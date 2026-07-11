/**
 * Tamper-detection test — verifies the HMAC chain ACTUALLY catches
 * audit log mutation. The audit team's 2026-05-13 review noted:
 *
 *   "HMAC chain tamper detection 테스트 0건. Audit chain이 그렇게
 *    자랑스러우면 '5 entries → flush → 가운데 line mutate →
 *    audit_summary 호출 → verified:false 단정' 테스트가 있어야 함.
 *    없음."
 *
 * The codebase ships `summarizeAuditEntries()` whose `verified` field
 * is one of the strongest trust signals — but nothing was asserting it
 * fires under real tampering. This test plugs that hole with four
 * mutation shapes:
 *   1. happy path — clean chain reports verified:true
 *   2. body mutation — change one entry's args, _hmac no longer matches
 *      → verified:false, reason:"hmac_mismatch"
 *   3. prev-link mutation — change _prev on the middle line, chain
 *      breaks at the seam → verified:false, reason:"prev_mismatch"
 *   4. _hmac field shape corruption — non-hex value → verified:false,
 *      reason:"malformed"
 *
 * If a future refactor weakens the chain scanner (e.g. silently tolerates
 * mismatches, or only checks the last line), this test fires.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-tamper-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "tamper-test-fixture-key";
process.env.AIRMCP_AUDIT_LOG = "true";

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush, _testGetState, readAuditEntries, summarizeAuditEntries } =
  await import("../dist/shared/audit.js");

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
}

async function seedFiveEntries() {
  _testReset();
  await wipeDir();
  for (let i = 0; i < 5; i++) {
    auditLog({
      timestamp: `2026-05-13T00:00:0${i}Z`,
      tool: `tool_${i}`,
      args: { i },
      status: "ok",
    });
  }
  await _testFlush();
}

const AUDIT_PATH = join(workDir, "audit.jsonl");

describe("audit chain tamper detection", () => {
  beforeEach(async () => {
    await seedFiveEntries();
  });

  test("1. clean chain — summary reports verified:true", async () => {
    const summary = await summarizeAuditEntries({
      since: "2020-01-01T00:00:00Z",
    });
    expect(summary.verified).toBe(true);
    expect(summary.verifiedFirstBreak).toBeUndefined();
  });

  test("2. body mutation — tool name changed mid-chain → verified:false, hmac_mismatch", async () => {
    // Read all 5 sealed lines, mutate the middle one's `tool` field, write
    // back. The _hmac is signed over the body — any body byte change
    // invalidates the signature.
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(5);

    const middle = JSON.parse(lines[2]);
    middle.tool = "tampered_tool"; // mutation under signed envelope
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({
      since: "2020-01-01T00:00:00Z",
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe("hmac_mismatch");
    // Index 2 is the third entry (0-indexed) — the one we mutated.
    expect(summary.verifiedFirstBreak.lineIndex).toBe(2);
  });

  test("3. prev-link mutation — _prev flipped → verified:false, prev_mismatch", async () => {
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const lines = raw.trimEnd().split("\n");
    const middle = JSON.parse(lines[2]);
    // Recompute the _hmac for the mutated _prev so the body itself
    // verifies — this isolates the prev_mismatch detection path from
    // the body-mismatch path tested above.
    const { createHmac } = await import("node:crypto");
    middle._prev = "f".repeat(64);
    const { _hmac: _h, _prev: _p, ...body } = middle;
    middle._hmac = createHmac("sha256", "tamper-test-fixture-key")
      .update(middle._prev)
      .update("\0")
      .update(JSON.stringify(body))
      .digest("hex");
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({
      since: "2020-01-01T00:00:00Z",
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe("prev_mismatch");
  });

  test("4. malformed _hmac — non-hex value → verified:false, malformed", async () => {
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const lines = raw.trimEnd().split("\n");
    const middle = JSON.parse(lines[2]);
    middle._hmac = "not-a-valid-hex-hmac"; // wrong length AND wrong charset
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({
      since: "2020-01-01T00:00:00Z",
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe("malformed");
  });

  test.each([
    ["duplicate key", (line) => line.replace('"tool":"tool_2"', '"tool":"forged","tool":"tool_2"')],
    ["alternate escape", (line) => line.replace('"tool":"tool_2"', '"tool":"tool_\\u0032"')],
    ["insignificant whitespace", (line) => line.replace('"status":"ok"', '"status" : "ok"')],
  ])("4b. %s raw-body edit cannot survive semantic JSON normalization", async (_name, mutate) => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    const originalObject = JSON.parse(lines[2]);
    lines[2] = mutate(lines[2]);

    // Every mutation decodes to the same object that AirMCP originally
    // signed. The verifier must nevertheless authenticate the literal bytes,
    // not JSON.parse/stringify's normalized representation.
    expect(JSON.parse(lines[2])).toEqual(originalObject);
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toMatchObject({ lineIndex: 2, reason: "hmac_mismatch" });
  });

  test("5. appended unauthorized entry — verified:false", async () => {
    // Attacker who knows about the file but NOT the HMAC key tries to
    // smuggle in a fake "ok" entry. They can craft any JSON, but they
    // can't compute the right _hmac → verifier catches them.
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const fake = JSON.stringify({
      timestamp: "2026-05-13T00:00:99Z",
      tool: "attacker_injected",
      status: "ok",
      _prev: "f".repeat(64),
      _hmac: "0".repeat(64), // bogus signature
    });
    await writeFile(AUDIT_PATH, raw + fake + "\n", "utf-8");

    const summary = await summarizeAuditEntries({
      since: "2020-01-01T00:00:00Z",
    });
    expect(summary.verified).toBe(false);
  });

  test("6. unsigned prepend before a signed chain is unverified and excluded from trusted counts", async () => {
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const legacy = JSON.stringify({
      timestamp: "2026-05-12T23:59:59Z",
      tool: "legacy_before_chain",
      status: "ok",
    });
    await writeFile(AUDIT_PATH, `${legacy}\n${raw}`, "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toEqual({
      file: "audit.jsonl",
      lineIndex: 0,
      reason: "malformed",
    });
    expect(summary.total).toBe(5);
    expect(summary.topTools.some((row) => row.tool === "legacy_before_chain")).toBe(false);
    const page = await readAuditEntries({ since: "2020-01-01T00:00:00Z", limit: 100 });
    expect(page.entries.some((row) => row.tool === "legacy_before_chain")).toBe(false);
  });

  test("7. unsigned insertion after chain start fails closed and is never counted", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    lines.splice(
      2,
      0,
      JSON.stringify({
        timestamp: "2026-05-13T00:00:02.500Z",
        tool: "unsigned_injected",
        status: "ok",
      }),
    );
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toEqual({
      file: "audit.jsonl",
      lineIndex: 2,
      reason: "malformed",
    });
    // Fail closed at the insertion: neither the fake row nor later rows from
    // the compromised ordering contribute to the trusted aggregate.
    expect(summary.total).toBe(2);
    expect(summary.topTools.map((row) => row.tool).sort()).toEqual(["tool_0", "tool_1"]);

    const page = await readAuditEntries({ since: "2020-01-01T00:00:00Z", limit: 100 });
    expect(page.total).toBe(2);
    expect(page.entries.some((entry) => entry.tool === "unsigned_injected")).toBe(false);
  });

  test("8. malformed insertion after chain start fails closed and is never counted", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    lines.splice(2, 0, "{not valid json");
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toEqual({
      file: "audit.jsonl",
      lineIndex: 2,
      reason: "malformed",
    });
    expect(summary.total).toBe(2);
    expect(summary.topTools.map((row) => row.tool).sort()).toEqual(["tool_0", "tool_1"]);
  });

  test("9. next signed append quarantines an unsigned prefix without changing the valid signed suffix", async () => {
    const signedBefore = await readFile(AUDIT_PATH, "utf-8");
    const legacy = JSON.stringify({
      timestamp: "2026-05-12T23:59:59Z",
      tool: "upgrade_legacy_prefix",
      status: "ok",
    });
    await writeFile(AUDIT_PATH, `${legacy}\n${signedBefore}`, "utf-8");
    _testReset(); // model the upgraded process starting from the mixed file

    auditLog({ timestamp: "2026-05-13T00:01:00Z", tool: "after_upgrade", status: "ok" });
    await _testFlush();

    const activeLines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    expect(activeLines.slice(0, 5).join("\n") + "\n").toBe(signedBefore);
    expect(JSON.parse(activeLines[5]).tool).toBe("after_upgrade");
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(6);
    expect(summary.topTools.some((row) => row.tool === "upgrade_legacy_prefix")).toBe(false);
    expect((await readdir(workDir)).some((file) => file.startsWith("audit.legacy-untrusted."))).toBe(true);
  });
});

const CHECKPOINT_PATH = join(workDir, "audit.checkpoint");

describe("audit chain tail-truncation detection (signed checkpoint)", () => {
  beforeEach(async () => {
    await seedFiveEntries();
  });

  test("flush writes a signed checkpoint and the clean chain verifies", async () => {
    // Seeding flushed 5 sealed lines + a checkpoint anchoring the highest seq.
    const ck = JSON.parse(await readFile(CHECKPOINT_PATH, "utf-8"));
    expect(ck.seq).toBe(4);
    expect(ck.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(ck.mac).toMatch(/^[0-9a-f]{64}$/);
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.verifiedFirstBreak).toBeUndefined();
  });

  test("removing the last lines (valid shorter chain) → verified:false, truncated", async () => {
    // Drop the final 2 lines. The remaining chain (seq 0..2) still verifies
    // line-by-line — a plain replay would report verified:true. The checkpoint
    // (seq=4) is what catches the missing tail.
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    await writeFile(AUDIT_PATH, lines.slice(0, 3).join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe("truncated");
  });

  test("editing the checkpoint MAC without the key → verified:false, checkpoint_forged", async () => {
    const ck = JSON.parse(await readFile(CHECKPOINT_PATH, "utf-8"));
    ck.mac = "a".repeat(64); // valid hex shape, wrong MAC — forging it needs the key
    await writeFile(CHECKPOINT_PATH, JSON.stringify(ck) + "\n", "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("checkpoint_forged");
  });

  test("an unparseable checkpoint fails closed (atomic writes cannot tear)", async () => {
    await writeFile(CHECKPOINT_PATH, "{not valid json", "utf-8");
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("checkpoint_forged");
  });

  test("deleting the checkpoint after sequenced writes fails closed", async () => {
    await rm(CHECKPOINT_PATH, { force: true });
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("truncated");
  });

  test("truncation with the checkpoint also removed still fails closed", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    await writeFile(AUDIT_PATH, lines.slice(0, 3).join("\n") + "\n", "utf-8");
    await rm(CHECKPOINT_PATH, { force: true });
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("truncated");
  });

  test("restart + append cannot overwrite a higher checkpoint and heal a truncated tail", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    const checkpointBefore = await readFile(CHECKPOINT_PATH, "utf-8");
    await writeFile(AUDIT_PATH, lines.slice(0, 3).join("\n") + "\n", "utf-8");

    _testReset(); // process restart: forget the in-memory head
    auditLog({ timestamp: "2026-05-13T00:01:00Z", tool: "must_not_append", status: "ok" });
    await _testFlush();

    expect((await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n")).toHaveLength(3);
    expect(await readFile(CHECKPOINT_PATH, "utf-8")).toBe(checkpointBefore);
    expect(_testGetState().bufferLength).toBe(1);
    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("truncated");
  });

  test("checkpoint replacement failure is recorded and leaves reads fail-closed without duplicate append", async () => {
    const checkpointBefore = await readFile(CHECKPOINT_PATH, "utf-8");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.AIRMCP_TEST_AUDIT_FAIL_CHECKPOINT = "1";
    try {
      auditLog({ timestamp: "2026-05-13T00:01:00Z", tool: "checkpoint_gap", status: "ok" });
      await _testFlush();
    } finally {
      delete process.env.AIRMCP_TEST_AUDIT_FAIL_CHECKPOINT;
    }

    expect(errorSpy.mock.calls.some((args) => args.join(" ").includes("atomic checkpoint write failed"))).toBe(true);
    errorSpy.mockRestore();
    expect((await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n")).toHaveLength(6);
    expect(await readFile(CHECKPOINT_PATH, "utf-8")).toBe(checkpointBefore);
    expect(_testGetState().bufferLength).toBe(0); // committed row is never requeued/duplicated

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("truncated");

    auditLog({ timestamp: "2026-05-13T00:02:00Z", tool: "must_wait_for_repair", status: "ok" });
    await _testFlush();
    expect((await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n")).toHaveLength(6);
    expect(_testGetState().bufferLength).toBe(1);
  });
});

describe("process-local checkpoint rollback floor", () => {
  beforeEach(async () => {
    _testReset();
    await wipeDir();
  });

  async function createOlderAndCurrentSnapshots() {
    auditLog({ timestamp: "2026-05-13T00:00:00Z", tool: "floor_0", status: "ok" });
    await _testFlush();
    const older = {
      log: await readFile(AUDIT_PATH, "utf-8"),
      checkpoint: await readFile(CHECKPOINT_PATH, "utf-8"),
    };
    auditLog({ timestamp: "2026-05-13T00:00:01Z", tool: "floor_1", status: "ok" });
    await _testFlush();
    return older;
  }

  test("rejects replacement with an older internally-valid log/checkpoint pair in the same process", async () => {
    const older = await createOlderAndCurrentSnapshots();
    await writeFile(AUDIT_PATH, older.log, "utf-8");
    await writeFile(CHECKPOINT_PATH, older.checkpoint, "utf-8");

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toMatchObject({ file: "audit.checkpoint", reason: "truncated" });
  });

  test("rejects deletion of both the log and checkpoint after observing a floor in the same process", async () => {
    await createOlderAndCurrentSnapshots();
    await rm(AUDIT_PATH, { force: true });
    await rm(CHECKPOINT_PATH, { force: true });

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toMatchObject({ file: "audit.checkpoint", reason: "truncated" });
  });

  test("documents that a complete older pair is valid again after the process-local floor is reset", async () => {
    const older = await createOlderAndCurrentSnapshots();
    await writeFile(AUDIT_PATH, older.log, "utf-8");
    await writeFile(CHECKPOINT_PATH, older.checkpoint, "utf-8");
    _testReset(); // models a process restart; no external monotonic anchor exists

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(1);
  });
});

describe("legacy-only audit compatibility boundary", () => {
  beforeEach(async () => {
    _testReset();
    await wipeDir();
  });

  test("legacy rows remain inspectable but never enter the trusted summary", async () => {
    await writeFile(
      AUDIT_PATH,
      JSON.stringify({ timestamp: "2026-05-12T00:00:00Z", tool: "legacy_only", status: "ok" }) + "\n",
      "utf-8",
    );
    const page = await readAuditEntries({ since: "2020-01-01T00:00:00Z", limit: 100 });
    expect(page.verified).toBe(false);
    expect(page.entries.map((row) => row.tool)).toEqual(["legacy_only"]);

    const summary = await summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.topTools).toEqual([]);
  });

  test("does not expose an unsigned prefix when the first signed-shaped row is malformed", async () => {
    const forgedLegacy = JSON.stringify({
      timestamp: "2026-05-12T00:00:00Z",
      tool: "forged_legacy_prefix",
      status: "ok",
    });
    const malformedSigned = JSON.stringify({
      timestamp: "2026-05-12T00:00:01Z",
      tool: "malformed_signed_row",
      status: "ok",
      _prev: "bad",
      _hmac: "bad",
    });
    await writeFile(AUDIT_PATH, `${forgedLegacy}\n${malformedSigned}\n`, "utf-8");

    const page = await readAuditEntries({ since: "2020-01-01T00:00:00Z", limit: 100 });
    expect(page.verified).toBe(false);
    expect(page.firstBreak).toMatchObject({ file: "audit.jsonl", lineIndex: 1, reason: "malformed" });
    expect(page.entries).toEqual([]);
  });
});
