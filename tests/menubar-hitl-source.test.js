import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const hitlManager = readFileSync(new URL("app/Sources/AirMCPApp/HitlManager.swift", root), "utf8");
const menuContent = readFileSync(new URL("app/Sources/AirMCPApp/Views/MenuContent.swift", root), "utf8");

describe("menubar HITL fallback source contract", () => {
  test("tracks pending approval requests until a response is sent", () => {
    expect(hitlManager).toContain("var pendingRequests: [ApprovalRequest] = []");
    expect(hitlManager).toContain("pendingRequests.insert(request, at: 0)");
    expect(hitlManager).toContain("pendingRequests.removeAll { $0.id == id }");
  });

  test("consumes each approval once and clears stale notification actions", () => {
    expect(hitlManager).toContain("guard let request = pendingRequests.first(where: { $0.id == id }) else");
    expect(hitlManager).toContain("tool: request.tool");
    expect(hitlManager).toContain("removePendingNotificationRequests(withIdentifiers: identifiers)");
    expect(hitlManager).toContain("removeDeliveredNotifications(withIdentifiers: identifiers)");
    expect(hitlManager).toMatch(
      /guard let request = pendingRequests\.first[\s\S]*else \{[\s\S]*removeNotifications[\s\S]*return[\s\S]*pendingRequests\.removeAll/,
    );
  });

  test("clears pending approval state when the listener stops", () => {
    expect(hitlManager).toMatch(
      /func stopListening\(\)[\s\S]*pendingRequests\.removeAll\(\)[\s\S]*pendingTools\.removeAll\(\)[\s\S]*removeNotifications/,
    );
  });

  test("distinguishes timeout and disconnected approval channels", () => {
    expect(hitlManager).toContain("reason: .timedOut");
    expect(hitlManager).toContain("recordRecentRequest(request, approved: false, reason: .unavailable)");
    expect(hitlManager).toContain("pendingConnections.removeValue(forKey: request.id)");
  });

  test("menu exposes explicit approve and deny actions for pending requests", () => {
    expect(menuContent).toContain("hitlManager.pendingRequests");
    expect(menuContent).toContain('Text(L("settings.pendingApprovals"))');
    expect(menuContent).toContain('Button(L("hitl.approve"))');
    expect(menuContent).toContain("hitlManager.respond(id: request.id, approved: true");
    expect(menuContent).toContain('Button(L("hitl.deny"))');
    expect(menuContent).toContain("hitlManager.respond(id: request.id, approved: false");
  });
});
