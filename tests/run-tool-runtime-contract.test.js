import { afterAll, describe, expect, test } from "@jest/globals";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createToolRegistry } from "../dist/shared/tool-registry.js";
import { installHitlGuard } from "../dist/shared/hitl-guard.js";
import { registerToolSessionTools } from "../dist/server/tool-session-tools.js";
import { flushAuditLog } from "../dist/shared/audit.js";

const harness = {
  maxSessionTools: 30,
  maxSessionTtlSeconds: 3600,
  defaultSessionTtlSeconds: 300,
  requireSessionForHiddenTools: false,
};

async function connectedServer(register, approvalClient) {
  const server = new McpServer({ name: "runtime-contract", version: "1.0.0" });
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const registerTool = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => registerTool(name, config, async (...args) => {
    try {
      return await handler(...args);
    } finally {
      finish(); // Wait for server-side completion even when the client abandoned its response.
    }
  });
  const registry = createToolRegistry();
  registry.installOn(server);
  if (approvalClient) {
    installHitlGuard(server, approvalClient, { hitl: { level: "sensitive-only", whitelist: new Set() } });
  }
  register(server);
  registerToolSessionTools(server, { config: { features: {} }, harness, toolRegistry: registry });
  const client = new Client({ name: "codex", version: "test" }, { capabilities: {} });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, completed, close: () => Promise.all([client.close(), server.close()]) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
afterAll(() => flushAuditLog());

describe("real MCP direct and run_tool runtime contracts", () => {
  test.each(["direct", "run_tool"])("%s never executes a destructive callback after approval-wait cancellation", async (route) => {
    let prompted;
    let release;
    let executions = 0;
    const prompt = new Promise((resolve) => { prompted = resolve; });
    const connection = await connectedServer((server) => {
      server.registerTool("synthetic_write", {
        inputSchema: {},
        annotations: { readOnlyHint: false, destructiveHint: true },
      }, async () => {
        executions++;
        return { content: [{ type: "text", text: "synthetic operation only" }] };
      });
    }, {
      isReachable: async () => true,
      requestApprovalDecision: async () => {
        prompted();
        return new Promise((resolve) => { release = resolve; });
      },
    });
    try {
      const abort = new AbortController();
      const result = connection.client.callTool({
        name: route === "direct" ? "synthetic_write" : "run_tool",
        arguments: route === "direct" ? {} : { name: "synthetic_write", args: {} },
      }, undefined, { signal: abort.signal }).catch((error) => error);
      await prompt;
      abort.abort();
      await tick(); // Deliver notifications/cancelled to the server before approval.
      release("approved");
      expect(await result).toBeInstanceOf(Error);
      await connection.completed;
      expect(executions).toBe(0);
    } finally {
      await connection.close();
    }
  });

  test.each([
    ["direct", { id: 42 }, /string/],
    ["run_tool", { id: 42 }, /string/],
    ["direct", [], /object/],
    ["run_tool", [], /object/],
    ["direct", undefined, /structuredContent/],
    ["run_tool", undefined, /structuredContent/],
  ])("%s reports target output-schema violations (%j) as tool errors", async (route, structuredContent, detail) => {
    const connection = await connectedServer((server) => {
      server.registerTool("synthetic_record", {
        inputSchema: {},
        outputSchema: { id: z.string() },
        annotations: { readOnlyHint: true },
      }, async () => ({
        content: [{ type: "text", text: '{"id":42}' }],
        ...(structuredContent === undefined ? {} : { structuredContent }),
      }));
    });
    try {
      const result = await connection.client.callTool({
        name: route === "direct" ? "synthetic_record" : "run_tool",
        arguments: route === "direct" ? {} : { name: "synthetic_record" },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/output.*validation/i);
      expect(result.content[0].text).toMatch(detail);
      if (structuredContent !== undefined) expect(result.structuredContent).not.toEqual(structuredContent);
    } finally {
      await connection.close();
    }
  });

  test("run_tool enforces asynchronous output refinements", async () => {
    const connection = await connectedServer((server) => {
      server.registerTool("async_record", {
        inputSchema: {},
        outputSchema: { id: z.string().refine(async (id) => id === "valid", "invalid record id") },
      }, async () => ({ content: [], structuredContent: { id: "invalid" } }));
    });
    try {
      const result = await connection.client.callTool({ name: "run_tool", arguments: { name: "async_record" } });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("invalid record id");
    } finally {
      await connection.close();
    }
  });
});
