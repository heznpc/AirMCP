import Foundation

/// Display-only snapshot that the **main app writes** to the shared App Group
/// container and the **widget reads**. It is deliberately minimal and
/// redactable: it NEVER carries the app-runtime bearer token or a copy of the
/// HMAC audit chain — only what a glanceable widget needs. Making the widget a
/// pure reader of this contract removes its direct EventKit access, so the
/// widget stops being an independent, ungoverned reader of the user's calendar
/// and reminders (RFC-style P0 "display-only snapshot" alignment).
///
/// Runtime note: the App Group container is only reachable from a **signed**
/// build with the `com.apple.security.application-groups` entitlement. In an
/// unsigned build `WidgetSnapshotStore.containerURL()` returns nil and callers
/// degrade gracefully; the model/serialization logic below is pure and unit
/// tested independently of the container.
public struct WidgetSnapshot: Codable, Sendable, Equatable {
    /// Bump when the on-disk shape changes. A widget rejects a snapshot whose
    /// version is newer than it understands instead of misreading it.
    public static let currentVersion = 1

    public enum PrivacyMode: String, Codable, Sendable {
        /// Only counts are exposed; titles/locations are stripped.
        case countsOnly
        /// Titles are exposed (user opted in).
        case titles
    }

    public enum RuntimeStatus: String, Codable, Sendable {
        case unknown
        case running
        case stopped
    }

    /// One upcoming event, bounded and redactable. `title`/`location` are nil in
    /// counts-only privacy mode; the time span is always present so the widget
    /// can still show "3 events, next at 14:00" without leaking what they are.
    public struct Event: Codable, Sendable, Equatable {
        public var title: String?
        public var start: Date
        public var end: Date
        public var isAllDay: Bool
        public var location: String?
        public var calendarColorHex: String?

        public init(
            title: String?,
            start: Date,
            end: Date,
            isAllDay: Bool,
            location: String? = nil,
            calendarColorHex: String? = nil
        ) {
            self.title = title
            self.start = start
            self.end = end
            self.isAllDay = isAllDay
            self.location = location
            self.calendarColorHex = calendarColorHex
        }
    }

    /// One reminder, bounded and redactable. `title` is nil in counts-only mode.
    public struct Reminder: Codable, Sendable, Equatable {
        public var title: String?
        public var dueDate: Date?
        public var isOverdue: Bool

        public init(title: String?, dueDate: Date?, isOverdue: Bool) {
            self.title = title
            self.dueDate = dueDate
            self.isOverdue = isOverdue
        }
    }

    public var version: Int
    public var generatedAt: Date
    /// After this instant the widget should treat the snapshot as stale and show
    /// a "last updated" affordance rather than presenting it as live.
    public var staleAt: Date
    public var privacyMode: PrivacyMode
    public var runtimeStatus: RuntimeStatus

    // Bounded briefing summary. Counts are always safe to show; per-item
    // titles/locations obey the privacy mode. `eventCount` is the true total
    // for the day and may exceed `events.count` when the list is truncated.
    public var events: [Event]
    public var reminders: [Reminder]
    public var eventCount: Int
    public var overdueReminderCount: Int
    /// Access the WRITER (the app) actually had when building this snapshot, so
    /// the widget shows an honest "grant access" state instead of a false empty.
    public var calendarAuthorized: Bool
    public var reminderAuthorized: Bool

    public init(
        version: Int = WidgetSnapshot.currentVersion,
        generatedAt: Date,
        staleAt: Date,
        privacyMode: PrivacyMode,
        runtimeStatus: RuntimeStatus,
        events: [Event] = [],
        reminders: [Reminder] = [],
        eventCount: Int,
        overdueReminderCount: Int,
        calendarAuthorized: Bool = true,
        reminderAuthorized: Bool = true
    ) {
        self.version = version
        self.generatedAt = generatedAt
        self.staleAt = staleAt
        self.privacyMode = privacyMode
        self.runtimeStatus = runtimeStatus
        self.events = events
        self.reminders = reminders
        self.eventCount = eventCount
        self.overdueReminderCount = overdueReminderCount
        self.calendarAuthorized = calendarAuthorized
        self.reminderAuthorized = reminderAuthorized
    }

    public func isStale(now: Date = Date()) -> Bool {
        now >= staleAt
    }

    /// A copy with title/detail fields stripped when the privacy mode forbids
    /// them. Applied by the WRITER before persisting, so a title never reaches
    /// the container in counts-only mode — defense in depth for the reader too.
    public func redactedForPrivacy() -> WidgetSnapshot {
        guard privacyMode == .countsOnly else { return self }
        var copy = self
        copy.events = copy.events.map { ev in
            var e = ev
            e.title = nil
            e.location = nil
            return e
        }
        copy.reminders = copy.reminders.map { rem in
            var r = rem
            r.title = nil
            return r
        }
        return copy
    }
}

public enum WidgetSnapshotError: Error, Equatable {
    case unsupportedVersion(Int)
}

public enum WidgetSnapshotConfig {
    /// App Group shared by the main app (writer) and the widget (reader). Must
    /// match the `com.apple.security.application-groups` entitlement on BOTH
    /// signed targets; the release gate checks that agreement.
    public static let appGroupID = "group.com.heznpc.AirMCP"
}

/// Reads/writes a `WidgetSnapshot` to a shared App Group container. The
/// container URL is signing-gated; `write(_:to:)` / `read(from:)` take an
/// explicit URL so the serialization contract is unit-testable against a temp
/// file without an entitlement.
public struct WidgetSnapshotStore: Sendable {
    public let appGroupID: String
    public static let fileName = "widget-snapshot.json"

    public init(appGroupID: String) {
        self.appGroupID = appGroupID
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    /// nil when running unsigned / without the App Group entitlement — callers
    /// must degrade gracefully instead of force-unwrapping.
    public func containerURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(Self.fileName)
    }

    public func encode(_ snapshot: WidgetSnapshot) throws -> Data {
        try Self.encoder.encode(snapshot.redactedForPrivacy())
    }

    public func decode(_ data: Data) throws -> WidgetSnapshot {
        let snap = try Self.decoder.decode(WidgetSnapshot.self, from: data)
        guard snap.version <= WidgetSnapshot.currentVersion else {
            throw WidgetSnapshotError.unsupportedVersion(snap.version)
        }
        return snap
    }

    /// Atomic write so the widget never observes a half-written file.
    public func write(_ snapshot: WidgetSnapshot, to url: URL) throws {
        try encode(snapshot).write(to: url, options: .atomic)
    }

    public func read(from url: URL) throws -> WidgetSnapshot {
        try decode(try Data(contentsOf: url))
    }
}
