import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const hitlManager = readFileSync(
  new URL("app/Sources/AirMCPApp/HitlManager.swift", root),
  "utf8",
);
const menuContent = readFileSync(
  new URL("app/Sources/AirMCPApp/Views/MenuContent.swift", root),
  "utf8",
);

describe("menubar HITL fallback source contract", () => {
  test("tracks pending approval requests until a response is sent", () => {
    expect(hitlManager).toContain("var pendingRequests: [ApprovalRequest] = []");
    expect(hitlManager).toContain("pendingRequests.insert(request, at: 0)");
    expect(hitlManager).toContain("pendingRequests.removeAll { $0.id == id }");
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
