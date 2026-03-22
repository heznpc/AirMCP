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
    }

    public typealias Handler = @Sendable (Event) -> Void

    private var handler: Handler?
    private var eventStore: EKEventStore?
    private var calendarObserver: NSObjectProtocol?
    private var reminderObserver: NSObjectProtocol?
    private var pasteboardTimer: Timer?
    private var lastPasteboardCount: Int = 0

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
        #endif
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
        pasteboardTimer?.invalidate()
        pasteboardTimer = nil
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
}
