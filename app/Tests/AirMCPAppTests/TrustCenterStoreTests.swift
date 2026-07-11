import Foundation
import XCTest
@testable import AirMCPApp

@MainActor
final class TrustCenterStoreTests: XCTestCase {
    func testPendingApprovalBypassesSearchAndStatusFilters() {
        let store = TrustCenterStore()
        store.statusFilter = .succeeded
        store.searchText = "a query that cannot match"

        let pending = GovernedRun(
            id: "pending-run",
            correlationId: "pending-run",
            entries: [],
            pendingApprovals: [
                LivePendingApproval(
                    id: "approval-1",
                    correlationId: "pending-run",
                    tool: "audit_log",
                    args: [:],
                    destructive: false,
                    sensitive: false,
                    openWorld: false,
                    timestamp: Date()
                ),
            ],
            liveApproval: nil
        )
        let ordinary = GovernedRun(
            id: "ordinary-run",
            correlationId: "ordinary-run",
            entries: [],
            pendingApprovals: [],
            liveApproval: nil
        )

        let visible = store.visibleRunsPreservingPending(from: [ordinary, pending])
        XCTAssertEqual(visible.map(\.id), ["pending-run"])
    }

    func testPendingApprovalIsNotDuplicatedWhenItAlsoMatchesFilters() {
        let store = TrustCenterStore()
        let pending = GovernedRun(
            id: "pending-run",
            correlationId: "pending-run",
            entries: [],
            pendingApprovals: [
                LivePendingApproval(
                    id: "approval-1",
                    correlationId: "pending-run",
                    tool: "audit_log",
                    args: [:],
                    destructive: false,
                    sensitive: false,
                    openWorld: false,
                    timestamp: Date()
                ),
            ],
            liveApproval: nil
        )

        let visible = store.visibleRunsPreservingPending(from: [pending])
        XCTAssertEqual(visible.map(\.id), ["pending-run"])
    }

    func testPendingApprovalStaysAheadOfNewerHistory() {
        let store = TrustCenterStore()
        let now = Date()
        let pending = GovernedRun(
            id: "pending-run",
            correlationId: "pending-run",
            entries: [],
            pendingApprovals: [
                LivePendingApproval(
                    id: "approval-1",
                    correlationId: "pending-run",
                    tool: "audit_log",
                    args: [:],
                    destructive: false,
                    sensitive: false,
                    openWorld: false,
                    timestamp: now
                ),
            ],
            liveApproval: nil
        )
        let newerHistory = GovernedRun(
            id: "newer-history",
            correlationId: "newer-history",
            entries: [],
            pendingApprovals: [],
            liveApproval: LiveApprovalRecord(
                id: "recent-1",
                correlationId: "newer-history",
                tool: "search_notes",
                status: .approved,
                timestamp: now.addingTimeInterval(60)
            )
        )

        let visible = store.visibleRunsPreservingPending(from: [newerHistory, pending])
        XCTAssertEqual(visible.map(\.id), ["pending-run", "newer-history"])
    }
}
