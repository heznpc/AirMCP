/**
 * Lightweight McpServer interface that avoids the heavy generic type inference
 * from the MCP SDK. With 260+ registerTool() calls, the SDK's complex generics
 * (ZodRawShapeCompat × SchemaOutput × dual v3/v4 Zod) cause TypeScript to
 * exceed 8GB memory during type-checking.
 *
 * Only mcp-setup.ts imports the real McpServer (to instantiate it).
 * All other modules use this interface, keeping the same runtime behavior.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Generic function type shared with tool-registry.ts. */
export type AnyFn = (...args: any[]) => any;

/** Minimal McpServer surface used by tool/prompt/resource registration modules. */
export interface McpServer {
  tool(name: string, config: any, cb: AnyFn): void;
  tool(name: string, description: string, config: any, cb: AnyFn): void;
  registerTool(name: string, config: any, cb: AnyFn): any;
  prompt(name: string, config: any, cb: AnyFn): void;
  prompt(name: string, description: string, config: any, cb: AnyFn): void;
  registerPrompt(name: string, config: any, cb: AnyFn): any;
  resource(name: string, uri: any, config: any, cb: AnyFn): void;
  registerResource(name: string, uri: any, config: any, cb: AnyFn): any;
  /** Low-level MCP Server for elicitation / sampling. */
  server: any;
}
