// AirMCPKit — MCPIntentRouter unit tests.
//
// The router is the shared entry point every generated AppIntent calls
// at perform() time (see swift/Sources/AirMCPKit/Generated/MCPIntents.swift).
// A host (macOS AirMCPApp, iOS AirMCPiOS) installs a handler; the
// generated intents invoke the router with `(tool:, args:)` and expect
// a String payload back. These tests cover the actor boundary + error
// paths so a regression in Swift 6 strict concurrency (the original
// motivation for the actor) or a handler miswiring surfaces early.

import XCTest
@testable import AirMCPKit

final class MCPIntentRouterTests: XCTestCase {

    override func tearDown() async throws {
        // Reset router state between tests so the shared singleton
        // doesn't leak a handler set by a previous test. No super
        // call — the default `XCTestCase.tearDown()` variants are
        // no-ops and inter-toolchain signature mismatches between
        // sync/async versions on older Xcodes would break CI.
        await MCPIntentRouter.shared.setHandler { _, _ in
            throw MCPIntentError.handlerNotInstalled(tool: "reset")
        }
    }

    // MARK: - Happy path

    func testCallRoundtripsHandlerOutput() async throws {
        await MCPIntentRouter.shared.setHandler { tool, args in
            return "called=\(tool) args=\(args.count)"
        }

        let result = try await MCPIntentRouter.shared.call(
            tool: "list_events",
            args: ["startDate": "2026-04-23T00:00:00Z", "limit": 50]
        )

        XCTAssertEqual(result, "called=list_events args=2")
    }

    func testCallWithEmptyArgs() async throws {
        await MCPIntentRouter.shared.setHandler { tool, args in
            XCTAssertTrue(args.isEmpty)
            return "ok:\(tool)"
        }

        let result = try await MCPIntentRouter.shared.call(tool: "today_events", args: [:])
        XCTAssertEqual(result, "ok:today_events")
    }

    // MARK: - Handler not installed

    func testCallWithoutHandlerThrowsSpecificError() async {
        // Can't easily construct a fresh MCPIntentRouter (it's a
        // singleton actor). Instead install a handler that re-throws
        // the canonical error to mimic the pre-launch state. A real
        // regression would surface here via a different error type
        // or a hang.
        await MCPIntentRouter.shared.setHandler { tool, _ in
            throw MCPIntentError.handlerNotInstalled(tool: tool)
        }

        do {
            _ = try await MCPIntentRouter.shared.call(tool: "foo", args: [:])
            XCTFail("expected handlerNotInstalled")
        } catch let MCPIntentError.handlerNotInstalled(tool) {
            XCTAssertEqual(tool, "foo")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    // MARK: - Error propagation

    func testHandlerThrowPropagates() async {
        let expected = MCPIntentError.toolCallFailed(tool: "search_notes", message: "backend down")
        await MCPIntentRouter.shared.setHandler { _, _ in throw expected }

        do {
            _ = try await MCPIntentRouter.shared.call(tool: "search_notes", args: [:])
            XCTFail("expected toolCallFailed")
        } catch let MCPIntentError.toolCallFailed(tool, message) {
            XCTAssertEqual(tool, "search_notes")
            XCTAssertEqual(message, "backend down")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    // MARK: - Handler replacement

    func testLastSetHandlerWins() async throws {
        await MCPIntentRouter.shared.setHandler { _, _ in "first" }
        await MCPIntentRouter.shared.setHandler { _, _ in "second" }

        let result = try await MCPIntentRouter.shared.call(tool: "x", args: [:])
        XCTAssertEqual(result, "second")
    }
}
