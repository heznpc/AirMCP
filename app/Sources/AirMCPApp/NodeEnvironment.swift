import Foundation

/// Shared utility for locating Node.js/npm/npx executables and building environments.
enum NodeEnvironment {
    /// Environment values that app-owned command-line children may inherit.
    ///
    /// Keep this list deliberately small. In particular, Node loader flags,
    /// dynamic-loader variables, proxy configuration, and `AIRMCP_*` runtime
    /// overrides must only be supplied by the app at the individual launch
    /// site, never by the process that launched AirMCP.app.
    private static let inheritedKeys = [
        "HOME",
        "LANG",
        "LC_ALL",
        "LC_COLLATE",
        "LC_CTYPE",
        "LC_MESSAGES",
        "LC_MONETARY",
        "LC_NUMERIC",
        "LC_TIME",
    ]

    /// Test-harness overrides that may cross into an app-owned Node runtime
    /// only when the native app was explicitly launched in acceptance mode.
    /// Runtime credentials and network policy are intentionally absent: the
    /// launch site always creates and injects those values itself.
    private static let appRuntimeAcceptanceOverrideKeys = [
        "AIRMCP_CONFIG_PATH",
        "AIRMCP_PROFILE",
        "AIRMCP_TOOL_EXPOSURE",
        "AIRMCP_REQUIRE_TOOL_SESSION",
        "AIRMCP_HITL_LEVEL",
        "AIRMCP_HITL_SOCKET_PATH",
        "AIRMCP_MEMORY_STORE_PATH",
        "AIRMCP_VECTOR_STORE_DIR",
        "AIRMCP_USAGE_PROFILE_PATH",
        "AIRMCP_EMERGENCY_STOP_PATH",
        "AIRMCP_TEMP_DIR",
        "AIRMCP_AUDIT_LOG",
        "AIRMCP_AUDIT_FLUSH_INTERVAL",
        "AIRMCP_AUDIT_HMAC_KEY",
        "AIRMCP_RATE_LIMIT",
        "AIRMCP_ELICITATION_DISABLE",
    ]

    private static let appRuntimeAcceptancePathKeys: Set<String> = [
        "AIRMCP_CONFIG_PATH",
        "AIRMCP_HITL_SOCKET_PATH",
        "AIRMCP_MEMORY_STORE_PATH",
        "AIRMCP_VECTOR_STORE_DIR",
        "AIRMCP_USAGE_PROFILE_PATH",
        "AIRMCP_EMERGENCY_STOP_PATH",
        "AIRMCP_TEMP_DIR",
    ]

    private static let appRuntimeAcceptanceLiteralValues: [String: Set<String>] = [
        "AIRMCP_PROFILE": ["full"],
        "AIRMCP_TOOL_EXPOSURE": ["full"],
        "AIRMCP_REQUIRE_TOOL_SESSION": ["false"],
        "AIRMCP_HITL_LEVEL": ["off", "sensitive-only"],
        "AIRMCP_AUDIT_LOG": ["true", "false"],
        "AIRMCP_RATE_LIMIT": ["true"],
        "AIRMCP_ELICITATION_DISABLE": ["false"],
    ]

    static let searchPaths: [String] = {
        let home = NSHomeDirectory()
        return [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "\(home)/n/bin",
            "\(home)/.volta/bin",
        ]
    }()

    /// Build a minimal child environment with Node paths prepended to PATH.
    static func buildEnv(
        from inherited: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        var env = inheritedKeys.reduce(into: [String: String]()) { result, key in
            guard let value = inherited[key], !value.isEmpty else { return }
            result[key] = value
        }
        if env["HOME"] == nil {
            env["HOME"] = NSHomeDirectory()
        }
        let currentPath = inherited["PATH"].flatMap { $0.isEmpty ? nil : $0 }
            ?? "/usr/bin:/bin"
        env["PATH"] = (searchPaths + [currentPath]).joined(separator: ":")
        return env
    }

