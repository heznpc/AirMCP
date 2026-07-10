import Foundation

enum HitlLevel: String, Codable, Sendable, CaseIterable {
    case off = "off"
    case destructiveOnly = "destructive-only"
    case sensitiveOnly = "sensitive-only"
    case allWrites = "all-writes"
    case all = "all"
}

@MainActor
@Observable
final class ConfigManager {
    struct HitlConfig: Codable, Sendable {
        var level: HitlLevel
        var whitelist: [String]
        var timeout: Int

        static let `default` = HitlConfig(level: .sensitiveOnly, whitelist: [], timeout: 30)

        init(level: HitlLevel, whitelist: [String], timeout: Int) {
            self.level = level
            self.whitelist = whitelist
            self.timeout = timeout
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            level = try container.decodeIfPresent(HitlLevel.self, forKey: .level) ?? .sensitiveOnly
            whitelist = try container.decodeIfPresent([String].self, forKey: .whitelist) ?? []
            timeout = try container.decodeIfPresent(Int.self, forKey: .timeout) ?? 30
        }
    }

    struct Config: Codable, Sendable {
        var profile: String?
        var toolExposure: String?
        var modulePacks: [String]?
        var requireToolSession: Bool
        var includeShared: Bool
        var allowSendMessages: Bool
        var allowSendMail: Bool
        var disabledModules: [String]
        var shareApproval: [String]?
        var hitl: HitlConfig?

        static let `default` = Config(
            profile: "starter",
            toolExposure: "progressive",
            modulePacks: nil,
            requireToolSession: true,
            includeShared: false,
            allowSendMessages: false,
            allowSendMail: false,
            disabledModules: [],
            shareApproval: nil,
            hitl: nil
        )

        init(
            profile: String?,
            toolExposure: String?,
            modulePacks: [String]?,
            requireToolSession: Bool,
            includeShared: Bool,
            allowSendMessages: Bool,
            allowSendMail: Bool,
            disabledModules: [String],
            shareApproval: [String]?,
            hitl: HitlConfig?
        ) {
            self.profile = profile
            self.toolExposure = toolExposure
            self.modulePacks = modulePacks
            self.requireToolSession = requireToolSession
            self.includeShared = includeShared
            self.allowSendMessages = allowSendMessages
            self.allowSendMail = allowSendMail
            self.disabledModules = disabledModules
            self.shareApproval = shareApproval
            self.hitl = hitl
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            profile = try container.decodeIfPresent(String.self, forKey: .profile)
            toolExposure = try container.decodeIfPresent(String.self, forKey: .toolExposure)
            modulePacks = try container.decodeIfPresent([String].self, forKey: .modulePacks)
            requireToolSession = try container.decodeIfPresent(Bool.self, forKey: .requireToolSession) ?? true
            includeShared = try container.decodeIfPresent(Bool.self, forKey: .includeShared) ?? false
            allowSendMessages = try container.decodeIfPresent(Bool.self, forKey: .allowSendMessages) ?? false
            allowSendMail = try container.decodeIfPresent(Bool.self, forKey: .allowSendMail) ?? false
            disabledModules = try container.decodeIfPresent([String].self, forKey: .disabledModules) ?? []
            shareApproval = try container.decodeIfPresent([String].self, forKey: .shareApproval)
            hitl = try container.decodeIfPresent(HitlConfig.self, forKey: .hitl)
        }
    }

    var config: Config = .default
    var lastPersistenceError: String?
    private var rawConfig: [String: Any] = [:]

    private static let configFile: URL = {
        if let override = ProcessInfo.processInfo.environment["AIRMCP_CONFIG_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/airmcp/config.json")
    }()

    private static let configDir: URL = {
        configFile.deletingLastPathComponent()
    }()

    private static let configBackupFile: URL = {
        configFile.appendingPathExtension("backup")
    }()

    init() {
        load()
    }

    // MARK: - Persistence

