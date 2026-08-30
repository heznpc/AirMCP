import XCTest
@testable import AirMCPApp

final class NodeEnvironmentTests: XCTestCase {
    func testBuildEnvOnlyInheritsPathHomeAndLocale() {
        let inherited = [
            "PATH": "/custom/bin:/usr/bin:/bin",
            "HOME": "/Users/example",
            "LANG": "ko_KR.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "LC_CTYPE": "UTF-8",
            "LC_TIME": "ko_KR.UTF-8",
            "NODE_OPTIONS": "--require=/tmp/steal-token.cjs",
            "NODE_PATH": "/tmp/attacker-modules",
            "DYLD_INSERT_LIBRARIES": "/tmp/steal-token.dylib",
            "LD_LIBRARY_PATH": "/tmp/attacker-libraries",
            "HTTP_PROXY": "http://127.0.0.1:8080",
            "https_proxy": "http://127.0.0.1:8081",
            "NO_PROXY": "*",
            "AIRMCP_HTTP_TOKEN": "attacker-token",
            "AIRMCP_ALLOW_NETWORK": "1",
            "AIRMCP_CONFIG_PATH": "/tmp/attacker-config.json",
            "CONTROL_PLANE_API_KEY": "secret",
        ]

        let environment = NodeEnvironment.buildEnv(from: inherited)

        XCTAssertEqual(environment["HOME"], "/Users/example")
        XCTAssertEqual(environment["LANG"], "ko_KR.UTF-8")
        XCTAssertEqual(environment["LC_ALL"], "en_US.UTF-8")
        XCTAssertEqual(environment["LC_CTYPE"], "UTF-8")
        XCTAssertEqual(environment["LC_TIME"], "ko_KR.UTF-8")
        XCTAssertEqual(
            environment["PATH"],
            (NodeEnvironment.searchPaths + ["/custom/bin:/usr/bin:/bin"])
                .joined(separator: ":")
        )
        XCTAssertEqual(
            Set(environment.keys),
            ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LC_TIME", "PATH"]
        )
    }

    func testBuildEnvUsesSafeDefaultsForMissingHomeAndPath() {
        let environment = NodeEnvironment.buildEnv(from: [:])

        XCTAssertEqual(environment["HOME"], NSHomeDirectory())
        XCTAssertEqual(
            environment["PATH"],
            (NodeEnvironment.searchPaths + ["/usr/bin:/bin"])
                .joined(separator: ":")
        )
        XCTAssertEqual(Set(environment.keys), ["HOME", "PATH"])
    }

    func testLaunchSiteCanInjectTrustedAirMCPPathsAfterSanitization() {
        var environment = NodeEnvironment.buildAppRuntimeEnv(from: [
            "HOME": "/tmp/attacker-home",
            "PATH": "/tmp/attacker-bin",
            "LANG": "ko_KR.UTF-8",
            "LC_ALL": "../../tmp/attacker-locale",
            "NODE_OPTIONS": "--require=/tmp/steal-token.cjs",
            "AIRMCP_HTTP_TOKEN": "attacker-token",
            "AIRMCP_BRIDGE_PATH": "/tmp/attacker-bridge",
        ])

        XCTAssertEqual(environment["HOME"], NSHomeDirectory())
        XCTAssertEqual(environment["PATH"], "/usr/bin:/bin:/usr/sbin:/sbin")
        XCTAssertEqual(environment["LANG"], "ko_KR.UTF-8")
        XCTAssertNil(environment["LC_ALL"])
        XCTAssertNil(environment["NODE_OPTIONS"])

        environment["AIRMCP_APP_RUNTIME_TOKEN_PATH"] = "/tmp/private/http-token"
        environment["AIRMCP_BRIDGE_PATH"] = "/Applications/AirMCP.app/Contents/Resources/bridge"

        XCTAssertEqual(environment["AIRMCP_APP_RUNTIME_TOKEN_PATH"], "/tmp/private/http-token")
        XCTAssertEqual(
            environment["AIRMCP_BRIDGE_PATH"],
            "/Applications/AirMCP.app/Contents/Resources/bridge"
        )
    }

