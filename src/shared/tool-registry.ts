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

import type { McpServer } from "./mcp.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface RegisteredToolEntry {
  handler: AnyFn;
  enabled: boolean;
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
    server.registerTool = ((name: string, ...rest: unknown[]) => {
      const result = (origRegisterTool as AnyFn)(name, ...rest);
      const callback = rest[rest.length - 1] as AnyFn;
      tools.set(name, { handler: callback, enabled: true });
      return result;
    }) as typeof server.registerTool;

    const origTool = server.tool.bind(server);
    server.tool = ((name: string, ...rest: unknown[]) => {
      const result = (origTool as AnyFn)(name, ...rest);
      const callback = rest[rest.length - 1] as AnyFn;
      tools.set(name, { handler: callback, enabled: true });
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
