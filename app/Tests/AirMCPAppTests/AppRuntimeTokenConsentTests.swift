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

    func testListenerIdentityProofMatchesNodeContractAndRejectsTampering() throws {
        let secret = String(repeating: "a", count: 43)
        let nonce = String(repeating: "b", count: 43)
        let proof = try XCTUnwrap(
            AppRuntimeToken.listenerIdentityProof(
                nonce: nonce,
                processIdentifier: 123,
                version: "2.16.5",
                ownerSecret: secret
            )
        )
        XCTAssertEqual(
            proof,
            "0d01fef81ad4d828dcf263f268d2906f4c965bcb3e93cef4ae7b216ebcac9830"
        )
        XCTAssertEqual(
            AppRuntimeToken.runtimeGenerationBearer(
                processIdentifier: 123,
                version: "2.16.5",
                ownerSecret: secret
            ),
            "airmcp_app_897599a80e1c449a8beeba036882deeeb1c801e7498a30f0b0d4cb7a4f101197"
        )
        XCTAssertTrue(
            AppRuntimeToken.runtimeResponseProofIsValid(
                "721f568c5c0e8e25925b047509c4a14c6e9e85b412466219e1d86e853d302fef",
                nonce: nonce,
                processIdentifier: 123,
                version: "2.16.5",
                method: "POST",
                path: "/mcp",
                ownerSecret: secret
            )
        )
        XCTAssertFalse(
            AppRuntimeToken.runtimeResponseProofIsValid(
                "721f568c5c0e8e25925b047509c4a14c6e9e85b412466219e1d86e853d302fef",
                nonce: nonce,
                processIdentifier: 123,
                version: "2.16.5",
                method: "DELETE",
                path: "/mcp",
                ownerSecret: secret
            )
        )

        let challenge = AppRuntimeIdentityChallenge(
            status: "ok",
            version: "2.16.5",
            appOwned: true,
            pid: 123,
            proof: proof,
            responseProof: "hmac-sha256-v1"
        )
        XCTAssertTrue(
            AppRuntimeClient.identityChallengeIsValid(
                challenge,
                nonce: nonce,
                ownerSecret: secret,
                expectedVersion: "2.16.5"
            )
        )
        XCTAssertFalse(
            AppRuntimeClient.identityChallengeIsValid(
                AppRuntimeIdentityChallenge(
                    status: challenge.status,
                    version: challenge.version,
                    appOwned: challenge.appOwned,
                    pid: 124,
                    proof: challenge.proof,
                    responseProof: challenge.responseProof
                ),
                nonce: nonce,
                ownerSecret: secret,
                expectedVersion: "2.16.5"
            )
        )
        XCTAssertNil(
            AppRuntimeToken.listenerIdentityProof(
                nonce: "short",
                processIdentifier: 123,
                version: "2.16.5",
                ownerSecret: secret
            )
        )
        XCTAssertNil(
            AppRuntimeToken.runtimeGenerationBearer(
                processIdentifier: 1,
                version: "2.16.5",
                ownerSecret: secret
            )
        )
    }
}
