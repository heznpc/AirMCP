import Foundation
import UserNotifications

final class HitlNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
    let onResponse: @Sendable (String, Bool) -> Void

    init(onResponse: @escaping @Sendable (String, Bool) -> Void) {
        self.onResponse = onResponse
        super.init()
    }

    static func approvalDecision(for actionIdentifier: String) -> Bool {
        HitlProtocol.approvalDecision(for: actionIdentifier)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let requestId = response.notification.request.identifier
        onResponse(requestId, Self.approvalDecision(for: response.actionIdentifier))
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
