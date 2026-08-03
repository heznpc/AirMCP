/**
 * Legacy-mixed chain migration + summary honesty regression tests.
 *
 * Reproduces the real-store failure shape found on 2026-08-03: a single
 * audit.jsonl written by SEVERAL AirMCP builds over time —
 *   [unsigned pre-HMAC rows] → [signed rows without seq] → [seq era 0..N] →
 *   [signed rows without seq again] → [seq era restarting at 0] →
 *   [a fork: two rows chaining off the same parent]
 * — plus a checkpoint anchored at the fork branch's tail. Every signed row's
 * HMAC verifies under the store key (provably key-holder output), but the
 * strict scanner rejects the history at the first seq anomaly, which used to
 * make EVERY flush fail until audit authority was permanently revoked
 * (auditDisabled), while audit_summary silently under-counted the store.
 *
 * Asserts the two fixes:
 *   1. Summary honesty — a broken chain DISCLOSES the unverified remainder
 *      (unverifiedTailRows / unsignedLegacyRows / quarantined) and classifies
 *      the break (legacyMixedBreak) instead of silently shrinking `total`.
 *   2. One-shot migration — the next flush quarantines the mixed history
 *      byte-exact behind audit.legacy-untrusted.*, re-anchors the checkpoint
 *      to the surviving strict prefix, seals a self-describing
 *      __audit_chain_migration marker, and resumes a verified chain.
 *   3. Tampering is NEVER migrated — byte edits and unknown-parent reroots
 *      keep the original hard fail-closed behavior.
 */
import { describe, test, expect, beforeEach, afterAll } from "@jest/globals";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-legacy-mixed-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "legacy-mixed-fixture-key";

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush, _testGetState, readAuditEntries, summarizeAuditEntries } = await import(
  "../dist/shared/audit.js"
);

const KEY = "legacy-mixed-fixture-key";
const GENESIS = "0".repeat(64);
const AUDIT_PATH = join(workDir, "audit.jsonl");
const CHECKPOINT_PATH = join(workDir, "audit.checkpoint");
const SINCE_EPOCH = { since: "2020-01-01T00:00:00.000Z" };

function hmacOf(prev, body) {
  return createHmac("sha256", KEY).update(prev).update("\0").update(body).digest("hex");
}

/** Replicates the writer's sealed-row byte format exactly. */
function seal(prev, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const hmac = hmacOf(prev, body);
  return { line: body.slice(0, -1) + `,"_prev":"${prev}","_hmac":"${hmac}"}`, hmac };
}

function checkpointLine(seq, hmac) {
  const mac = hmacOf("airmcp-audit-checkpoint-v1", `${seq}:${hmac}`);
  return JSON.stringify({ seq, hmac, mac }) + "\n";
}

function entry(tool, timestamp, extra = {}) {
  return { timestamp, tool, args: { fixture: true }, status: "ok", ...extra };
}

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
}

/**
 * Build the mixed-version store. Layout (0-based line index):
 *   0-1   unsigned pre-HMAC rows
 *   2-3   signed, no seq (pre-seq build)
 *   4-5   signed, seq 0..1 (sequenced build)
 *   6-7   signed, no seq again  ← FIRST ANOMALY at index 6
 *   8-9   signed, seq restarting 0..1
 *   10    signed, no seq, forked off row 9
 *   11-12 signed, seq 2..3, ALSO forked off row 9 (checkpoint branch)
 * Checkpoint anchors {seq:3, hmac(row 12)}.
 */
