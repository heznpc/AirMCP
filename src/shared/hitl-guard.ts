import type { McpServer } from "./mcp.js";
import type { AirMcpConfig, HitlLevel } from "./config.js";
import type { HitlClient } from "./hitl.js";
import { errPermission } from "./result.js";
import { traceApproval } from "./telemetry.js";

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
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

function shouldRequireApproval(
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
    case "all-writes":
      return annotations.readOnlyHint === false;
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
): Promise<boolean | undefined> {
  try {
    const inner = server.server;
    if (!inner?.elicitInput) return undefined;

    const label = destructive ? `⚠️ Destructive: ${toolName}` : `Approve: ${toolName}`;
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
 * Approval priority:
 * 1. MCP Elicitation (form mode) — works with any MCP client that supports it
 * 2. Socket-based HITL — fallback for clients without elicitation support
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
      const managed = isManagedClient(server);

      // Skip MCP elicitation for clients with their own permission system
      // (e.g. Claude Code) to avoid double-approval UX.
      if (!managed) {
        const elicitResult = await tryElicitApproval(server, name, toolArgs, destructive);
        if (elicitResult !== undefined) {
          if (telemetryEnabled) {
            traceApproval(name, elicitResult ? "approved" : "denied", "elicitation", { destructive, managed });
          }
          if (!elicitResult) {
            return errPermission(`Action denied: "${name}" was rejected via MCP elicitation.`);
          }
          return (callback as (...a: unknown[]) => unknown)(...args);
        }
      }

      // Fallback: socket-based HITL (separate channel — always available)
      const approved = await hitlClient.requestApproval(
        name,
        toolArgs,
        destructive,
        annotations.openWorldHint ?? false,
      );
      if (telemetryEnabled) {
        traceApproval(name, approved ? "approved" : "denied", "socket", { destructive, managed });
      }
      if (!approved) {
        return errPermission(
          `Action denied: "${name}" requires user approval. The user denied or did not respond in time.`,
        );
      }
      return (callback as (...a: unknown[]) => unknown)(...args);
    };

    return original(name, toolConfig as Parameters<typeof original>[1], wrapped as Parameters<typeof original>[2]);
  };
  server.registerTool = patched as typeof server.registerTool;
}
