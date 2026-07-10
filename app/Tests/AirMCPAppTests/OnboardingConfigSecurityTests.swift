import Darwin
import Foundation
import XCTest
@testable import AirMCPApp

final class OnboardingConfigSecurityTests: XCTestCase {
    private var temporaryDirectory: URL!
    private var tokenPath: String!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "airmcp-onboarding-config-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        tokenPath = temporaryDirectory.appendingPathComponent("runtime-token").path
        setenv("AIRMCP_APP_RUNTIME_TOKEN_PATH", tokenPath, 1)
    }

    override func tearDownWithError() throws {
        unsetenv("AIRMCP_APP_RUNTIME_TOKEN_PATH")
        if let temporaryDirectory {
            try? FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o700)],
                ofItemAtPath: temporaryDirectory.path
            )
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
        temporaryDirectory = nil
        tokenPath = nil
    }

    func testExistingConfigAndBackupBecomeOwnerOnly() throws {
        let configURL = temporaryDirectory.appendingPathComponent("client.json")
        let original = Data("{\"mcpServers\":{\"existing\":{\"command\":\"keep\"}}}\n".utf8)
        try original.write(to: configURL)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o644)],
            ofItemAtPath: configURL.path
        )

        XCTAssertTrue(OnboardingView.patchConfig(at: configURL.path))

        let backupURL = URL(fileURLWithPath: configURL.path + ".airmcp-backup")
        XCTAssertEqual(try permissions(of: configURL), 0o600)
        XCTAssertEqual(try permissions(of: backupURL), 0o600)
        XCTAssertEqual(try Data(contentsOf: backupURL), original)

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as? [String: Any]
        )
        let servers = try XCTUnwrap(object["mcpServers"] as? [String: Any])
        XCTAssertNotNil(servers["existing"])
        let airmcp = try XCTUnwrap(servers["airmcp"] as? [String: Any])
        let environment = try XCTUnwrap(airmcp["env"] as? [String: String])
        XCTAssertFalse(try XCTUnwrap(environment["AIRMCP_HTTP_TOKEN"]).isEmpty)
    }

    func testNewTokenBearingConfigIsCreatedOwnerOnly() throws {
        let configURL = temporaryDirectory.appendingPathComponent("nested/client.json")

        XCTAssertTrue(OnboardingView.patchConfig(at: configURL.path))

        XCTAssertEqual(try permissions(of: configURL), 0o600)
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path + ".airmcp-backup"))
        let siblings = try FileManager.default.contentsOfDirectory(atPath: configURL.deletingLastPathComponent().path)
        XCTAssertFalse(siblings.contains { $0.hasSuffix(".tmp") })
    }

    func testMalformedExistingConfigIsLeftByteForByteUnchanged() throws {
        let configURL = temporaryDirectory.appendingPathComponent("client.json")
        let malformed = Data("{not-json\n".utf8)
        try malformed.write(to: configURL)

        XCTAssertFalse(OnboardingView.patchConfig(at: configURL.path))

        XCTAssertEqual(try Data(contentsOf: configURL), malformed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path + ".airmcp-backup"))
    }

    private func permissions(of url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return try XCTUnwrap(attributes[.posixPermissions] as? NSNumber).intValue & 0o777
    }
}
