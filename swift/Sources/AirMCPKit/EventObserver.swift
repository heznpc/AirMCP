import Foundation
import EventKit
#if canImport(AppKit)
import AppKit
#endif

/// Observes Apple data sources for changes and emits events.
/// Used in persistent bridge mode to push notifications.
public actor EventObserver {
    public enum Event: Sendable {
        case calendarChanged
        case remindersChanged
        case pasteboardChanged(String?)
        case focusModeChanged(String?)
        case fileModified(path: String, kind: String)
    }

    public typealias Handler = @Sendable (Event) -> Void

    /// Comma-separated absolute paths to watch. Defaults to `~/Downloads`
    /// if the env var is absent or empty. Non-existent paths are silently
    /// skipped so a missing directory doesn't abort the whole observer.
    public static let defaultWatchPaths = "AIRMCP_WATCH_PATHS"

    private var handler: Handler?
    private var eventStore: EKEventStore?
    private var calendarObserver: NSObjectProtocol?
    private var reminderObserver: NSObjectProtocol?
    private var focusObserver: NSObjectProtocol?
    private var pasteboardTimer: Timer?
    private var lastPasteboardCount: Int = 0

    // DispatchSource file watchers — actor-isolated; closures that feed
    // them hop back onto this actor before mutating state.
    private var fileSources: [(source: DispatchSourceFileSystemObject, fd: Int32, path: String)] = []

    public init() {}

    /// Start observing all sources. Call handler on each change.
    public func start(handler: @escaping Handler) {
        self.handler = handler

        // Retain the store so notifications keep firing
        let store = EKEventStore()
        self.eventStore = store

        // EKEventStoreChanged fires for both calendar and reminder changes.
        // We emit both events so triggers for either type can match.
        calendarObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: store,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task {
                await self.emit(.calendarChanged)
                await self.emit(.remindersChanged)
            }
        }

        #if canImport(AppKit)
        lastPasteboardCount = NSPasteboard.general.changeCount
        let timer = Timer(timeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.checkPasteboard() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pasteboardTimer = timer

        // Focus-mode observer via DistributedNotificationCenter.
        // macOS 12+ posts `com.apple.focus.state-change` when the user
        // enters or leaves any Focus filter (Do Not Disturb, Work, etc.).
        // This is a public, documented notification.
        focusObserver = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.apple.focus.state-change"),
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let self else { return }
            let state = (note.userInfo?["state"] as? String)
                ?? (note.userInfo?["mode"] as? String)
            Task { await self.emit(.focusModeChanged(state)) }
        }
        #endif

        startFileWatchers()
    }

    /// Stop all observers.
    public func stop() {
        if let obs = calendarObserver {
            NotificationCenter.default.removeObserver(obs)
            calendarObserver = nil
        }
        if let obs = reminderObserver {
            NotificationCenter.default.removeObserver(obs)
            reminderObserver = nil
        }
        #if canImport(AppKit)
        if let obs = focusObserver {
            DistributedNotificationCenter.default().removeObserver(obs)
            focusObserver = nil
        }
        #endif
        pasteboardTimer?.invalidate()
        pasteboardTimer = nil
        stopFileWatchers()
        handler = nil
        eventStore = nil
    }

    private func emit(_ event: Event) {
        handler?(event)
    }

    #if canImport(AppKit)
    private func checkPasteboard() {
        let current = NSPasteboard.general.changeCount
        if current != lastPasteboardCount {
            lastPasteboardCount = current
            let text = NSPasteboard.general.string(forType: .string)
            emit(.pasteboardChanged(text))
        }
    }
    #endif

    // MARK: - File watching

    /// Resolve watch paths from AIRMCP_WATCH_PATHS, falling back to ~/Downloads.
    /// Tilde expansion is applied per-entry. Non-existent paths are filtered out.
    private func resolveWatchPaths() -> [String] {
        let envRaw = ProcessInfo.processInfo.environment[Self.defaultWatchPaths] ?? ""
        let trimmed = envRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw: [String]
        if trimmed.isEmpty {
            raw = ["~/Downloads"]
        } else {
            raw = trimmed.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        let fm = FileManager.default
        return raw
            .map { NSString(string: $0).expandingTildeInPath }
            .filter { fm.fileExists(atPath: $0) }
    }

    private func startFileWatchers() {
        for path in resolveWatchPaths() {
            let fd = open(path, O_EVTONLY)
            guard fd >= 0 else { continue }
            let source = DispatchSource.makeFileSystemObjectSource(
                fileDescriptor: fd,
                eventMask: [.write, .rename, .delete],
                queue: DispatchQueue.global(qos: .utility)
            )
            source.setEventHandler { [weak self] in
                guard let self else { return }
                let flags = source.data
                let kind: String
                if flags.contains(.delete) {
                    kind = "delete"
                } else if flags.contains(.rename) {
                    kind = "rename"
                } else {
                    kind = "write"
                }
                Task { await self.emit(.fileModified(path: path, kind: kind)) }
            }
            source.setCancelHandler {
                close(fd)
            }
            source.resume()
            fileSources.append((source: source, fd: fd, path: path))
        }
    }

    private func stopFileWatchers() {
        for entry in fileSources {
            entry.source.cancel()
        }
        fileSources.removeAll()
    }
}
