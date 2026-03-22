import AppKit
import Foundation
import UserNotifications

/// macOS Services provider — adds AirMCP actions to the system-wide Services menu.
/// Available via right-click → Services in any app when text is selected.
final class ServicesProvider: NSObject, @unchecked Sendable {

    /// Escape a string for safe interpolation into an AppleScript string literal.
    private func escapeForAppleScript(_ str: String) -> String {
        str.replacingOccurrences(of: "\\", with: "\\\\")
           .replacingOccurrences(of: "\"", with: "\\\"")
           .replacingOccurrences(of: "\n", with: "\\n")
           .replacingOccurrences(of: "\r", with: "\\r")
           .replacingOccurrences(of: "\t", with: "\\t")
    }

    /// Run an AppleScript string on a background queue.
    private func runAppleScript(_ source: String, onError: (@Sendable () -> Void)? = nil) {
        DispatchQueue.global(qos: .userInitiated).async {
            var appleScriptError: NSDictionary?
            if let appleScript = NSAppleScript(source: source) {
                appleScript.executeAndReturnError(&appleScriptError)
            }
            if appleScriptError != nil { onError?() }
        }
    }

    /// Post a local notification.
    private func postNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Save selected text as a new Apple Note.
    @objc func saveToNotes(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = "No text selected" as NSString
            return
        }

        let escaped = escapeForAppleScript(text)
        let script = """
        tell application "Notes"
            make new note at folder "Notes" with properties {name:"AirMCP — Saved Text", body:"\(escaped)"}
        end tell
        """

        runAppleScript(script) { [weak self] in
            DispatchQueue.main.async {
                self?.postNotification(title: "AirMCP", body: "Failed to save note")
            }
        }
    }

    /// Create a reminder from selected text.
    @objc func createReminder(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = "No text selected" as NSString
            return
        }

        let escaped = escapeForAppleScript(text)
        let escapedTitle = escapeForAppleScript(String(text.prefix(100)))

        let script = """
        tell application "Reminders"
            make new reminder with properties {name:"\(escapedTitle)", body:"\(escaped)"}
        end tell
        """

        runAppleScript(script)
    }

    /// Search AirMCP semantic index with selected text.
    @objc func searchAirMCP(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty else {
            error.pointee = "No text selected" as NSString
            return
        }

        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString("airmcp-search:\(text)", forType: .string)

        let body = "Search query set: \(String(text.prefix(50)))..."
        DispatchQueue.main.async { [weak self] in
            self?.postNotification(title: "AirMCP Search", body: body)
        }
    }
}
