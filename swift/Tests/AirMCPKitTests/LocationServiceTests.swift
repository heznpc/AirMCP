// AirMCPKit — CoreLocation service tests.

import XCTest
import CoreLocation
@testable import AirMCPKit

final class LocationServiceTests: XCTestCase {

    func testLocationStatusIncludesWhenInUseAuthorization() {
        #if os(iOS)
        XCTAssertEqual(locationStatusString(.authorizedWhenInUse), "authorized_when_in_use")
        #endif
        XCTAssertEqual(locationStatusString(.authorizedAlways), "authorized_always")
        XCTAssertEqual(locationStatusString(.notDetermined), "not_determined")
        XCTAssertEqual(locationStatusString(.denied), "denied")
        XCTAssertEqual(locationStatusString(.restricted), "restricted")
    }

    func testFetchTimeoutReturnsWithoutHanging() async {
        let fetcher = LocationFetcher()
        let started = Date()
        do {
            _ = try await fetcher.fetch(timeout: 0.1)
        } catch {
            // Permission-denied, unavailable, or timeout are all acceptable in CI.
            // The contract under test is that fetch returns instead of hanging.
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.0)
    }

    func testCancelledFetchReturnsPromptly() async {
        let fetcher = LocationFetcher()
        let started = Date()
        let task = Task {
            try await fetcher.fetch(timeout: 10)
        }

        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Cancelled location fetch should not succeed")
        } catch {
            // The contract under test is that cancellation resumes the checked
            // continuation promptly, even if the main-queue request has not started.
        }

        XCTAssertLessThan(Date().timeIntervalSince(started), 2.0)
    }
}