    func testAppRuntimeEnvAddsOnlyTheSelectedExecutableDirectoryToPath() {
        let environment = NodeEnvironment.buildAppRuntimeEnv(
            from: ["PATH": "/tmp/attacker-bin"],
            executablePath: "/opt/homebrew/bin/npx"
        )

        XCTAssertEqual(
            environment["PATH"],
            "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        )
    }

    func testAppRuntimeEnvCanLaunchResolvedNpxShebang() throws {
        guard let npxPath = NodeEnvironment.findTrustedAppRuntimeExecutable(named: "npx") else {
            throw XCTSkip("npx is not installed")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: npxPath)
        process.arguments = ["--version"]
        process.environment = NodeEnvironment.buildAppRuntimeEnv(executablePath: npxPath)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        try process.run()
        process.waitUntilExit()

        XCTAssertEqual(process.terminationStatus, 0)
    }

    func testGeneralExecutableLookupPreservesInheritedPathCompatibility() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("airmcp-node-path-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let executableName = "path-only-npx-\(UUID().uuidString)"
        let executable = directory.appendingPathComponent(executableName)
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        XCTAssertEqual(
            NodeEnvironment.findExecutable(named: executableName, from: ["PATH": directory.path]),
            executable.path
        )
    }

    func testTrustedAppRuntimeLookupIgnoresAttackerPath() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("airmcp-untrusted-node-path-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let executableName = "attacker-npx-\(UUID().uuidString)"
        let executable = directory.appendingPathComponent(executableName)
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        XCTAssertEqual(
            NodeEnvironment.findExecutable(named: executableName, from: ["PATH": directory.path]),
            executable.path
        )
        XCTAssertNil(NodeEnvironment.findTrustedAppRuntimeExecutable(named: executableName))
    }

    func testGovernedHarnessProducesTheExactCredentialSafeChildEnvironment() {
        let stateRoot = "/tmp/airmcp-governed.ABC123"
        let auditKey = String(repeating: "a", count: 64)
        let inherited = [
            "AIRMCP_FORCE_APP_RUNTIME": "1",
            "CFFIXED_USER_HOME": "\(stateRoot)/home",
            "HOME": "\(stateRoot)/home",
            "PATH": "/tmp/attacker-bin",
            "AIRMCP_PROFILE": "full",
            "AIRMCP_TOOL_EXPOSURE": "full",
            "AIRMCP_REQUIRE_TOOL_SESSION": "false",
            "AIRMCP_HITL_LEVEL": "sensitive-only",
            "AIRMCP_HITL_SOCKET_PATH": "\(stateRoot)/hitl.sock",
            "AIRMCP_CONFIG_PATH": "\(stateRoot)/config.json",
            "AIRMCP_MEMORY_STORE_PATH": "\(stateRoot)/memory.json",
            "AIRMCP_VECTOR_STORE_DIR": "\(stateRoot)/audit",
            "AIRMCP_USAGE_PROFILE_PATH": "\(stateRoot)/usage.json",
            "AIRMCP_EMERGENCY_STOP_PATH": "\(stateRoot)/emergency-stop",
            "AIRMCP_TEMP_DIR": "\(stateRoot)/tmp",
            "AIRMCP_AUDIT_LOG": "true",
            "AIRMCP_AUDIT_FLUSH_INTERVAL": "25",
            "AIRMCP_AUDIT_HMAC_KEY": auditKey,
            "AIRMCP_RATE_LIMIT": "true",
            "AIRMCP_ELICITATION_DISABLE": "false",
            "AIRMCP_HTTP_TOKEN": "attacker-token",
            "AIRMCP_APP_RUNTIME_OWNER_SECRET": "attacker-owner",
            "AIRMCP_BRIDGE_PATH": "/tmp/attacker-bridge",
            "AIRMCP_ALLOW_NETWORK": "all",
            "AIRMCP_NPM_PACKAGE_SPECIFIER": "/tmp/attacker-package",
            "NODE_OPTIONS": "--require=/tmp/steal-token.cjs",
            "NODE_PATH": "/tmp/attacker-modules",
            "DYLD_INSERT_LIBRARIES": "/tmp/steal-token.dylib",
            "LD_LIBRARY_PATH": "/tmp/attacker-libraries",
        ]
        let accepted = [
            "AIRMCP_PROFILE": "full",
            "AIRMCP_TOOL_EXPOSURE": "full",
            "AIRMCP_REQUIRE_TOOL_SESSION": "false",
            "AIRMCP_HITL_LEVEL": "sensitive-only",
            "AIRMCP_HITL_SOCKET_PATH": "\(stateRoot)/hitl.sock",
            "AIRMCP_CONFIG_PATH": "\(stateRoot)/config.json",
            "AIRMCP_MEMORY_STORE_PATH": "\(stateRoot)/memory.json",
            "AIRMCP_VECTOR_STORE_DIR": "\(stateRoot)/audit",
            "AIRMCP_USAGE_PROFILE_PATH": "\(stateRoot)/usage.json",
            "AIRMCP_EMERGENCY_STOP_PATH": "\(stateRoot)/emergency-stop",
            "AIRMCP_TEMP_DIR": "\(stateRoot)/tmp",
            "AIRMCP_AUDIT_LOG": "true",
            "AIRMCP_AUDIT_FLUSH_INTERVAL": "25",
            "AIRMCP_AUDIT_HMAC_KEY": auditKey,
            "AIRMCP_RATE_LIMIT": "true",
            "AIRMCP_ELICITATION_DISABLE": "false",
        ]

        XCTAssertEqual(NodeEnvironment.appRuntimeAcceptanceOverrides(from: inherited), accepted)

        var child = NodeEnvironment.buildAppRuntimeEnv(
            from: inherited,
            executablePath: "/opt/homebrew/bin/npx"
        )
        for (key, value) in NodeEnvironment.appRuntimeAcceptanceOverrides(from: inherited) {
            child[key] = value
        }
        child["AIRMCP_ALLOW_NETWORK"] = "with-token"
        child["AIRMCP_APP_OWNED_RUNTIME"] = "1"
        child["AIRMCP_APP_RUNTIME_TOKEN_PATH"] = "\(stateRoot)/http-token"
        child["AIRMCP_APP_RUNTIME_OWNER_PATH"] = "\(stateRoot)/runtime-owner-secret"
        child["AIRMCP_BRIDGE_PATH"] = "/Applications/AirMCP.app/Contents/Resources/airmcp/bin/AirMcpBridge"

        var expectedChild = accepted
        expectedChild["HOME"] = NSHomeDirectory()
        expectedChild["PATH"] = "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        expectedChild["AIRMCP_ALLOW_NETWORK"] = "with-token"
        expectedChild["AIRMCP_APP_OWNED_RUNTIME"] = "1"
        expectedChild["AIRMCP_APP_RUNTIME_TOKEN_PATH"] = "\(stateRoot)/http-token"
        expectedChild["AIRMCP_APP_RUNTIME_OWNER_PATH"] = "\(stateRoot)/runtime-owner-secret"
        expectedChild["AIRMCP_BRIDGE_PATH"] = "/Applications/AirMCP.app/Contents/Resources/airmcp/bin/AirMcpBridge"

        XCTAssertEqual(child, expectedChild)
    }

    func testAcceptanceOverridesFilterOutOfRootAndMalformedValuesIndividually() {
        let stateRoot = "/tmp/airmcp-signed-verify.ABC123"
        let inherited = [
            "AIRMCP_FORCE_APP_RUNTIME": "1",
            "CFFIXED_USER_HOME": "\(stateRoot)/home",
            "AIRMCP_CONFIG_PATH": "/Users/example/.config/airmcp/config.json",
            "AIRMCP_MEMORY_STORE_PATH": "\(stateRoot)/nested/../memory.json",
            "AIRMCP_PROFILE": "full",
            "AIRMCP_HITL_LEVEL": "all",
            "AIRMCP_HITL_SOCKET_PATH": "\(stateRoot)/../escaped.sock",
            "AIRMCP_AUDIT_LOG": "true",
            "AIRMCP_AUDIT_FLUSH_INTERVAL": "00025",
            "AIRMCP_AUDIT_HMAC_KEY": "not-a-key",
            "AIRMCP_RATE_LIMIT": "false",
        ]

        XCTAssertEqual(
            NodeEnvironment.appRuntimeAcceptanceOverrides(from: inherited),
            [
                "AIRMCP_MEMORY_STORE_PATH": "\(stateRoot)/memory.json",
                "AIRMCP_PROFILE": "full",
                "AIRMCP_AUDIT_LOG": "true",
            ]
        )
    }

    func testAcceptanceOverridesRequireCompileHarnessLaunchContract() {
        XCTAssertTrue(NodeEnvironment.appRuntimeAcceptanceOverrides(from: [
            "CFFIXED_USER_HOME": "/tmp/airmcp-governed.ABC123/home",
            "AIRMCP_PROFILE": "full",
        ]).isEmpty)
        XCTAssertTrue(NodeEnvironment.appRuntimeAcceptanceOverrides(from: [
            "AIRMCP_FORCE_APP_RUNTIME": "1",
            "CFFIXED_USER_HOME": "/Users/example",
            "AIRMCP_PROFILE": "full",
        ]).isEmpty)
    }

    func testSignedProductionHarnessPassesNoAirMCPChildOverrides() {
        let stateRoot = "/tmp/airmcp-signed-verify.ABC123"
        let signedLaunchEnvironment = [
            "HOME": "\(stateRoot)/home",
            "CFFIXED_USER_HOME": "\(stateRoot)/home",
        ]

        XCTAssertTrue(
            NodeEnvironment.appRuntimeAcceptanceOverrides(from: signedLaunchEnvironment).isEmpty
        )
        XCTAssertEqual(
            NodeEnvironment.buildAppRuntimeEnv(from: signedLaunchEnvironment),
            [
                "HOME": NSHomeDirectory(),
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            ]
        )
    }
}