async function buildMixedStore() {
  const lines = [];
  lines.push(JSON.stringify(entry("launch_app", "2026-04-30T10:00:00.000Z")));
  lines.push(JSON.stringify(entry("get_frontmost_app", "2026-04-30T10:01:00.000Z")));
  const s0 = seal(GENESIS, entry("list_notes", "2026-05-01T10:00:00.000Z"));
  const s1 = seal(s0.hmac, entry("read_note", "2026-05-01T10:01:00.000Z"));
  const q0 = seal(s1.hmac, entry("__auth_failure", "2026-06-22T10:00:00.000Z", { seq: 0 }));
  const q1 = seal(q0.hmac, entry("summarize_context", "2026-06-22T10:01:00.000Z", { seq: 1 }));
  const m0 = seal(q1.hmac, entry("search_reminders", "2026-06-23T10:00:00.000Z"));
  const m1 = seal(m0.hmac, entry("search_notes", "2026-06-23T10:01:00.000Z"));
  const r0 = seal(m1.hmac, entry("semantic_status", "2026-07-09T10:00:00.000Z", { seq: 0 }));
  const r1 = seal(r0.hmac, entry("recent_files", "2026-07-09T10:01:00.000Z", { seq: 1 }));
  const f0 = seal(r1.hmac, entry("recent_files", "2026-07-10T10:00:00.000Z"));
  const f1 = seal(r1.hmac, entry("summarize_context", "2026-07-10T11:00:00.000Z", { seq: 2 }));
  const f2 = seal(f1.hmac, entry("skill_inbox-triage", "2026-07-10T11:01:00.000Z", { seq: 3 }));
  for (const row of [s0, s1, q0, q1, m0, m1, r0, r1, f0, f1, f2]) lines.push(row.line);
  await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");
  await writeFile(CHECKPOINT_PATH, checkpointLine(3, f2.hmac), "utf-8");
  return { lines, strictHead: q1.hmac };
}

async function quarantineFiles() {
  const files = await readdir(workDir);
  return files.filter((f) => f.startsWith("audit.legacy-untrusted."));
}

describe("mixed-version legacy history", () => {
  beforeEach(async () => {
    _testReset();
    await wipeDir();
  });

  test("summary DISCLOSES the broken remainder instead of silently shrinking total", async () => {
    await buildMixedStore();
    const summary = await summarizeAuditEntries(SINCE_EPOCH);

    expect(summary.verified).toBe(false);
    expect(summary.firstBreak ?? summary.verifiedFirstBreak).toEqual({
      file: "audit.jsonl",
      lineIndex: 6,
      reason: "malformed",
    });
    // Strict verified prefix only (rows 2-5) …
    expect(summary.total).toBe(4);
    // … but the remainder is disclosed, never dropped in silence.
    expect(summary.unverifiedTailRows).toBe(7);
    expect(summary.unsignedLegacyRows).toBe(2);
    expect(summary.quarantined).toEqual({ files: 0, rows: 0 });
    // And the break is classified as key-holder mixed-version history.
    expect(summary.legacyMixedBreak).toBe(true);
    expect(summary.auditDisabled).toBe(false);
  });

  test("next flush migrates: quarantines mixed history byte-exact, re-anchors checkpoint, resumes verified chain", async () => {
    const { lines } = await buildMixedStore();

    auditLog(entry("create_note", "2026-08-03T09:00:00.000Z"));
    await _testFlush();

    // Flush succeeded — audit authority retained, nothing requeued.
    const state = _testGetState();
    expect(state.auditDisabled).toBe(false);
    expect(state.bufferLength).toBe(0);
    expect(state.consecutiveFlushFailures).toBe(0);

    // Active file: strict prefix (rows 2-5) + migration marker + new row.
    const active = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    expect(active.slice(0, 4)).toEqual(lines.slice(2, 6));
    expect(active).toHaveLength(6);
    const marker = JSON.parse(active[4]);
    expect(marker.tool).toBe("__audit_chain_migration");
    expect(marker.seq).toBe(2);
    expect(marker.args.reason).toBe("legacy_mixed_history");
    expect(marker.args.quarantinedRows).toBe(7);
    expect(marker.args.firstAnomaly).toBe("audit.jsonl:6");
    const sealed = JSON.parse(active[5]);
    expect(sealed.tool).toBe("create_note");
    expect(sealed.seq).toBe(3);

    // Checkpoint re-anchored to the new tail.
    const ck = JSON.parse(await readFile(CHECKPOINT_PATH, "utf-8"));
    expect(ck.seq).toBe(3);
    expect(ck.hmac).toBe(sealed._hmac);

    // Quarantine preserved every removed row byte-exact: the mixed tail
    // (rows 6-12, inside the full original file image) and the unsigned
    // prefix (rows 0-1).
    const qFiles = await quarantineFiles();
    expect(qFiles).toHaveLength(2);
    const contents = await Promise.all(qFiles.map((f) => readFile(join(workDir, f), "utf-8")));
    const allQuarantined = contents.join("");
    for (const line of [...lines.slice(0, 2), ...lines.slice(6)]) {
      expect(allQuarantined).toContain(line);
    }

    // The resumed chain verifies end-to-end and the summary is honest.
    const read = await readAuditEntries(SINCE_EPOCH);
    expect(read.verified).toBe(true);
    expect(read.total).toBe(6);
    const summary = await summarizeAuditEntries(SINCE_EPOCH);
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(6);
    expect(summary.unverifiedTailRows).toBe(0);
    expect(summary.unsignedLegacyRows).toBe(0);
    // Quarantine files are FULL pre-surgery snapshots: the mixed-history
    // snapshot holds the original 13-line file, the unsigned-prefix snapshot
    // holds the 6-line rewrite that preceded the second surgery.
    expect(summary.quarantined).toEqual({ files: 2, rows: 19 });
    expect(summary.legacyMixedBreak).toBe(false);
  });

  test("a second break in the same process fails closed (no migration loop)", async () => {
    await buildMixedStore();
    auditLog(entry("create_note", "2026-08-03T09:00:00.000Z"));
    await _testFlush();
    expect(_testGetState().auditDisabled).toBe(false);

    // A stale pre-contract build appends another seq-less (but key-sealed)
    // row onto the migrated chain.
    const active = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    const tail = JSON.parse(active[active.length - 1]);
    const stale = seal(tail._hmac, entry("recent_files", "2026-08-03T10:00:00.000Z"));
    await writeFile(AUDIT_PATH, active.join("\n") + "\n" + stale.line + "\n", "utf-8");

    auditLog(entry("list_notes", "2026-08-03T10:01:00.000Z"));
    await _testFlush();

    // No second migration: the batch is requeued as a flush failure and the
    // stale row is still on disk, not quarantined again.
    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBeGreaterThan(0);
    expect(state.bufferLength).toBe(1);
    const after = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    expect(after[after.length - 1]).toBe(stale.line);
    expect((await quarantineFiles()).length).toBe(2); // unchanged from the first migration
  });
});

