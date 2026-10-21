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

}
