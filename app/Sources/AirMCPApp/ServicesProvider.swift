import AppKit
import Foundation
import UserNotifications

/// macOS Services provider — adds AirMCP actions to the system-wide Services menu.
/// Available via right-click → Services in any app when text is selected.
/// @MainActor because all @objc service callbacks are invoked on the main thread.
@MainActor
final class ServicesProvider: NSObject {

    private func escapedHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
            .replacingOccurrences(of: "\n", with: "<br>")
    }

    /// Post a local notification.
    private func postNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Services share the governed MCP path used by App Intents. Direct
    /// AppleScript/JXA here would bypass audit, rate limits, emergency stop,
    /// and the per-call HITL contract.
    private func executeTool(
        _ tool: String,
        arguments: [String: Any],
        successMessage: String,
        onSuccess: ((String) -> Void)? = nil
    ) {
        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await AppRuntimeClient.callTool(tool, args: arguments)
                onSuccess?(result)
                postNotification(title: "AirMCP", body: successMessage)
            } catch {
                postNotification(title: "AirMCP", body: L("services.actionFailed", error.localizedDescription))
            }
        }
    }

    /// Save selected text as a new Apple Note.
    @objc func saveToNotes(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = L("services.noText") as NSString
            return
        }

        let title = escapedHTML(L("services.savedNoteTitle"))
        let body = "<h1>\(title)</h1><p>\(escapedHTML(text))</p>"
        executeTool(
            "create_note",
            arguments: ["body": body],
            successMessage: L("services.noteSaved")
        )
    }

    /// Create a reminder from selected text.
    @objc func createReminder(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = L("services.noText") as NSString
            return
        }

        executeTool(
            "create_reminder",
            arguments: ["title": String(text.prefix(100)), "body": text],
            successMessage: L("services.reminderCreated")
        )
    }

    /// Search AirMCP semantic index with selected text.
    @objc func searchAirMCP(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = L("services.noText") as NSString
            return
        }

        executeTool(
            "semantic_search",
            arguments: ["query": String(text.prefix(500)), "limit": 10],
            successMessage: L("services.searchCopied")
        ) { result in
            let output = NSPasteboard.general
            output.clearContents()
            output.setString(result, forType: .string)
        }
    }
}
