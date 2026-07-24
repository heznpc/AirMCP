import Foundation
import XCTest
@testable import AirMCPApp

final class ConfigManagerScopeTransactionTests: XCTestCase {
    private var directory: URL!
    private var configURL: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "airmcp-scope-config-\(UUID().uuidString)",
            isDirectory: true
        )
        configURL = directory.appendingPathComponent("config.json")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        configURL = nil
    }

    @MainActor
    func testScopeTransactionVerifiesExactBytesAndRollsBackOriginal() throws {
        let original = Data(
            """
            {
              "profile": "starter",
              "toolExposure": "progressive",
              "disabledModules": ["calendar"],
              "futureOwnerField": {"keep": true}
            }
            """.utf8
        )
        try original.write(to: configURL)
        let backupURL = configURL.appendingPathExtension("backup")
        let originalBackup = Data("owner-backup-before-setup".utf8)
        try originalBackup.write(to: backupURL)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o640)],
            ofItemAtPath: configURL.path
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600)],
            ofItemAtPath: backupURL.path
        )
        let manager = ConfigManager(configFile: configURL)
        let scope = OnboardingRuntimeScope(
            workflowID: "meeting-prep",
            disabledModules: ["mail", "notes"]
        )

        let transaction = try XCTUnwrap(
            manager.beginOnboardingRuntimeScopeTransaction(scope)
        )
        XCTAssertTrue(manager.isOnboardingRuntimeScopePersisted(scope))
        let saved = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as? [String: Any]
        )
        XCTAssertEqual(saved["profile"] as? String, "custom")
        XCTAssertEqual(saved["onboardingWorkflow"] as? String, "meeting-prep")
        XCTAssertEqual(saved["disabledModules"] as? [String], ["mail", "notes"])
        XCTAssertNotNil(saved["futureOwnerField"])

        XCTAssertTrue(manager.rollbackOnboardingRuntimeScope(transaction))
        XCTAssertEqual(try Data(contentsOf: configURL), original)
        XCTAssertEqual(try Data(contentsOf: backupURL), originalBackup)
        let mode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: configURL.path)[.posixPermissions]
                as? NSNumber
        ).intValue & 0o777
        XCTAssertEqual(mode, 0o640)
        let backupMode = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: backupURL.path)[.posixPermissions]
                as? NSNumber
        ).intValue & 0o777
        XCTAssertEqual(backupMode, 0o600)
    }

    @MainActor
    func testMalformedConfigFailsClosedWithoutMutation() throws {
        let malformed = Data("{not-json".utf8)
        try malformed.write(to: configURL)
        let manager = ConfigManager(configFile: configURL)
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: ["mail"]
        )

        XCTAssertNil(manager.beginOnboardingRuntimeScopeTransaction(scope))
        XCTAssertEqual(try Data(contentsOf: configURL), malformed)
        XCTAssertNotNil(manager.lastPersistenceError)
    }

    @MainActor
    func testNewConfigRollbackRestoresFileAbsence() throws {
        let manager = ConfigManager(configFile: configURL)
        let scope = OnboardingRuntimeScope(
            workflowID: "daily-briefing",
            disabledModules: ["mail"]
        )

        let transaction = try XCTUnwrap(
            manager.beginOnboardingRuntimeScopeTransaction(scope)
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: configURL.path))
        XCTAssertTrue(manager.rollbackOnboardingRuntimeScope(transaction))
        XCTAssertFalse(FileManager.default.fileExists(atPath: configURL.path))
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: configURL.appendingPathExtension("backup").path)
        )
    }
}
