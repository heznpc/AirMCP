import Foundation

struct CodexCommandResult: Sendable {
    let success: Bool
    let output: String
    let errorOutput: String

    init(success: Bool, output: String, errorOutput: String = "") {
        self.success = success
        self.output = output
        self.errorOutput = errorOutput
    }

    var reportsMissingAirMCPServer: Bool {
        let diagnostic = [output, errorOutput].joined(separator: "\n")
        return diagnostic.range(
            of: #"No MCP server named ['\"]airmcp['\"] found\.?"#,
            options: .regularExpression
        ) != nil
    }
}

/// Applies the onboarding-owned Codex MCP registration as a transaction over
/// the user's global Codex config. Codex has no in-place MCP update command, so
/// a failed remove/add sequence must restore the entire file, not reconstruct a
/// subset of the previous registration.
enum CodexOnboardingConfigurator {
    typealias CommandRunner = (
        _ executable: String,
        _ arguments: [String],
        _ currentDirectory: URL,
        _ environment: [String: String]
    ) -> CodexCommandResult

    static func configure(
        codex executable: String,
        homeDirectory: URL,
        token: String,
        proxyCommand: String,
        proxyArguments: [String],
        tokenStillCurrent: () -> Bool = { true },
        commandRunner: CommandRunner = runCommand
    ) -> Bool {
        let configURL = homeDirectory
            .appendingPathComponent(".codex", isDirectory: true)
            .appendingPathComponent("config.toml")

        let snapshot: ConfigSnapshot
        do {
            snapshot = try ConfigSnapshot.capture(at: configURL)
        } catch {
            return false
        }
        guard tokenStillCurrent() else { return false }

        var environment = NodeEnvironment.buildEnv()
        environment["HOME"] = homeDirectory.path
        // Onboarding deliberately edits ~/.codex/config.toml. An inherited
        // override must not redirect the transaction to a different tree.
        environment.removeValue(forKey: "CODEX_HOME")

        let existingResult = commandRunner(
            executable,
            ["mcp", "get", "airmcp", "--json"],
            homeDirectory,
            environment
        )
        guard tokenStillCurrent() else {
            _ = snapshot.restore(at: configURL)
            return false
        }

        let existingSettings: ExistingSettings?
        if existingResult.success {
            guard let parsed = ExistingSettings(json: existingResult.output) else {
                return false
            }
            existingSettings = parsed

            guard tokenStillCurrent() else { return false }
            let removed = commandRunner(
                executable,
                ["mcp", "remove", "airmcp"],
                homeDirectory,
                environment
            )
            guard removed.success else {
                _ = snapshot.restore(at: configURL)
                return false
            }
            guard tokenStillCurrent() else {
                _ = snapshot.restore(at: configURL)
                return false
            }
        } else {
            // `mcp get` uses a non-zero exit both for "not registered" and for
            // CLI/config read failures. If the byte snapshot already contains
            // the global AirMCP table, fail closed: treating a permission or
            // parse failure as absence could replace it and lose fields that the
            // failed command never returned.
            guard existingResult.reportsMissingAirMCPServer,
                  snapshot.isValidUTF8,
                  !snapshot.containsAirMCPServerEntry
            else { return false }
            existingSettings = nil
        }

        var replacementEnvironment = existingSettings?.environment ?? [:]
        replacementEnvironment["AIRMCP_HTTP_TOKEN"] = token

        var addArguments = ["mcp", "add"]
        for key in replacementEnvironment.keys.sorted() {
            guard let value = replacementEnvironment[key] else { continue }
            addArguments.append(contentsOf: ["--env", "\(key)=\(value)"])
        }
        addArguments.append(contentsOf: ["airmcp", "--", proxyCommand])
        addArguments.append(contentsOf: proxyArguments)

        guard tokenStillCurrent() else {
            _ = snapshot.restore(at: configURL)
            return false
        }
        let added = commandRunner(
            executable,
            addArguments,
            homeDirectory,
            environment
        )
        guard added.success else {
            _ = snapshot.restore(at: configURL)
            return false
        }
        guard tokenStillCurrent() else {
            _ = snapshot.restore(at: configURL)
            return false
        }

        if let existingSettings,
           !existingSettings.restoreAdvancedFields(
               in: configURL,
               preferredPermissions: 0o600
           ) {
            _ = snapshot.restore(at: configURL)
            return false
        }

        // The replacement embeds the app-runtime bearer token. Keep the
        // successful configuration owner-only even if the pre-existing file
        // was group/world-readable; failures above still restore the exact
        // original bytes and mode.
        do {
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: configURL.path
            )
        } catch {
            _ = snapshot.restore(at: configURL)
            return false
        }

