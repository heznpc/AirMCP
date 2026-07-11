/**
 * Self-managed registry that tracks tool and prompt registrations independently
 * of the MCP SDK internals. Eliminates `as any` casts to private SDK properties
 * (`_registeredTools`, `_registeredPrompts`).
 *
 * Usage: call `toolRegistry.installOn(server)` once before any module
 * registration. The registry wraps `server.tool()`, `server.prompt()`,
 * `server.registerTool()`, and `server.registerPrompt()` to intercept every
 * registration transparently — no module changes required.
 *
 * Safety: each wrapper validates the argument structure before interception.
 * If the MCP SDK changes its method signatures, the wrapper logs a clear
 * warning and falls through to the original method — the server keeps working,
 * just without registry tracking / usage instrumentation.
 */

import type { McpServer, AnyFn } from "./mcp.js";
import { usageTracker } from "./usage-tracker.js";
import { auditLog, readAuditEntries } from "./audit.js";
import { compactDescription } from "./tool-filter.js";
import { withResultSizeHint } from "./result.js";
import { log } from "./logger.js";
import { traceToolCall } from "./telemetry.js";
import { assertTestMode } from "./errors.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  getOAuthClaims,
  getRequestContext,
  runWithRequestContext,
  getActor,
  getCorrelationId,
} from "./request-context.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateScopeGate } from "./oauth-scope.js";
import { isErrorCategory, parseCategoryPrefix } from "./error-categories.js";
import { consumeApprovalAuditEvents, runWithApprovalAuditSink, type PendingApprovalAuditEvent } from "./hitl-guard.js";
import { isResourceTemplateRegistration, resourceAuditName, resourceRequestMetadata } from "./resource-governance.js";
import { runGovernedActivity } from "./governed-activity.js";

/** Threshold in characters above which we auto-attach a result size hint. */
const SIZE_HINT_THRESHOLD = 10_000;

/** If the tool result's text content exceeds SIZE_HINT_THRESHOLD, attach _meta size hint. */
function autoSizeHint(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as { content?: Array<{ text?: string }>; _meta?: Record<string, unknown> };
  if (!Array.isArray(r.content)) return result;
  // Already has an explicit hint — don't override.
  if (r._meta?.["anthropic/maxResultSizeChars"] !== undefined) return result;
  const totalChars = r.content.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
  if (totalChars <= SIZE_HINT_THRESHOLD) return result;
  // Scale hint to 2× actual size (headroom for next call), capped at 500K.
  return withResultSizeHint(r as Parameters<typeof withResultSizeHint>[0], totalChars * 2);
}

function isReturnedToolError(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { isError?: unknown }).isError === true;
}

interface SafeReturnedToolError {
  category?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  correlationId?: string;
}

/** Extract only stable, non-sensitive error metadata. Human messages, causes,
 * hints, structured payloads, and tool args never enter this envelope. */
