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
            events: [
                WidgetSnapshot.Event(
                    title: "Design Review",
                    start: Date(timeIntervalSince1970: 1_700_003_600),
                    end: Date(timeIntervalSince1970: 1_700_007_200),
                    isAllDay: false,
                    location: "Room A",
                    calendarColorHex: "#34C759"
                ),
            ],
            eventCount: 3,
            overdueReminderCount: 1,
            calendarAuthorized: true,
            reminderAuthorized: false
        )
    }

    func testAccessFlagsRoundTrip() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let decoded = try store.decode(try store.encode(sample()))
        XCTAssertTrue(decoded.calendarAuthorized)
        XCTAssertFalse(decoded.reminderAuthorized)
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

    func testCountsOnlyModeStripsTitlesBeforePersist() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let snap = sample(privacy: .countsOnly)
        // The writer redacts before persisting, so the encoded bytes carry no
        // event title or location.
        let json = String(data: try store.encode(snap), encoding: .utf8)!
        XCTAssertFalse(json.contains("Design Review"), "counts-only snapshot must not encode the event title")
        XCTAssertFalse(json.contains("Room A"), "counts-only snapshot must not encode the event location")
        let decoded = try store.decode(try store.encode(snap))
        XCTAssertNil(decoded.events.first?.title)
        XCTAssertNil(decoded.events.first?.location)
        // Counts and the time span survive redaction.
        XCTAssertEqual(decoded.eventCount, 3)
        XCTAssertEqual(decoded.overdueReminderCount, 1)
        XCTAssertEqual(decoded.events.count, 1)
        XCTAssertEqual(decoded.events.first?.start, Date(timeIntervalSince1970: 1_700_003_600))
    }

    func testTitlesModeKeepsTitle() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let decoded = try store.decode(try store.encode(sample(privacy: .titles)))
        XCTAssertEqual(decoded.events.first?.title, "Design Review")
        XCTAssertEqual(decoded.events.first?.location, "Room A")
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
    /// Checks the real leak markers (chain fields / credentials), not the bare
    /// word "audit" (a benign field like integrityVerifiedAt may reference it).
    func testEncodedSnapshotCarriesNoSecrets() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        var snap = sample()
        snap.trust = WidgetSnapshot.TrustSummary(
            hitlLevel: "sensitive-only",
            emergencyStopActive: false,
            pendingApprovalCount: 2,
            integrityVerifiedAt: gen
        )
        let json = String(data: try store.encode(snap), encoding: .utf8)!.lowercased()
        for forbidden in ["_hmac", "_prev", "bearer", "token", "secret", "password"] {
            XCTAssertFalse(json.contains(forbidden), "snapshot leaked a forbidden field: \(forbidden)")
        }
    }

    func testTrustSummaryRoundTrip() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        var snap = sample()
        snap.trust = WidgetSnapshot.TrustSummary(
            hitlLevel: "all-writes",
            emergencyStopActive: true,
            pendingApprovalCount: 3,
            integrityVerifiedAt: gen
        )
        let decoded = try store.decode(try store.encode(snap))
        XCTAssertEqual(decoded.trust?.hitlLevel, "all-writes")
        XCTAssertTrue(decoded.trust?.emergencyStopActive ?? false)
        XCTAssertEqual(decoded.trust?.pendingApprovalCount, 3)
        XCTAssertEqual(decoded.trust?.integrityVerifiedAt, gen)
    }

    func testTrustDefaultsToNil() throws {
        let store = WidgetSnapshotStore(appGroupID: "group.test")
        let decoded = try store.decode(try store.encode(sample()))
        XCTAssertNil(decoded.trust)
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
