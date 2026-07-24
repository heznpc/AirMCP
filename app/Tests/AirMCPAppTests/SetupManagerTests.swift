import XCTest
@testable import AirMCPApp

final class SetupManagerTests: XCTestCase {
    func testNotificationConsentRequiresAnExplicitRuntimeStart() {
        XCTAssertFalse(
            RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(
                hitlLevel: .sensitiveOnly,
                userInitiated: false
            )
        )
        XCTAssertFalse(
            RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(
                hitlLevel: .off,
                userInitiated: true
            )
        )
        XCTAssertTrue(
            RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(
                hitlLevel: .sensitiveOnly,
                userInitiated: true
            )
        )
    }

    func testQuickSetupCopiesConfigurationOnlyForRunningRuntime() {
        XCTAssertTrue(SetupManager.runtimeReadyForConfiguration(.running))
        XCTAssertFalse(SetupManager.runtimeReadyForConfiguration(.stopped))
        XCTAssertFalse(SetupManager.runtimeReadyForConfiguration(.checking))
        XCTAssertFalse(
            SetupManager.runtimeReadyForConfiguration(.error("readiness failed"))
        )
    }
}
