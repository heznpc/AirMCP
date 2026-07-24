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
        var onboardingWorkflow: String?
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
            onboardingWorkflow: nil,
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
            onboardingWorkflow: String?,
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
            self.onboardingWorkflow = onboardingWorkflow
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
            onboardingWorkflow = try container.decodeIfPresent(String.self, forKey: .onboardingWorkflow)
            shareApproval = try container.decodeIfPresent([String].self, forKey: .shareApproval)
            hitl = try container.decodeIfPresent(HitlConfig.self, forKey: .hitl)
        }
    }

    var config: Config = .default
    var lastPersistenceError: String?
    private var rawConfig: [String: Any] = [:]
    private var persistenceBlockedByLoadError = false

    struct OnboardingScopeTransaction {
        fileprivate let previousConfig: Config
        fileprivate let previousRawConfig: [String: Any]
        fileprivate let previousFile: ConfigFileSnapshot
        fileprivate let previousBackupFile: ConfigFileSnapshot
        let scope: OnboardingRuntimeScope
        let previousDisabledModules: [String]
        let previousRuntimeFingerprint: String
    }

    fileprivate struct ConfigFileSnapshot {
        let existed: Bool
        let data: Data?
        let permissions: Int?
    }

    private static var defaultConfigFile: URL {
        if let override = ProcessInfo.processInfo.environment["AIRMCP_CONFIG_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/airmcp/config.json")
    }

    private let configFile: URL
    private var configDir: URL { configFile.deletingLastPathComponent() }
    private var configBackupFile: URL { configFile.appendingPathExtension("backup") }

    init(configFile: URL? = nil) {
        self.configFile = configFile ?? Self.defaultConfigFile
        load()
    }

    // MARK: - Persistence

    func load() {
        guard FileManager.default.fileExists(atPath: configFile.path) else {
            config = .default
            rawConfig = [:]
            lastPersistenceError = nil
            persistenceBlockedByLoadError = false
            return
        }
        do {
            let data = try Data(contentsOf: configFile)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw CocoaError(.fileReadCorruptFile)
            }
            config = try JSONDecoder().decode(Config.self, from: data)
            rawConfig = object
            lastPersistenceError = nil
            persistenceBlockedByLoadError = false
        } catch {
            // Never replace a malformed owner config with defaults. Surface the
            // error and keep the in-memory defaults until the file is repaired.
            lastPersistenceError = error.localizedDescription
            persistenceBlockedByLoadError = true
        }
    }

    func save() {
        // A failed load means `rawConfig` is not an authoritative snapshot.
        // Refuse to merge defaults over an unreadable or malformed owner file.
        guard !persistenceBlockedByLoadError else { return }
        do {
            try FileManager.default.createDirectory(
                at: configDir,
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
            if FileManager.default.fileExists(atPath: configFile.path) {
                try? FileManager.default.removeItem(at: configBackupFile)
                try FileManager.default.copyItem(at: configFile, to: configBackupFile)
            }
            try data.write(to: configFile, options: .atomic)
            rawConfig = merged
            lastPersistenceError = nil
        } catch {
            lastPersistenceError = error.localizedDescription
        }
    }

    /// Persist the exact Setup scope as a reversible transaction. The caller
    /// may start a runtime only after this method has read the written bytes
    /// back and verified both workflow identity and normalized module scope.
    /// Any write/verification failure restores the previous file and in-memory
    /// configuration before returning nil.
    func beginOnboardingRuntimeScopeTransaction(
        _ scope: OnboardingRuntimeScope
    ) -> OnboardingScopeTransaction? {
        guard !persistenceBlockedByLoadError else { return nil }
        let validWorkflows = Set(onboardingWorkflows.map(\.id))
        let validModules = Set(allModules.map(\.id))
        guard validWorkflows.contains(scope.workflowID),
              Set(scope.disabledModules).isSubset(of: validModules),
              let workflow = onboardingWorkflows.first(where: { $0.id == scope.workflowID }),
              Set(scope.requiredModules) == workflow.requiredModules,
              Set(scope.requestedModules) == onboardingModuleIds.subtracting(scope.disabledModules)
        else {
            lastPersistenceError = "Setup contains an unknown workflow or module."
            return nil
        }

        let previousFile: ConfigFileSnapshot
        do {
            previousFile = try captureConfigFile(at: configFile)
            let previousBackupFile = try captureConfigFile(at: configBackupFile)
            let transaction = OnboardingScopeTransaction(
                previousConfig: config,
                previousRawConfig: rawConfig,
                previousFile: previousFile,
                previousBackupFile: previousBackupFile,
                scope: scope,
                previousDisabledModules: Array(Set(config.disabledModules)).sorted(),
                previousRuntimeFingerprint: OnboardingRuntimeScope(
                    workflowID: config.onboardingWorkflow ?? "previous",
                    disabledModules: config.disabledModules
                ).runtimeFingerprint
            )
            config.profile = "custom"
            config.toolExposure = config.toolExposure ?? "profile"
            config.disabledModules = scope.disabledModules
            config.onboardingWorkflow = scope.workflowID
            save()

            let failure: String?
            if let lastPersistenceError {
                failure = lastPersistenceError
            } else if !isOnboardingRuntimeScopePersisted(scope) {
                failure = "The saved Setup scope could not be verified."
            } else {
                failure = nil
            }

            guard let failure else { return transaction }
            if rollbackOnboardingRuntimeScope(transaction) {
                lastPersistenceError = failure
            }
            return nil
        } catch {
            lastPersistenceError = error.localizedDescription
            return nil
        }
    }

    /// Restore the byte-for-byte configuration that preceded a scoped runtime
    /// activation. A failed restore is surfaced and leaves persistence blocked
    /// by the error rather than claiming the old configuration is active.
    @discardableResult
    func rollbackOnboardingRuntimeScope(
        _ transaction: OnboardingScopeTransaction
    ) -> Bool {
        do {
            try restoreConfigFile(transaction.previousBackupFile, at: configBackupFile)
            try restoreConfigFile(transaction.previousFile, at: configFile)
            config = transaction.previousConfig
            rawConfig = transaction.previousRawConfig
            persistenceBlockedByLoadError = false
            lastPersistenceError = nil
            return true
        } catch {
            lastPersistenceError = error.localizedDescription
            return false
        }
    }

    func isOnboardingRuntimeScopePersisted(
        _ scope: OnboardingRuntimeScope
    ) -> Bool {
        guard let data = try? Data(contentsOf: configFile),
              let persisted = try? JSONDecoder().decode(Config.self, from: data)
        else { return false }
        return persisted.profile == "custom"
            && persisted.onboardingWorkflow == scope.workflowID
            && persisted.disabledModules == scope.disabledModules
    }

    private func captureConfigFile(at url: URL) throws -> ConfigFileSnapshot {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: url.path) else {
            return ConfigFileSnapshot(existed: false, data: nil, permissions: nil)
        }
        let data = try Data(contentsOf: url)
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
        return ConfigFileSnapshot(existed: true, data: data, permissions: permissions)
    }

    private func restoreConfigFile(_ snapshot: ConfigFileSnapshot, at url: URL) throws {
        let fileManager = FileManager.default
        if snapshot.existed {
            guard let data = snapshot.data else { throw CocoaError(.fileReadCorruptFile) }
            try fileManager.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
            if let permissions = snapshot.permissions {
                try fileManager.setAttributes(
                    [.posixPermissions: NSNumber(value: permissions)],
                    ofItemAtPath: url.path
                )
            }
        } else if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
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
        setOptional("onboardingWorkflow", config.onboardingWorkflow)
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