        guard tokenStillCurrent() else {
            _ = snapshot.restore(at: configURL)
            return false
        }

        return true
    }

    private struct ConfigSnapshot {
        let existed: Bool
        let data: Data?
        let permissions: Int?

        static func capture(at url: URL) throws -> ConfigSnapshot {
            let fileManager = FileManager.default
            guard fileManager.fileExists(atPath: url.path) else {
                return ConfigSnapshot(existed: false, data: nil, permissions: nil)
            }

            let data = try Data(contentsOf: url)
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
            return ConfigSnapshot(existed: true, data: data, permissions: permissions)
        }

        var containsAirMCPServerEntry: Bool {
            guard let data,
                  let source = String(data: data, encoding: .utf8)
            else { return false }
            let tablePattern = #"^\s*\[\s*mcp_servers\s*\.\s*(?:airmcp|\"airmcp\"|'airmcp')\s*\]\s*(?:#.*)?$"#
            return source.components(separatedBy: .newlines).contains { line in
                line.range(of: tablePattern, options: .regularExpression) != nil
            }
        }

        var isValidUTF8: Bool {
            guard let data else { return true }
            return String(data: data, encoding: .utf8) != nil
        }

        func restore(at url: URL) -> Bool {
            let fileManager = FileManager.default
            do {
                if existed {
                    guard let data else { return false }
                    try fileManager.createDirectory(
                        at: url.deletingLastPathComponent(),
                        withIntermediateDirectories: true,
                        attributes: [.posixPermissions: NSNumber(value: 0o700)]
                    )
                    try data.write(to: url, options: .atomic)
                    if let permissions {
                        try fileManager.setAttributes(
                            [.posixPermissions: NSNumber(value: permissions)],
                            ofItemAtPath: url.path
                        )
                    }
                } else if fileManager.fileExists(atPath: url.path) {
                    try fileManager.removeItem(at: url)
                }
                return true
            } catch {
                return false
            }
        }
    }

    private struct ExistingSettings {
        let enabledTools: [String]?
        let disabledTools: [String]?
        let startupTimeout: NSNumber?
        let toolTimeout: NSNumber?
        let workingDirectory: String?
        let environmentVariables: [String]?
        let environment: [String: String]

        init?(json: String) {
            guard let data = json.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let transport = object["transport"] as? [String: Any]
            else { return nil }

            enabledTools = object["enabled_tools"] as? [String]
            disabledTools = object["disabled_tools"] as? [String]
            startupTimeout = object["startup_timeout_sec"] as? NSNumber
            toolTimeout = object["tool_timeout_sec"] as? NSNumber
            workingDirectory = transport["cwd"] as? String
            environmentVariables = transport["env_vars"] as? [String]

            if let rawEnvironment = transport["env"] as? [String: Any] {
                environment = rawEnvironment.reduce(into: [:]) { result, item in
                    if let value = item.value as? String,
                       item.key != "AIRMCP_HTTP_TOKEN" {
                        result[item.key] = value
                    }
                }
            } else {
                environment = [:]
            }
        }

        func restoreAdvancedFields(
            in configURL: URL,
            preferredPermissions: Int?
        ) -> Bool {
            guard let data = try? Data(contentsOf: configURL),
                  let source = String(data: data, encoding: .utf8)
            else { return false }

            var lines = source.components(separatedBy: "\n")
            guard let sectionIndex = lines.firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces) == "[mcp_servers.airmcp]"
            }) else { return false }

            let advancedKeys = Set([
                "enabled",
                "enabled_tools",
                "disabled_tools",
                "startup_timeout_sec",
                "tool_timeout_sec",
                "cwd",
                "env_vars",
            ])
            var sectionEnd = lines.count
            if sectionIndex + 1 < lines.count {
                for index in (sectionIndex + 1)..<lines.count
                where lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("[") {
                    sectionEnd = index
                    break
                }
            }

            if sectionIndex + 1 < sectionEnd {
                for index in stride(from: sectionEnd - 1, through: sectionIndex + 1, by: -1) {
                    let key = lines[index]
                        .split(separator: "=", maxSplits: 1)
                        .first?
                        .trimmingCharacters(in: .whitespaces)
                    if let key, advancedKeys.contains(key) {
                        lines.remove(at: index)
                    }
                }
            }

            // The only caller is the explicit “Enable in Codex” action. Make
            // that consent effective even when an older AirMCP entry had been
            // disabled, while still preserving its tool/time/env constraints.
            var restored: [String] = ["enabled = true"]
            if let enabledTools {
                restored.append("enabled_tools = \(Self.tomlArray(enabledTools))")
            }
            if let disabledTools {
                restored.append("disabled_tools = \(Self.tomlArray(disabledTools))")
            }
            if let startupTimeout {
                restored.append("startup_timeout_sec = \(startupTimeout.stringValue)")
            }
            if let toolTimeout {
                restored.append("tool_timeout_sec = \(toolTimeout.stringValue)")
            }
            if let workingDirectory {
                restored.append("cwd = \(Self.tomlString(workingDirectory))")
            }
            if let environmentVariables, !environmentVariables.isEmpty {
                restored.append("env_vars = \(Self.tomlArray(environmentVariables))")
            }

            lines.insert(contentsOf: restored, at: sectionIndex + 1)
            guard let updated = lines.joined(separator: "\n").data(using: .utf8) else {
                return false
            }

            let permissions = preferredPermissions ?? Self.permissions(of: configURL) ?? 0o600
            do {
                try updated.write(to: configURL, options: .atomic)
                try FileManager.default.setAttributes(
                    [.posixPermissions: NSNumber(value: permissions)],
                    ofItemAtPath: configURL.path
                )
                return true
            } catch {
                return false
            }
        }

        private static func tomlArray(_ values: [String]) -> String {
            "[" + values.map(tomlString).joined(separator: ", ") + "]"
        }

        private static func tomlString(_ value: String) -> String {
            var encoded = "\""
            for scalar in value.unicodeScalars {
                switch scalar.value {
                case 0x08: encoded += "\\b"
                case 0x09: encoded += "\\t"
                case 0x0A: encoded += "\\n"
                case 0x0C: encoded += "\\f"
                case 0x0D: encoded += "\\r"
                case 0x22: encoded += "\\\""
                case 0x5C: encoded += "\\\\"
                case 0x00...0x1F, 0x7F:
                    encoded += String(format: "\\u%04X", scalar.value)
                default:
                    encoded.unicodeScalars.append(scalar)
                }
            }
            encoded += "\""
            return encoded
        }

        private static func permissions(of url: URL) -> Int? {
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            return (attributes?[.posixPermissions] as? NSNumber)?.intValue
        }
    }

    private static func runCommand(
        executable: String,
        arguments: [String],
        currentDirectory: URL,
        environment: [String: String]
    ) -> CodexCommandResult {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectory
        process.environment = environment
        process.standardOutput = output
        // Missing registrations are reported on stderr. Capture the combined
        // stream so a generic CLI/config failure can be distinguished from the
        // exact non-mutating "not found" result. Any warning mixed with JSON on
        // a successful get makes parsing fail closed.
        process.standardError = output

        do {
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let text = String(data: data, encoding: .utf8) ?? ""
            return CodexCommandResult(
                success: process.terminationStatus == 0,
                output: text,
                errorOutput: text
            )
        } catch {
            return CodexCommandResult(success: false, output: "")
        }
    }
}
