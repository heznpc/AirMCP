import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "airmcp-governed-approval-"));
const previousAuditDir = process.env.AIRMCP_VECTOR_STORE_DIR;
const previousAuditEnabled = process.env.AIRMCP_AUDIT_LOG;
const previousUsageTracking = process.env.AIRMCP_USAGE_TRACKING;
process.env.AIRMCP_VECTOR_STORE_DIR = scratch;
process.env.AIRMCP_AUDIT_LOG = "true";
process.env.AIRMCP_USAGE_TRACKING = "false";

const { createToolRegistry } = await import("../dist/shared/tool-registry.js");
const { installHitlGuard } = await import("../dist/shared/hitl-guard.js");
const { withResourceGovernance } = await import("../dist/shared/resource-governance.js");
const { getCorrelationId } = await import("../dist/shared/request-context.js");
const { _testReset, readAuditEntries } = await import("../dist/shared/audit.js");

function createMockServer() {
  const tools = new Map();
  const resources = new Map();
  return {
    registerTool: jest.fn((name, options, handler) => {
      tools.set(name, { options, handler });
    }),
    tool: jest.fn(),
    registerPrompt: jest.fn(),
    prompt: jest.fn(),
    registerResource: jest.fn((name, uriOrTemplate, config, handler) => {
      resources.set(name, { uriOrTemplate, config, handler });
    }),
    _tools: tools,
    _resources: resources,
  };
}

beforeEach(() => {
  _testReset();
  rmSync(scratch, { recursive: true, force: true });
});

afterAll(() => {
  _testReset();
  rmSync(scratch, { recursive: true, force: true });
  if (previousAuditDir === undefined) delete process.env.AIRMCP_VECTOR_STORE_DIR;
  else process.env.AIRMCP_VECTOR_STORE_DIR = previousAuditDir;
  if (previousAuditEnabled === undefined) delete process.env.AIRMCP_AUDIT_LOG;
  else process.env.AIRMCP_AUDIT_LOG = previousAuditEnabled;
  if (previousUsageTracking === undefined) delete process.env.AIRMCP_USAGE_TRACKING;
  else process.env.AIRMCP_USAGE_TRACKING = previousUsageTracking;
});

