import XCTest
@testable import AirMCPApp

final class TrustCenterRefreshPolicyTests: XCTestCase {
    func testAutomaticAuditHistoryReadIsNeverAllowed() {
        XCTAssertFalse(
            TrustCenterRefreshPolicy.allowsAuditHistoryRead(userInitiated: false)
        )
    }

    func testExplicitLoadOrRefreshAllowsOneAuditHistoryRead() {
        XCTAssertTrue(
            TrustCenterRefreshPolicy.allowsAuditHistoryRead(userInitiated: true)
        )
    }
}
