/**
 * tools/list schema dialect fix — re-serialize tool schemas as JSON Schema 2020-12.
 *
 * MCP SDK 1.30.0's ListTools handler converts Zod v4 schemas with a hardcoded
 * `target: "draft-7"` (server/mcp.js → toJsonSchemaCompat, no target passed),
 * stamping `$schema: "http://json-schema.org/draft-07/schema#"` on every
 * inputSchema / outputSchema on the wire. Strict clients (Claude Code among
 * them) validate structured tool results with a 2020-12-only validator and
 * refuse to call any tool whose outputSchema declares another dialect:
 *
 *   Tool 'audit_summary' has an invalid outputSchema: JSON Schema declares
 *   an unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#")
 *
 * Zod v4's own serializer defaults to 2020-12 — the SDK actively downgrades.
 * Deleting `$schema` from the emitted JSON is not enough: the draft-7 target
 * also emits draft-7 *idioms* — tuples become `items: [...]` (array form),
 * which is invalid under 2020-12 (`prefixItems`) — so we re-serialize from
 * the registered Zod sources with `target: "draft-2020-12"` instead of
 * patching the emitted JSON.
 *
 * tool-filter.ts deliberately avoids intercepting tools/list for description
 * compaction (registration-time transform instead); here interception is
 * unavoidable because the SDK converts Zod → JSON Schema *inside* its own
 * list handler at request time. Install BEFORE the first registerTool() call:
 * the SDK lazily registers its tools/list handler on first tool registration,
 * and we catch it by wrapping the low-level `setRequestHandler`.
 *
 * This leans on two internals of the exactly-pinned SDK (`_registeredTools`
 * and server/zod-compat.js); tests/tool-schema-dialect.test.js is the canary
 * that fails loudly if an SDK upgrade moves them — or starts emitting 2020-12
 * itself, at which point this shim should be deleted.
 */

import { z } from "zod";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { log, errToCtx } from "../shared/logger.js";

export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

type JsonSchemaObject = Record<string, unknown>;

interface ToolListEntry {
  name: string;
  inputSchema?: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
}

/** The slice of the SDK's registered-tool record we re-serialize from. */
interface RegisteredToolSchemas {
  inputSchema?: unknown;
  outputSchema?: unknown;
}

type RequestHandler = (request: { method?: string }, extra: unknown) => unknown;

/** McpServer surface this shim needs: the low-level server + the tool map. */
interface DialectFixableServer {
  server: {
    setRequestHandler: (requestSchema: unknown, handler: RequestHandler) => void;
  };
  _registeredTools?: Record<string, RegisteredToolSchemas>;
}

/** Serialize a registered Zod schema (raw shape or object schema) as 2020-12. */
function serialize2020(zodSchema: unknown, io: "input" | "output"): JsonSchemaObject | undefined {
  const obj = normalizeObjectSchema(zodSchema as never);
  if (!obj) return undefined;
  return z.toJSONSchema(obj as never, { target: "draft-2020-12", io }) as JsonSchemaObject;
}

function rewriteToolSchemas(server: DialectFixableServer, tools: ToolListEntry[]): void {
  const registered = server._registeredTools;
  if (!registered) {
    log.warn("schema-dialect: SDK no longer exposes _registeredTools; tools/list keeps the SDK's dialect");
    return;
  }
  for (const tool of tools) {
    const reg = registered[tool.name];
    if (!reg) continue;
    try {
      if (reg.inputSchema) {
        const input = serialize2020(reg.inputSchema, "input");
        if (input) tool.inputSchema = input;
      }
      if (reg.outputSchema && tool.outputSchema) {
        const output = serialize2020(reg.outputSchema, "output");
        if (output) tool.outputSchema = output;
      }
    } catch (e) {
      // Leave the SDK-emitted schema untouched: a declared draft-07 dialect
      // is more honest than a silently mangled schema.
      log.warn("schema-dialect: 2020-12 re-serialization failed; keeping SDK dialect", {
        tool: tool.name,
        err: errToCtx(e),
      });
    }
  }
}

/**
 * Install the dialect fix on a freshly constructed McpServer. Must run before
 * the first registerTool() so the wrapper sees the SDK's lazy tools/list
 * handler registration.
 */
export function installToolListSchemaDialectFix(server: unknown): void {
  const s = server as DialectFixableServer;
  const lowLevel = s.server;
  if (typeof lowLevel?.setRequestHandler !== "function") {
    // Test doubles (and a hypothetical SDK reshape) may not expose the
    // low-level server; skip rather than crash — the canary test pins the
    // real SDK surface.
    log.warn("schema-dialect: server exposes no low-level setRequestHandler; dialect fix not installed");
    return;
  }
  const origSetRequestHandler = lowLevel.setRequestHandler.bind(lowLevel);
  lowLevel.setRequestHandler = (requestSchema: unknown, handler: RequestHandler) => {
    origSetRequestHandler(requestSchema, async (request, extra) => {
      const result = await handler(request, extra);
      if (request?.method === "tools/list" && result && typeof result === "object") {
        const tools = (result as { tools?: unknown }).tools;
        if (Array.isArray(tools)) rewriteToolSchemas(s, tools as ToolListEntry[]);
      }
      return result;
    });
  };
}