describe("governed approval audit ordering", () => {
  test("a sensitive resource approval is HMAC-verified before its live read", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    const approvalCalls = [];
    installHitlGuard(
      server,
      {
        isReachable: async () => true,
        requestApproval: async (name, args, destructive, openWorld, sensitive) => {
          approvalCalls.push({ name, args, destructive, openWorld, sensitive });
          return true;
        },
      },
      { hitl: { level: "sensitive-only", whitelist: new Set() } },
    );

    let readStarted = false;
    let preReadSnapshot;
    server.registerResource(
      "clipboard-current",
      "clipboard://current",
      withResourceGovernance(
        { title: "Clipboard", description: "Current clipboard", mimeType: "text/plain" },
        { sensitiveHint: true },
      ),
      async () => {
        preReadSnapshot = await readAuditEntries({
          since: "2020-01-01T00:00:00.000Z",
          tool: "resource:clipboard-current",
          kind: "approval",
          limit: 10,
        });
        readStarted = true;
        return { contents: [{ uri: "clipboard://current", text: "private value" }] };
      },
    );

    const sdkExtra = { requestId: "must-not-be-treated-as-vars" };
    sdkExtra.circular = sdkExtra;
    const result = await server._resources
      .get("clipboard-current")
      .handler(new URL("clipboard://current"), sdkExtra);

    expect(result.contents[0].text).toBe("private value");
    expect(readStarted).toBe(true);
    expect(approvalCalls).toEqual([
      {
        name: "resource:clipboard-current",
        args: { uri: "clipboard://current" },
        destructive: false,
        openWorld: false,
        sensitive: true,
      },
    ]);
    expect(preReadSnapshot).toMatchObject({ verified: true, auditDisabled: false });
    expect(preReadSnapshot.entries).toEqual([
      expect.objectContaining({
        approvalId: expect.any(String),
        kind: "approval",
        tool: "resource:clipboard-current",
        approvalDecision: "approved",
        approvalChannel: "socket",
      }),
    ]);

    const completed = await readAuditEntries({
      since: "2020-01-01T00:00:00.000Z",
      tool: "resource:clipboard-current",
      limit: 10,
    });
    expect(completed.verified).toBe(true);
    expect(completed.entries.some((entry) => entry.kind === "tool" && entry.status === "ok")).toBe(true);
    expect(JSON.stringify(completed.entries)).not.toContain("private value");
    expect(JSON.stringify(completed.entries)).not.toContain("must-not-be-treated-as-vars");
  });

  test("the approved event is HMAC-verified before the handler mutates", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      {
        isReachable: async () => true,
        requestApproval: async () => true,
      },
      { hitl: { level: "all", whitelist: new Set() } },
    );

    let mutated = false;
    let preMutationSnapshot;
    server.registerTool(
      "persist_governed_change",
      {
        title: "Persist governed change",
        annotations: { readOnlyHint: false },
      },
      async () => {
        const correlationId = getCorrelationId();
        preMutationSnapshot = await readAuditEntries({
          since: "2020-01-01T00:00:00.000Z",
          tool: "persist_governed_change",
          kind: "approval",
          correlationId,
          limit: 10,
        });
        mutated = true;
        return { content: [{ type: "text", text: "changed" }] };
      },
    );

    await registry.callTool("persist_governed_change", {});

    expect(mutated).toBe(true);
    expect(preMutationSnapshot).toMatchObject({ verified: true, auditDisabled: false });
    expect(preMutationSnapshot.entries).toHaveLength(1);
    const approval = preMutationSnapshot.entries[0];
    expect(approval).toMatchObject({
      kind: "approval",
      tool: "persist_governed_change",
      status: "ok",
      approvalDecision: "approved",
      approvalChannel: "socket",
      correlationId: expect.any(String),
    });

    const completed = await readAuditEntries({
      since: "2020-01-01T00:00:00.000Z",
      correlationId: approval.correlationId,
      limit: 10,
    });
    expect(completed).toMatchObject({ verified: true, auditDisabled: false });
    const outcome = completed.entries.find((entry) => entry.kind === "tool");
    expect(outcome).toBeDefined();
    expect(outcome.timestamp.localeCompare(approval.timestamp)).toBeGreaterThanOrEqual(0);
  });

  test("AIRMCP_AUDIT_LOG=false blocks an approved mutation instead of bypassing the durable barrier", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      { isReachable: async () => true, requestApproval: async () => true },
      { hitl: { level: "all", whitelist: new Set() } },
    );
    const mutation = jest.fn(async () => ({ content: [{ type: "text", text: "must not run" }] }));
    server.registerTool(
      "audit_disabled_approved_write",
      { title: "Audit disabled approved write", annotations: { readOnlyHint: false } },
      mutation,
    );

    process.env.AIRMCP_AUDIT_LOG = "false";
    try {
      await expect(registry.callTool("audit_disabled_approved_write", {})).rejects.toThrow(
        "Approval audit is disabled",
      );
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      process.env.AIRMCP_AUDIT_LOG = "true";
    }
  });

  test("AIRMCP_AUDIT_LOG=false preserves a negative HITL permission result", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      { isReachable: async () => true, requestApproval: async () => false },
      { hitl: { level: "all", whitelist: new Set() } },
    );
    const mutation = jest.fn();
    server.registerTool(
      "audit_disabled_denied_write",
      { title: "Audit disabled denied write", annotations: { readOnlyHint: false } },
      mutation,
    );

    process.env.AIRMCP_AUDIT_LOG = "false";
    try {
      const result = await registry.callTool("audit_disabled_denied_write", {});
      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toContain("denied");
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      process.env.AIRMCP_AUDIT_LOG = "true";
    }
  });
});
