import Foundation

/// Syncs AirMCP configuration and usage data across devices via iCloud key-value store.
/// Uses NSUbiquitousKeyValueStore for lightweight sync (max 1MB total, 64KB per key).
public actor CloudSyncService {

    private let store = NSUbiquitousKeyValueStore.default

    // Key prefix to avoid collisions
    private let prefix = "com.airmcp."

    public init() {}

    // MARK: - Config Sync

    /// Save a config value to iCloud.
    public func setConfig(_ key: String, value: Any) {
        store.set(value, forKey: prefix + "config." + key)
        // system syncs automatically
    }

    /// Get a config value from iCloud.
    public func getConfig(_ key: String) -> Any? {
        return store.object(forKey: prefix + "config." + key)
    }

    /// Save disabled modules list to iCloud.
    public func syncDisabledModules(_ modules: [String]) {
        store.set(modules, forKey: prefix + "disabledModules")
        // system syncs automatically
    }

    /// Get disabled modules from iCloud.
    public func getDisabledModules() -> [String] {
        let raw = store.array(forKey: prefix + "disabledModules") as? [String] ?? []
        // Validate: only keep non-empty alphanumeric module names
        return raw.filter { !$0.isEmpty && $0.range(of: "^[a-z][a-z0-9]*$", options: .regularExpression) != nil }
    }

    // MARK: - Usage Profile Sync

    /// Save usage frequency data to iCloud (top tools only — within 64KB limit).
    public func syncUsageFrequency(_ frequency: [String: Int]) {
        // Only sync top 100 tools to stay within size limits
        let top = frequency.sorted { $0.value > $1.value }.prefix(100)
        let dict = Dictionary(uniqueKeysWithValues: top.map { ($0.key, $0.value) })
        store.set(dict, forKey: prefix + "usage.frequency")
        // system syncs automatically
    }

    /// Get synced usage frequency from iCloud.
    public func getUsageFrequency() -> [String: Int] {
        return store.dictionary(forKey: prefix + "usage.frequency") as? [String: Int] ?? [:]
    }

    /// Save tool sequences to iCloud (top patterns only).
    public func syncUsageSequences(_ sequences: [String: Int]) {
        let top = sequences.sorted { $0.value > $1.value }.prefix(200)
        let dict = Dictionary(uniqueKeysWithValues: top.map { ($0.key, $0.value) })
        store.set(dict, forKey: prefix + "usage.sequences")
        // system syncs automatically
    }

    /// Get synced tool sequences from iCloud.
    public func getUsageSequences() -> [String: Int] {
        return store.dictionary(forKey: prefix + "usage.sequences") as? [String: Int] ?? [:]
    }

    // MARK: - Change Observation

    /// Start observing iCloud changes. Call this on app launch.
    public func startObserving(onChange: @escaping @Sendable () -> Void) {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: store,
            queue: .main
        ) { _ in
            onChange()
        }
        // system syncs automatically
    }

    /// Get all synced data as a summary.
    public func getSyncStatus() -> SyncStatus {
        let frequency = getUsageFrequency()
        let sequences = getUsageSequences()
        let modules = getDisabledModules()
        return SyncStatus(
            hasData: !frequency.isEmpty || !sequences.isEmpty,
            toolCount: frequency.count,
            sequenceCount: sequences.count,
            disabledModules: modules,
            lastSync: store.object(forKey: prefix + "lastSync") as? String
        )
    }

    /// Mark current time as last sync.
    public func markSynced() {
        store.set(formatISO8601(Date()), forKey: prefix + "lastSync")
        // system syncs automatically
    }
}

public struct SyncStatus: Codable, Sendable {
    public let hasData: Bool
    public let toolCount: Int
    public let sequenceCount: Int
    public let disabledModules: [String]
    public let lastSync: String?
}
