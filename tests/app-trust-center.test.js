import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const trust = readFileSync(new URL("../app/Sources/AirMCPApp/Views/TrustCenterView.swift", import.meta.url), "utf8");
const store = readFileSync(new URL("../app/Sources/AirMCPApp/TrustCenterStore.swift", import.meta.url), "utf8");
const models = readFileSync(new URL("../app/Sources/AirMCPApp/TrustCenterModels.swift", import.meta.url), "utf8");
const intents = readFileSync(new URL("../app/Sources/AirMCPApp/AppIntents.swift", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/Sources/AirMCPApp/AirMCPApp.swift", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/Sources/AirMCPApp/Views/MenuContent.swift", import.meta.url), "utf8");
const generated = readFileSync(
  new URL("../swift/Sources/AirMCPKit/Generated/MCPIntents.swift", import.meta.url),
  "utf8",
);

describe("macOS trust and App Intent surfaces", () => {
  test("Trust Center reports live governed runtime evidence", () => {
    expect(app).toContain('Window(L("trust.title"), id: AirMcpConstants.trustCenterWindowID)');
    expect(menu).toContain("openWindow(id: AirMcpConstants.trustCenterWindowID)");
    expect(trust).toContain("AppRuntimeClient.listTools()");
    expect(store).toContain("AppRuntimeClient.callAppRuntimeToolJSON(");
    expect(store).toContain('"audit_log"');
    expect(intents).toContain('forHTTPHeaderField: "X-AirMCP-Run-ID"');
    expect(intents).toContain("static func callAppRuntimeToolJSON<T: Decodable & Sendable>");
    expect(store).toContain("let args: AppRuntimeToolArguments");
    expect(trust).toContain("hitlManager.pendingRequests.count");
    expect(trust).toContain("permissionManager.runSetup()");
  });

  test("Trust Center groups runs and exposes approval, gate, and error evidence", () => {
    expect(trust).toContain("NavigationSplitView");
    expect(trust).toContain("pendingApprovalCard(");
    expect(trust).toContain("timelineRow(");
    expect(models).toContain("let correlationId: String?");
    expect(models).toContain("let gate: String?");
    expect(models).toContain("static func grouped(entries: [AuditEntryRecord])");
    expect(store).toContain("pendingRequests: [HitlManager.ApprovalRequest]");
    expect(store).toContain("existing.pendingApprovals.append(snapshot)");
    expect(trust).toContain("ForEach(run.pendingApprovals)");
  });

  test("redacted export owns a narrow allowlist and owner-only file mode", () => {
    expect(store).toContain("NSSavePanel()");
    expect(store).toContain("TrustExportReport.make(");
    expect(store).toContain("static func writeOwnerOnlyReport");
    expect(store).toContain("try verifyOwnerOnly(temp)");
    expect(store).toContain(".withoutDeletingBackupItem");
    expect(trust).toContain("store.exportRedactedReport(runs: persistedVisibleRuns)");
    expect(models).not.toContain("let args: [String: String]\n        let status: AuditEntryRecord.Status");
    expect(models).toContain('scope: "persisted_audit_snapshot_only"');
    expect(models).toContain("liveStateExcluded: true");
    expect(models).toContain("this file is not the original HMAC evidence");
  });

  test("latest range wins and post-approval completion is re-queried with bounded backoff", () => {
    expect(store).toContain("private var refreshGeneration = 0");
    expect(store).toContain("guard generation == refreshGeneration else { return }");
    expect(store).toContain("func refreshPersistedRun(correlationId: String)");
    expect(trust).toContain("scheduleOutcomeRefresh(");
    expect(trust).toContain("currentToolEvents > baselineToolEvents");
  });

  test("emergency stop removal requires an explicit confirmation dialog", () => {
    expect(trust).toContain(".config/airmcp/emergency-stop");
    expect(trust).toContain(".confirmationDialog(");
    expect(trust).toContain("clearEmergencyStop()");
  });

  test("AppShortcutsProvider is compiled for iOS only while macOS keeps AppIntent actions", () => {
    const providerStart = generated.indexOf("// MARK: - iOS AppShortcutsProvider");
    const providerEnd = generated.indexOf("#endif // os(iOS)", providerStart);
    expect(providerStart).toBeGreaterThan(-1);
    expect(generated.slice(providerStart, providerEnd)).toContain("#if os(iOS)");
    expect(generated.slice(providerStart, providerEnd)).toContain("AppShortcutsProvider");
    expect(menu).not.toContain("Hey Siri");
  });
});
