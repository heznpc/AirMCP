import Foundation
import XCTest
@testable import AirMCPApp

private actor ProgressiveRequestRecorder {
    struct Request: Sendable, Equatable {
        let method: String
        let tool: String?
        let target: String?
        let delegatedSessionID: String?
        let ttlSeconds: Int?
        let mcpSessionID: String?
        let runID: String?
        let token: String
    }

    private(set) var requests: [Request] = []
    private(set) var closes: [(sessionID: String, token: String)] = []

    func append(_ request: Request) {
        requests.append(request)
    }

    func appendClose(sessionID: String, token: String) {
        closes.append((sessionID, token))
    }
}

final class AppRuntimeProgressiveSessionTests: XCTestCase {
    private let mcpSessionID = "mcp-session-1"
    private let token = "owner-only-runtime-token"

    func testPolicyOutlivesMaximumApprovalWaitWhileRemainingBounded() {
        XCTAssertEqual(AppRuntimeProgressiveSessionPolicy.maximumApprovalWaitSeconds, 120)
        XCTAssertEqual(AppRuntimeProgressiveSessionPolicy.executionHeadroomSeconds, 30)
        XCTAssertEqual(
            AppRuntimeProgressiveSessionPolicy.toolSessionTTLSeconds,
            AppRuntimeProgressiveSessionPolicy.maximumApprovalWaitSeconds
                + AppRuntimeProgressiveSessionPolicy.executionHeadroomSeconds
        )
        XCTAssertGreaterThan(
            AppRuntimeProgressiveSessionPolicy.toolSessionTTLSeconds,
            AppRuntimeProgressiveSessionPolicy.maximumApprovalWaitSeconds
        )
        XCTAssertLessThanOrEqual(AppRuntimeProgressiveSessionPolicy.toolSessionTTLSeconds, 180)
        XCTAssertGreaterThanOrEqual(
            AppRuntimeProgressiveSessionPolicy.delegatedCallTimeout,
            TimeInterval(AppRuntimeProgressiveSessionPolicy.maximumApprovalWaitSeconds * 2)
        )
    }

    func testHiddenToolUsesOneAuthenticatedMCPSessionAndCleansToolSession() async throws {
        let recorder = ProgressiveRequestRecorder()
        let runID = UUID().uuidString.lowercased()
        let toolSessionID = UUID().uuidString.lowercased()

        let response = try await runAppRuntimeProgressiveToolCall(
            "audit_log",
            args: ["limit": 25],
            runID: runID,
            token: token,
            post: makePost(recorder: recorder, toolSessionID: toolSessionID),
            close: { sessionID, token in
                await recorder.appendClose(sessionID: sessionID, token: token)
            }
        )

        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let structured = try XCTUnwrap(result["structuredContent"] as? [String: Any])
        XCTAssertEqual(structured["returned"] as? Int, 1)

        let requests = await recorder.requests
        XCTAssertEqual(requests.map(\.method), [
            "initialize",
            "notifications/initialized",
            "tools/call",
            "tools/call",
            "tools/call",
        ])
        XCTAssertEqual(requests.compactMap(\.tool), [
            "start_tool_session",
            "run_tool",
            "end_tool_session",
        ])
        XCTAssertEqual(requests[2].target, "audit_log")
        XCTAssertEqual(
            requests[2].ttlSeconds,
            AppRuntimeProgressiveSessionPolicy.toolSessionTTLSeconds
        )
        XCTAssertEqual(requests[3].target, "audit_log")
        XCTAssertEqual(requests[3].delegatedSessionID, toolSessionID)
        XCTAssertEqual(requests[4].delegatedSessionID, toolSessionID)
        XCTAssertTrue(requests.allSatisfy { $0.token == token })
        XCTAssertNil(requests[0].mcpSessionID)
        XCTAssertTrue(requests.dropFirst().allSatisfy { $0.mcpSessionID == mcpSessionID })
        XCTAssertTrue(requests.prefix(2).allSatisfy { $0.runID == nil })
        XCTAssertTrue(requests.suffix(3).allSatisfy { $0.runID == runID })

        let closes = await recorder.closes
        XCTAssertEqual(closes.count, 1)
        XCTAssertEqual(closes.first?.sessionID, mcpSessionID)
        XCTAssertEqual(closes.first?.token, token)
    }

