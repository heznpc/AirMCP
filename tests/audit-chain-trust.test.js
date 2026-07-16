/** Process-local chain-trust anchor: append/approval barriers skip re-HMACing
 *  rows this process already verified under the writer lock, while full
 *  verification (audit_summary, readAuditEntries default) keeps recomputing
 *  every row. These tests pin that trade-off explicitly. */
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-audit-chain-trust-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "audit-chain-trust-regression-key";
process.env.AIRMCP_AUDIT_LOG = "true";

const audit = await import("../dist/shared/audit.js");

const auditPath = join(workDir, "audit.jsonl");

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const file of files) await rm(join(workDir, file), { recursive: true, force: true });
}

async function flushRow(tool) {
  audit.auditLog({ timestamp: new Date().toISOString(), tool, status: "ok" });
  await audit._testFlush();
}

async function readRows() {
  return (await readFile(auditPath, "utf-8")).trimEnd().split("\n").map(JSON.parse);
}

beforeEach(async () => {
  audit._testReset();
  await wipeDir();
});

afterAll(async () => {
  audit._testReset();
  await rm(workDir, { recursive: true, force: true });
});

describe("audit chain-trust anchor", () => {
  test("appends stay O(delta): an in-place body edit of an old row does not block later flushes, but full verification reports it", async () => {
    await flushRow("first_row");

    // In-place BODY tamper of the sealed row: keep _prev/_hmac/seq intact so
    // every structural check still passes and only HMAC recomputation can
    // catch it.
    const rows = await readRows();
    const tampered = rows[0];
    tampered.tool = "tampered_row";
    const line = JSON.stringify(tampered);
    // Writers seal `{body,"_prev":…,"_hmac":…}` — rebuild that exact shape.
    const { _prev, _hmac, ...body } = tampered;
    const sealed = JSON.stringify(body).slice(0, -1) + `,"_prev":"${_prev}","_hmac":"${_hmac}"}`;
    expect(line.length).toBeGreaterThan(0);
    await writeFile(auditPath, sealed + "\n", { mode: 0o600 });

    // The trusted append path (anchor at seq 0) must still seal new rows.
    await flushRow("second_row");
    const after = await readRows();
    expect(after.map((row) => row.tool)).toEqual(["tampered_row", "second_row"]);

    // The hot barrier mode trusts the process anchor…
    const processRead = await audit.readAuditEntries({ since: "2020-01-01T00:00:00Z", integrity: "process" });
    expect(processRead.verified).toBe(true);

    // …while every full verification still fails closed on the edit.
    const fullRead = await audit.readAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(fullRead.verified).toBe(false);
    expect(fullRead.firstBreak?.reason).toBe("hmac_mismatch");
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
  });

  test("a tampered anchor hmac falls back to a full scan and the flush fails closed", async () => {
    await flushRow("anchor_row");

    const rows = await readRows();
    const forged = rows[0];
    forged._hmac = "0".repeat(64);
    const { _prev, _hmac, ...body } = forged;
    const sealed = JSON.stringify(body).slice(0, -1) + `,"_prev":"${_prev}","_hmac":"${_hmac}"}`;
    await writeFile(auditPath, sealed + "\n", { mode: 0o600 });

    audit.auditLog({ timestamp: new Date().toISOString(), tool: "must_not_append", status: "ok" });
    await audit._testFlush().catch(() => {});

    const after = await readRows();
    expect(after.map((row) => row.tool)).toEqual(["anchor_row"]);
    expect(after).toHaveLength(1);
  });

  test("a fresh process (no anchor) fully verifies before its first append", async () => {
    await flushRow("row_a");
    await flushRow("row_b");
    audit._testReset(); // simulates a restart: the trust anchor is process-local

    await flushRow("row_c");
    const rows = await readRows();
    expect(rows.map((row) => row.tool)).toEqual(["row_a", "row_b", "row_c"]);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]);

    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(3);
    expect(existsSync(join(workDir, "audit.lock"))).toBe(false);
  });
});
