import Foundation

/// Shared utility for locating Node.js/npm/npx executables and building environments.
enum NodeEnvironment {
    static let searchPaths: [String] = {
        let home = NSHomeDirectory()
        return [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "\(home)/n/bin",
            "\(home)/.volta/bin",
        ]
    }()

    /// Build a process environment with Node paths prepended to PATH.
    static func buildEnv() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let currentPath = env["PATH"] ?? "/usr/bin:/bin"
        env["PATH"] = (searchPaths + [currentPath]).joined(separator: ":")
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
