import { describe, test, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('Swift HITL protocol contract', () => {
  test('parses requests, emits responses, and maps notification actions', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'airmcp-hitl-'));
    const mainPath = join(workDir, 'main.swift');
    const binPath = join(workDir, 'hitl-contract');

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
require(request.tool == "delete_note", "tool")
require(request.args["id"] == "note-123", "arg id")
require(request.args["force"] == "true", "arg bool")
require(request.args["count"] == "2", "arg number")
require(request.destructive, "destructive")
require(request.sensitive, "sensitive")
require(!request.openWorld, "openWorld")
require(request.timestamp == timestamp, "timestamp")

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

require(HitlProtocol.approvalDecision(for: "APPROVE"), "approve maps true")
require(!HitlProtocol.approvalDecision(for: "DENY"), "deny maps false")
require(!HitlProtocol.approvalDecision(for: UNNotificationDismissActionIdentifier), "dismiss maps false")
require(!HitlProtocol.approvalDecision(for: "UNKNOWN"), "unknown maps false")
`,
      'utf8',
    );

    try {
      execFileSync(
        'xcrun',
        ['swiftc', 'app/Sources/AirMCPApp/HitlProtocol.swift', mainPath, '-o', binPath],
        { cwd: REPO_ROOT, stdio: 'pipe' },
      );
      execFileSync(binPath, { stdio: 'pipe' });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    expect(true).toBe(true);
  });
});
