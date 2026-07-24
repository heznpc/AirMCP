import { describe, test, expect } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const managerSource = readFileSync(new URL("../app/Sources/AirMCPApp/HitlManager.swift", import.meta.url), "utf8");

describe("Swift HITL protocol contract", () => {
  test("normalizes the socket override without mutating an existing override parent", () => {
    expect(managerSource).toContain('environment["AIRMCP_HITL_SOCKET_PATH"]');
    expect(managerSource).toContain('candidate.hasPrefix("~/")');
    expect(managerSource).toContain('guard expanded.hasPrefix("/") else { return nil }');
    expect(managerSource).toContain("standardizedFileURL.path");
    expect(managerSource).toContain("if !socketPathConfiguration.isOverride || !parentExisted");
  });

  test("owns only the socket inode observed after listener readiness", () => {
    expect(managerSource).toContain("private var ownedSocketIdentity: SocketFileIdentity?");
    expect(managerSource).toMatch(/case \.ready:[\s\S]*ownedSocketIdentity = identity/);
    expect(managerSource).toContain("(info.st_mode & S_IFMT) == S_IFSOCK");
    expect(managerSource).toMatch(
      /if isSocketReachable\(at: path\)[\s\S]*guard socketFileIdentity\(at: path\) == identity[\s\S]*Darwin\.unlink\(path\)/,
    );
    expect(managerSource).toContain("guard socketFileIdentity(at: path) == expected else { return }");
    expect(managerSource).not.toContain("FileManager.default.removeItem(atPath:");
  });

  test("protects approval notifications", () => {
    expect(managerSource).toContain("options: [.authenticationRequired]");
    expect(managerSource).not.toContain("let argsPreview = request.args");
  });

  test("parses requests, emits responses, and maps notification actions", () => {
    const workDir = mkdtempSync(join(tmpdir(), "airmcp-hitl-"));
    const mainPath = join(workDir, "main.swift");
    const binPath = join(workDir, "hitl-contract");

    writeFileSync(
      mainPath,
      `
import Foundation
import UserNotifications

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fatalError(message)
    }
}

let timestamp = Date(timeIntervalSince1970: 1_717_171_717)
let requestJson = """
{
  "id": "req-1",
  "correlationId": "3d811f80-3a22-4ad8-a928-2bea8f63c1fd",
  "type": "hitl_request",
  "tool": "delete_note",
  "args": {
    "id": "note-123",
    "force": true,
    "count": 2
  },
  "destructive": true,
  "sensitive": true,
  "openWorld": false
}
"""

guard let request = HitlProtocol.parseApprovalRequest(
    from: requestJson.data(using: .utf8)!,
    timestamp: timestamp
) else {
    fatalError("request should parse")
}

require(request.id == "req-1", "id")
require(request.correlationId == "3d811f80-3a22-4ad8-a928-2bea8f63c1fd", "correlation id")
require(request.tool == "delete_note", "tool")
require(request.args["id"] == "note-123", "arg id")
require(request.args["force"] == "true", "arg bool")
require(request.args["count"] == "2", "arg number")
require(request.destructive, "destructive")
require(request.sensitive, "sensitive")
require(!request.openWorld, "openWorld")
require(request.timestamp == timestamp, "timestamp")

let legacyJson = #"{"id":"legacy","type":"hitl_request","tool":"list_notes"}"#.data(using: .utf8)!
let legacyRequest = HitlProtocol.parseApprovalRequest(from: legacyJson)!
require(legacyRequest.correlationId == nil, "legacy correlation remains optional")

require(HitlProtocol.parseApprovalRequest(from: Data("not json".utf8)) == nil, "malformed ignored")
let wrongType = #"{"id":"req-2","type":"other","tool":"delete_note"}"#.data(using: .utf8)!
require(HitlProtocol.parseApprovalRequest(from: wrongType) == nil, "wrong type ignored")

guard let payload = HitlProtocol.responsePayload(id: "req-3", approved: false),
      let text = String(data: payload, encoding: .utf8) else {
    fatalError("response payload")
}
require(text.hasSuffix("\\n"), "line delimited")
let response = try! JSONSerialization.jsonObject(with: Data(text.dropLast().utf8)) as! [String: Any]
require(response["id"] as? String == "req-3", "response id")
require(response["type"] as? String == "hitl_response", "response type")
require(response["approved"] as? Bool == false, "response decision")
require(response["reason"] as? String == "denied", "legacy false maps explicit denial")

guard let timeoutPayload = HitlProtocol.responsePayload(
    id: "req-timeout",
    approved: false,
    reason: .timedOut
), let timeoutText = String(data: timeoutPayload, encoding: .utf8) else {
    fatalError("timeout payload")
}
let timeoutResponse = try! JSONSerialization.jsonObject(
    with: Data(timeoutText.dropLast().utf8)
) as! [String: Any]
require(timeoutResponse["approved"] as? Bool == false, "timeout is not approval")
require(timeoutResponse["reason"] as? String == "timed_out", "timeout reason")

guard let unavailablePayload = HitlProtocol.responsePayload(
    id: "req-unavailable",
    approved: false,
    reason: .unavailable
), let unavailableText = String(data: unavailablePayload, encoding: .utf8) else {
    fatalError("unavailable payload")
}
let unavailableResponse = try! JSONSerialization.jsonObject(
    with: Data(unavailableText.dropLast().utf8)
) as! [String: Any]
require(unavailableResponse["reason"] as? String == "unavailable", "unavailable reason")

guard let approvedPayload = HitlProtocol.responsePayload(id: "req-approved", approved: true),
      let approvedText = String(data: approvedPayload, encoding: .utf8) else {
    fatalError("approved payload")
}
let approvedResponse = try! JSONSerialization.jsonObject(
    with: Data(approvedText.dropLast().utf8)
) as! [String: Any]
require(approvedResponse["reason"] as? String == "approved", "approved reason")
require(
    HitlProtocol.responsePayload(id: "bad", approved: true, reason: .timedOut) == nil,
    "contradictory payload rejected"
)

require(HitlProtocol.approvalDecision(for: "APPROVE"), "approve maps true")
require(!HitlProtocol.approvalDecision(for: "DENY"), "deny maps false")
require(!HitlProtocol.approvalDecision(for: UNNotificationDismissActionIdentifier), "dismiss maps false")
require(!HitlProtocol.approvalDecision(for: "UNKNOWN"), "unknown maps false")
require(HitlProtocol.responseReason(for: "APPROVE") == .approved, "approve reason")
require(HitlProtocol.responseReason(for: "DENY") == .denied, "deny reason")
`,
      "utf8",
    );

    try {
      execFileSync("xcrun", ["swiftc", "app/Sources/AirMCPApp/HitlProtocol.swift", mainPath, "-o", binPath], {
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