    /// App-owned runtime children receive credentials after this method
    /// returns, so their inherited environment is stricter than general CLI
    /// helpers. HOME and PATH come from the current OS account and fixed search
    /// system roots; only canonical locale values cross the process boundary.
    static func buildAppRuntimeEnv(
        from inherited: [String: String] = ProcessInfo.processInfo.environment,
        executablePath: String? = nil
    ) -> [String: String] {
        var pathEntries = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        if let executablePath, !executablePath.isEmpty {
            let executableDirectory = URL(fileURLWithPath: executablePath)
                .deletingLastPathComponent()
                .path
            if !pathEntries.contains(executableDirectory) {
                pathEntries.insert(executableDirectory, at: 0)
            }
        }
        var env: [String: String] = [
            "HOME": NSHomeDirectory(),
            "PATH": pathEntries.joined(separator: ":"),
        ]
        for key in inheritedKeys where key != "HOME" {
            guard let value = inherited[key],
                  value.range(of: #"^[A-Za-z0-9_.@-]{1,64}$"#, options: .regularExpression) != nil
            else { continue }
            env[key] = value
        }
        return env
    }

    /// Select the isolated state/configuration contract used by the signed-app
    /// acceptance harness. Ordinary app launches inherit none of these values.
    static func appRuntimeAcceptanceOverrides(
        from inherited: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        guard inherited["AIRMCP_FORCE_APP_RUNTIME"] == "1",
              let fixedHome = inherited["CFFIXED_USER_HOME"],
              fixedHome.hasPrefix("/")
        else { return [:] }
        let stateRoot = URL(fileURLWithPath: fixedHome)
            .standardizedFileURL
            .deletingLastPathComponent()
        guard stateRoot.lastPathComponent.hasPrefix("airmcp-governed.")
                || stateRoot.lastPathComponent.hasPrefix("airmcp-signed-verify.")
        else { return [:] }

        return appRuntimeAcceptanceOverrideKeys.reduce(into: [String: String]()) { result, key in
            guard let value = inherited[key], !value.isEmpty else { return }
            if appRuntimeAcceptancePathKeys.contains(key) {
                guard value.hasPrefix("/") else { return }
                let path = URL(fileURLWithPath: value).standardizedFileURL.path
                let root = stateRoot.path
                guard path == root || path.hasPrefix(root + "/") else { return }
                result[key] = path
            } else if let accepted = appRuntimeAcceptanceLiteralValues[key] {
                guard accepted.contains(value) else { return }
                result[key] = value
            } else if key == "AIRMCP_AUDIT_FLUSH_INTERVAL" {
                guard value.range(of: #"^[1-9][0-9]{0,5}$"#, options: .regularExpression) != nil else { return }
                result[key] = value
            } else if key == "AIRMCP_AUDIT_HMAC_KEY" {
                guard value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else { return }
                result[key] = value
            }
        }
    }

    /// Find an executable for user-facing setup and add-on commands. These
    /// helpers intentionally honor the launcher's PATH after checking the
    /// conventional Node installation roots so shell-managed installations
    /// remain discoverable from onboarding.
    static func findExecutable(
        named name: String,
        from inherited: [String: String] = ProcessInfo.processInfo.environment
    ) -> String? {
        let inheritedDirectories = inherited["PATH"]?
            .split(separator: ":", omittingEmptySubsequences: true)
            .map(String.init) ?? []
        return firstExecutable(named: name, in: searchPaths + inheritedDirectories)
    }

    /// Resolve an executable used by the credential-bearing app-owned runtime.
    /// Unlike `findExecutable`, this never consults inherited PATH; only roots
    /// derived from the current OS account and fixed installation locations are
    /// eligible to become the selected runtime's trusted shebang directory.
    static func findTrustedAppRuntimeExecutable(named name: String) -> String? {
        firstExecutable(named: name, in: searchPaths)
    }

    private static func firstExecutable(named name: String, in directories: [String]) -> String? {
        guard !name.isEmpty, !name.contains("/") else { return nil }
        for directory in directories where !directory.isEmpty {
            let path = directory + "/\(name)"
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }

    /// Check if Node.js is available.
    static func nodeExists() -> Bool {
        return findExecutable(named: "node") != nil
    }
}
