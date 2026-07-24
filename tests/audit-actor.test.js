/**
 * Actor-provenance in the audit log — the "what ran without me?" query.
 *
 * Every audit row is stamped with an actor (getActor): human/client calls omit
 * it (→ "direct"), autonomous event-triggered skills carry "daemon-skill:<name>".
 * These tests prove the actor filter on readAuditEntries and the byActor
 * breakdown on summarizeAuditEntries surface that dimension, which was on disk
 * but invisible at the tool boundary before.
 */
import { describe, test, expect, beforeEach, afterAll } from "@jest/globals";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-actor-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "actor-test-fixture-key";
process.env.AIRMCP_AUDIT_LOG = "true";

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush, readAuditEntries, summarizeAuditEntries } = await import(
  "../dist/shared/audit.js"
);

async function wipeDir() {
  for (const f of await readdir(workDir).catch(() => [])) {
    await rm(join(workDir, f), { force: true }).catch(() => {});
  }
}

async function seed() {
  _testReset();
  await wipeDir();
  // 2 human/direct (no actor), 2 autonomous daemon skill, 1 hitl-approved.
  auditLog({ timestamp: "2026-07-20T00:00:00Z", tool: "list_notes", args: {}, status: "ok" });
  auditLog({ timestamp: "2026-07-20T00:00:01Z", tool: "create_note", args: {}, status: "ok" });
  auditLog({ timestamp: "2026-07-20T00:00:02Z", tool: "create_reminder", args: {}, status: "ok", actor: "daemon-skill:evening-winddown" });
  auditLog({ timestamp: "2026-07-20T00:00:03Z", tool: "create_reminder", args: {}, status: "error", actor: "daemon-skill:evening-winddown" });
  auditLog({ timestamp: "2026-07-20T00:00:04Z", tool: "delete_event", args: {}, status: "ok", actor: "hitl-approved" });
  await _testFlush();
}

const WIDE = "2020-01-01T00:00:00Z";

describe("audit actor provenance", () => {
  beforeEach(seed);

  test("readAuditEntries filters by actor=daemon-skill:*", async () => {
    const page = await readAuditEntries({ since: WIDE, actor: "daemon-skill:evening-winddown" });
    expect(page.entries).toHaveLength(2);
    expect(page.entries.every((e) => e.actor === "daemon-skill:evening-winddown")).toBe(true);
  });

  test("readAuditEntries actor='direct' selects the unstamped human calls", async () => {
    const page = await readAuditEntries({ since: WIDE, actor: "direct" });
    expect(page.entries).toHaveLength(2);
    expect(page.entries.map((e) => e.tool).sort()).toEqual(["create_note", "list_notes"]);
    // Direct entries carry no actor stamp.
    expect(page.entries.every((e) => e.actor === undefined)).toBe(true);
  });

  test("summarizeAuditEntries byActor separates autonomous from human activity", async () => {
    const summary = await summarizeAuditEntries({ since: WIDE });
    const byActor = Object.fromEntries(summary.byActor.map((a) => [a.actor, a]));

    expect(byActor.direct.count).toBe(2);
    expect(byActor["daemon-skill:evening-winddown"].count).toBe(2);
    expect(byActor["daemon-skill:evening-winddown"].errors).toBe(1);
    expect(byActor["hitl-approved"].count).toBe(1);
    // Sorted by count desc, ties allowed; total across actors == total calls.
    expect(summary.byActor.reduce((n, a) => n + a.count, 0)).toBe(summary.total);
  });
});
