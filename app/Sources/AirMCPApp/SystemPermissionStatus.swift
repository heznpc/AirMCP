import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// The three macOS privacy categories that can never show a consent popup:
/// the user must flip the toggle in System Settings themselves. These probes
/// report the AirMCP.app process only; stdio MCP servers must inspect the host
/// process that launches their osascript/JXA execution path instead. The Trust
/// Center therefore labels its status as app-local and provides a deep link.
enum SystemPermissionState: Sendable {
    case granted
    case notGranted
    case unknown
}

struct SystemPermissionInfo: Identifiable, Sendable {
    let id: String
    /// Localizable.strings key for the display name.
    let titleKey: String
    /// Anchor inside the Privacy & Security pane (Privacy_ScreenCapture, …).
    let settingsAnchor: String
    var state: SystemPermissionState

    var settingsURL: URL? {
        URL(string: "x-apple.systempreferences:com.apple.preference.security?\(settingsAnchor)")
    }
}

enum SystemPermissionProbe {
    /// All probes are read-only preflight checks — none of them enqueue a
    /// TCC prompt, so refreshing the Trust Center never surprises the user
    /// with a permission dialog.
    static func current() -> [SystemPermissionInfo] {
        [
            SystemPermissionInfo(
                id: "screen_recording",
                titleKey: "trust.screenRecording",
                settingsAnchor: "Privacy_ScreenCapture",
                state: screenRecordingState()
            ),
            SystemPermissionInfo(
                id: "accessibility",
                titleKey: "trust.accessibility",
                settingsAnchor: "Privacy_Accessibility",
                state: accessibilityState()
            ),
            SystemPermissionInfo(
                id: "full_disk",
                titleKey: "trust.fullDiskAccess",
                settingsAnchor: "Privacy_AllFiles",
                state: fullDiskState()
            ),
        ]
    }

    static func screenRecordingState() -> SystemPermissionState {
        CGPreflightScreenCaptureAccess() ? .granted : .notGranted
    }

    static func accessibilityState() -> SystemPermissionState {
        AXIsProcessTrusted() ? .granted : .notGranted
    }

    /// The user copy of the TCC database always exists and is readable only
    /// with Full Disk Access — a successful read-only open proves the grant,
    /// a permission error proves its absence. Modern macOS data vaults hide
    /// even the *existence* of TCC.db from processes without the grant, so
    /// "file not found" also means "not granted" as long as the system TCC
    /// directory (visible without FDA) is still where it has always been.
    static func fullDiskState() -> SystemPermissionState {
        let probeURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/com.apple.TCC/TCC.db")
        do {
            let handle = try FileHandle(forReadingFrom: probeURL)
            try? handle.close()
            return .granted
        } catch let error as NSError {
            if error.domain == NSCocoaErrorDomain, error.code == NSFileReadNoPermissionError {
                return .notGranted
            }
            if error.domain == NSPOSIXErrorDomain,
               error.code == Int(EPERM) || error.code == Int(EACCES) {
                return .notGranted
            }
            let vaultHidDatabase = error.domain == NSCocoaErrorDomain
                && error.code == NSFileReadNoSuchFileError
                && FileManager.default.fileExists(atPath: "/Library/Application Support/com.apple.TCC")
            return vaultHidDatabase ? .notGranted : .unknown
        }
    }
}
