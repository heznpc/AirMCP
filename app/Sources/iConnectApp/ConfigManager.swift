import Foundation

@MainActor
@Observable
final class ConfigManager {

    struct HitlConfig: Codable, Sendable {
        var level: String
        var whitelist: [String]
        var timeout: Int

        static let `default` = HitlConfig(level: "off", whitelist: [], timeout: 30)
    }

    struct Config: Codable, Sendable {
        var includeShared: Bool
        var allowSendMessages: Bool
        var allowSendMail: Bool
        var disabledModules: [String]
        var shareApproval: [String]?
        var hitl: HitlConfig?

        static let `default` = Config(
            includeShared: false,
            allowSendMessages: true,
            allowSendMail: true,
            disabledModules: [],
            shareApproval: nil,
            hitl: nil
        )
    }

    var config: Config = .default

    private static let configDir: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/airmcp", isDirectory: true)
    }()

    private static let configFile: URL = {
        configDir.appendingPathComponent("config.json")
    }()

    init() {
        load()
    }

    // MARK: - Persistence

    func load() {
        do {
            let data = try Data(contentsOf: Self.configFile)
            config = try JSONDecoder().decode(Config.self, from: data)
        } catch {
            // File missing or malformed — keep defaults
        }
    }

    func save() {
        do {
            try FileManager.default.createDirectory(
                at: Self.configDir,
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(config)
            try data.write(to: Self.configFile, options: .atomic)
        } catch {
            // Silently fail — menubar app should not crash on write errors
        }
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
        set { config.disabledModules = newValue; save() }
    }

    var shareApprovalModules: [String] {
        get { config.shareApproval ?? [] }
        set {
            config.shareApproval = newValue.isEmpty ? nil : newValue
            save()
        }
    }

    var hitlLevel: String {
        get { config.hitl?.level ?? "off" }
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

    /// Path relative to where npm/npx installs: ~/.config/airmcp or common dev path
    private var homeBridgePath: String? {
        // Check typical dev checkout via npx package cache
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        // Common dev location
        let devPath = home + "/IdeaProjects/iConnect/swift/.build/release/AirMcpBridge"
        if FileManager.default.isExecutableFile(atPath: devPath) {
            return devPath
        }
        return nil
    }

    /// Check alongside the app bundle
    private var bundleBridgePath: String? {
        let bundle = Bundle.main.bundlePath
        let base = (bundle as NSString).deletingLastPathComponent
        let path = (base as NSString).appendingPathComponent("swift/.build/release/AirMcpBridge")
        return path
    }
}