function safeReturnedToolError(result: unknown): SafeReturnedToolError {
  if (!isReturnedToolError(result)) return {};
  const value = result as {
    structuredContent?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  const structured =
    value.structuredContent && typeof value.structuredContent === "object"
      ? (value.structuredContent as { error?: unknown })
      : undefined;
  const error =
    structured?.error && typeof structured.error === "object"
      ? (structured.error as Record<string, unknown>)
      : undefined;
  const firstText = value.content?.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  const typedCategory = error?.category;
  const category = isErrorCategory(typedCategory)
    ? typedCategory
    : typeof firstText === "string"
      ? parseCategoryPrefix(firstText)?.category
      : undefined;
  const retryAfterMs = error?.retryAfterMs;
  const correlationId = typeof error?.correlationId === "string" ? error.correlationId : getCorrelationId();
  return {
    ...(category ? { category } : {}),
    ...(typeof error?.retryable === "boolean" ? { retryable: error.retryable } : {}),
    ...(typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? { retryAfterMs } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

/** Success output schemas describe only successful structuredContent. The MCP
 * client validates any structuredContent it receives against that schema,
 * including isError results, so typed error payloads would become a JSON-RPC
 * -32602 instead of the intended tool denial. For schema-bearing tools only,
 * remove the incompatible payload and preserve a minimal safe envelope in
 * namespaced result metadata. Tools without outputSchema keep their existing
 * structuredContent error contract. */
function normalizeOutputSchemaToolError(result: unknown, error: SafeReturnedToolError): unknown {
  if (!isReturnedToolError(result)) return result;
  const { structuredContent: _structured, _meta: existingMeta, ...rest } = result as Record<string, unknown>;
  void _structured;
  const safeExistingMeta =
    existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)
      ? (existingMeta as Record<string, unknown>)
      : {};
  const mergedMeta = {
    ...safeExistingMeta,
    ...(Object.keys(error).length > 0 ? { "airmcp/error": error } : {}),
  };
  return {
    ...rest,
    ...(Object.keys(mergedMeta).length > 0 ? { _meta: mergedMeta } : {}),
  };
}

function thrownErrorCategory(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return parseCategoryPrefix(error.message)?.category;
}

async function sealApprovalAuditEvent(event: PendingApprovalAuditEvent): Promise<void> {
  if (process.env.AIRMCP_AUDIT_LOG === "false") {
    // Disabling general audit emission is an operator-supported diagnostic
    // mode, but it cannot turn an approved HITL callback into an ungoverned
    // mutation. Negative decisions already fail at the guard and may preserve
    // their normal permission result without a durable row.
    if (event.decision === "approved") {
      throw new Error(`[internal_error] Approval audit is disabled; "${event.tool}" was not executed.`);
    }
    return;
  }
  const correlationId = event.correlationId ?? getCorrelationId();
  auditLog({
    approvalId: event.approvalId,
    timestamp: event.timestamp,
    kind: "approval",
    tool: event.tool,
    status: event.decision === "approved" ? "ok" : "error",
    actor: event.actor ?? getActor(),
    correlationId,
    approvalDecision: event.decision,
    approvalChannel: event.channel,
  });
  // readAuditEntries seals the pending buffer into the HMAC chain before it
  // scans. Awaiting that barrier is intentional: an approved callback must
  // not reach its mutation until the decision is durable and queryable.
  try {
    const snapshot = await readAuditEntries({
      since: event.timestamp,
      tool: event.tool,
      kind: "approval",
      ...(correlationId ? { correlationId } : {}),
      limit: 10,
    });
    if (event.decision !== "approved") return;
    const decisionIsSealed = snapshot.entries.some(
      (entry) =>
        entry.approvalId === event.approvalId &&
        entry.timestamp === event.timestamp &&
        entry.kind === "approval" &&
        entry.tool === event.tool &&
        entry.correlationId === correlationId &&
        entry.approvalDecision === event.decision &&
        entry.approvalChannel === event.channel,
    );
    if (!snapshot.verified || snapshot.auditDisabled || !decisionIsSealed) {
      throw new Error("approval audit verification failed");
    }
  } catch {
    // A positive decision is not authority to mutate until the exact event is
    // present in the verified chain. Negative/unavailable decisions already
    // fail closed at the HITL guard, so preserve their permission-error result
    // even if the audit device is unhealthy.
    if (event.decision === "approved") {
      throw new Error(`[internal_error] Approval audit could not be verified; "${event.tool}" was not executed.`);
    }
  }
}

async function sealPendingApprovalAuditEvents(): Promise<void> {
  const events = consumeApprovalAuditEvents();
  for (const event of events) {
    await sealApprovalAuditEvent(event);
  }
}

interface RegisteredToolEntry {
  handler: AnyFn;
  generation: number;
  inputSchema?: unknown;
  outputSchema?: unknown;
  enabled: boolean;
  exposed: boolean;
  title?: string;
  fullDescription?: string;
  summaryDescription?: string;
  titleLower?: string;
  descriptionLower?: string;
  /** Captured from `annotations.destructiveHint` at registration time —
   *  consulted by the rate limiter and audit summaries so we don't
   *  have to re-parse the opts each call. */
  destructive?: boolean;
  /** Captured from `annotations.readOnlyHint` at registration time. Used
   *  by the OAuth scope gate to map tools onto mcp:read / mcp:write /
   *  mcp:destructive per RFC 0005 §3.4 without re-parsing opts. */
  readOnly?: boolean;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
}

export type ToolDescriptionMode = "summary" | "full" | "none";

export interface ToolDetails extends ToolInfo {
  exposed: boolean;
  destructive?: boolean;
  readOnly?: boolean;
}

export interface OutputSchemaToolInfo {
  name: string;
  outputSchema: unknown;
}

export interface ToolExposurePolicy {
  mode: "full" | "profile" | "progressive";
  exposedToolNames?: Set<string>;
}

interface RegisteredPromptEntry {
  callback: AnyFn;
  generation: number;
}

export class ToolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputValidationError";
  }
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredToolEntry>();
  private prompts = new Map<string, RegisteredPromptEntry>();
  private exposurePolicy: ToolExposurePolicy = { mode: "full" };
  private registrationGeneration = 0;
  // ── Tool accessors ──────────────────────────────────────────────

  getToolCount(): number {
    return this.tools.size;
  }

  getExposedToolCount(): number {
    return this.getExposedToolNames().length;
  }

  /** Get all tool names. */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Get tool names currently advertised through the MCP SDK tools/list surface. */
  getExposedToolNames(): string[] {
    return [...this.tools.entries()].filter(([, entry]) => entry.enabled && entry.exposed).map(([name]) => name);
  }

  getExposureMode(): ToolExposurePolicy["mode"] {
    return this.exposurePolicy.mode;
  }

  /** Registered tools that declare an SDK output schema. Used by contract
   *  tests and diagnostics to derive the inventory from real registration
   *  calls instead of maintaining a parallel hand-written tool list. */
  getOutputSchemaTools(): OutputSchemaToolInfo[] {
    const out: OutputSchemaToolInfo[] = [];
    for (const [name, entry] of this.tools) {
      if (entry.outputSchema !== undefined) out.push({ name, outputSchema: entry.outputSchema });
    }
    return out;
  }

  configureExposure(policy: ToolExposurePolicy): void {
    this.exposurePolicy = {
      mode: policy.mode,
      exposedToolNames: policy.exposedToolNames ? new Set(policy.exposedToolNames) : undefined,
    };
  }

  /** Search tools by query string (substring match on name, title, description). */
  searchTools(
    query: string,
    limit = 20,
    options: { allowedToolNames?: Set<string>; descriptionMode?: ToolDescriptionMode } = {},
  ): ToolInfo[] {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const scored: Array<{ info: ToolInfo; score: number }> = [];

    for (const [name, entry] of this.tools) {
      if (!entry.enabled) continue;
      if (options.allowedToolNames && !options.allowedToolNames.has(name)) continue;
      let score = 0;
      for (const w of words) {
        if (name.includes(w)) score += 3;
        else if (entry.titleLower?.includes(w)) score += 2;
        else if (this.getDescriptionLower(entry)?.includes(w)) score += 1;
      }
      if (score > 0) {
        scored.push({ info: this.toToolInfo(name, entry, options.descriptionMode ?? "summary"), score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.info);
  }

  /** Get tool info by name. */
  getToolInfo(name: string, options: { descriptionMode?: ToolDescriptionMode } = {}): ToolInfo | undefined {
    const entry = this.tools.get(name);
    if (!entry) return undefined;
    return this.toToolInfo(name, entry, options.descriptionMode ?? "full");
  }

  getToolDetails(name: string, options: { descriptionMode?: ToolDescriptionMode } = {}): ToolDetails | undefined {
    const entry = this.tools.get(name);
    if (!entry) return undefined;
    return {
      ...this.toToolInfo(name, entry, options.descriptionMode ?? "full"),
      exposed: entry.exposed,
      ...(entry.destructive !== undefined ? { destructive: entry.destructive } : {}),
      ...(entry.readOnly !== undefined ? { readOnly: entry.readOnly } : {}),
    };
  }

  private getDescriptionLower(entry: RegisteredToolEntry): string | undefined {
    if (entry.descriptionLower !== undefined) return entry.descriptionLower;
    entry.descriptionLower = entry.fullDescription?.toLowerCase();
    return entry.descriptionLower;
  }

  private getSummaryDescription(entry: RegisteredToolEntry): string | undefined {
    if (!entry.fullDescription) return undefined;
    entry.summaryDescription ??= compactDescription(entry.fullDescription);
    return entry.summaryDescription;
  }

  private toToolInfo(name: string, entry: RegisteredToolEntry, descriptionMode: ToolDescriptionMode): ToolInfo {
    const description =
      descriptionMode === "none"
        ? undefined
        : descriptionMode === "summary"
          ? this.getSummaryDescription(entry)
          : entry.fullDescription;
    return {
      name,
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  }

  /**
   * Invoke a registered tool by name, as the skill executor needs.
   * Throws if the tool is not found or is disabled.
   *
   * Passes through `structuredContent` (outputSchema-validated JSON) and
   * `_meta` so callers that chain tools together — the skill executor in
   * particular — can consume the typed payload directly instead of
   * re-parsing the text content. The wire format for normal MCP clients
   * is unaffected because this method is only reached via direct in-process
   * calls.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
    structuredContent?: unknown;
    _meta?: Record<string, unknown>;
  }> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    if (!tool.enabled) throw new Error(`Tool "${name}" is disabled`);
    const validatedArgs = validateToolArgs(name, tool.inputSchema, args);
    const raw = (await tool.handler(validatedArgs, {})) as {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
      structuredContent?: unknown;
      _meta?: Record<string, unknown>;
    };
    return {
      content: raw.content ?? [],
      ...(raw.isError !== undefined ? { isError: raw.isError } : {}),
      ...(raw.structuredContent !== undefined ? { structuredContent: raw.structuredContent } : {}),
      ...(raw._meta !== undefined ? { _meta: raw._meta } : {}),
    };
  }

  // ── Prompt accessors ────────────────────────────────────────────

  getPromptCount(): number {
    return this.prompts.size;
  }

  getPromptNames(): string[] {
    return [...this.prompts.keys()];
  }

  getPromptCallback(name: string): AnyFn | undefined {
    return this.prompts.get(name)?.callback;
  }

  // ── Registration interceptors ───────────────────────────────────

  /**
   * Install interception on the server so every `server.tool()`,
   * `server.registerTool()`, `server.registerResource()`, `server.prompt()`,
   * and `server.registerPrompt()` call automatically traverses core policy.
   *
   * Must be called once per server, before any module registrations.
   * Call this BEFORE `installHitlGuard` — the HITL guard will then become
   * the outermost wrapper, and the registry's stored handler will be
   * `audit(HITL(callback))`. This guarantees that calling tools via
   * `callTool()` (e.g. from the skill executor) still routes through HITL
   * approval, instead of bypassing it.
   *
   * In HTTP mode, multiple sessions create servers and call this method.
   * Only the first call clears the registry; subsequent calls overwrite
   * entries so concurrent sessions never see an empty registry during
   * the async gap between clear and re-registration.
   */
  installOn(server: McpServer): void {
    if (this.tools.size === 0) {
      this.tools.clear();
      this.prompts.clear();
    }
    this.registrationGeneration += 1;
    const generation = this.registrationGeneration;
    this.interceptToolRegistration(server, generation);
    this.interceptResourceRegistration(server);
    this.interceptPromptRegistration(server, generation);
  }

  /**
   * Remove registrations from older server generations. HTTP warmup can
   * construct a new server with a narrower profile while the singleton still
   * contains the previous session's wider registry; pruning after all modules
   * register keeps discovery/call_tool aligned with the active profile without
   * creating an empty-registry race window during startup.
   */
  pruneStaleRegistrations(): void {
    for (const [name, entry] of this.tools) {
      if (entry.generation !== this.registrationGeneration) this.tools.delete(name);
    }
    for (const [name, entry] of this.prompts) {
      if (entry.generation !== this.registrationGeneration) this.prompts.delete(name);
    }
  }

  /**
   * Reset the registry. For test isolation only. Guarded by `assertTestMode`
   * so a production caller with a reference to the singleton cannot wipe every
   * registered tool/prompt at runtime.
   */
  reset(): void {
    assertTestMode("ToolRegistry.reset()");
    this.tools.clear();
    this.prompts.clear();
    this.exposurePolicy = { mode: "full" };
    this.registrationGeneration = 0;
  }

  /**
   * Validate that the last argument is a function (the callback).
   * Returns the callback on success, or null if validation fails (with a warning logged).
   */
  private validateCallback(
    method: string,
    entityType: string,
    name: string,
    rest: unknown[],
    origFn: AnyFn,
  ): AnyFn | null {
    const lastArg = rest[rest.length - 1];
    if (typeof lastArg !== "function") {
      log.warn("SDK signature mismatch — registered without interception", {
        method,
        entityType,
        name,
        note: "callback not found at expected position; SDK may have changed",
      });
      origFn(name, ...rest);
      return null;
    }
    return lastArg as AnyFn;
  }

  private interceptToolRegistration(server: McpServer, generation: number): void {
    const origRegisterTool = server.registerTool.bind(server);
    const tools = this.tools;
    const shouldExposeTool = (name: string): boolean => {
      if (this.exposurePolicy.mode !== "progressive") return true;
      return this.exposurePolicy.exposedToolNames?.has(name) === true;
    };

    const wrapHandler = (name: string, handler: AnyFn): AnyFn => {
      return (async (...args: unknown[]) => {
        return runGovernedActivity(async () => {
          if (process.env.AIRMCP_USAGE_TRACKING !== "false") usageTracker.record(name);

          const entry = tools.get(name);

          // Stamp a correlation ID on the active context (or open one if
          // the call came in over stdio with no upstream middleware) so
          // every audit / telemetry / error line for this tool call shares
          // an identifier. Honors any ID already set by a transport
          // middleware so external tracing systems can drive it.
          const existing = getRequestContext();
          if (!existing?.correlationId) {
            const ctx = { ...(existing ?? {}), correlationId: randomUUID() };
            return runWithRequestContext(ctx, () => runWrapped());
          }
          return runWrapped();

          async function runWrapped(): Promise<unknown> {
            // OAuth scope gate (RFC 0005 §3.4 — Step 2). Runs BEFORE the
            // rate-limit bucket so a token missing `mcp:destructive` can't
            // burn the destructive bucket's budget just to hit a 403.
            // Absence of claims means we're on a non-OAuth path (stdio,
            // loopback, legacy Bearer) — skip the gate entirely.
            const claims = getOAuthClaims();
            if (claims) {
              const decision = evaluateScopeGate({
                toolName: name,
                isReadOnly: entry?.readOnly === true,
                isDestructive: entry?.destructive === true,
                callerScopes: claims.scopes,
              });
              if (!decision.allowed) {
                const msg = `[forbidden] scope ${decision.missing} required for tool "${name}"`;
                if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                  auditLog({
                    timestamp: new Date().toISOString(),
                    kind: "tool",
                    tool: name,
                    args: args[0] as Record<string, unknown>,
                    status: "error",
                    actor: getActor(),
                    errorCategory: "permission_denied",
                    gate: "oauth_scope",
                  });
                }
                throw new Error(msg);
              }
            }

            // Rate-limit + emergency-stop gate. Runs before the call reaches
            // the handler so a runaway agent burning through the bucket can
            // never touch the filesystem/APIs on the denied call. Denials
            // throw so the error is captured by audit and surfaces to the
            // caller with the same shape as any other failure.
            // Tenant isolation: when OAuth claims are present (HTTP transport),
            // the bucket is keyed on the JWT subject so one tenant's runaway
            // agent can't exhaust budget for everyone else. Stdio / loopback
            // share the default tenant.
            const gate = checkRateLimit(entry?.destructive === true, claims?.subject);
            if (!gate.allowed) {
              const msg = `[rate_limited] ${gate.reason ?? "Rate limit exceeded"}${
                gate.retryAfterMs ? ` (retry in ~${Math.ceil(gate.retryAfterMs / 1000)}s)` : ""
              }`;
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                auditLog({
                  timestamp: new Date().toISOString(),
                  kind: "tool",
                  tool: name,
                  args: args[0] as Record<string, unknown>,
                  status: "error",
                  actor: getActor(),
                  errorCategory: "rate_limited",
                  gate: gate.gate ?? "rate_limit",
                });
              }
              throw new Error(msg);
            }

            const execute = async () => {
              const start = Date.now();
              try {
                // HITL normally runs inside this registry wrapper and seals its
                // decision through the sink. The pending-event drain covers the
                // inverse wrapper order and still runs before the callback.
                await sealPendingApprovalAuditEvents();
                let result = await runWithApprovalAuditSink(sealApprovalAuditEvent, () => handler(...args));
                const returnedError = isReturnedToolError(result);
                const safeError = safeReturnedToolError(result);
                const errorCategory = safeError.category;
                if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                  auditLog({
                    timestamp: new Date().toISOString(),
                    kind: "tool",
                    tool: name,
                    args: args[0] as Record<string, unknown>,
                    status: returnedError ? "error" : "ok",
                    durationMs: Date.now() - start,
                    actor: getActor(),
                    ...(errorCategory ? { errorCategory } : {}),
                  });
                }
                if (returnedError && entry?.outputSchema !== undefined) {
                  result = normalizeOutputSchemaToolError(result, safeError);
                }
                result = autoSizeHint(result);
                return result;
              } catch (e) {
                const errorCategory = thrownErrorCategory(e);
                if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                  auditLog({
                    timestamp: new Date().toISOString(),
                    kind: "tool",
                    tool: name,
                    args: args[0] as Record<string, unknown>,
                    status: "error",
                    durationMs: Date.now() - start,
                    actor: getActor(),
                    ...(errorCategory ? { errorCategory } : {}),
                  });
                }
                throw e;
              }
            };

            if (process.env.AIRMCP_TELEMETRY === "true") {
              const toolArgs = args[0] as Record<string, unknown> | undefined;
              return traceToolCall(name, toolArgs ? Object.keys(toolArgs).length : 0, execute);
            }
            return execute();
          }
        });
      }) as AnyFn;
    };

    server.registerTool = ((name: string, ...rest: unknown[]) => {
      const callback = this.validateCallback("registerTool", "Tool", name, rest, origRegisterTool as AnyFn);
      if (!callback) return;

      // Validate config is an object (expected at rest[0])
      const hasConfig = rest.length >= 2;
      if (hasConfig && (typeof rest[0] !== "object" || rest[0] === null)) {
        log.warn("registerTool() config is not an object — registered without interception", {
          name,
          configType: typeof rest[0],
        });
        return (origRegisterTool as AnyFn)(name, ...rest);
      }
      const wrapped = wrapHandler(name, callback);
      rest[rest.length - 1] = wrapped;
      const config = hasConfig ? (rest[0] as Record<string, unknown>) : {};
      const title = config.title as string | undefined;
      const fullDescription = config.description as string | undefined;
      const inputSchema = config.inputSchema;
      const outputSchema = config.outputSchema;
      const exposed = shouldExposeTool(name);
      // Compact mode: shorten descriptions sent to clients via SDK
      if (exposed && fullDescription) {
        config.description = compactDescription(fullDescription);
      }
      const result = exposed ? (origRegisterTool as AnyFn)(name, ...rest) : undefined;
      // Store the full description lazily for describe_tool / search scoring.
      const annotations = (config as { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } })
        .annotations;
      tools.set(name, {
        handler: wrapped,
        generation,
        inputSchema,
        outputSchema,
        enabled: true,
        exposed,
        title,
        fullDescription,
        summaryDescription: exposed ? (config.description as string | undefined) : undefined,
        titleLower: title?.toLowerCase(),
        destructive: annotations?.destructiveHint === true,
        readOnly: annotations?.readOnlyHint === true,
      });
      return result;
    }) as typeof server.registerTool;

    const origTool = server.tool.bind(server);
    server.tool = ((name: string, ...rest: unknown[]) => {
      const callback = this.validateCallback("tool", "Tool", name, rest, origTool as AnyFn);
      if (!callback) return;
      const wrapped = wrapHandler(name, callback);
      rest[rest.length - 1] = wrapped;
      // Legacy tool() — description is the 2nd arg if it's a string
      const fullDesc = typeof rest[0] === "string" ? rest[0] : undefined;
      const inputSchema = typeof rest[0] === "string" ? rest[1] : rest[0];
      const exposed = shouldExposeTool(name);
      // Compact mode: shorten description sent to clients via SDK
      if (exposed && fullDesc) {
        rest[0] = compactDescription(fullDesc);
      }
      const result = exposed ? (origTool as AnyFn)(name, ...rest) : undefined;
      // Store the full description lazily for describe_tool / search scoring.
      tools.set(name, {
        handler: wrapped,
        generation,
        inputSchema,
        enabled: true,
        exposed,
        fullDescription: fullDesc,
        summaryDescription: exposed ? (rest[0] as string | undefined) : undefined,
      });
      return result;
    }) as typeof server.tool;
  }

  /** Route MCP resource reads through the same scope, rate, HITL audit sink,
   * and outcome audit boundary as tool calls. Resource contents are never
   * included in audit args; only URI/template variables are recorded. */
  private interceptResourceRegistration(server: McpServer): void {
    if (typeof server.registerResource !== "function") return;
    const origRegisterResource = server.registerResource.bind(server);

    const wrapHandler = (name: string, handler: AnyFn, isTemplate: boolean): AnyFn => {
      const activityName = resourceAuditName(name);
      return (async (...args: unknown[]) => {
        return runGovernedActivity(async () => {
          const existing = getRequestContext();
          if (!existing?.correlationId) {
            return runWithRequestContext({ ...(existing ?? {}), correlationId: randomUUID() }, () => runWrapped());
          }
          return runWrapped();

          async function runWrapped(): Promise<unknown> {
            const requestMetadata = resourceRequestMetadata(args, isTemplate);
            const claims = getOAuthClaims();
            if (claims) {
              const decision = evaluateScopeGate({
                toolName: activityName,
                isReadOnly: true,
                isDestructive: false,
                callerScopes: claims.scopes,
              });
              if (!decision.allowed) {
                if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                  auditLog({
                    timestamp: new Date().toISOString(),
                    kind: "tool",
                    tool: activityName,
                    args: requestMetadata,
                    status: "error",
                    actor: getActor(),
                    errorCategory: "permission_denied",
                    gate: "oauth_scope",
                  });
                }
                throw new Error(`[forbidden] scope ${decision.missing} required for resource "${name}"`);
              }
            }

            const gate = checkRateLimit(false, claims?.subject);
            if (!gate.allowed) {
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                auditLog({
                  timestamp: new Date().toISOString(),
                  kind: "tool",
                  tool: activityName,
                  args: requestMetadata,
                  status: "error",
                  actor: getActor(),
                  errorCategory: "rate_limited",
                  gate: gate.gate ?? "rate_limit",
                });
              }
              throw new Error(
                `[rate_limited] ${gate.reason ?? "Rate limit exceeded"}${
                  gate.retryAfterMs ? ` (retry in ~${Math.ceil(gate.retryAfterMs / 1000)}s)` : ""
                }`,
              );
            }

            const start = Date.now();
            try {
              await sealPendingApprovalAuditEvents();
              const result = await runWithApprovalAuditSink(sealApprovalAuditEvent, () => handler(...args));
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                auditLog({
                  timestamp: new Date().toISOString(),
                  kind: "tool",
                  tool: activityName,
                  args: requestMetadata,
                  status: "ok",
                  durationMs: Date.now() - start,
                  actor: getActor(),
                });
              }
              return result;
            } catch (error) {
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                const errorCategory = thrownErrorCategory(error);
                auditLog({
                  timestamp: new Date().toISOString(),
                  kind: "tool",
                  tool: activityName,
                  args: requestMetadata,
                  status: "error",
                  durationMs: Date.now() - start,
                  actor: getActor(),
                  ...(errorCategory ? { errorCategory } : {}),
                });
              }
              throw error;
            }
          }
        });
      }) as AnyFn;
    };

    server.registerResource = ((name: string, ...rest: unknown[]) => {
      const callback = this.validateCallback("registerResource", "Resource", name, rest, origRegisterResource as AnyFn);
      if (!callback) return;
      const isTemplate = isResourceTemplateRegistration(rest[0]);
      rest[rest.length - 1] = wrapHandler(name, callback, isTemplate);
      return (origRegisterResource as AnyFn)(name, ...rest);
    }) as typeof server.registerResource;
  }

  private interceptPromptRegistration(server: McpServer, generation: number): void {
    const origRegisterPrompt = server.registerPrompt.bind(server);
    const prompts = this.prompts;
    server.registerPrompt = ((name: string, ...rest: unknown[]) => {
      const cb = this.validateCallback("registerPrompt", "Prompt", name, rest, origRegisterPrompt as AnyFn);
      if (!cb) return;
      const result = (origRegisterPrompt as AnyFn)(name, ...rest);
      prompts.set(name, { callback: cb, generation });
      return result;
    }) as typeof server.registerPrompt;

    const origPrompt = server.prompt.bind(server);
    server.prompt = ((name: string, ...rest: unknown[]) => {
      const cb = this.validateCallback("prompt", "Prompt", name, rest, origPrompt as AnyFn);
      if (!cb) return;
      const result = (origPrompt as AnyFn)(name, ...rest);
      prompts.set(name, { callback: cb, generation });
      return result;
    }) as typeof server.prompt;
  }
}