    func load() {
        do {
            let data = try Data(contentsOf: Self.configFile)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CocoaError(.fileReadCorruptFile)
            }
            config = try JSONDecoder().decode(Config.self, from: data)
            rawConfig = object
            lastPersistenceError = nil
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            rawConfig = [:]
            lastPersistenceError = nil
        } catch {
            // Never replace a malformed owner config with defaults. Surface the
            // error and keep the in-memory defaults until the file is repaired.
            lastPersistenceError = error.localizedDescription
        }
    }

    func save() {
        do {
            try FileManager.default.createDirectory(
                at: Self.configDir,
                withIntermediateDirectories: true
            )
            let merged = mergeKnownFields(into: rawConfig)
            let data = try JSONSerialization.data(
                withJSONObject: merged,
                options: [.prettyPrinted, .sortedKeys]
            )
            // Validate the exact bytes before replacing the owner's config.
            guard (try JSONSerialization.jsonObject(with: data)) is [String: Any] else {
                throw CocoaError(.fileWriteUnknown)
            }
            if FileManager.default.fileExists(atPath: Self.configFile.path) {
                try? FileManager.default.removeItem(at: Self.configBackupFile)
                try FileManager.default.copyItem(at: Self.configFile, to: Self.configBackupFile)
            }
            try data.write(to: Self.configFile, options: .atomic)
            rawConfig = merged
            lastPersistenceError = nil
        } catch {
            lastPersistenceError = error.localizedDescription
        }
    }

    /// Merge only the fields owned by the app UI. Features, performance
    /// tuning, and future Node-side keys survive round-trips unchanged.
    private func mergeKnownFields(into original: [String: Any]) -> [String: Any] {
        var merged = original

        func setOptional(_ key: String, _ value: Any?) {
            if let value {
                merged[key] = value
            } else {
                merged.removeValue(forKey: key)
            }
        }

        setOptional("profile", config.profile)
        setOptional("toolExposure", config.toolExposure)
        setOptional("modulePacks", config.modulePacks)
        merged["requireToolSession"] = config.requireToolSession
        merged["includeShared"] = config.includeShared
        merged["allowSendMessages"] = config.allowSendMessages
        merged["allowSendMail"] = config.allowSendMail
        merged["disabledModules"] = config.disabledModules
        setOptional("shareApproval", config.shareApproval)

        if let hitl = config.hitl {
            var hitlObject = merged["hitl"] as? [String: Any] ?? [:]
            hitlObject["level"] = hitl.level.rawValue
            hitlObject["whitelist"] = hitl.whitelist
            hitlObject["timeout"] = hitl.timeout
            merged["hitl"] = hitlObject
        } else {
            merged.removeValue(forKey: "hitl")
        }

        return merged
    }

    // MARK: - Convenience Bindings

    var includeShared: Bool {
        get { config.includeShared }
        set { config.includeShared = newValue; save() }
    }

    var allowSendMessages: Bool {
        get { config.allowSendMessages }
        set { config.allowSendMessages = newValue; save() }
    }

    var allowSendMail: Bool {
        get { config.allowSendMail }
        set { config.allowSendMail = newValue; save() }
    }

    var disabledModules: [String] {
        get { config.disabledModules }
        set {
            config.profile = "custom"
            config.toolExposure = config.toolExposure ?? "profile"
            config.disabledModules = newValue
            save()
        }
    }

    var modulePacks: [String] {
        get { config.modulePacks ?? allModulePacks.map(\.id) }
        set {
            var seen = Set<String>()
            var next = newValue.filter { pack in
                guard allModulePackIds.contains(pack), !seen.contains(pack) else { return false }
                seen.insert(pack)
                return true
            }
            if !next.contains("core") {
                next.insert("core", at: 0)
            }
            config.modulePacks = next
            save()
        }
    }

    func setModulePack(_ pack: String, enabled: Bool) {
        var packs = modulePacks
        if enabled {
            if !packs.contains(pack) {
                packs.append(pack)
            }
        } else if pack != "core" {
            packs.removeAll { $0 == pack }
        }
        modulePacks = packs
    }

    var shareApprovalModules: [String] {
        get { config.shareApproval ?? [] }
        set {
            config.shareApproval = newValue.isEmpty ? nil : newValue
            save()
        }
    }

    var hitlLevel: HitlLevel {
        get { config.hitl?.level ?? .sensitiveOnly }
        set {
            if config.hitl == nil { config.hitl = .default }
            config.hitl?.level = newValue
            save()
        }
    }

    var hitlTimeout: Int {
        get { config.hitl?.timeout ?? 30 }
        set {
            if config.hitl == nil { config.hitl = .default }
            config.hitl?.timeout = newValue
            save()
        }
    }

    var hitlWhitelist: [String] {
        get { config.hitl?.whitelist ?? [] }
        set {
            if config.hitl == nil { config.hitl = .default }
            config.hitl?.whitelist = newValue
            save()
        }
    }

    // MARK: - Swift Bridge

    var swiftBridgeAvailable: Bool {
        // Look for AirMcpBridge relative to the executable or common install paths
        let candidates = [
            bundleBridgePath,
            homeBridgePath,
        ].compactMap { $0 }

        return candidates.contains { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Check AIRMCP_BRIDGE_PATH env var, then fall back to ~/.config/airmcp/AirMcpBridge
    private var homeBridgePath: String? {
        if let envPath = ProcessInfo.processInfo.environment["AIRMCP_BRIDGE_PATH"],
           FileManager.default.isExecutableFile(atPath: envPath) {
            return envPath
        }
        let configPath = FileManager.default.homeDirectoryForCurrentUser.path + "/.config/airmcp/AirMcpBridge"
        if FileManager.default.isExecutableFile(atPath: configPath) {
            return configPath
        }
        return nil
    }

    /// Check alongside the app bundle
    private var bundleBridgePath: String? {
        AirMcpConstants.bundledBridgePath
    }
}
