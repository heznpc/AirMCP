import Foundation
import Network
import UserNotifications
import XCTest
@testable import AirMCPApp

/// Keep presentation suspended until teardown, without any system notification
/// center, permission prompt, sound, or app window participating in socket tests.
private actor SuspendedHitlAuthorizer: HitlNotificationAuthorizing {
    private var continuations: [CheckedContinuation<UNAuthorizationStatus, Never>] = []
    private var finished = false

    func authorizationStatus() async -> UNAuthorizationStatus {
        if finished { return .denied }
        return await withCheckedContinuation { continuations.append($0) }
    }

    func requestAuthorization() async -> Bool { false }

    func finish() {
        finished = true
        for continuation in continuations { continuation.resume(returning: .denied) }
        continuations.removeAll()
    }
}

final class HitlRuntimeLifecycleTests: XCTestCase {
    @MainActor
    private func waitUntil(timeoutMilliseconds: Int = 1000, _ condition: () -> Bool) async throws {
        for _ in 0..<(timeoutMilliseconds / 10) {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("HITL runtime did not reach the expected state")
    }

    @MainActor
    private func connectedManager(timeoutSeconds: Int = 120) async throws -> (URL, HitlManager, NWConnection) {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hitl-\(UUID().uuidString.prefix(8))")
        let socketPath = directory.appendingPathComponent("s").path
        let manager = HitlManager(socketPath: socketPath)
        manager.applyConfiguration(level: .all, timeoutSeconds: timeoutSeconds)
        try await waitUntil { FileManager.default.fileExists(atPath: socketPath) }
        let parameters = NWParameters()
        parameters.defaultProtocolStack.transportProtocol = NWProtocolTCP.Options()
        let client = NWConnection(to: .unix(path: socketPath), using: parameters)
        client.start(queue: .main)
        try await waitUntil { manager.state == .connected }
        return (directory, manager, client)
    }

    @MainActor
    private func sendApproval(id: String, on client: NWConnection, to manager: HitlManager) async throws {
        let data = Data("{\"id\":\"\(id)\",\"type\":\"hitl_request\",\"tool\":\"synthetic_write\",\"args\":{}}\n".utf8)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            client.send(content: data, completion: .contentProcessed { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            })
        }
        try await waitUntil { manager.pendingRequests.contains(where: { $0.id == id }) }
    }

