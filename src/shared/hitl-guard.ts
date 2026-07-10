import type { McpServer } from "./mcp.js";
import type { AirMcpConfig, HitlLevel } from "./config.js";
import type { HitlApprovalDecision, HitlClient } from "./hitl.js";
import { errPermission, toolErr } from "./result.js";
import { traceApproval } from "./telemetry.js";
import { getRequestContext, runWithRequestContext, type RequestContext } from "./request-context.js";

/** Sentinel: elicitation offered no channel for this call — caller falls back. */
const NOT_HANDLED = Symbol("hitl-elicitation-not-handled");

export interface PendingApprovalAuditEvent {
  timestamp: string;
  tool: string;
  decision: HitlApprovalDecision;
  channel: "elicitation" | "socket" | "unavailable";
  correlationId?: string;
  actor?: string;
}

type ApprovalAuditSink = (event: PendingApprovalAuditEvent) => void | Promise<void>;

interface ApprovalRequestContext extends RequestContext {
  __airmcpApprovalAuditEvents?: PendingApprovalAuditEvent[];
  __airmcpApprovalAuditSink?: ApprovalAuditSink;
}

function normalizeApprovalDecision(value: unknown): HitlApprovalDecision {
  switch (value) {
    case "approved":
    case "denied":
    case "timed_out":
    case "unavailable":
      return value;
    default:
      return "unavailable";
  }
}

async function recordApprovalDecision(
  tool: string,
  decision: PendingApprovalAuditEvent["decision"],
  channel: PendingApprovalAuditEvent["channel"],
): Promise<void> {
  const context = getRequestContext() as ApprovalRequestContext | undefined;
  if (!context) return;
  const event: PendingApprovalAuditEvent = {
    timestamp: new Date().toISOString(),
    tool,
    decision,
    channel,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context.actor ? { actor: context.actor } : {}),
  };
  if (context.__airmcpApprovalAuditSink) {
    await context.__airmcpApprovalAuditSink(event);
    return;
  }
  const events = context.__airmcpApprovalAuditEvents ?? [];
  events.push(event);
  context.__airmcpApprovalAuditEvents = events;
}

/** Run a guarded handler with the registry-owned durable audit sink. The HITL
 * wrapper awaits this sink before invoking an approved callback, so the
 * approval row is sealed before any mutation can begin. */
export function runWithApprovalAuditSink<T>(sink: ApprovalAuditSink, fn: () => T): T {
  const context = getRequestContext() as ApprovalRequestContext | undefined;
  const nextContext = {
    ...(context ?? {}),
    __airmcpApprovalAuditSink: sink,
  } as ApprovalRequestContext;
  return runWithRequestContext(nextContext, fn);
}

/** Consume decisions queued when HITL wrapped the registry rather than the
 * registry wrapping HITL. Sharing and splicing the array keeps nested request
 * contexts from replaying the same event. */
export function consumeApprovalAuditEvents(): PendingApprovalAuditEvent[] {
  const context = getRequestContext() as ApprovalRequestContext | undefined;
  if (!context?.__airmcpApprovalAuditEvents?.length) return [];
  return context.__airmcpApprovalAuditEvents.splice(0);
}

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  sensitiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Clients where MCP elicitation should be skipped.
 *
 * All Claude products (Desktop, Code, Cowork, Managed Agents, etc.) are detected
 * via the "claude" prefix on `clientInfo.name`. Non-Claude managed clients can be
 * added via the `AIRMCP_MANAGED_CLIENTS` env var (comma-separated, case-insensitive).
 *
 * Socket-based HITL remains active as it's a separate, explicit channel.
 */

let extraManagedClients: ReadonlySet<string> | undefined;

