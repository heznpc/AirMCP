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
const { getCorrelationId } = await import("../dist/shared/request-context.js");
const { _testReset, readAuditEntries } = await import("../dist/shared/audit.js");

function createMockServer() {
  const tools = new Map();
  return {
    registerTool: jest.fn((name, options, handler) => {
      tools.set(name, { options, handler });
    }),
    tool: jest.fn(),
    registerPrompt: jest.fn(),
    prompt: jest.fn(),
    _tools: tools,
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
});
