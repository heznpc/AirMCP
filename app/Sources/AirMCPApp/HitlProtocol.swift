import Foundation
import UserNotifications

enum HitlResponseReason: String, Equatable, Sendable {
    case approved
    case denied
    case timedOut = "timed_out"
    case unavailable
}

struct HitlApprovalRequestPayload: Equatable, Sendable {
    let id: String
    let correlationId: String?
    let tool: String
    let args: [String: String]
    let destructive: Bool
    let sensitive: Bool
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

        let correlationId: String? = {
            guard let value = json["correlationId"] as? String,
                  !value.isEmpty,
                  value.utf8.count <= 128
            else { return nil }
            return value
        }()

        return HitlApprovalRequestPayload(
            id: id,
            correlationId: correlationId,
            tool: tool,
            args: argsDict,
            destructive: json["destructive"] as? Bool ?? false,
            sensitive: json["sensitive"] as? Bool ?? false,
            openWorld: json["openWorld"] as? Bool ?? false,
            timestamp: timestamp
        )
    }

    static func responsePayload(
        id: String,
        approved: Bool,
        reason: HitlResponseReason? = nil
    ) -> Data? {
        let resolvedReason = reason ?? (approved ? .approved : .denied)
        guard (approved && resolvedReason == .approved)
                || (!approved && resolvedReason != .approved)
        else { return nil }
        let responseDict: [String: Any] = [
            "id": id,
            "type": "hitl_response",
            "approved": approved,
            "reason": resolvedReason.rawValue,
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
        responseReason(for: actionIdentifier) == .approved
    }

    static func responseReason(for actionIdentifier: String) -> HitlResponseReason {
        switch actionIdentifier {
        case "APPROVE":
            return .approved
        case "DENY", UNNotificationDismissActionIdentifier:
            return .denied
        default:
            return .denied
        }
    }
}
