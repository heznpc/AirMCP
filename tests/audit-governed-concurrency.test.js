/** Real audit barrier integration for concurrent approved mutations. */
import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-governed-concurrency-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "governed-concurrency-regression-key";
process.env.AIRMCP_AUDIT_LOG = "true";

jest.unstable_mockModule("../dist/shared/usage-tracker.js", () => ({
  usageTracker: { record: jest.fn() },
}));

const { createToolRegistry } = await import("../dist/shared/tool-registry.js");
const { installHitlGuard } = await import("../dist/shared/hitl-guard.js");
const { _testFlush, _testReset, readAuditEntries } = await import("../dist/shared/audit.js");
const { runWithRequestContext } = await import("../dist/shared/request-context.js");

function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, opts, handler) {
      tools.set(name, { opts, handler });
    },
    tool(name, ...rest) {
      tools.set(name, { rest });
    },
    registerPrompt() {},
    prompt() {},
    _tools: tools,
  };
}

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const file of files) await rm(join(workDir, file), { recursive: true, force: true });
}

beforeEach(async () => {
  _testReset();
  await wipeDir();
});

afterAll(async () => {
  delete process.env.AIRMCP_TEST_AUDIT_HOLD_LOCK_MS;
  _testReset();
  await rm(workDir, { recursive: true, force: true });
});

describe("governed mutation audit barrier", () => {
  test("quarantines unsigned upgrade history and verifies the new approval before mutation", async () => {
    await writeFile(
      join(workDir, "audit.jsonl"),
      JSON.stringify({ timestamp: "2026-05-12T00:00:00Z", tool: "legacy_only", status: "ok" }) + "\n",
      { mode: 0o600 },
    );
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      { isReachable: async () => true, requestApproval: async () => true },
      { hitl: { level: "all", whitelist: new Set() } },
    );

    let mutated = false;
    server.registerTool(
      "governed_upgrade_write",
      { title: "governed_upgrade_write", annotations: { readOnlyHint: false } },
      async () => {
        const snapshot = await readAuditEntries({
          since: "2020-01-01T00:00:00Z",
          tool: "governed_upgrade_write",
          kind: "approval",
          limit: 10,
        });
        expect(snapshot.verified).toBe(true);
        expect(snapshot.entries).toEqual([
          expect.objectContaining({
            tool: "governed_upgrade_write",
            kind: "approval",
            approvalDecision: "approved",
          }),
        ]);
        mutated = true;
        return { content: [{ type: "text", text: "mutated" }] };
      },
    );

    const result = await registry.callTool("governed_upgrade_write", {});

    expect(result.isError).not.toBe(true);
    expect(mutated).toBe(true);
    const files = await readdir(workDir);
    expect(files.some((file) => file.startsWith("audit.legacy-untrusted."))).toBe(true);
    const history = await readAuditEntries({ since: "2020-01-01T00:00:00Z", limit: 100 });
    expect(history.verified).toBe(true);
    expect(history.entries.some((row) => row.tool === "legacy_only")).toBe(false);
  });

  test("two concurrent approvals are each sealed before both mutations run", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      { isReachable: async () => true, requestApproval: async () => true },
      { hitl: { level: "all", whitelist: new Set() } },
    );

    const mutations = [];
    const sealedAtMutation = new Map();
    for (const name of ["governed_write_a", "governed_write_b"]) {
      server.registerTool(name, { title: name, annotations: { readOnlyHint: false } }, async () => {
        const snapshot = await readAuditEntries({
          since: "2020-01-01T00:00:00Z",
          tool: name,
          kind: "approval",
          limit: 10,
        });
        const ownApprovalIsSealed =
          snapshot.verified &&
          snapshot.entries.some(
            (row) => row.tool === name && row.kind === "approval" && row.approvalDecision === "approved",
          );
        sealedAtMutation.set(name, ownApprovalIsSealed);
        if (!ownApprovalIsSealed) throw new Error(`${name} entered mutation before its approval was sealed`);
        mutations.push(name);
        return { content: [{ type: "text", text: "mutated" }] };
      });
    }

    // Widen the first append window. The second approval must await the same
    // active flush and then drive its own buffered row before returning.
    process.env.AIRMCP_TEST_AUDIT_HOLD_LOCK_MS = "100";
    try {
      await Promise.all([registry.callTool("governed_write_a", {}), registry.callTool("governed_write_b", {})]);
    } finally {
      delete process.env.AIRMCP_TEST_AUDIT_HOLD_LOCK_MS;
    }

    expect(new Set(mutations)).toEqual(new Set(["governed_write_a", "governed_write_b"]));
    expect([...sealedAtMutation.entries()]).toEqual(
      expect.arrayContaining([
        ["governed_write_a", true],
        ["governed_write_b", true],
      ]),
    );
    const approvals = await readAuditEntries({ since: "2020-01-01T00:00:00Z", kind: "approval", limit: 10 });
    expect(approvals.verified).toBe(true);
    expect(approvals.entries).toHaveLength(2);
    expect(new Set(approvals.entries.map((row) => row.tool))).toEqual(
      new Set(["governed_write_a", "governed_write_b"]),
    );
  });

  test("same-run same-tool same-millisecond approval cannot reuse an older row after append failure", async () => {
    const registry = createToolRegistry();
    const server = createMockServer();
    registry.installOn(server);
    installHitlGuard(
      server,
      { isReachable: async () => true, requestApproval: async () => true },
      { hitl: { level: "all", whitelist: new Set() } },
    );

    const mutation = jest.fn(async () => ({ content: [{ type: "text", text: "mutated" }] }));
    server.registerTool(
      "same_tuple_write",
      { title: "same_tuple_write", annotations: { readOnlyHint: false } },
      mutation,
    );

    const auditPath = join(workDir, "audit.jsonl");
    const correlationId = "77777777-7777-4777-8777-777777777777";
    const isoSpy = jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-07-11T00:00:00.000Z");
    try {
      await runWithRequestContext({ correlationId }, () => registry.callTool("same_tuple_write", {}));
      await _testFlush(); // seal the first tool outcome as well as its approval

      const firstSnapshot = await readAuditEntries({
        since: "2020-01-01T00:00:00.000Z",
        tool: "same_tuple_write",
        correlationId,
        kind: "approval",
        limit: 10,
      });
      expect(firstSnapshot.entries).toHaveLength(1);
      expect(firstSnapshot.entries[0].approvalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // Reads and the writer lock remain available, but both append attempts
      // fail. Without a per-call approvalId, the earlier row has the exact
      // same timestamp/tool/correlation/decision/channel tuple and would
      // incorrectly authorize this second mutation while auditDisabled is
      // still false (the disable threshold is five failed flushes).
      await chmod(auditPath, 0o400);
      await expect(
        runWithRequestContext({ correlationId }, () => registry.callTool("same_tuple_write", {})),
      ).rejects.toThrow("Approval audit could not be verified");
      expect(mutation).toHaveBeenCalledTimes(1);
    } finally {
      isoSpy.mockRestore();
      await chmod(auditPath, 0o600).catch(() => {});
      _testReset();
    }
  });
});
