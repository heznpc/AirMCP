import Foundation
import UserNotifications

struct HitlApprovalRequestPayload: Equatable, Sendable {
    let id: String
    let tool: String
    let args: [String: String]
    let destructive: Bool
    let openWorld: Bool
    let timestamp: Date
}

enum HitlProtocol {
    static func parseApprovalRequest(
        from data: Data,
        timestamp: Date = Date()
    ) -> HitlApprovalRequestPayload? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? String,
              let type = json["type"] as? String,
              type == "hitl_request",
              let tool = json["tool"] as? String
        else {
            return nil
        }

        var argsDict: [String: String] = [:]
        if let args = json["args"] as? [String: Any] {
            for (key, value) in args {
                if let bool = value as? Bool {
                    argsDict[key] = bool ? "true" : "false"
                } else {
                    argsDict[key] = "\(value)"
                }
            }
        }

        return HitlApprovalRequestPayload(
            id: id,
            tool: tool,
            args: argsDict,
            destructive: json["destructive"] as? Bool ?? false,
            openWorld: json["openWorld"] as? Bool ?? false,
            timestamp: timestamp
        )
    }

    static func responsePayload(id: String, approved: Bool) -> Data? {
        let responseDict: [String: Any] = [
            "id": id,
            "type": "hitl_response",
            "approved": approved,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: responseDict),
              var payload = String(data: jsonData, encoding: .utf8)
        else {
            return nil
        }

        payload += "\n"
        return payload.data(using: .utf8)
    }

    static func approvalDecision(for actionIdentifier: String) -> Bool {
        switch actionIdentifier {
        case "APPROVE":
            return true
        case "DENY", UNNotificationDismissActionIdentifier:
            return false
        default:
            return false
        }
    }
}
