import type { McpServer } from "./mcp.js";
import type { AirMcpConfig, HitlLevel } from "./config.js";
import type { HitlClient } from "./hitl.js";
import { err } from "./result.js";

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
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
export function installHitlGuard(
  server: McpServer,
  hitlClient: HitlClient,
  config: AirMcpConfig,
): void {
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

    const wrapped = async (...args: unknown[]) => {
      const toolArgs = (args[0] ?? {}) as Record<string, unknown>;
      const destructive = annotations.destructiveHint ?? false;

      // Try MCP Elicitation first (protocol-native, works everywhere)
      const elicitResult = await tryElicitApproval(server, name, toolArgs, destructive);
      if (elicitResult !== undefined) {
        if (!elicitResult) {
          return err(`Action denied: "${name}" was rejected via MCP elicitation.`);
        }
        return (callback as (...a: unknown[]) => unknown)(...args);
      }

      // Fallback: socket-based HITL
      const approved = await hitlClient.requestApproval(
        name,
        toolArgs,
        destructive,
        annotations.openWorldHint ?? false,
      );
      if (!approved) {
        return err(
          `Action denied: "${name}" requires user approval. The user denied or did not respond in time.`,
        );
      }
      return (callback as (...a: unknown[]) => unknown)(...args);
    };

    return original(name, toolConfig as Parameters<typeof original>[1], wrapped as Parameters<typeof original>[2]);
  };
  server.registerTool = patched as typeof server.registerTool;
}