function getExtraManagedClients(): ReadonlySet<string> {
  if (!extraManagedClients) {
    const raw = process.env.AIRMCP_MANAGED_CLIENTS ?? "";
    extraManagedClients = new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return extraManagedClients;
}

/**
 * Returns true if the connected MCP client has its own permission management,
 * making MCP elicitation redundant (would cause double-approval).
 *
 * Detection: "claude" prefix covers all Anthropic clients (Claude Code, Desktop,
 * Cowork, Managed Agents). `AIRMCP_MANAGED_CLIENTS` env var covers third-party
 * managed clients in enterprise deployments.
 */
function isManagedClient(server: McpServer): boolean {
  try {
    const info = server.server?.getClientVersion?.();
    if (!info?.name) return false;
    const name = info.name.toLowerCase();
    return name.startsWith("claude") || getExtraManagedClients().has(name);
  } catch {
    return false;
  }
}

/**
 * Pure gating predicate: does a tool with these annotations require HITL
 * approval at the given level? Exported so tests can lock the monotonic
 * ordering off ⊆ destructive-only ⊆ sensitive-only ⊆ all-writes ⊆ all
 * (review finding #3/#5). No side effects.
 */
export function shouldRequireApproval(
  level: HitlLevel,
  annotations: ToolAnnotations,
  whitelist: Set<string>,
  toolName: string,
): boolean {
  if (whitelist.has(toolName)) return false;
  switch (level) {
    case "off":
      return false;
    case "destructive-only":
      return annotations.destructiveHint === true;
    case "sensitive-only":
      return annotations.destructiveHint === true || annotations.sensitiveHint === true;
    case "all-writes":
      // Must be a superset of "sensitive-only": the init wizard presents
      // Recommended(sensitive-only) then Strict(all-writes) as increasing
      // strictness, so anything sensitive-only gates must also gate here.
      // Plain `readOnlyHint === false` missed sensitive-but-readonly tools
      // (health_*, get_clipboard, capture_screen, ui_read) which carry
      // readOnlyHint: true + sensitiveHint: true — breaking monotonicity.
      return (
        annotations.readOnlyHint === false || annotations.destructiveHint === true || annotations.sensitiveHint === true
      );
    case "all":
      return true;
  }
}

/**
 * Try MCP Elicitation (form mode) for approval. Returns undefined if
 * the client does not support elicitation, letting the caller fall back.
 */
async function tryElicitApproval(
  server: McpServer,
  toolName: string,
  toolArgs: Record<string, unknown>,
  destructive: boolean,
  sensitive: boolean,
): Promise<boolean | undefined> {
  // RFC 0008 §3.3 — operator opt-out for end-to-end scripted pipelines
  // that don't want any user prompt. When set, every call falls through
  // to the socket HITL channel (or the no-prompt path) just like a
  // client that doesn't advertise elicitation.
  if (process.env.AIRMCP_ELICITATION_DISABLE === "true") return undefined;

  try {
    const inner = server.server;
    if (!inner?.elicitInput) return undefined;

    // RFC 0008 §3.2 — capability gate. Honoring the negotiated capability
    // up-front avoids waiting on a doomed request when the client declared
    // no elicitation support; the try/catch around the call below stays as
    // a belt-and-suspenders fallback for clients that lie about it.
    const caps = inner.getClientCapabilities?.();
    if (caps && !caps.elicitation) return undefined;

    const label = destructive
      ? `⚠️ Destructive: ${toolName}`
      : sensitive
        ? `⚠️ Sensitive: ${toolName}`
        : `Approve: ${toolName}`;
    const argsSummary = JSON.stringify(toolArgs, null, 2).slice(0, 500);

    const result = await inner.elicitInput({
      message: `${label}\n\nArguments:\n${argsSummary}`,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: `Allow "${toolName}" to execute?`,
            default: false,
          },
        },
        required: ["approve"],
      },
    });

    if (result.action === "accept" && result.content?.approve === true) {
      return true;
    }
    return false;
  } catch {
    // Client doesn't support elicitation — return undefined to signal fallback
    return undefined;
  }
}

/**
 * Monkey-patches server.registerTool so every subsequent registration
 * goes through HITL approval when the policy requires it.
 *
 * Channel order (gated-call approval is preserved in every path — only the
 * channel that answers differs by what is actually available):
 * - non-managed clients: MCP elicitation → socket HITL → deny
 * - managed clients:     socket HITL (if reachable) → MCP elicitation →
 *                        deny with an actionable message
 *
 * Managed clients (the Claude family + AIRMCP_MANAGED_CLIENTS) run their own
 * per-call permission prompt, so elicitation is skipped while the socket can
 * answer — the menubar app stays the explicit approver when it is running.
 * But in the default headless setup (`npx airmcp`, no companion app) nothing
 * listens on that socket, and the old order hard-denied every gated tool out
 * of the box — issue #28's reporter resolved it by setting hitl level "off",
 * i.e. the safety feature got disabled by its own UX. Falling back to
 * elicitation keeps a human in the loop instead (RFC 0008 Phase 1.5).
 */