describe("tampering is never treated as legacy history", () => {
  beforeEach(async () => {
    _testReset();
    await wipeDir();
    for (let i = 0; i < 5; i++) {
      auditLog(entry(`tool_${i}`, `2026-08-01T00:00:0${i}.000Z`));
    }
    await _testFlush();
  });

  test("body edit mid-chain → hmac_mismatch, no migration, flush fails closed", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    const middle = JSON.parse(lines[2]);
    middle.tool = "tampered_tool";
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    // Fresh-process semantics: the in-process chain-trust anchor deliberately
    // skips re-verifying bodies of rows this process already sealed (see
    // verifiedChainTrust); a body edit is caught by every FULL verification.
    _testReset();

    const summary = await summarizeAuditEntries(SINCE_EPOCH);
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("hmac_mismatch");
    expect(summary.legacyMixedBreak).toBe(false);
    // The unverified remainder (edited row + everything after) is disclosed.
    expect(summary.unverifiedTailRows).toBe(3);

    auditLog(entry("create_note", "2026-08-03T09:00:00.000Z"));
    await _testFlush();
    expect(_testGetState().consecutiveFlushFailures).toBeGreaterThan(0);
    expect(await (async () => (await readdir(workDir)).filter((f) => f.startsWith("audit.legacy-untrusted.")))()).toEqual(
      [],
    );
  });

  test("key-sealed row rerooted to an unknown parent → prev_mismatch, not migratable", async () => {
    const lines = (await readFile(AUDIT_PATH, "utf-8")).trimEnd().split("\n");
    // Self-consistent seal (valid HMAC under the real key) but chained to a
    // parent this store has never seen — a splice, not a fork.
    const forged = seal("f".repeat(64), entry("forged_row", "2026-08-02T00:00:00.000Z"));
    lines[3] = forged.line;
    await writeFile(AUDIT_PATH, lines.join("\n") + "\n", "utf-8");

    const summary = await summarizeAuditEntries(SINCE_EPOCH);
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe("prev_mismatch");
    expect(summary.legacyMixedBreak).toBe(false);
  });
});
