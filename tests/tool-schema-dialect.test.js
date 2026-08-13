/**
 * tools/list schema dialect — regression tests for src/server/schema-dialect.ts.
 *
 * SDK 1.30.0 serializes Zod v4 tool schemas with a hardcoded draft-7 target,
 * which strict 2020-12-only clients (Claude Code) reject at call time:
 *   "Tool 'audit_summary' has an invalid outputSchema: JSON Schema declares
 *    an unsupported dialect".
 *
 * These tests speak real wire protocol (McpServer + Client over linked
 * in-memory transports) and double as the canary for the pinned-SDK
 * internals the shim relies on: if an SDK upgrade stops emitting draft-07
 * (upstream fix — delete the shim) or moves `_registeredTools` /
 * server/zod-compat.js (shim breaks), a test here fails loudly.
 */
import { describe, test, expect } from "@jest/globals";
import { z } from "zod";

const { installToolListSchemaDialectFix, JSON_SCHEMA_2020_12 } = await import("../dist/server/schema-dialect.js");
const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

function createLinkedTransports() {
  const left = {
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
    async start() {},
    async send(message) {
      queueMicrotask(() => right.onmessage?.(structuredClone(message)));
    },
    async close() {
      left.onclose?.();
    },
  };
  const right = {
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
    async start() {},
    async send(message) {
      queueMicrotask(() => left.onmessage?.(structuredClone(message)));
    },
    async close() {
      right.onclose?.();
    },
  };
  return { serverTransport: left, clientTransport: right };
}

/** Register a representative tool: tuple output (the draft-7 idiom trap). */
function registerSampleTool(server) {
  server.registerTool(
    "sample_windows",
    {
      description: "Sample tool with tuple-bearing output schema.",
      inputSchema: {
        since: z.string().optional(),
        topN: z.number().default(10),
      },
      outputSchema: {
        windows: z.array(
          z.object({
            title: z.string(),
            position: z.tuple([z.number(), z.number()]).nullable(),
          }),
        ),
      },
    },
    async () => ({ content: [], structuredContent: { windows: [] } }),
  );
}

async function listToolsOverWire(server) {
  const client = new Client({ name: "dialect-test", version: "0.0.0" });
  const { serverTransport, clientTransport } = createLinkedTransports();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

describe("tools/list schema dialect", () => {
  test("canary: without the fix, SDK 1.30.0 emits draft-07 (delete the shim if this fails)", async () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    registerSampleTool(server);
    const { tools } = await listToolsOverWire(server);
    expect(tools).toHaveLength(1);
    expect(tools[0].inputSchema.$schema).toBe(DRAFT_07);
    expect(tools[0].outputSchema.$schema).toBe(DRAFT_07);
  });

  test("with the fix, schemas declare 2020-12 and use 2020-12 idioms", async () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    installToolListSchemaDialectFix(server);
    registerSampleTool(server);
    const { tools } = await listToolsOverWire(server);
    expect(tools).toHaveLength(1);
    const [tool] = tools;

    expect(tool.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    expect(tool.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12);

    // Structure is preserved…
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["since", "topN"]);
    const windowItem = tool.outputSchema.properties.windows.items;
    expect(Object.keys(windowItem.properties)).toEqual(["title", "position"]);

    // …and the tuple uses prefixItems, not draft-7's array-form items (which
    // a 2020-12 validator rejects — merely stripping $schema would not do).
    const tuple = windowItem.properties.position.anyOf.find((s) => s.type === "array");
    expect(tuple.prefixItems).toHaveLength(2);
    expect(tuple.items).toBeUndefined();

    // No draft-07 marker survives anywhere in the emitted schemas.
    expect(JSON.stringify(tool)).not.toContain("draft-07");
  });

  test("tools registered after connect are fixed too (list-time rewrite)", async () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    installToolListSchemaDialectFix(server);
    registerSampleTool(server);
    server.registerTool(
      "late_tool",
      {
        description: "Registered alongside — every listed tool goes through the rewrite.",
        inputSchema: { q: z.string() },
        outputSchema: { hits: z.array(z.string()) },
      },
      async () => ({ content: [], structuredContent: { hits: [] } }),
    );
    const { tools } = await listToolsOverWire(server);
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12);
      expect(tool.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12);
    }
  });

  test("tools without outputSchema keep the SDK's empty-object inputSchema shape", async () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    installToolListSchemaDialectFix(server);
    server.registerTool("no_schema_tool", { description: "No schemas at all." }, async () => ({ content: [] }));
    const { tools } = await listToolsOverWire(server);
    expect(tools).toHaveLength(1);
    expect(tools[0].inputSchema).toEqual({ type: "object", properties: {} });
    expect(tools[0].outputSchema).toBeUndefined();
  });
});
