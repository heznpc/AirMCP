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
