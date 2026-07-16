import Foundation

public enum WidgetSnapshotError: Error, Equatable {
    case unsupportedVersion(Int)
}

public enum WidgetSnapshotConfig {
    /// App Group shared by the main app (writer) and the widget (reader). Must
    /// match the `com.apple.security.application-groups` entitlement on BOTH
    /// signed targets; the release gate checks that agreement.
    public static let appGroupID = "group.com.heznpc.AirMCP"
}

/// Reads/writes a ``WidgetSnapshot`` to a shared App Group container. The
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
