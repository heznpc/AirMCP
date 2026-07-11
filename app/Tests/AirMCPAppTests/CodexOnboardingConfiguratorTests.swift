import Darwin
import Foundation
import XCTest
@testable import AirMCPApp

final class CodexOnboardingConfiguratorTests: XCTestCase {
    private var homeDirectory: URL!
    private var configURL: URL!

    override func setUpWithError() throws {
        homeDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "airmcp-codex-home-\(UUID().uuidString)",
            isDirectory: true
        )
        configURL = homeDirectory
            .appendingPathComponent(".codex", isDirectory: true)
            .appendingPathComponent("config.toml")
        try FileManager.default.createDirectory(
            at: configURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
    }

    override func tearDownWithError() throws {
        unsetenv("CODEX_HOME")
        if let homeDirectory {
            try? FileManager.default.removeItem(at: homeDirectory)
        }
        homeDirectory = nil
        configURL = nil
    }

    func testRemoveFailureRestoresEntireConfigAndMode() throws {
        let original = Data("# exact bytes: 안녕\n[mcp_servers.airmcp]\nenabled = false\n".utf8)
        try write(original, permissions: 0o640)

        let result = configure { [configURL] _, arguments, _, _ in
            if arguments == ["mcp", "get", "airmcp", "--json"] {
                return CodexCommandResult(success: true, output: Self.existingJSON)
            }
            if arguments == ["mcp", "remove", "airmcp"] {
                try! Data("partially changed".utf8).write(to: configURL!)
                try! FileManager.default.setAttributes(
                    [.posixPermissions: NSNumber(value: 0o600)],
                    ofItemAtPath: configURL!.path
                )
                return CodexCommandResult(success: false, output: "")
            }
            return CodexCommandResult(success: false, output: "unexpected")
        }

        XCTAssertFalse(result)
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o640)
    }

    func testAddFailureRestoresEntireConfigAndMode() throws {
        let original = Data("model = \"gpt\"\n\n[mcp_servers.airmcp]\ncommand = \"old\"\n".utf8)
        try write(original, permissions: 0o600)

        let result = configure { [configURL] _, arguments, _, _ in
            switch Array(arguments.prefix(3)) {
            case ["mcp", "get", "airmcp"]:
                return CodexCommandResult(success: true, output: Self.existingJSON)
            case ["mcp", "remove", "airmcp"]:
                try! Data("model = \"gpt\"\n".utf8).write(to: configURL!)
                return CodexCommandResult(success: true, output: "")
            case ["mcp", "add", "--env"]:
                try! Data("truncated add".utf8).write(to: configURL!)
                try! FileManager.default.setAttributes(
                    [.posixPermissions: NSNumber(value: 0o666)],
                    ofItemAtPath: configURL!.path
                )
                return CodexCommandResult(success: false, output: "")
            default:
                return CodexCommandResult(success: false, output: "unexpected")
            }
        }

        XCTAssertFalse(result)
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o600)
    }

    func testGetFailureWithExistingQuotedEntryFailsClosedWithoutMutation() throws {
        let original = Data(
            "model = \"gpt\"\n\n[mcp_servers.\"airmcp\"]\ncommand = \"keep-me\"\ncustom = true\n".utf8
        )
        try write(original, permissions: 0o640)
        var calls: [[String]] = []

        let result = configure { _, arguments, _, _ in
            calls.append(arguments)
            if arguments == ["mcp", "get", "airmcp", "--json"] {
                return CodexCommandResult(success: false, output: "permission denied")
            }
            return CodexCommandResult(success: false, output: "must not mutate")
        }

        XCTAssertFalse(result)
        XCTAssertEqual(calls, [["mcp", "get", "airmcp", "--json"]])
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o640)
    }

    func testGetFailureWithInvalidUTF8ConfigFailsClosedWithoutMutation() throws {
        let original = Data([0xff, 0xfe, 0x00, 0x80])
        try write(original, permissions: 0o640)
        var calls: [[String]] = []

        let result = configure { _, arguments, _, _ in
            calls.append(arguments)
            return CodexCommandResult(success: false, output: "config parse failed")
        }

        XCTAssertFalse(result)
        XCTAssertEqual(calls, [["mcp", "get", "airmcp", "--json"]])
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o640)
    }

    func testGetFailureWithInvalidTOMLFailsClosedWithoutMutation() throws {
        let original = Data("model = [unterminated\n".utf8)
        try write(original, permissions: 0o640)
        var calls: [[String]] = []

        let result = configure { _, arguments, _, _ in
            calls.append(arguments)
            return CodexCommandResult(success: false, output: "TOML parse error")
        }

        XCTAssertFalse(result)
        XCTAssertEqual(calls, [["mcp", "get", "airmcp", "--json"]])
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o640)
    }

    func testSuccessfulReplacementExplicitlyEnablesAndPreservesAdvancedSettings() throws {
        let original = Data("model = \"gpt\"\n\n[mcp_servers.airmcp]\nenabled = false\ncommand = \"old\"\n".utf8)
        try write(original, permissions: 0o640)
        setenv("CODEX_HOME", "/tmp/must-not-be-used", 1)

        let projectConfig = homeDirectory
            .appendingPathComponent("project/.codex/config.toml")
        try FileManager.default.createDirectory(
            at: projectConfig.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let projectBytes = Data("project_override = true\n".utf8)
        try projectBytes.write(to: projectConfig)

        var calls: [(arguments: [String], directory: URL, environment: [String: String])] = []
        let result = configure { [configURL, homeDirectory] _, arguments, directory, environment in
            calls.append((arguments, directory, environment))
            switch Array(arguments.prefix(3)) {
            case ["mcp", "get", "airmcp"]:
                return CodexCommandResult(success: true, output: Self.existingJSON)
            case ["mcp", "remove", "airmcp"]:
                try! Data("model = \"gpt\"\n".utf8).write(to: configURL!)
                return CodexCommandResult(success: true, output: "")
            case ["mcp", "add", "--env"]:
                let generated = """
                model = "gpt"

                [mcp_servers.airmcp]
                command = "proxy"
                args = ["connect"]

                [mcp_servers.airmcp.env]
                AIRMCP_HTTP_TOKEN = "new-token"
                KEEP_ME = "yes"
                """ + "\n"
                try! Data(generated.utf8).write(to: configURL!)
                try! FileManager.default.setAttributes(
                    [.posixPermissions: NSNumber(value: 0o600)],
                    ofItemAtPath: configURL!.path
                )
                XCTAssertEqual(directory, homeDirectory)
                return CodexCommandResult(success: true, output: "")
            default:
                return CodexCommandResult(success: false, output: "unexpected")
            }
        }

        XCTAssertTrue(result)
        let updated = try String(contentsOf: configURL, encoding: .utf8)
        XCTAssertTrue(updated.contains("model = \"gpt\""))
        XCTAssertTrue(updated.contains("enabled = true"))
        XCTAssertFalse(updated.contains("enabled = false"))
        XCTAssertTrue(updated.contains("enabled_tools = [\"notes.read\"]"))
        XCTAssertTrue(updated.contains("disabled_tools = [\"mail.delete\"]"))
        XCTAssertTrue(updated.contains("startup_timeout_sec = 17"))
        XCTAssertTrue(updated.contains("tool_timeout_sec = 42.5"))
        XCTAssertTrue(updated.contains("cwd = \"/tmp/advanced cwd\""))
        XCTAssertTrue(updated.contains("env_vars = [\"FORWARDED_ENV\"]"))
        XCTAssertEqual(try permissions(of: configURL), 0o600)
        XCTAssertEqual(try Data(contentsOf: projectConfig), projectBytes)

        XCTAssertFalse(calls.isEmpty)
        XCTAssertTrue(calls.allSatisfy { $0.directory == homeDirectory })
        XCTAssertTrue(calls.allSatisfy { $0.environment["HOME"] == homeDirectory.path })
        XCTAssertTrue(calls.allSatisfy { $0.environment["CODEX_HOME"] == nil })
        let addArguments = try XCTUnwrap(calls.first { $0.arguments.prefix(2) == ["mcp", "add"] }?.arguments)
        XCTAssertTrue(addArguments.contains("AIRMCP_HTTP_TOKEN=new-token"))
        XCTAssertTrue(addArguments.contains("KEEP_ME=yes"))
    }

    func testFailedFirstAddRemovesConfigCreatedByCodex() throws {
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path))

        let result = configure { [configURL] _, arguments, _, _ in
            if arguments == ["mcp", "get", "airmcp", "--json"] {
                return CodexCommandResult(
                    success: false,
                    output: "",
                    errorOutput: "Error: No MCP server named 'airmcp' found."
                )
            }
            if arguments.prefix(2) == ["mcp", "add"] {
                try! Data("partial".utf8).write(to: configURL!)
                return CodexCommandResult(success: false, output: "")
            }
            return CodexCommandResult(success: false, output: "unexpected")
        }

        XCTAssertFalse(result)
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path))
    }

    func testSuccessfulFirstAddMakesTokenBearingConfigOwnerOnly() throws {
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path))

        let result = configure { [configURL] _, arguments, _, _ in
            if arguments == ["mcp", "get", "airmcp", "--json"] {
                return CodexCommandResult(
                    success: false,
                    output: "",
                    errorOutput: "Error: No MCP server named 'airmcp' found."
                )
            }
            if arguments.prefix(2) == ["mcp", "add"] {
                try! Data("[mcp_servers.airmcp]\ncommand = \"proxy\"\n".utf8).write(to: configURL!)
                try! FileManager.default.setAttributes(
                    [.posixPermissions: NSNumber(value: 0o644)],
                    ofItemAtPath: configURL!.path
                )
                return CodexCommandResult(success: true, output: "")
            }
            return CodexCommandResult(success: false, output: "unexpected")
        }

        XCTAssertTrue(result)
        XCTAssertEqual(try permissions(of: configURL), 0o600)
    }

    func testTokenDeletionAfterCodexMutationRestoresEntireSnapshot() throws {
        let original = Data("model = \"gpt\"\n\n[mcp_servers.airmcp]\ncommand = \"old\"\n".utf8)
        try write(original, permissions: 0o640)
        var tokenCurrent = true
        var calls: [[String]] = []

        let result = configure(tokenStillCurrent: { tokenCurrent }) { [configURL] _, arguments, _, _ in
            calls.append(arguments)
            if arguments == ["mcp", "get", "airmcp", "--json"] {
                return CodexCommandResult(success: true, output: Self.existingJSON)
            }
            if arguments == ["mcp", "remove", "airmcp"] {
                try! Data("model = \"gpt\"\n".utf8).write(to: configURL!)
                tokenCurrent = false
                return CodexCommandResult(success: true, output: "")
            }
            return CodexCommandResult(success: false, output: "must not add")
        }

        XCTAssertFalse(result)
        XCTAssertEqual(calls.count, 2)
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try permissions(of: configURL), 0o640)
    }

    private func configure(
        tokenStillCurrent: @escaping () -> Bool = { true },
        commandRunner: CodexOnboardingConfigurator.CommandRunner
    ) -> Bool {
        CodexOnboardingConfigurator.configure(
            codex: "/usr/bin/false",
            homeDirectory: homeDirectory,
            token: "new-token",
            proxyCommand: "proxy",
            proxyArguments: ["connect"],
            tokenStillCurrent: tokenStillCurrent,
            commandRunner: commandRunner
        )
    }

    private func write(_ data: Data, permissions: Int) throws {
        try data.write(to: configURL)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: permissions)],
            ofItemAtPath: configURL.path
        )
    }

    private func permissions(of url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return try XCTUnwrap(attributes[.posixPermissions] as? NSNumber).intValue & 0o777
    }

    private static let existingJSON = """
    {
      "name": "airmcp",
      "enabled": false,
      "transport": {
        "type": "stdio",
        "command": "old",
        "args": ["serve"],
        "env": {"AIRMCP_HTTP_TOKEN": "old-token", "KEEP_ME": "yes"},
        "env_vars": ["FORWARDED_ENV"],
        "cwd": "/tmp/advanced cwd"
      },
      "enabled_tools": ["notes.read"],
      "disabled_tools": ["mail.delete"],
      "startup_timeout_sec": 17,
      "tool_timeout_sec": 42.5
    }
    """
}
