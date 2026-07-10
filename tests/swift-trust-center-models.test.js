import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("Swift Trust Center model contract", () => {
  test("decodes compatible history, groups runs, prioritizes gates, and exports only redacted fields", () => {
    const workDir = mkdtempSync(join(tmpdir(), "airmcp-trust-models-"));
    const mainPath = join(workDir, "main.swift");
    const binPath = join(workDir, "trust-models");

    writeFileSync(
      mainPath,
      `
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

let payload = #"""
{
  "total": 5,
  "returned": 5,
  "scannedFiles": 2,
  "verified": true,
  "auditDisabled": false,
  "entries": [{"timestamp":"2026-07-10T00:00:00.000Z","tool":"must_not_win","status":"ok"}],
  "history": [
    {
      "timestamp":"2026-07-10T01:00:00.000Z",
      "tool":"create_reminder",
      "status":"ok",
      "kind":"approval",
      "approvalDecision":"approved",
      "approvalChannel":"socket",
      "correlationId":"11111111-1111-4111-8111-111111111111",
      "actor":"daemon-skill:private-skill",
      "args":{"title":"secret-value"},
      "_hmac":"must-not-escape"
    },
    {
      "timestamp":"2026-07-10T01:00:01.000Z",
      "tool":"create_reminder",
      "status":"ok",
      "kind":"tool",
      "durationMs":42,
      "correlationId":"11111111-1111-4111-8111-111111111111",
      "actor":"daemon-skill:private-skill"
    },
    {
      "timestamp":"2026-07-10T02:00:00.000Z",
      "tool":"delete_note",
      "status":"error",
      "kind":"tool",
      "gate":"rate_limit",
      "errorCategory":"rate_limited",
      "correlationId":"22222222-2222-4222-8222-222222222222"
    },
    {
      "timestamp":"2026-07-10T03:00:00.000Z",
      "tool":"send_mail",
      "status":"error",
      "kind":"approval",
      "approvalDecision":"denied",
      "approvalChannel":"elicitation",
      "correlationId":"33333333-3333-4333-8333-333333333333"
    },
    {
      "timestamp":"2026-07-10T04:00:00.000Z",
      "tool":"list_notes",
      "status":"ok"
    }
  ]
}
"""#.data(using: .utf8)!

let response = try! JSONDecoder().decode(AuditLogResponse.self, from: payload)
require(response.entries.count == 5, "history alias must win over entries")
require(response.verified == true, "integrity")
let runs = GovernedRun.grouped(entries: response.entries)
require(runs.count == 4, "correlated rows group; legacy remains isolated")

let approved = runs.first { $0.correlationId == "11111111-1111-4111-8111-111111111111" }!
require(approved.status == .succeeded, "approved write succeeds")
require(approved.approvalStatus == .approved, "approval status")
require(approved.actorClass == "daemon", "actor is normalized")
require(approved.toolCount == 1, "approval event is not a tool count")

let gated = runs.first { $0.correlationId == "22222222-2222-4222-8222-222222222222" }!
require(gated.status == .blocked, "gate beats generic failure")
require(gated.entries.first?.gate == "rate_limit", "gate is retained")

let denied = runs.first { $0.correlationId == "33333333-3333-4333-8333-333333333333" }!
require(denied.status == .denied, "denied decision")

let timedOutEntry = try! JSONDecoder().decode(
    AuditEntryRecord.self,
    from: #"{"timestamp":"2026-07-10T05:00:00.000Z","tool":"slow_write","status":"error","kind":"approval","approvalDecision":"timed_out","approvalChannel":"socket","correlationId":"55555555-5555-4555-8555-555555555555"}"#.data(using: .utf8)!
)
require(timedOutEntry.approvalDecision == .timedOut, "timed_out decision decodes exactly")
let timedOutRun = GovernedRun.grouped(entries: [timedOutEntry]).first!
require(timedOutRun.approvalStatus == .timedOut, "timed_out approval status")
require(timedOutRun.status == .timedOut, "timed_out remains distinct from explicit denial")

let unavailableEntry = try! JSONDecoder().decode(
    AuditEntryRecord.self,
    from: #"{"timestamp":"2026-07-10T06:00:00.000Z","tool":"offline_write","status":"error","kind":"approval","approvalDecision":"unavailable","approvalChannel":"unavailable","correlationId":"66666666-6666-4666-8666-666666666666"}"#.data(using: .utf8)!
)
require(unavailableEntry.approvalDecision == .unavailable, "unavailable decision decodes exactly")
let unavailableRun = GovernedRun.grouped(entries: [unavailableEntry]).first!
require(unavailableRun.approvalStatus == .unavailable, "unavailable approval status")
require(unavailableRun.status == .blocked, "unavailable remains blocked")

let pendingA = LivePendingApproval(
    id: "pending-a",
    correlationId: approved.correlationId,
    tool: "create_reminder",
    args: ["title": "live-secret-a"],
    destructive: false,
    sensitive: true,
    openWorld: false,
    timestamp: Date(timeIntervalSince1970: 10)
)
let pendingB = LivePendingApproval(
    id: "pending-b",
    correlationId: approved.correlationId,
    tool: "send_mail",
    args: ["body": "live-secret-b"],
    destructive: false,
    sensitive: true,
    openWorld: true,
    timestamp: Date(timeIntervalSince1970: 11)
)
var approvedWithLiveState = approved
approvedWithLiveState.pendingApprovals = [pendingA, pendingB]
require(approvedWithLiveState.pendingApprovals.count == 2, "multiple pending approvals remain visible")
require(approvedWithLiveState.status == .pending, "pending state wins in local UI")
require(approvedWithLiveState.persistedEvidenceOnly.pendingApprovals.isEmpty, "persisted projection strips live state")
require(approvedWithLiveState.persistedEvidenceOnly.status == .succeeded, "persisted projection derives sealed status")

let liveOnly = GovernedRun(
    id: "approval:live-only",
    correlationId: "44444444-4444-4444-8444-444444444444",
    entries: [],
    pendingApprovals: [pendingA],
    liveApproval: nil
)
let exportRuns = runs.map { run in
    run.id == approved.id ? approvedWithLiveState : run
} + [liveOnly]

let report = TrustExportReport.make(
    version: "2.16.0",
    since: Date(timeIntervalSince1970: 0),
    response: response,
    runs: exportRuns,
    now: Date(timeIntervalSince1970: 1)
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let exported = String(data: try! encoder.encode(report), encoding: .utf8)!
require(!exported.contains("secret-value"), "args values excluded")
require(!exported.contains("\\"args\\""), "args key excluded")
require(!exported.contains("_hmac"), "HMAC envelope excluded")
require(!exported.contains("must-not-escape"), "HMAC value excluded")
require(!exported.contains("private-skill"), "user skill name excluded")
require(!exported.contains("live-secret-a"), "live pending args excluded")
require(!exported.contains("live-secret-b"), "all live pending args excluded")
require(!exported.contains("approval:live-only"), "live-only run excluded")
require(!exported.contains("verifiedFirstBreak"), "raw break path object excluded")
require(exported.contains("rate_limit"), "safe gate reason retained")
require(exported.contains("persisted_audit_snapshot_only"), "integrity scope is explicit")
require(exported.contains("\\"liveStateExcluded\\":true"), "live state exclusion is explicit")
`,
      "utf8",
    );

    try {
      execFileSync("xcrun", ["swiftc", "app/Sources/AirMCPApp/TrustCenterModels.swift", mainPath, "-o", binPath], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
      execFileSync(binPath, { stdio: "pipe" });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    expect(true).toBe(true);
  });
});