    @MainActor
    func testDisablingWithAConnectedClientStaysIdleAfterReceiveCancellation() async throws {
        let (directory, manager, client) = try await connectedManager()
        defer {
            client.cancel()
            manager.stopListening()
            try? FileManager.default.removeItem(at: directory)
        }
        manager.applyConfiguration(level: .off, timeoutSeconds: 120)
        XCTAssertEqual(manager.state, .idle)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(manager.state, .idle)
        XCTAssertTrue(manager.pendingRequests.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("s").path))
    }

    @MainActor
    func testReenabledListenerIgnoresThePreviousClientsCallbacks() async throws {
        let (directory, manager, previousClient) = try await connectedManager()
        defer {
            previousClient.cancel()
            manager.stopListening()
            try? FileManager.default.removeItem(at: directory)
        }
        manager.applyConfiguration(level: .off, timeoutSeconds: 120)
        manager.applyConfiguration(level: .all, timeoutSeconds: 120)
        let socketPath = directory.appendingPathComponent("s").path
        try await waitUntil { FileManager.default.fileExists(atPath: socketPath) }
        let parameters = NWParameters()
        parameters.defaultProtocolStack.transportProtocol = NWProtocolTCP.Options()
        let currentClient = NWConnection(to: .unix(path: socketPath), using: parameters)
        defer { currentClient.cancel() }
        currentClient.start(queue: .main)
        try await waitUntil { manager.state == .connected }
        previousClient.cancel()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(manager.state, .connected)
        XCTAssertTrue(manager.pendingRequests.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: socketPath))
    }

    @MainActor
    func testShorteningTimeoutExpiresAnAlreadyOlderPendingRequest() async throws {
        let (directory, manager, client) = try await connectedManager(timeoutSeconds: 5)
        let authorizer = SuspendedHitlAuthorizer()
        manager.notificationAuthorizer = authorizer
        manager.notificationRemover = { _ in }
        defer {
            manager.stopListening()
            client.cancel()
            Task { await authorizer.finish() }
            try? FileManager.default.removeItem(at: directory)
        }
        try await sendApproval(id: "shorten", on: client, to: manager)
        try await Task.sleep(for: .milliseconds(1200))
        manager.applyConfiguration(level: .all, timeoutSeconds: 1)
        // Its original age already exceeds the new timeout. Do not grant a new
        // one-second approval window from the moment the setting changed.
        try await waitUntil(timeoutMilliseconds: 500) { manager.pendingRequests.isEmpty }
        XCTAssertEqual(manager.recentRequests.first?.id, "shorten")
        XCTAssertEqual(manager.recentRequests.first?.reason, .timedOut)
        XCTAssertEqual(manager.recentRequests.first?.approved, false)
    }

    @MainActor
    func testExtendingTimeoutInvalidatesThePreviousTimerAndKeepsTheOriginalAge() async throws {
        let (directory, manager, client) = try await connectedManager(timeoutSeconds: 2)
        let authorizer = SuspendedHitlAuthorizer()
        manager.notificationAuthorizer = authorizer
        manager.notificationRemover = { _ in }
        defer {
            manager.stopListening()
            client.cancel()
            Task { await authorizer.finish() }
            try? FileManager.default.removeItem(at: directory)
        }
        try await sendApproval(id: "extend", on: client, to: manager)
        let timestamp = try XCTUnwrap(manager.pendingRequests.first?.timestamp)
        try await Task.sleep(for: .milliseconds(1200))
        manager.applyConfiguration(level: .all, timeoutSeconds: 3)
        try await Task.sleep(for: .milliseconds(1000))
        XCTAssertEqual(manager.pendingRequests.map(\.id), ["extend"], "The superseded two-second timer must not deny the request")
        XCTAssertTrue(manager.recentRequests.isEmpty)
        try await waitUntil(timeoutMilliseconds: 1200) { manager.pendingRequests.isEmpty }
        XCTAssertLessThan(Date().timeIntervalSince(timestamp), 3.8, "Extending the timeout must preserve the original request age")
        XCTAssertEqual(manager.recentRequests.map(\.id), ["extend"])
        XCTAssertEqual(manager.recentRequests.first?.reason, .timedOut)
        XCTAssertEqual(manager.recentRequests.first?.approved, false)
    }

    @MainActor
    func testSettingsChangesReconfigureTheLiveListenerWithoutAnyView() async throws {
        // Short, disposable Unix path: no real app config or notification center.
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hitl-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = ConfigManager(configFile: directory.appendingPathComponent("config.json"))
        config.hitlLevel = .off
        let socketPath = directory.appendingPathComponent("s").path
        let manager = HitlManager(socketPath: socketPath)
        defer { manager.stopListening() }
        var applied: [HitlLevel] = []
        let controller = HitlRuntimeController(
            readConfiguration: { .init(level: config.hitlLevel, timeoutSeconds: config.hitlTimeout) },
            applyConfiguration: {
                applied.append($0.level)
                manager.applyConfiguration(level: $0.level, timeoutSeconds: $0.timeoutSeconds)
            },
            respond: { _, _ in },
            notificationCenter: NotificationCenter()
        )
        controller.start()
        XCTAssertEqual(manager.state, .idle)

        config.hitlLevel = .sensitiveOnly
        try await waitUntil { manager.state == .listening && FileManager.default.fileExists(atPath: socketPath) }
        config.hitlTimeout = 45
        try await waitUntil { manager.timeoutSeconds == 45 }
        config.hitlLevel = .all
        try await waitUntil { applied.last == .all }
        XCTAssertEqual(manager.state, .listening)

        config.hitlLevel = .off
        try await waitUntil { manager.state == .idle }
        XCTAssertFalse(FileManager.default.fileExists(atPath: socketPath))
        config.hitlLevel = .destructiveOnly
        try await waitUntil { manager.state == .listening && FileManager.default.fileExists(atPath: socketPath) }
        // Let the old listener's queued cancellation arrive; it must not stop
        // the newly enabled listener.
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(manager.state, .listening)
    }

    @MainActor
    func testRapidDisableEnableIgnoresThePreviousListenersCancellation() async throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hitl-\(UUID().uuidString.prefix(8))")
        defer { try? FileManager.default.removeItem(at: directory) }
        let socketPath = directory.appendingPathComponent("s").path
        let manager = HitlManager(socketPath: socketPath)
        defer { manager.stopListening() }
        manager.applyConfiguration(level: .all, timeoutSeconds: 120)
        try await waitUntil { manager.state == .listening && FileManager.default.fileExists(atPath: socketPath) }
        manager.applyConfiguration(level: .off, timeoutSeconds: 120)
        manager.applyConfiguration(level: .all, timeoutSeconds: 30)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(manager.state, .listening)
        XCTAssertTrue(FileManager.default.fileExists(atPath: socketPath))
        XCTAssertEqual(manager.timeoutSeconds, 30)
    }

    @MainActor
    func testNotificationActionsAreReceivedWithoutConstructingMenuContent() async throws {
        let center = NotificationCenter()
        var responses: [(String, Bool)] = []
        var applications = 0
        let controller = HitlRuntimeController(
            readConfiguration: { .init(level: .sensitiveOnly, timeoutSeconds: 120) },
            applyConfiguration: { _ in applications += 1 },
            respond: { responses.append(($0, $1)) },
            notificationCenter: center
        )
        controller.start()
        controller.start() // Repeated app appearances do not duplicate subscribers.
        center.post(name: .hitlNotificationResponse, object: nil, userInfo: ["id": "approve", "approved": true])
        center.post(name: .hitlNotificationResponse, object: nil, userInfo: ["id": "deny", "approved": false])
        center.post(name: .hitlNotificationResponse, object: nil, userInfo: ["id": "malformed"])
        try await waitUntil { responses.count == 2 }
        XCTAssertEqual(responses.map(\.0), ["approve", "deny"])
        XCTAssertEqual(responses.map(\.1), [true, false])
        XCTAssertEqual(applications, 1)
    }
}
