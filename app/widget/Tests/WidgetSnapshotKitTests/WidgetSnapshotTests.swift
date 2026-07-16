import XCTest
@testable import WidgetSnapshotKit

final class WidgetSnapshotTests: XCTestCase {
    // Whole-second dates so ISO8601 round-trips exactly.
    private let gen = Date(timeIntervalSince1970: 1_700_000_000)
    private let stale = Date(timeIntervalSince1970: 1_700_001_800) // +30 min

    private func sample(privacy: WidgetSnapshot.PrivacyMode = .titles) -> WidgetSnapshot {
        WidgetSnapshot(
            generatedAt: gen,
            staleAt: stale,
            privacyMode: privacy,
            runtimeStatus: .running,
            eventCount: 3,
            overdueReminderCount: 1,
            nextEventTitle: "Design Review",
            nextEventTime: Date(timeIntervalSince1970: 1_700_003_600)
        )
    }

    func testEncodeDecodeRoundTrip() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let snap = sample()
        let decoded = try store.decode(try store.encode(snap))
        XCTAssertEqual(decoded, snap)
    }

    func testStaleness() {
        let snap = sample()
        XCTAssertFalse(snap.isStale(now: Date(timeIntervalSince1970: 1_700_000_500)))
        XCTAssertTrue(snap.isStale(now: Date(timeIntervalSince1970: 1_700_002_000)))
        // Boundary: staleAt itself counts as stale.
        XCTAssertTrue(snap.isStale(now: stale))
    }

    func testCountsOnlyModeStripsTitleBeforePersist() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let snap = sample(privacy: .countsOnly)
        // The writer redacts before persisting, so the encoded bytes carry no title.
        let json = String(data: try store.encode(snap), encoding: .utf8)!
        XCTAssertFalse(json.contains("Design Review"), "counts-only snapshot must not encode the event title")
        let decoded = try store.decode(try store.encode(snap))
        XCTAssertNil(decoded.nextEventTitle)
        // Counts survive redaction.
        XCTAssertEqual(decoded.eventCount, 3)
        XCTAssertEqual(decoded.overdueReminderCount, 1)
    }

    func testTitlesModeKeepsTitle() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let decoded = try store.decode(try store.encode(sample(privacy: .titles)))
        XCTAssertEqual(decoded.nextEventTitle, "Design Review")
    }

    func testAtomicFileRoundTrip() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("snap-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try store.write(sample(), to: url)
        XCTAssertEqual(try store.read(from: url), sample())
    }

    /// Security invariant: the snapshot must NEVER carry the runtime bearer
    /// token or a copy of the HMAC audit chain — only glanceable summary data.
    func testEncodedSnapshotCarriesNoSecrets() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let json = String(data: try store.encode(sample()), encoding: .utf8)!.lowercased()
        for forbidden in ["token", "hmac", "audit", "bearer", "secret", "_prev"] {
            XCTAssertFalse(json.contains(forbidden), "snapshot leaked a forbidden field: \(forbidden)")
        }
    }

    func testRejectsNewerVersion() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        var snap = sample()
        snap.version = WidgetSnapshot.currentVersion + 1
        let data = try WidgetSnapshotStore(appGroupID: "group.test").encode(snap)
        XCTAssertThrowsError(try store.decode(data)) { err in
            XCTAssertEqual(err as? WidgetSnapshotError, .unsupportedVersion(WidgetSnapshot.currentVersion + 1))
        }
    }
}
