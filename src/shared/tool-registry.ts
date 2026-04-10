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
import { traceToolCall } from "./telemetry.js";
import { assertTestMode } from "./errors.js";

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
  enabled: boolean;
  title?: string;
  description?: string;
  titleLower?: string;
  descriptionLower?: string;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
}

interface RegisteredPromptEntry {
  callback: AnyFn;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredToolEntry>();
  private prompts = new Map<string, RegisteredPromptEntry>();
  // ── Tool accessors ──────────────────────────────────────────────

  getToolCount(): number {
    return this.tools.size;
  }

  /** Get all tool names. */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Search tools by query string (substring match on name, title, description). */
  searchTools(query: string, limit = 20): ToolInfo[] {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const scored: Array<{ info: ToolInfo; score: number }> = [];

    for (const [name, entry] of this.tools) {
      if (!entry.enabled) continue;
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
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    if (!tool.enabled) throw new Error(`Tool "${name}" is disabled`);
    return (await tool.handler(args, {})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
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
    this.interceptToolRegistration(server);
    this.interceptPromptRegistration(server);
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
      console.error(
        `[AirMCP] WARNING: ${method}() signature mismatch — callback not found at expected position. ` +
          `SDK may have changed. ${entityType} "${name}" registered without interception.`,
      );
      origFn(name, ...rest);
      return null;
    }
    return lastArg as AnyFn;
  }

  private interceptToolRegistration(server: McpServer): void {
    const origRegisterTool = server.registerTool.bind(server);
    const tools = this.tools;

    const wrapHandler = (name: string, handler: AnyFn): AnyFn => {
      return (async (...args: unknown[]) => {
        if (process.env.AIRMCP_USAGE_TRACKING !== "false") usageTracker.record(name);

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
      }) as AnyFn;
    };

    server.registerTool = ((name: string, ...rest: unknown[]) => {
      const callback = this.validateCallback("registerTool", "Tool", name, rest, origRegisterTool as AnyFn);
      if (!callback) return;

      // Validate config is an object (expected at rest[0])
      const hasConfig = rest.length >= 2;
      if (hasConfig && (typeof rest[0] !== "object" || rest[0] === null)) {
        console.error(
          `[AirMCP] WARNING: registerTool() config is not an object (got ${typeof rest[0]}). ` +
            `Tool "${name}" registered without interception.`,
        );
        return (origRegisterTool as AnyFn)(name, ...rest);
      }
      const wrapped = wrapHandler(name, callback);
      rest[rest.length - 1] = wrapped;
      const config = hasConfig ? (rest[0] as Record<string, unknown>) : {};
      const title = config.title as string | undefined;
      const fullDescription = config.description as string | undefined;
      // Compact mode: shorten descriptions sent to clients via SDK
      if (fullDescription) {
        config.description = compactDescription(fullDescription);
      }
      const result = (origRegisterTool as AnyFn)(name, ...rest);
      // Store FULL description in registry for discover_tools / semantic search
      tools.set(name, {
        handler: wrapped,
        enabled: true,
        title,
        description: fullDescription,
        titleLower: title?.toLowerCase(),
        descriptionLower: fullDescription?.toLowerCase(),
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
      // Compact mode: shorten description sent to clients via SDK
      if (fullDesc) {
        rest[0] = compactDescription(fullDesc);
      }
      const result = (origTool as AnyFn)(name, ...rest);
      // Store FULL description in registry for discover_tools / semantic search
      tools.set(name, {
        handler: wrapped,
        enabled: true,
        description: fullDesc,
        descriptionLower: fullDesc?.toLowerCase(),
      });
      return result;
    }) as typeof server.tool;
  }

  private interceptPromptRegistration(server: McpServer): void {
    const origRegisterPrompt = server.registerPrompt.bind(server);
    const prompts = this.prompts;
    server.registerPrompt = ((name: string, ...rest: unknown[]) => {
      const cb = this.validateCallback("registerPrompt", "Prompt", name, rest, origRegisterPrompt as AnyFn);
      if (!cb) return;
      const result = (origRegisterPrompt as AnyFn)(name, ...rest);
      prompts.set(name, { callback: cb });
      return result;
    }) as typeof server.registerPrompt;

    const origPrompt = server.prompt.bind(server);
    server.prompt = ((name: string, ...rest: unknown[]) => {
      const cb = this.validateCallback("prompt", "Prompt", name, rest, origPrompt as AnyFn);
      if (!cb) return;
      const result = (origPrompt as AnyFn)(name, ...rest);
      prompts.set(name, { callback: cb });
      return result;
    }) as typeof server.prompt;
  }
}

/** Singleton registry instance — shared across the process. */
export const toolRegistry = new ToolRegistry();