    func testDelegatedTransportFailureStillEndsToolSessionAndClosesMCP() async throws {
        let recorder = ProgressiveRequestRecorder()
        let runID = UUID().uuidString.lowercased()
        let toolSessionID = UUID().uuidString.lowercased()
        let successfulPost = makePost(recorder: recorder, toolSessionID: toolSessionID)

        do {
            _ = try await runAppRuntimeProgressiveToolCall(
                "audit_log",
                args: [:],
                runID: runID,
                token: token,
                post: { payload, token, sessionID, requestRunID, allowsEmptyResponse, timeoutInterval in
                    let params = payload["params"] as? [String: Any]
                    if params?["name"] as? String == "run_tool" {
                        _ = try await successfulPost(
                            payload,
                            token,
                            sessionID,
                            requestRunID,
                            allowsEmptyResponse,
                            timeoutInterval
                        )
                        throw URLError(.networkConnectionLost)
                    }
                    return try await successfulPost(
                        payload,
                        token,
                        sessionID,
                        requestRunID,
                        allowsEmptyResponse,
                        timeoutInterval
                    )
                },
                close: { sessionID, token in
                    await recorder.appendClose(sessionID: sessionID, token: token)
                }
            )
            XCTFail("Expected the uncertain delegated call to fail")
        } catch {
            // The public behavior is the failure; exact private transport
            // error shape is intentionally not part of the test contract.
        }

        let requests = await recorder.requests
        XCTAssertEqual(requests.compactMap(\.tool), [
            "start_tool_session",
            "run_tool",
            "end_tool_session",
        ])
        XCTAssertEqual(requests.last?.delegatedSessionID, toolSessionID)
        XCTAssertEqual(requests.last?.runID, runID)

        let closes = await recorder.closes
        XCTAssertEqual(closes.count, 1)
        XCTAssertEqual(closes.first?.sessionID, mcpSessionID)
        XCTAssertEqual(closes.first?.token, token)
    }

    func testCleanupFailureKeepsDefinitiveResultAndDoesNotRepeatDelegatedCall() async throws {
        let recorder = ProgressiveRequestRecorder()
        let runID = UUID().uuidString.lowercased()
        let toolSessionID = UUID().uuidString.lowercased()
        let successfulPost = makePost(recorder: recorder, toolSessionID: toolSessionID)

        let response = try await runAppRuntimeProgressiveToolCall(
            "audit_log",
            args: ["limit": 25],
            runID: runID,
            token: token,
            post: { payload, token, sessionID, requestRunID, allowsEmptyResponse, timeoutInterval in
                let params = payload["params"] as? [String: Any]
                if params?["name"] as? String == "end_tool_session" {
                    _ = try await successfulPost(
                        payload,
                        token,
                        sessionID,
                        requestRunID,
                        allowsEmptyResponse,
                        timeoutInterval
                    )
                    throw URLError(.networkConnectionLost)
                }
                return try await successfulPost(
                    payload,
                    token,
                    sessionID,
                    requestRunID,
                    allowsEmptyResponse,
                    timeoutInterval
                )
            },
            close: { sessionID, token in
                await recorder.appendClose(sessionID: sessionID, token: token)
            }
        )

        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let structured = try XCTUnwrap(result["structuredContent"] as? [String: Any])
        XCTAssertEqual(structured["returned"] as? Int, 1)

        let requests = await recorder.requests
        XCTAssertEqual(requests.filter { $0.tool == "run_tool" }.count, 1)
        XCTAssertEqual(
            requests.first { $0.tool == "start_tool_session" }?.ttlSeconds,
            AppRuntimeProgressiveSessionPolicy.toolSessionTTLSeconds
        )
        XCTAssertEqual(requests.last?.tool, "end_tool_session")
        XCTAssertEqual(requests.last?.runID, runID)

        let closes = await recorder.closes
        XCTAssertEqual(closes.count, 1)
        XCTAssertEqual(closes.first?.sessionID, mcpSessionID)
    }

    private func makePost(
        recorder: ProgressiveRequestRecorder,
        toolSessionID: String
    ) -> AppRuntimeMCPPost {
        { [mcpSessionID] payload, token, sessionID, runID, _, _ in
            let method = payload["method"] as? String ?? ""
            let params = payload["params"] as? [String: Any]
            let tool = params?["name"] as? String
            let arguments = params?["arguments"] as? [String: Any]
            let target: String?
            if tool == "start_tool_session" {
                target = (arguments?["tools"] as? [String])?.first
            } else if tool == "run_tool" {
                target = arguments?["name"] as? String
            } else {
                target = nil
            }
            await recorder.append(.init(
                method: method,
                tool: tool,
                target: target,
                delegatedSessionID: arguments?["sessionId"] as? String,
                ttlSeconds: arguments?["ttlSeconds"] as? Int,
                mcpSessionID: sessionID,
                runID: runID,
                token: token
            ))

            switch (method, tool) {
            case ("initialize", _):
                return (["jsonrpc": "2.0", "id": 1, "result": [:] as [String: Any]], mcpSessionID)
            case ("notifications/initialized", _):
                return ([:], nil)
            case ("tools/call", "start_tool_session"):
                return (toolResult([
                    "sessionId": toolSessionID,
                    "allowedTools": ["audit_log"],
                ]), nil)
            case ("tools/call", "run_tool"):
                return (toolResult(["returned": 1]), nil)
            case ("tools/call", "end_tool_session"):
                return (toolResult(["sessionId": toolSessionID, "ended": true]), nil)
            default:
                XCTFail("Unexpected request: \(method) \(tool ?? "")")
                return ([:], nil)
            }
        }
    }
}

private func toolResult(_ structuredContent: [String: Any]) -> [String: Any] {
    [
        "jsonrpc": "2.0",
        "id": 1,
        "result": [
            "content": [["type": "text", "text": "{}"]],
            "structuredContent": structuredContent,
        ],
    ]
}