interface SafeParseSchema {
  safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

function isSafeParseSchema(value: unknown): value is SafeParseSchema {
  return (
    value !== null &&
    typeof value === "object" &&
    "safeParse" in value &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

function isZodRawShape(value: unknown): value is z.ZodRawShape {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isSafeParseSchema);
}

function formatValidationIssues(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return String(error);
  return issues
    .map((issue) => {
      const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "arguments";
      return `${path}: ${issue.message ?? "invalid value"}`;
    })
    .join("; ");
}

function coerceValidatedObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function validateToolArgs(name: string, inputSchema: unknown, args: Record<string, unknown>): Record<string, unknown> {
  if (isZodRawShape(inputSchema) && Object.keys(inputSchema).length === 0) return args;
  const schema = isSafeParseSchema(inputSchema)
    ? inputSchema
    : isZodRawShape(inputSchema)
      ? z.object(inputSchema)
      : null;
  if (!schema) return args;

  const parsed = schema.safeParse(args);
  if (parsed.success) return coerceValidatedObject(parsed.data);
  throw new ToolInputValidationError(`Invalid arguments for tool "${name}": ${formatValidationIssues(parsed.error)}`);
}

/** Singleton registry instance — shared across the process. */
export const toolRegistry = new ToolRegistry();

/** Create an isolated executable registry for one MCP server instance.
 *
 * HTTP transport creates one McpServer per session. Sharing executable
 * handlers between those servers lets a later session overwrite an earlier
 * session's callback (including its HITL elicitation channel). Runtime server
 * construction must therefore use this factory and close all in-process
 * dispatch over the returned registry. The exported singleton remains for
 * backwards-compatible direct registration and unit-test use. */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
