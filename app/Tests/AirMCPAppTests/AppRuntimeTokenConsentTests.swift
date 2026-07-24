import Foundation
import XCTest
@testable import AirMCPApp

final class AppRuntimeTokenConsentTests: XCTestCase {
    private var scratch: URL!
    private var tokenURL: URL!
    private var ownerSecretURL: URL!

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent(
            "airmcp-token-consent-\(UUID().uuidString)",
            isDirectory: true
        )
        tokenURL = scratch.appendingPathComponent("http-token")
        ownerSecretURL = scratch.appendingPathComponent("runtime-owner-secret")
        setenv("AIRMCP_APP_RUNTIME_TOKEN_PATH", tokenURL.path, 1)
        setenv("AIRMCP_APP_RUNTIME_OWNER_PATH", ownerSecretURL.path, 1)
    }

    override func tearDownWithError() throws {
        unsetenv("AIRMCP_APP_RUNTIME_TOKEN_PATH")
        unsetenv("AIRMCP_APP_RUNTIME_OWNER_PATH")
        if let scratch {
            try? FileManager.default.removeItem(at: scratch)
        }
        scratch = nil
        tokenURL = nil
        ownerSecretURL = nil
    }

    func testExistingTokenProbeDoesNotCreateCredentials() async throws {
        XCTAssertNil(try AppRuntimeToken.loadExisting())
        let probeSucceeded = await AppRuntimeClient.probe()
        XCTAssertFalse(probeSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: tokenURL.path))
        XCTAssertNil(try AppRuntimeToken.expectedOwnerFingerprint())
        XCTAssertFalse(FileManager.default.fileExists(atPath: ownerSecretURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: scratch.path))
    }

    func testExplicitEnsureCreatesThenLoadExistingReadsSameToken() throws {
        let created = try AppRuntimeToken.ensure()
        XCTAssertFalse(created.isEmpty)
        XCTAssertEqual(try AppRuntimeToken.loadExisting(), created)
        XCTAssertTrue(FileManager.default.fileExists(atPath: tokenURL.path))
    }

    func testPinnedTokenFingerprintRejectsReplacementAndDeletion() throws {
        let captured = try AppRuntimeToken.ensure()
        let fingerprint = AppRuntimeToken.fingerprint(for: captured)
        XCTAssertEqual(fingerprint.count, 64)
        XCTAssertNotEqual(fingerprint, captured)
        XCTAssertTrue(AppRuntimeToken.matchesExisting(captured))

        let replacement = String(repeating: "b", count: 43)
        try Data(replacement.utf8).write(to: tokenURL, options: .atomic)
        XCTAssertFalse(AppRuntimeToken.matchesExisting(captured))
        XCTAssertNotEqual(AppRuntimeToken.fingerprint(for: replacement), fingerprint)

        try FileManager.default.removeItem(at: tokenURL)
        XCTAssertFalse(AppRuntimeToken.matchesExisting(captured))
    }

    func testConcurrentExplicitStartsPublishOneCompleteToken() async throws {
        let tokens = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<8 {
                group.addTask { try AppRuntimeToken.ensure() }
            }
            var values: [String] = []
            for try await value in group {
                values.append(value)
            }
            return values
        }

        XCTAssertEqual(Set(tokens).count, 1)
        XCTAssertEqual(try AppRuntimeToken.loadExisting(), tokens.first)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: scratch.path).sorted(),
            ["http-token"]
        )
    }

    func testExplicitLaunchRotatesAnAtomicOwnerOnlyGenerationSecret() throws {
        let first = try AppRuntimeToken.rotateOwnerSecret()
        let firstFingerprint = AppRuntimeToken.ownerFingerprint(for: first)
        XCTAssertEqual(try AppRuntimeToken.loadExistingOwnerSecret(), first)
        XCTAssertEqual(try AppRuntimeToken.expectedOwnerFingerprint(), firstFingerprint)

        let second = try AppRuntimeToken.rotateOwnerSecret()
        XCTAssertNotEqual(second, first)
        XCTAssertNotEqual(AppRuntimeToken.ownerFingerprint(for: second), firstFingerprint)
        XCTAssertEqual(try AppRuntimeToken.loadExistingOwnerSecret(), second)
        XCTAssertEqual(
            try XCTUnwrap(
                FileManager.default.attributesOfItem(atPath: ownerSecretURL.path)[.posixPermissions]
                    as? NSNumber
            ).intValue & 0o777,
            0o600
        )
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: scratch.path).sorted(),
            ["runtime-owner-secret"]
        )
    }
}
