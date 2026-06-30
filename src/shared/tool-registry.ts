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
import { auditLog } from "./audit.js";
import { compactDescription } from "./tool-filter.js";
import { withResultSizeHint } from "./result.js";
import { log } from "./logger.js";
import { traceToolCall } from "./telemetry.js";
import { assertTestMode } from "./errors.js";
import { checkRateLimit } from "./rate-limit.js";
import { getOAuthClaims, getRequestContext, runWithRequestContext, getActor } from "./request-context.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateScopeGate } from "./oauth-scope.js";

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

interface RegisteredToolEntry {
  handler: AnyFn;
  generation: number;
  inputSchema?: unknown;
  enabled: boolean;
  exposed: boolean;
  title?: string;
  description?: string;
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

class ToolRegistry {
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

  configureExposure(policy: ToolExposurePolicy): void {
    this.exposurePolicy = {
      mode: policy.mode,
      exposedToolNames: policy.exposedToolNames ? new Set(policy.exposedToolNames) : undefined,
    };
  }

  /** Search tools by query string (substring match on name, title, description). */
  searchTools(query: string, limit = 20, options: { allowedToolNames?: Set<string> } = {}): ToolInfo[] {
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
        else if (entry.descriptionLower?.includes(w)) score += 1;
      }
      if (score > 0) {
        scored.push({ info: { name, title: entry.title, description: entry.description }, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.info);
  }

  /** Get tool info by name. */
  getToolInfo(name: string): ToolInfo | undefined {
    const entry = this.tools.get(name);
    if (!entry) return undefined;
    return { name, title: entry.title, description: entry.description };
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
   * `server.registerTool()`, `server.prompt()`, and `server.registerPrompt()`
   * call automatically tracks the registration in this registry.
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
                  tool: name,
                  args: args[0] as Record<string, unknown>,
                  status: "error",
                  actor: getActor(),
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
                tool: name,
                args: args[0] as Record<string, unknown>,
                status: "error",
                actor: getActor(),
              });
            }
            throw new Error(msg);
          }

          const execute = async () => {
            const start = Date.now();
            try {
              let result = await handler(...args);
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                auditLog({
                  timestamp: new Date(start).toISOString(),
                  tool: name,
                  args: args[0] as Record<string, unknown>,
                  status: "ok",
                  durationMs: Date.now() - start,
                  actor: getActor(),
                });
              }
              result = autoSizeHint(result);
              return result;
            } catch (e) {
              if (process.env.AIRMCP_AUDIT_LOG !== "false") {
                auditLog({
                  timestamp: new Date(start).toISOString(),
                  tool: name,
                  args: args[0] as Record<string, unknown>,
                  status: "error",
                  durationMs: Date.now() - start,
                  actor: getActor(),
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
      const exposed = shouldExposeTool(name);
      // Compact mode: shorten descriptions sent to clients via SDK
      if (exposed && fullDescription) {
        config.description = compactDescription(fullDescription);
      }
      const result = exposed ? (origRegisterTool as AnyFn)(name, ...rest) : undefined;
      // Store FULL description in registry for discover_tools / semantic search
      const annotations = (config as { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } })
        .annotations;
      tools.set(name, {
        handler: wrapped,
        generation,
        inputSchema,
        enabled: true,
        exposed,
        title,
        description: fullDescription,
        titleLower: title?.toLowerCase(),
        descriptionLower: fullDescription?.toLowerCase(),
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
      // Store FULL description in registry for discover_tools / semantic search
      tools.set(name, {
        handler: wrapped,
        generation,
        inputSchema,
        enabled: true,
        exposed,
        description: fullDesc,
        descriptionLower: fullDesc?.toLowerCase(),
      });
      return result;
    }) as typeof server.tool;
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
