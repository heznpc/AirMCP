import Foundation
import UserNotifications

final class HitlNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
    let onResponse: @Sendable (String, Bool) -> Void

    init(onResponse: @escaping @Sendable (String, Bool) -> Void) {
        self.onResponse = onResponse
        super.init()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let requestId = response.notification.request.identifier
        switch response.actionIdentifier {
        case "APPROVE":
            onResponse(requestId, true)
        case "DENY", UNNotificationDismissActionIdentifier:
            onResponse(requestId, false)
        default:
            onResponse(requestId, false)
        }
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
