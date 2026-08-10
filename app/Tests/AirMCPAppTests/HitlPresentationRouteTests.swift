import UserNotifications
import XCTest
@testable import AirMCPApp

/// Records authorization interactions without touching UNUserNotificationCenter,
/// which cannot be constructed in a unit-test bundle.
private actor FakeAuthorizer: HitlNotificationAuthorizing {
    let status: UNAuthorizationStatus
    let grantsOnRequest: Bool
    private(set) var authorizationRequestCount = 0

    init(status: UNAuthorizationStatus, grantsOnRequest: Bool = false) {
        self.status = status
        self.grantsOnRequest = grantsOnRequest
    }

    func authorizationStatus() async -> UNAuthorizationStatus { status }

    func requestAuthorization() async -> Bool {
        authorizationRequestCount += 1
        return grantsOnRequest
    }
}

final class HitlPresentationRouteTests: XCTestCase {

    // MARK: - Pure status → route mapping

    func testAuthorizedStatusesRouteToNotification() {
        XCTAssertEqual(
            HitlManager.presentationRoute(for: .authorized),
            .present(.notification)
        )
        XCTAssertEqual(
            HitlManager.presentationRoute(for: .provisional),
            .present(.notification)
        )
    }

    func testNotDeterminedRoutesToAuthorizationRequestNotSilentDrop() {
        // The original bug: with .notDetermined authorization the notification
        // was posted anyway, silently dropped, and the request timed out
        // unseen. .notDetermined must never route straight to a notification.
        XCTAssertEqual(
            HitlManager.presentationRoute(for: .notDetermined),
            .requestAuthorization
        )
    }

    func testDeniedRoutesToVisualFallback() {
        XCTAssertEqual(
            HitlManager.presentationRoute(for: .denied),
            .present(.visualFallback)
        )
    }

    // MARK: - Post-authorization-request mapping

    func testGrantedAuthorizationPresentsNotification() {
        XCTAssertEqual(
            HitlManager.presentation(afterAuthorizationGranted: true),
            .notification
        )
    }

    func testRefusedAuthorizationPresentsVisualFallback() {
        // Approval must never become impossible just because the user said no
        // to notifications — the in-app UI is the guaranteed floor.
        XCTAssertEqual(
            HitlManager.presentation(afterAuthorizationGranted: false),
            .visualFallback
        )
    }

    // MARK: - End-to-end resolution over the seam

    func testAuthorizedResolvesWithoutPromptingForPermission() async {
        let authorizer = FakeAuthorizer(status: .authorized)
        let presentation = await HitlManager.resolvePresentation(using: authorizer)
        XCTAssertEqual(presentation, .notification)
        let requests = await authorizer.authorizationRequestCount
        XCTAssertEqual(requests, 0)
    }

    func testDeniedResolvesToFallbackWithoutPromptingForPermission() async {
        let authorizer = FakeAuthorizer(status: .denied)
        let presentation = await HitlManager.resolvePresentation(using: authorizer)
        XCTAssertEqual(presentation, .visualFallback)
        let requests = await authorizer.authorizationRequestCount
        XCTAssertEqual(requests, 0)
    }

    func testNotDeterminedPromptsOnceAndPostsWhenGranted() async {
        let authorizer = FakeAuthorizer(status: .notDetermined, grantsOnRequest: true)
        let presentation = await HitlManager.resolvePresentation(using: authorizer)
        XCTAssertEqual(presentation, .notification)
        let requests = await authorizer.authorizationRequestCount
        XCTAssertEqual(requests, 1)
    }

    func testNotDeterminedPromptsOnceAndFallsBackWhenRefused() async {
        let authorizer = FakeAuthorizer(status: .notDetermined, grantsOnRequest: false)
        let presentation = await HitlManager.resolvePresentation(using: authorizer)
        XCTAssertEqual(presentation, .visualFallback)
        let requests = await authorizer.authorizationRequestCount
        XCTAssertEqual(requests, 1)
    }

    // MARK: - Menu-bar icon state (pure derivation from pending count)
    //
    // This covers only the logic: "does the icon state flip when there's a
    // pending request". Whether the glyph actually renders distinctly and
    // whether NSSound audibly plays in HitlManager's visual-fallback branch
    // are both device-only — no simulator/headless check exists for either,
    // so they are NOT covered here and must be confirmed on a real run.

    func testZeroPendingIsIdleIcon() {
        XCTAssertEqual(HitlManager.menuBarIconState(pendingCount: 0), .idle)
        XCTAssertEqual(HitlManager.MenuBarIconState.idle.systemImageName, "a.square.fill")
    }

    func testAnyPendingIsAlertIcon() {
        XCTAssertEqual(HitlManager.menuBarIconState(pendingCount: 1), .pendingApproval)
        XCTAssertEqual(HitlManager.menuBarIconState(pendingCount: 5), .pendingApproval)
        XCTAssertEqual(HitlManager.MenuBarIconState.pendingApproval.systemImageName, "exclamationmark.circle.fill")
    }

    func testIconStateIsNotConflatedWithPresentationChannel() {
        // The icon must flip on pending count alone, independent of whether
        // that specific request is being shown via notification or the
        // visual fallback — it is a supplementary signal, not a replacement
        // for either, and must not silently depend on which channel a given
        // request happened to route through.
        XCTAssertEqual(HitlManager.menuBarIconState(pendingCount: 1), .pendingApproval)
    }
}
