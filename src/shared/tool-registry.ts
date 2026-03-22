/**
 * Self-managed registry that tracks tool and prompt registrations independently
 * of the MCP SDK internals. Eliminates `as any` casts to private SDK properties
 * (`_registeredTools`, `_registeredPrompts`).
 *
 * Usage: call `toolRegistry.installOn(server)` once before any module
 * registration. The registry monkey-patches `server.tool()`, `server.prompt()`,
 * `server.registerTool()`, and `server.registerPrompt()` to intercept every
 * registration transparently — no module changes required.
 */

import type { McpServer, AnyFn } from "./mcp.js";
import { usageTracker } from "./usage-tracker.js";

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
   * Must be called once, before any module registrations. Compatible with
   * the HITL guard monkey-patch (call this AFTER `installHitlGuard` so that
   * the handler stored here already includes the HITL wrapper).
   */
  installOn(server: McpServer): void {
    this.tools.clear();
    this.prompts.clear();
    this.interceptToolRegistration(server);
    this.interceptPromptRegistration(server);
  }

  private interceptToolRegistration(server: McpServer): void {
    const origRegisterTool = server.registerTool.bind(server);
    const tools = this.tools;

    const wrapHandler = (name: string, handler: AnyFn): AnyFn => {
      return (async (...args: unknown[]) => {
        usageTracker.record(name);
        return handler(...args);
      }) as AnyFn;
    };

    server.registerTool = ((name: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as AnyFn;
      const wrapped = wrapHandler(name, callback);
      rest[rest.length - 1] = wrapped;
      const result = (origRegisterTool as AnyFn)(name, ...rest);
      const config = rest.length >= 2 ? (rest[0] as Record<string, unknown>) : {};
      const title = config.title as string | undefined;
      const description = config.description as string | undefined;
      tools.set(name, {
        handler: wrapped, enabled: true,
        title, description,
        titleLower: title?.toLowerCase(),
        descriptionLower: description?.toLowerCase(),
      });
      return result;
    }) as typeof server.registerTool;

    const origTool = server.tool.bind(server);
    server.tool = ((name: string, ...rest: unknown[]) => {
      const callback = rest[rest.length - 1] as AnyFn;
      const wrapped = wrapHandler(name, callback);
      rest[rest.length - 1] = wrapped;
      const result = (origTool as AnyFn)(name, ...rest);
      // Legacy tool() — description is the 2nd arg if it's a string
      const desc = typeof rest[0] === "string" ? rest[0] : undefined;
      tools.set(name, { handler: wrapped, enabled: true, description: desc, descriptionLower: desc?.toLowerCase() });
      return result;
    }) as typeof server.tool;
  }

  private interceptPromptRegistration(server: McpServer): void {
    const origRegisterPrompt = server.registerPrompt.bind(server);
    const prompts = this.prompts;
    server.registerPrompt = ((name: string, ...rest: unknown[]) => {
      const result = (origRegisterPrompt as AnyFn)(name, ...rest);
      const callback = rest[rest.length - 1] as AnyFn;
      prompts.set(name, { callback });
      return result;
    }) as typeof server.registerPrompt;

    const origPrompt = server.prompt.bind(server);
    server.prompt = ((name: string, ...rest: unknown[]) => {
      const result = (origPrompt as AnyFn)(name, ...rest);
      const callback = rest[rest.length - 1] as AnyFn;
      prompts.set(name, { callback });
      return result;
    }) as typeof server.prompt;
  }
}

/** Singleton registry instance — shared across the process. */
export const toolRegistry = new ToolRegistry();
