import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const app = read("app/Sources/AirMCPApp/AirMCPApp.swift");
const policy = read("app/Sources/AirMCPApp/SingleInstancePolicy.swift");
const server = read("app/Sources/AirMCPApp/ServerManager.swift");
const menu = read("app/Sources/AirMCPApp/Views/MenuContent.swift");
const onboarding = read("app/Sources/AirMCPApp/Views/OnboardingView.swift");
const plist = read("app/Sources/AirMCPApp/Resources/Info.plist");
const english = read("app/Sources/AirMCPApp/Resources/en.lproj/Localizable.strings");

describe("macOS single-instance launch contract", () => {
  test("declares the LaunchServices guard and keeps a delegate fallback", () => {
    expect(plist).toContain("<key>LSMultipleInstancesProhibited</key>");
    expect(app).toContain("func applicationWillFinishLaunching");
    expect(app).toContain("guard applicationDelegate.guardPrimaryInstance() else");
    expect(app.indexOf("guard applicationDelegate.guardPrimaryInstance() else")).toBeLessThan(
      app.indexOf("serverManager.startPolling()"),
    );
  });

  test("activates the existing process and terminates only the duplicate launch", () => {
    expect(policy).toContain("$0.processIdentifier != currentProcessIdentifier");
    expect(policy).toContain("$0.bundleIdentifier == bundleIdentifier");
    expect(app).toContain("existingApplication?.activate(options: [.activateAllWindows])");
    expect(app).toContain("NSApp.terminate(nil)");
    expect(app).not.toContain("existingApplication?.terminate()");
    expect(app).toContain("NSRunningApplication.current");
    expect(app).toContain("snapshots.append(");
  });

  test("retains the one-window Setup guard inside the surviving process", () => {
    expect(app).toContain("if let existingWindow = OnboardingWindowHolder.shared.window");
    expect(app).toContain("existingWindow.makeKeyAndOrderFront(nil)");
  });
});

describe("stale app-owned runtime diagnosis", () => {
  test("classifies health version mismatch before authenticated readiness", () => {
    expect(server).toContain("case versionMismatch(found: String, expected: String)");
    expect(server).toContain("version == expectedVersion");
    expect(server).toContain("await AppRuntimeClient.probe()");
    expect(server).toContain('let appOwned = json["appOwned"] as? Bool');
    expect(server).toContain("applyRuntimeProbe(readiness");
  });

  test("treats a non-AirMCP HTTP response as an occupied port", () => {
    expect(server).toContain("case occupiedUnrecognized");
    expect(server).toContain("case portOccupied");
    expect(server).toContain("guard statusCode != nil else { return .unavailable }");
    expect(server).toContain('L("server.runtimePortOccupied"');
    expect(server).toContain("classifyRuntimeTransportFailure(");
    expect(server).toContain("case .cannotConnectToHost");
    expect(server).toContain("return .occupiedUnrecognized");
  });

  test("surfaces and de-duplicates the port-owner diagnosis in status and logs", () => {
    expect(server).toContain('L("server.runtimeVersionConflict"');
    expect(server).toContain("logManager?.append(message, isError: true)");
    expect(server).toContain("if lastRuntimeDiagnostic != message");
    expect(english).toContain("Conflicting AirMCP runtime on port %d");
    expect(english).not.toMatch(/runtimeVersionConflict[^\n]*(?:AIRMCP_HTTP_TOKEN|Bearer)/);
  });

  test("does not auto-launch another child when a runtime already owns port 3847", () => {
    expect(server).toContain("if case .unavailable = probe");
    expect(server).toContain("EADDRINUSE");
    expect(server).toContain("return");
  });

  test("serializes in-app start attempts and invalidates a pending launch on stop", () => {
    expect(server).toContain("private var startAttemptID: UUID?");
    expect(server).toContain("private var operationGate = RuntimeOperationGate()");
    expect(server).toContain("startAttemptID == nil");
    expect(server).toContain("startAttemptID == attemptID");
    expect(server).toContain("guard self.serverProcess === terminatedProcess else");
    expect(server).toMatch(/func stopServer\(\) \{[\s\S]*?startAttemptID = nil/);
    expect(server).toMatch(/func autoStartIfNeeded\(\) \{[\s\S]*?startServer\(\)/);
    expect(server).toContain("shouldPerformScheduledRestart(");
    expect(server).toContain("stopOperationGeneration == operationGeneration");
  });

  test("adopts and terminates only an exact authenticated runtime identity", () => {
    expect(server).toContain("private var ownedRuntimeIdentity: AppOwnedRuntimeIdentity?");
    expect(server).toContain("authenticatedOwnedRuntimeIdentity(");
    expect(server).toContain("state.ownerFingerprint == expectedOwnerFingerprint");
    expect(server).toContain("verifiedAdoptedRuntimeIdentity(for: initialProbe) == expectedIdentity");
    expect(server).toContain("signalExactProcess(expectedIdentity, signal: SIGTERM)");
    expect(server).toContain('env["AIRMCP_APP_RUNTIME_OWNER_SECRET"] = ownerSecret');
    expect(onboarding).not.toContain("AIRMCP_APP_RUNTIME_OWNER_SECRET");
    expect(server).toContain("stopOperationGeneration == nil");
    expect(server).toContain("canStopRuntime");
    expect(server).not.toContain("pkill");
    expect(server).not.toContain('process.arguments = ["-f"');
    expect(menu).toMatch(/if serverManager\.canStopRuntime \{[\s\S]*?menu\.stopServer/);
  });

  test("cleans a spawned child before exposing a retryable readiness error", () => {
    expect(server).toContain("await cleanupFailedLaunch(process: process, pipes: pipes)");
    expect(server).toContain("process.terminationHandler = nil");
    expect(server).toContain("serverProcess = nil");
    expect(server).toContain("await Self.terminateOwnedProcess(process)");
    expect(server.indexOf("await cleanupFailedLaunch(process: process, pipes: pipes)")).toBeLessThan(
      server.indexOf('let message = "App-owned runtime failed authenticated readiness"'),
    );
  });

  test("uses one bounded readiness task and preserves manual runtime ownership", () => {
    expect(server).toContain("appOwnedReadinessTimeoutSeconds: TimeInterval = 12");
    expect(server).toContain("boundedAppOwnedRuntimeProbe()");
    expect(server).toContain("let deadline = clock.now.advanced(");
    expect(server).toContain("case .ready(let version, appOwned: false):");
    expect(server).toContain("return .manualRuntime(version: version)");
    expect(server).toContain("if case .ready(_, appOwned: false) = probe { return false }");
  });
});
