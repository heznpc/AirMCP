import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
 * Monkey-patches server.registerTool so every subsequent registration
 * goes through HITL approval when the policy requires it.
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
      const approved = await hitlClient.requestApproval(
        name,
        toolArgs,
        annotations.destructiveHint ?? false,
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
