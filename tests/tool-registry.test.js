import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { z } from "zod";

// ─── Mock dependencies that tool-registry.js imports at the module level ────
jest.unstable_mockModule("../dist/shared/usage-tracker.js", () => ({
  usageTracker: { record: jest.fn() },
}));
const auditLogMock = jest.fn();
const readAuditEntriesMock = jest.fn();
jest.unstable_mockModule("../dist/shared/audit.js", () => ({
  auditLog: auditLogMock,
  readAuditEntries: readAuditEntriesMock,
}));
jest.unstable_mockModule("../dist/shared/tool-filter.js", () => ({
  compactDescription: jest.fn((d) => (d ? d.substring(0, 80) : d)),
}));

const { toolRegistry, createToolRegistry, ToolInputValidationError } = await import("../dist/shared/tool-registry.js");
const { installHitlGuard } = await import("../dist/shared/hitl-guard.js");
const { withResourceGovernance } = await import("../dist/shared/resource-governance.js");
const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

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

// ─── Helper: mock server for unit-level tests ──────────────────────────────
function createMockServer() {
  const tools = new Map();
  const prompts = new Map();
  return {
    registerTool: jest.fn((name, opts, handler) => {
      tools.set(name, { opts, handler });
    }),
    tool: jest.fn((name, ...rest) => {
      tools.set(name, { rest });
    }),
    registerPrompt: jest.fn((name, opts, callback) => {
      prompts.set(name, { opts, callback });
    }),
    prompt: jest.fn((name, ...rest) => {
      prompts.set(name, { rest });
    }),
    _tools: tools,
    _prompts: prompts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit tests (mock server) — preserved from the original test suite
// ═══════════════════════════════════════════════════════════════════════════

describe("ToolRegistry (mock server)", () => {
  let server;

  beforeEach(() => {
    auditLogMock.mockReset();
    readAuditEntriesMock.mockReset();
    toolRegistry.reset();
    server = createMockServer();
    toolRegistry.installOn(server);
  });

  test("starts with zero tools and prompts", () => {
    expect(toolRegistry.getToolCount()).toBe(0);
    expect(toolRegistry.getPromptCount()).toBe(0);
    expect(toolRegistry.getToolNames()).toEqual([]);
    expect(toolRegistry.getPromptNames()).toEqual([]);
  });

  test("tracks tool registrations via registerTool", () => {
    server.registerTool(
      "test_tool",
      {
        title: "Test Tool",
        description: "A test tool for testing",
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(["test_tool"]);
  });

  test("tracks multiple tool registrations", () => {
    server.registerTool("tool_a", { title: "Tool A", description: "First" }, async () => ({}));
    server.registerTool("tool_b", { title: "Tool B", description: "Second" }, async () => ({}));
    server.registerTool("tool_c", { title: "Tool C", description: "Third" }, async () => ({}));

    expect(toolRegistry.getToolCount()).toBe(3);
    expect(toolRegistry.getToolNames()).toContain("tool_a");
    expect(toolRegistry.getToolNames()).toContain("tool_b");
    expect(toolRegistry.getToolNames()).toContain("tool_c");
  });

  test("getToolInfo returns correct info", () => {
    server.registerTool(
      "my_tool",
      {
        title: "My Tool",
        description: "Does something useful",
      },
      async () => ({}),
    );

    const info = toolRegistry.getToolInfo("my_tool");
    expect(info).toBeDefined();
    expect(info.name).toBe("my_tool");
    expect(info.title).toBe("My Tool");
    expect(info.description).toBe("Does something useful");
  });

  test("getToolInfo returns undefined for unknown tool", () => {
    expect(toolRegistry.getToolInfo("nonexistent")).toBeUndefined();
  });

  test("searchTools finds tools by name", () => {
    server.registerTool("search_notes", { title: "Search Notes", description: "Search" }, async () => ({}));
    server.registerTool("list_notes", { title: "List Notes", description: "List" }, async () => ({}));
    server.registerTool("read_mail", { title: "Read Mail", description: "Read" }, async () => ({}));

    const results = toolRegistry.searchTools("notes");
    expect(results.length).toBe(2);
    expect(results.map((r) => r.name)).toContain("search_notes");
    expect(results.map((r) => r.name)).toContain("list_notes");
  });

  test("searchTools scores name matches higher than description", () => {
    server.registerTool("calendar_event", { title: "Cal", description: "Create event" }, async () => ({}));
    server.registerTool("other_tool", { title: "Other", description: "Manages calendar items" }, async () => ({}));

    const results = toolRegistry.searchTools("calendar");
    expect(results[0].name).toBe("calendar_event");
  });

  test("searchTools respects limit", () => {
    for (let i = 0; i < 30; i++) {
      server.registerTool(`tool_${i}`, { title: `Tool ${i}`, description: "test tool" }, async () => ({}));
    }

    const results = toolRegistry.searchTools("tool", 5);
    expect(results.length).toBe(5);
  });

  test("searchTools returns empty for no matches", () => {
    server.registerTool("my_tool", { title: "My Tool", description: "Something" }, async () => ({}));
    expect(toolRegistry.searchTools("zzzznonexistent")).toEqual([]);
  });

  test("searchTools returns compact descriptions while getToolDetails can fetch full text", () => {
    const fullDescription = `${"A".repeat(90)} needle`;
    server.registerTool(
      "long_description_tool",
      {
        title: "Long Description Tool",
        description: fullDescription,
      },
      async () => ({}),
    );

    const [match] = toolRegistry.searchTools("needle");
    expect(match.name).toBe("long_description_tool");
    expect(match.description).toBe(fullDescription.substring(0, 80));

    const details = toolRegistry.getToolDetails("long_description_tool", { descriptionMode: "full" });
    expect(details.description).toBe(fullDescription);
  });

  test("callTool invokes registered handler", async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: "result" }],
    });
    server.registerTool("callable", { title: "Callable" }, handler);

    const result = await toolRegistry.callTool("callable", { key: "value" });
    expect(result.content[0].text).toBe("result");
  });

  test("audits returned MCP error values as error with category-only metadata", async () => {
    server.registerTool(
      "denied_value",
      {
        title: "Denied",
        outputSchema: { value: z.string() },
      },
      async () => ({
        content: [{ type: "text", text: "private human-facing denial detail" }],
        structuredContent: {
          error: {
            category: "permission_denied",
            message: "private human-facing denial detail",
            retryable: false,
          },
        },
        _meta: { existingEvidence: "preserved" },
        isError: true,
      }),
    );

    const result = await toolRegistry.callTool("denied_value", {});

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const row = auditLogMock.mock.calls[0][0];
    expect(row).toMatchObject({
      kind: "tool",
      tool: "denied_value",
      status: "error",
      errorCategory: "permission_denied",
    });
    expect(row).not.toHaveProperty("message");
    expect(JSON.stringify(row)).not.toContain("private human-facing denial detail");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta?.["airmcp/error"]).toMatchObject({
      category: "permission_denied",
      retryable: false,
      correlationId: expect.any(String),
    });
    expect(result._meta?.existingEvidence).toBe("preserved");
    expect(JSON.stringify(result._meta)).not.toContain("private human-facing denial detail");
  });

  test("retains structured typed errors for tools without outputSchema", async () => {
    server.registerTool("untyped_denied_value", { title: "Untyped denied" }, async () => ({
      content: [{ type: "text", text: "[permission_denied] denied" }],
      structuredContent: {
        error: { category: "permission_denied", message: "denied", retryable: false },
      },
      isError: true,
    }));

    const result = await toolRegistry.callTool("untyped_denied_value", {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { category: "permission_denied", message: "denied", retryable: false },
    });
  });

  test("seals a separate approval event before the denied tool outcome", async () => {
    const hitlClient = {
      isReachable: async () => true,
      requestApproval: async () => false,
    };
    installHitlGuard(server, hitlClient, {
      hitl: { level: "all", whitelist: new Set() },
    });
    server.registerTool(
      "governed_write",
      {
        title: "Governed write",
        annotations: { readOnlyHint: false },
      },
      async () => ({ content: [{ type: "text", text: "must not run" }] }),
    );

    const result = await toolRegistry.callTool("governed_write", { secret: "do-not-copy" });

    expect(result.isError).toBe(true);
    expect(auditLogMock).toHaveBeenCalledTimes(2);
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({
      kind: "approval",
      tool: "governed_write",
      status: "error",
      approvalDecision: "denied",
      approvalChannel: "socket",
      correlationId: expect.any(String),
    });
    expect(auditLogMock.mock.calls[0][0]).not.toHaveProperty("args");
    expect(auditLogMock.mock.calls[1][0]).toMatchObject({
      kind: "tool",
      tool: "governed_write",
      status: "error",
      errorCategory: "permission_denied",
    });
  });

  test("seals socket timeout as timed_out with a hitl_timeout tool outcome", async () => {
    const hitlClient = {
      isReachable: async () => true,
      requestApprovalDecision: async () => "timed_out",
      requestApproval: async () => false,
    };
    installHitlGuard(server, hitlClient, {
      hitl: { level: "all", whitelist: new Set() },
    });
    const mutation = jest.fn(async () => ({ content: [{ type: "text", text: "must not run" }] }));
    server.registerTool(
      "timed_out_write",
      {
        title: "Timed out write",
        annotations: { readOnlyHint: false },
      },
      mutation,
    );

    const result = await toolRegistry.callTool("timed_out_write", {});

    expect(result).toMatchObject({ isError: true });
    expect(mutation).not.toHaveBeenCalled();
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({
      kind: "approval",
      tool: "timed_out_write",
      status: "error",
      approvalDecision: "timed_out",
      approvalChannel: "socket",
    });
    expect(auditLogMock.mock.calls[1][0]).toMatchObject({
      kind: "tool",
      tool: "timed_out_write",
      status: "error",
      errorCategory: "hitl_timeout",
    });
  });

  test("flushes an approved decision before mutation and preserves its decision timestamp", async () => {
    const order = [];
    auditLogMock.mockImplementation((entry) => {
      if (entry.kind === "approval") order.push("append");
    });
    readAuditEntriesMock.mockImplementation(async (query) => {
      order.push("flush");
      const approval = auditLogMock.mock.calls.find(([entry]) => entry.kind === "approval")?.[0];
      return {
        entries: approval
          ? [
              {
                ...approval,
                kind: "approval",
                correlationId: query.correlationId,
              },
            ]
          : [],
        verified: true,
        auditDisabled: false,
      };
    });
    const hitlClient = {
      isReachable: async () => true,
      requestApproval: async () => true,
    };
    installHitlGuard(server, hitlClient, {
      hitl: { level: "all", whitelist: new Set() },
    });
    server.registerTool(
      "governed_mutation",
      {
        title: "Governed mutation",
        annotations: { readOnlyHint: false },
      },
      async () => {
        order.push("mutation");
        return { content: [{ type: "text", text: "mutated" }] };
      },
    );

    await toolRegistry.callTool("governed_mutation", {});

    expect(order).toEqual(["append", "flush", "mutation"]);
    const approval = auditLogMock.mock.calls[0][0];
    expect(approval).toMatchObject({
      kind: "approval",
      approvalId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      approvalDecision: "approved",
      approvalChannel: "socket",
      correlationId: expect.any(String),
      timestamp: expect.any(String),
    });
    expect(readAuditEntriesMock).toHaveBeenCalledWith({
      since: approval.timestamp,
      tool: "governed_mutation",
      kind: "approval",
      correlationId: approval.correlationId,
      limit: 10,
    });
    const outcome = auditLogMock.mock.calls.find(([entry]) => entry.kind === "tool")?.[0];
    expect(outcome.timestamp.localeCompare(approval.timestamp)).toBeGreaterThanOrEqual(0);
  });

  test.each([
    ["missing approval row", { entries: [], verified: true, auditDisabled: false }],
    ["broken chain", { entries: [], verified: false, auditDisabled: false }],
    ["disabled audit", { entries: [], verified: true, auditDisabled: true }],
  ])("blocks an approved mutation when audit verification reports %s", async (_caseName, snapshot) => {
    readAuditEntriesMock.mockResolvedValue(snapshot);
    const hitlClient = {
      isReachable: async () => true,
      requestApproval: async () => true,
    };
    installHitlGuard(server, hitlClient, {
      hitl: { level: "all", whitelist: new Set() },
    });
    const mutation = jest.fn(async () => ({ content: [{ type: "text", text: "mutated" }] }));
    server.registerTool(
      "fail_closed_mutation",
      {
        title: "Fail-closed mutation",
        annotations: { readOnlyHint: false },
      },
      mutation,
    );

    await expect(toolRegistry.callTool("fail_closed_mutation", {})).rejects.toThrow(
      "Approval audit could not be verified",
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  test("preserves denial result when its audit flush cannot be verified", async () => {
    readAuditEntriesMock.mockRejectedValue(new Error("disk unavailable"));
    const hitlClient = {
      isReachable: async () => true,
      requestApproval: async () => false,
    };
    installHitlGuard(server, hitlClient, {
      hitl: { level: "all", whitelist: new Set() },
    });
    const mutation = jest.fn();
    server.registerTool(
      "denied_unhealthy_audit",
      {
        title: "Denied with unhealthy audit",
        annotations: { readOnlyHint: false },
      },
      mutation,
    );

    const result = await toolRegistry.callTool("denied_unhealthy_audit", {});

    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain("denied");
    expect(mutation).not.toHaveBeenCalled();
  });

  test("callTool validates arguments against registerTool inputSchema", async () => {
    server.registerTool(
      "requires_name",
      {
        title: "Requires Name",
        inputSchema: {
          name: z.string().min(1),
          limit: z.number().int().min(1).default(5),
        },
      },
      async (args) => ({
        content: [{ type: "text", text: JSON.stringify(args) }],
      }),
    );

    await expect(toolRegistry.callTool("requires_name", {})).rejects.toBeInstanceOf(ToolInputValidationError);

    const result = await toolRegistry.callTool("requires_name", { name: "Ada" });
    expect(JSON.parse(result.content[0].text)).toEqual({ name: "Ada", limit: 5 });
  });

  test("callTool throws for unknown tool", async () => {
    await expect(toolRegistry.callTool("nonexistent", {})).rejects.toThrow('Tool "nonexistent" not found');
  });

  test("tracks prompt registrations via registerPrompt", () => {
    server.registerPrompt("my_prompt", {}, async () => ({}));

    expect(toolRegistry.getPromptCount()).toBe(1);
    expect(toolRegistry.getPromptNames()).toEqual(["my_prompt"]);
  });

  test("getPromptCallback returns callback", () => {
    const cb = async () => ({});
    server.registerPrompt("test_prompt", {}, cb);

    const retrieved = toolRegistry.getPromptCallback("test_prompt");
    expect(retrieved).toBeDefined();
  });

  test("getPromptCallback returns undefined for unknown prompt", () => {
    expect(toolRegistry.getPromptCallback("nonexistent")).toBeUndefined();
  });

  test("installOn preserves entries when re-installed (HTTP multi-session safety)", () => {
    server.registerTool("old_tool", { title: "Old" }, async () => ({}));
    expect(toolRegistry.getToolCount()).toBe(1);

    // Re-install on a new server — entries preserved (no race window)
    const server2 = createMockServer();
    toolRegistry.installOn(server2);
    expect(toolRegistry.getToolCount()).toBe(1);
  });

  test("isolated registries keep same-name handlers bound to their own server session", async () => {
    const firstRegistry = createToolRegistry();
    const secondRegistry = createToolRegistry();
    const firstServer = createMockServer();
    const secondServer = createMockServer();
    firstRegistry.installOn(firstServer);
    secondRegistry.installOn(secondServer);

    firstServer.registerTool("session_probe", { title: "Probe" }, async () => ({
      content: [{ type: "text", text: "first-session" }],
    }));
    secondServer.registerTool("session_probe", { title: "Probe" }, async () => ({
      content: [{ type: "text", text: "second-session" }],
    }));

    await expect(firstRegistry.callTool("session_probe", {})).resolves.toMatchObject({
      content: [{ text: "first-session" }],
    });
    await expect(secondRegistry.callTool("session_probe", {})).resolves.toMatchObject({
      content: [{ text: "second-session" }],
    });
  });

  test("pruneStaleRegistrations removes entries not registered by the latest server generation", () => {
    server.registerTool("old_tool", { title: "Old" }, async () => ({}));

    const server2 = createMockServer();
    toolRegistry.installOn(server2);
    server2.registerTool("new_tool", { title: "New" }, async () => ({}));
    toolRegistry.pruneStaleRegistrations();

    expect(toolRegistry.getToolNames()).toEqual(["new_tool"]);
    expect(toolRegistry.getToolInfo("old_tool")).toBeUndefined();
  });

  test("reset() clears all registrations", () => {
    server.registerTool("old_tool", { title: "Old" }, async () => ({}));
    expect(toolRegistry.getToolCount()).toBe(1);
    toolRegistry.reset();
    expect(toolRegistry.getToolCount()).toBe(0);
  });

  test("progressive exposure hides tools from SDK but keeps them searchable and callable", async () => {
    toolRegistry.configureExposure({ mode: "progressive", exposedToolNames: new Set(["visible_tool"]) });

    server.registerTool("visible_tool", { title: "Visible", description: "Shown to tools/list" }, async () => ({
      content: [{ type: "text", text: "visible" }],
    }));
    server.registerTool("hidden_tool", { title: "Hidden", description: "Still discoverable" }, async () => ({
      content: [{ type: "text", text: "hidden" }],
    }));

    expect(toolRegistry.getToolCount()).toBe(2);
    expect(toolRegistry.getExposedToolNames()).toEqual(["visible_tool"]);
    expect(toolRegistry.getExposedToolCount()).toBe(1);
    expect(server._tools.has("visible_tool")).toBe(true);
    expect(server._tools.has("hidden_tool")).toBe(false);
    expect(toolRegistry.searchTools("hidden").map((r) => r.name)).toContain("hidden_tool");

    const result = await toolRegistry.callTool("hidden_tool", {});
    expect(result.content[0].text).toBe("hidden");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests — real McpServer from @modelcontextprotocol/sdk v1.29.0
//
// These verify that the monkey-patching in tool-registry.ts is compatible
// with the actual SDK. The critical assumption is that the callback is
// always the last argument to registerTool(name, config, cb).
// ═══════════════════════════════════════════════════════════════════════════

describe("ToolRegistry monkey-patch on real McpServer (SDK integration)", () => {
  let server;

  beforeEach(() => {
    toolRegistry.reset();
    server = new McpServer({ name: "test-server", version: "0.0.1" });
    toolRegistry.installOn(server);
  });

  // ── Basic registration and tracking ───────────────────────────────

  test("registerTool on real McpServer is tracked in the registry", () => {
    server.registerTool(
      "real_tool",
      {
        title: "Real Tool",
        description: "Registered on the real SDK McpServer",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({
        content: [{ type: "text", text: "hello" }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(["real_tool"]);
  });

  test("getToolInfo returns correct metadata for a real-SDK tool", () => {
    server.registerTool(
      "info_tool",
      {
        title: "Info Tool",
        description: "Returns tool info correctly",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => ({
        content: [{ type: "text", text: "info" }],
      }),
    );

    const info = toolRegistry.getToolInfo("info_tool");
    expect(info).toBeDefined();
    expect(info.name).toBe("info_tool");
    expect(info.title).toBe("Info Tool");
    expect(info.description).toBe("Returns tool info correctly");
  });

  test("actual SDK registration inventories outputSchema and dispatches structuredContent", async () => {
    server.registerTool(
      "typed_tool",
      {
        title: "Typed Tool",
        description: "Returns a typed payload",
        inputSchema: {},
        outputSchema: { value: z.string() },
        annotations: { readOnlyHint: true },
      },
      async () => ({
        content: [{ type: "text", text: '{"value":"session-bound"}' }],
        structuredContent: { value: "session-bound" },
      }),
    );

    expect(toolRegistry.getOutputSchemaTools()).toEqual([
      { name: "typed_tool", outputSchema: { value: expect.anything() } },
    ]);
    await expect(toolRegistry.callTool("typed_tool", {})).resolves.toMatchObject({
      structuredContent: { value: "session-bound" },
    });
  });

  test("real SDK client receives HITL denial instead of outputSchema JSON-RPC error", async () => {
    const original = jest.fn(async () => ({
      content: [{ type: "text", text: '{"stored":true}' }],
      structuredContent: { stored: true },
    }));
    installHitlGuard(
      server,
      {
        isReachable: async () => true,
        requestApproval: async () => false,
      },
      {
        hitl: { level: "all", whitelist: new Set() },
      },
    );
    server.registerTool(
      "schema_governed_write",
      {
        title: "Schema governed write",
        description: "Regression probe for typed HITL denial",
        inputSchema: {},
        outputSchema: { stored: z.boolean() },
        annotations: { readOnlyHint: false, sensitiveHint: true },
      },
      original,
    );

    const { serverTransport, clientTransport } = createLinkedTransports();
    const client = new Client({ name: "claude-regression", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await client.listTools();
      const result = await client.callTool({ name: "schema_governed_write", arguments: {} });

      expect(original).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0].text).toContain("[permission_denied]");
      expect(result._meta?.["airmcp/error"]).toMatchObject({
        category: "permission_denied",
        retryable: false,
        correlationId: expect.any(String),
      });
      expect(result).not.toHaveProperty("error");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("real SDK client receives a categorized resource denial on the wire", async () => {
    const original = jest.fn(async () => ({
      contents: [{ uri: "secret://current", mimeType: "text/plain", text: "must not leak" }],
    }));
    installHitlGuard(
      server,
      {
        isReachable: async () => true,
        requestApproval: async () => false,
      },
      { hitl: { level: "sensitive-only", whitelist: new Set() } },
    );
    server.registerResource(
      "secret-current",
      "secret://current",
      withResourceGovernance(
        { title: "Secret", description: "Sensitive resource", mimeType: "text/plain" },
        { sensitiveHint: true },
      ),
      original,
    );

    const { serverTransport, clientTransport } = createLinkedTransports();
    const client = new Client({ name: "resource-regression", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await client.listResources();
      await expect(client.readResource({ uri: "secret://current" })).rejects.toThrow(/permission_denied/);
      expect(original).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  // ── Handler wrapping — callTool returns expected result ───────────

  test("callTool invokes the wrapped handler and returns expected result", async () => {
    server.registerTool(
      "echo_tool",
      {
        title: "Echo",
        description: "Echoes back the input",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async (args) => ({
        content: [{ type: "text", text: `echo: ${JSON.stringify(args)}` }],
      }),
    );

    const result = await toolRegistry.callTool("echo_tool", { msg: "ping" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe('echo: {"msg":"ping"}');
  });

  test("callTool propagates errors from the handler", async () => {
    server.registerTool(
      "fail_tool",
      {
        title: "Fail Tool",
        description: "Always throws",
        inputSchema: {},
      },
      async () => {
        throw new Error("intentional failure");
      },
    );

    await expect(toolRegistry.callTool("fail_tool", {})).rejects.toThrow("intentional failure");
  });

  // ── Multiple tools — callback position assumption holds ───────────

  test("registering two tools tracks both and both handlers work", async () => {
    server.registerTool(
      "tool_alpha",
      {
        title: "Alpha",
        description: "First tool",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () => ({
        content: [{ type: "text", text: "alpha-result" }],
      }),
    );

    server.registerTool(
      "tool_beta",
      {
        title: "Beta",
        description: "Second tool",
        inputSchema: {
          value: z.string().describe("A string value"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => ({
        content: [{ type: "text", text: `beta-${args.value}` }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(2);
    expect(toolRegistry.getToolNames()).toContain("tool_alpha");
    expect(toolRegistry.getToolNames()).toContain("tool_beta");

    const alphaResult = await toolRegistry.callTool("tool_alpha", {});
    expect(alphaResult.content[0].text).toBe("alpha-result");

    const betaResult = await toolRegistry.callTool("tool_beta", { value: "test" });
    expect(betaResult.content[0].text).toBe("beta-test");
  });

  // ── Signature compatibility: exact patterns from codebase modules ─

  test("registerTool with empty inputSchema and full annotations (reminders pattern)", async () => {
    // Mirrors: src/reminders/tools.ts — list_reminder_lists
    server.registerTool(
      "list_reminder_lists",
      {
        title: "List Reminder Lists",
        description: "List all reminder lists with reminder counts.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "Default", count: 3 }]) }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(["list_reminder_lists"]);
    const result = await toolRegistry.callTool("list_reminder_lists", {});
    expect(result.content[0].text).toContain("Default");
  });

  test("registerTool with Zod inputSchema fields (reminders list_reminders pattern)", async () => {
    // Mirrors: src/reminders/tools.ts — list_reminders (Zod fields in inputSchema)
    server.registerTool(
      "list_reminders",
      {
        title: "List Reminders",
        description: "List reminders. Supports filtering and pagination.",
        inputSchema: {
          list: z.string().max(500).optional().describe("Filter by list name"),
          completed: z.boolean().optional().describe("Filter by completed status"),
          limit: z.number().int().min(1).max(1000).optional().default(200).describe("Max number to return"),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ list: args.list || "all", count: 0 }),
          },
        ],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    const info = toolRegistry.getToolInfo("list_reminders");
    expect(info.title).toBe("List Reminders");
    const result = await toolRegistry.callTool("list_reminders", { list: "Work" });
    expect(JSON.parse(result.content[0].text).list).toBe("Work");
  });

  test("registerTool with minimal config (no inputSchema, no annotations)", async () => {
    // Edge case: bare-minimum config object
    server.registerTool(
      "bare_tool",
      {
        title: "Bare Tool",
        description: "Minimal registration",
      },
      async () => ({
        content: [{ type: "text", text: "bare" }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(["bare_tool"]);
    const result = await toolRegistry.callTool("bare_tool", {});
    expect(result.content[0].text).toBe("bare");
  });

  test("registerTool with write annotations (pages pattern)", async () => {
    // Mirrors: src/pages/tools.ts — pages_open_document (readOnlyHint: false)
    server.registerTool(
      "pages_open_document",
      {
        title: "Open Pages Document",
        description: "Open a Pages document from a file path.",
        inputSchema: {
          path: z.string().describe("Absolute file path to the .pages document"),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => ({
        content: [{ type: "text", text: `opened: ${args.path}` }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    const result = await toolRegistry.callTool("pages_open_document", {
      path: "/tmp/test.pages",
    });
    expect(result.content[0].text).toBe("opened: /tmp/test.pages");
  });

  // ── Verify SDK actually received the tool (not silently dropped) ──

  test("real McpServer internally registers the tool (not silently swallowed)", () => {
    server.registerTool(
      "internal_check",
      {
        title: "Internal Check",
        description: "Verifies the SDK stored the tool internally",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => ({
        content: [{ type: "text", text: "ok" }],
      }),
    );

    // The SDK stores tools in _registeredTools (a plain object, not a Map).
    // Access it to confirm the monkey-patch forwarded the call correctly.
    // This is intentionally accessing a private field for test verification.
    const sdkInternalTools = server._registeredTools;
    expect(sdkInternalTools).toBeDefined();
    expect("internal_check" in sdkInternalTools).toBe(true);
    expect(typeof sdkInternalTools["internal_check"].handler).toBe("function");
  });

  // ── registerTool signature: callback is always the last argument ──

  test("callback is the last argument to registerTool (SDK v1.29.0 contract)", () => {
    // The monkey-patch assumes: rest[rest.length - 1] is the callback.
    // Verify this by checking the SDK's registerTool.length or by confirming
    // that the tool works. If the SDK ever changes the argument order, this
    // test will break, alerting us to update the monkey-patch.
    const originalRegisterTool = McpServer.prototype.registerTool;
    // SDK registerTool should accept (name, config, cb) — 3 parameters
    // Note: Function.length may not reflect all params due to defaults/rest,
    // so we rely on a functional test instead.
    let callbackReceived = false;
    const testServer = new McpServer({ name: "sig-test", version: "0.0.1" });

    // Register without the monkey-patch to observe raw SDK behavior
    testServer.registerTool(
      "sig_test",
      {
        title: "Sig Test",
        description: "Signature verification",
        inputSchema: {},
      },
      async () => {
        callbackReceived = true;
        return { content: [{ type: "text", text: "sig-ok" }] };
      },
    );

    // Verify the SDK stored it — the handler should be in the tool's entry
    const entry = testServer._registeredTools["sig_test"];
    expect(entry).toBeDefined();
    // The SDK stores the callback as .handler. If callback was not the last arg,
    // the SDK would have thrown or stored undefined.
    expect(typeof entry.handler).toBe("function");
  });

  // ── Bulk registration — stress test for multiple tools ────────────

  test("registering many tools in sequence all tracked correctly", async () => {
    const count = 20;
    for (let i = 0; i < count; i++) {
      server.registerTool(
        `bulk_tool_${i}`,
        {
          title: `Bulk Tool ${i}`,
          description: `Bulk test tool number ${i}`,
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
        async () => ({
          content: [{ type: "text", text: `result-${i}` }],
        }),
      );
    }

    expect(toolRegistry.getToolCount()).toBe(count);
    for (let i = 0; i < count; i++) {
      expect(toolRegistry.getToolNames()).toContain(`bulk_tool_${i}`);
    }

    // Spot-check a few handlers
    const r0 = await toolRegistry.callTool("bulk_tool_0", {});
    expect(r0.content[0].text).toBe("result-0");

    const r19 = await toolRegistry.callTool("bulk_tool_19", {});
    expect(r19.content[0].text).toBe("result-19");
  });
});
