import { afterAll, describe, expect, test } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "airmcp-audit-spool-"));
const previousAuditDir = process.env.AIRMCP_VECTOR_STORE_DIR;
const previousAuditKey = process.env.AIRMCP_AUDIT_HMAC_KEY;
const previousBufferLimit = process.env.AIRMCP_AUDIT_MAX_BUFFER_BYTES;
process.env.AIRMCP_VECTOR_STORE_DIR = scratch;
process.env.AIRMCP_AUDIT_HMAC_KEY = "bounded-spool-test-key";
process.env.AIRMCP_AUDIT_MAX_BUFFER_BYTES = "10000";

const { _testGetState, _testReset, auditLog, flushAuditLog } = await import("../dist/shared/audit.js");

afterAll(() => {
  _testReset();
  rmSync(scratch, { recursive: true, force: true });
  if (previousAuditDir === undefined) delete process.env.AIRMCP_VECTOR_STORE_DIR;
  else process.env.AIRMCP_VECTOR_STORE_DIR = previousAuditDir;
  if (previousAuditKey === undefined) delete process.env.AIRMCP_AUDIT_HMAC_KEY;
  else process.env.AIRMCP_AUDIT_HMAC_KEY = previousAuditKey;
  if (previousBufferLimit === undefined) delete process.env.AIRMCP_AUDIT_MAX_BUFFER_BYTES;
  else process.env.AIRMCP_AUDIT_MAX_BUFFER_BYTES = previousBufferLimit;
});

describe("bounded audit spool", () => {
  test("caps memory and permanently fails governed audit authority closed", async () => {
    for (let index = 0; index < 100; index += 1) {
      auditLog({
        timestamp: `2026-07-11T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        tool: `spool_probe_${index}`,
        args: { payload: "x".repeat(500) },
        status: "ok",
      });
    }

    const capped = _testGetState();
    expect(capped).toMatchObject({ auditDisabled: true, auditSpoolOverflowed: true });
    expect(capped.bufferBytes).toBeLessThanOrEqual(10_000);
    const accepted = capped.bufferLength;

    for (let index = 0; index < 100; index += 1) {
      auditLog({ timestamp: "2026-07-11T00:01:00.000Z", tool: `refused_${index}`, status: "ok" });
    }
    expect(_testGetState()).toMatchObject({
      auditDisabled: true,
      auditSpoolOverflowed: true,
      bufferLength: accepted,
      bufferBytes: capped.bufferBytes,
    });

    await expect(flushAuditLog()).rejects.toThrow("Audit shutdown flush incomplete");
    const persisted = readFileSync(join(scratch, "audit.jsonl"), "utf8").trim().split("\n");
    expect(persisted).toHaveLength(accepted);
    expect(_testGetState()).toMatchObject({
      auditDisabled: true,
      auditSpoolOverflowed: true,
      bufferLength: 0,
      bufferBytes: 0,
    });
  });
});
