import XCTest
@testable import AirMCPApp
import WidgetSnapshotKit

final class WidgetSnapshotWriterTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("airmcp-writer-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func writeConfig(_ json: String) throws {
        try json.data(using: .utf8)!.write(to: dir.appendingPathComponent("config.json"))
    }

    func testReadsHitlLevelFromConfig() throws {
        try writeConfig(#"{"hitl":{"level":"all-writes"}}"#)
        XCTAssertEqual(WidgetSnapshotWriter.readHitlLevel(configDir: dir), "all-writes")
    }

    func testHitlLevelDefaultsWhenMissingOrUnparsable() throws {
        // No config file at all.
        XCTAssertEqual(WidgetSnapshotWriter.readHitlLevel(configDir: dir), "sensitive-only")
        // Present but no hitl block.
        try writeConfig(#"{"profile":"full"}"#)
        XCTAssertEqual(WidgetSnapshotWriter.readHitlLevel(configDir: dir), "sensitive-only")
        // Garbage.
        try writeConfig("not json")
        XCTAssertEqual(WidgetSnapshotWriter.readHitlLevel(configDir: dir), "sensitive-only")
    }

    func testEmergencyStopReflectsFilePresence() throws {
        XCTAssertFalse(WidgetSnapshotWriter.emergencyStopActive(configDir: dir))
        try Data().write(to: dir.appendingPathComponent("emergency-stop"))
        XCTAssertTrue(WidgetSnapshotWriter.emergencyStopActive(configDir: dir))
    }

    func testGovernanceStateAssemblesCountsAndFlags() throws {
        try writeConfig(#"{"hitl":{"level":"destructive-only"}}"#)
        try Data().write(to: dir.appendingPathComponent("emergency-stop"))
        let trust = WidgetSnapshotWriter.governanceState(pendingApprovalCount: 4, configDir: dir)
        XCTAssertEqual(trust.hitlLevel, "destructive-only")
        XCTAssertTrue(trust.emergencyStopActive)
        XCTAssertEqual(trust.pendingApprovalCount, 4)
        XCTAssertNil(trust.integrityVerifiedAt)
    }
}
