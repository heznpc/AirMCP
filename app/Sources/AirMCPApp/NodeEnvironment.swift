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
        from inherited: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        var env: [String: String] = [
            "HOME": NSHomeDirectory(),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        ]
        for key in inheritedKeys where key != "HOME" {
            guard let value = inherited[key],
                  value.range(of: #"^[A-Za-z0-9_.@-]{1,64}$"#, options: .regularExpression) != nil
            else { continue }
            env[key] = value
        }
        return env
    }

    /// Find an executable by name, checking common Node paths then falling back to `which`.
    static func findExecutable(named name: String) -> String? {
        let candidates = searchPaths.map { $0 + "/\(name)" }
        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = [name]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let path = String(data: data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if let path, !path.isEmpty {
                    return path
                }
            }
        } catch {
            // fall through
        }

        return nil
    }

    /// Check if Node.js is available.
    static func nodeExists() -> Bool {
        return findExecutable(named: "node") != nil
    }
}