export function installHitlGuard(server: McpServer, hitlClient: HitlClient, config: AirMcpConfig): void {
  const original = server.registerTool.bind(server);

  const patched = (
    name: string,
    toolConfig: { annotations?: ToolAnnotations; [key: string]: unknown },
    callback: (...args: unknown[]) => unknown,
  ) => {
    const annotations: ToolAnnotations = toolConfig.annotations ?? {};

    if (!shouldRequireApproval(config.hitl.level, annotations, config.hitl.whitelist, name)) {
      return original(name, toolConfig as Parameters<typeof original>[1], callback as Parameters<typeof original>[2]);
    }

    const telemetryEnabled = process.env.AIRMCP_TELEMETRY === "true";

    const wrapped = async (...args: unknown[]) => {
      const toolArgs = (args[0] ?? {}) as Record<string, unknown>;
      const destructive = annotations.destructiveHint ?? false;
      const sensitive = annotations.sensitiveHint ?? false;
      const managed = isManagedClient(server);

      // Resolve the call through MCP elicitation. Returns NOT_HANDLED when the
      // client offers no elicitation channel, so the caller can fall back.
      const viaElicitation = async (): Promise<unknown> => {
        const elicitResult = await tryElicitApproval(server, name, toolArgs, destructive, sensitive);
        if (elicitResult === undefined) return NOT_HANDLED;
        if (telemetryEnabled) {
          traceApproval(name, elicitResult ? "approved" : "denied", "elicitation", { destructive, managed });
        }
        await recordApprovalDecision(name, elicitResult ? "approved" : "denied", "elicitation");
        if (!elicitResult) {
          return errPermission(`Action denied: "${name}" was rejected via MCP elicitation.`);
        }
        return (callback as (...a: unknown[]) => unknown)(...args);
      };

      if (!managed) {
        // Elicitation first — managed clients skip it here to avoid a double
        // prompt on top of their own per-call permission UX.
        const handled = await viaElicitation();
        if (handled !== NOT_HANDLED) return handled;
      } else if (!(await hitlClient.isReachable())) {
        // Managed client, but nothing is listening on the approval socket
        // (headless `npx airmcp` without the menubar app). Elicitation is the
        // only channel that can still put a human in the loop — use it.
        const handled = await viaElicitation();
        if (handled !== NOT_HANDLED) return handled;
        // No approval channel exists at all: deny this call, and say how to fix it.
        if (telemetryEnabled) {
          traceApproval(name, "denied", "unavailable", { destructive, managed });
        }
        await recordApprovalDecision(name, "unavailable", "unavailable");
        return errPermission(
          `Action denied: "${name}" requires approval for this call, but no approval channel is available. ` +
            `Start the AirMCP menubar app, use an MCP client that supports elicitation, ` +
            `or adjust hitl.whitelist / hitl.level in ~/.config/airmcp/config.json.`,
        );
      }

      // Socket-based HITL (managed client with the app reachable, or fallback
      // for non-managed clients without elicitation support).
      if (!(await hitlClient.isReachable())) {
        if (telemetryEnabled) {
          traceApproval(name, "denied", "unavailable", { destructive, managed });
        }
        await recordApprovalDecision(name, "unavailable", "unavailable");
        return errPermission(
          `Action denied: "${name}" requires approval for this call, but the AirMCP approval socket is unavailable. ` +
            `Start the AirMCP menubar app or use an MCP client that supports elicitation.`,
        );
      }
      const decisionClient = hitlClient as unknown as {
        requestApprovalDecision?: (
          tool: string,
          args: Record<string, unknown>,
          destructive: boolean,
          openWorld: boolean,
          sensitive?: boolean,
        ) => Promise<HitlApprovalDecision>;
      };
      const rawDecision =
        typeof decisionClient.requestApprovalDecision === "function"
          ? await decisionClient.requestApprovalDecision.call(
              hitlClient,
              name,
              toolArgs,
              destructive,
              annotations.openWorldHint ?? false,
              sensitive,
            )
          : (await hitlClient.requestApproval(
                name,
                toolArgs,
                destructive,
                annotations.openWorldHint ?? false,
                sensitive,
              ))
            ? "approved"
            : "denied";
      const decision = normalizeApprovalDecision(rawDecision);
      if (telemetryEnabled) {
        traceApproval(name, decision, "socket", { destructive, managed });
      }
      await recordApprovalDecision(name, decision, "socket");
      if (decision === "timed_out") {
        return toolErr("hitl_timeout", `Action denied: approval for "${name}" timed out before a decision.`);
      }
      if (decision === "unavailable") {
        return errPermission(
          `Action denied: the AirMCP approval socket became unavailable before "${name}" received a decision.`,
        );
      }
      if (decision === "denied") {
        return errPermission(`Action denied: "${name}" requires user approval. The user denied this call.`);
      }
      if (decision !== "approved") {
        return errPermission(`Action denied: "${name}" did not receive a valid approval decision.`);
      }
      return (callback as (...a: unknown[]) => unknown)(...args);
    };

    return original(name, toolConfig as Parameters<typeof original>[1], wrapped as Parameters<typeof original>[2]);
  };
  server.registerTool = patched as typeof server.registerTool;
}
