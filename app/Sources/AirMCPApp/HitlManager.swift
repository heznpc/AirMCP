import Foundation
import Network
import UserNotifications

@MainActor
@Observable
final class HitlManager {

    // MARK: - Types

    struct ApprovalRequest: Identifiable, Sendable {
        let id: String
        let tool: String
        let args: [String: String]
        let destructive: Bool
        let sensitive: Bool
        let openWorld: Bool
        let timestamp: Date
    }

    struct ApprovalRecord: Identifiable, Sendable {
        let id: String
        let tool: String
        let approved: Bool
        let timestamp: Date
    }

    enum ConnectionState: Sendable {
        case idle
        case listening
        case connected
    }

    // MARK: - Observable State

    var state: ConnectionState = .idle
    var pendingRequests: [ApprovalRequest] = []
    var recentRequests: [ApprovalRecord] = []

    // MARK: - Private

    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private var pendingTimers: [String: DispatchWorkItem] = [:]
    private var pendingConnections: [String: NWConnection] = [:]
    private(set) var pendingTools: [String: String] = [:]  // id -> tool name
    private var receiveBuffers: [ObjectIdentifier: Data] = [:]

    private let socketPath: String = {
        NSHomeDirectory() + "/.config/airmcp/hitl.sock"
    }()

    var timeoutSeconds: Int = 30

    // MARK: - Lifecycle

    func startListening() {
        guard listener == nil else { return }

        // Ensure config directory exists
        let configDir = (socketPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: configDir,
            withIntermediateDirectories: true
        )

        // Remove stale socket file
        removeSocketFile()

        do {
            let params = NWParameters()
            params.defaultProtocolStack.transportProtocol = NWProtocolTCP.Options()
            params.requiredLocalEndpoint = NWEndpoint.unix(path: socketPath)

            let nwListener = try NWListener(using: params)

            nwListener.stateUpdateHandler = { [weak self] newState in
                Task { @MainActor [weak self] in
                    self?.handleListenerState(newState)
                }
            }

            nwListener.newConnectionHandler = { [weak self] newConnection in
                Task { @MainActor [weak self] in
                    self?.handleNewConnection(newConnection)
                }
            }

            nwListener.start(queue: .main)
            listener = nwListener
            state = .listening
        } catch {
            state = .idle
        }
    }

    func stopListening() {
        for timer in pendingTimers.values {
            timer.cancel()
        }
        pendingTimers.removeAll()
        pendingConnections.removeAll()

        for connection in connections {
            connection.cancel()
        }
        connections.removeAll()
        receiveBuffers.removeAll()

        listener?.cancel()
        listener = nil

        removeSocketFile()
        state = .idle
    }

    // MARK: - Listener State

    private func handleListenerState(_ newState: NWListener.State) {
        switch newState {
        case .ready:
            state = connections.isEmpty ? .listening : .connected
        case .failed, .cancelled:
            stopListening()
        default:
            break
        }
    }

    // MARK: - Connection Handling

    private func handleNewConnection(_ connection: NWConnection) {
        connections.append(connection)
        let connId = ObjectIdentifier(connection)
        receiveBuffers[connId] = Data()

        connection.stateUpdateHandler = { [weak self] newState in
            Task { @MainActor [weak self] in
                switch newState {
                case .ready:
                    self?.state = .connected
                case .failed, .cancelled:
                    self?.removeConnection(connection)
                default:
                    break
                }
            }
        }

        connection.start(queue: .main)
        scheduleReceive(on: connection)
    }

    private func removeConnection(_ connection: NWConnection) {
        let connId = ObjectIdentifier(connection)
        receiveBuffers.removeValue(forKey: connId)
        connections.removeAll { $0 === connection }
        state = connections.isEmpty ? .listening : .connected
    }

    // MARK: - Receive & Parse

    private func scheduleReceive(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
            [weak self] content, _, isComplete, error in
            Task { @MainActor [weak self] in
                guard let self else { return }

                if let data = content, !data.isEmpty {
                    let connId = ObjectIdentifier(connection)
                    self.receiveBuffers[connId, default: Data()].append(data)
                    self.processBuffer(for: connection)
                }

                if isComplete || error != nil {
                    self.removeConnection(connection)
                    return
                }

                self.scheduleReceive(on: connection)
            }
        }
    }

    private func processBuffer(for connection: NWConnection) {
        let connId = ObjectIdentifier(connection)
        guard var buffer = receiveBuffers[connId] else { return }

        let newline = UInt8(0x0A) // '\n'
        while let newlineIndex = buffer.firstIndex(of: newline) {
            let lineData = buffer[buffer.startIndex..<newlineIndex]
            buffer = buffer[(newlineIndex + 1)...]

            if let request = parseRequest(lineData) {
                pendingConnections[request.id] = connection
                handleRequest(request)
            }
        }

        receiveBuffers[connId] = Data(buffer)
    }

    static func parseApprovalRequest(
        from data: Data,
        timestamp: Date = Date()
    ) -> ApprovalRequest? {
        guard let parsed = HitlProtocol.parseApprovalRequest(from: data, timestamp: timestamp) else { return nil }
        return ApprovalRequest(
            id: parsed.id,
            tool: parsed.tool,
            args: parsed.args,
            destructive: parsed.destructive,
            sensitive: parsed.sensitive,
            openWorld: parsed.openWorld,
            timestamp: parsed.timestamp
        )
    }

    private func parseRequest(_ data: Data) -> ApprovalRequest? {
        Self.parseApprovalRequest(from: data)
    }

    // MARK: - Request Handling

    private func handleRequest(_ request: ApprovalRequest) {
        pendingTools[request.id] = request.tool
        pendingRequests.removeAll { $0.id == request.id }
        pendingRequests.insert(request, at: 0)
        postNotification(for: request)

        let timeout = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.pendingTimers[request.id] != nil else { return }
                self.respond(id: request.id, approved: false, tool: request.tool)
            }
        }
        pendingTimers[request.id] = timeout
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .seconds(timeoutSeconds),
            execute: timeout
        )
    }

    func respond(id: String, approved: Bool, tool: String) {
        // Cancel the timeout timer
        pendingTimers[id]?.cancel()
        pendingTimers.removeValue(forKey: id)
        pendingTools.removeValue(forKey: id)
        pendingRequests.removeAll { $0.id == id }

        // Send the response over the socket
        if let connection = pendingConnections.removeValue(forKey: id) {
            sendResponse(id: id, approved: approved, on: connection)
        }

        // Record for UI
        let record = ApprovalRecord(
            id: id,
            tool: tool,
            approved: approved,
            timestamp: Date()
        )
        recentRequests.insert(record, at: 0)
        if recentRequests.count > 5 { recentRequests.removeLast() }
    }

    // MARK: - Send Response

    static func responsePayload(id: String, approved: Bool) -> Data? {
        HitlProtocol.responsePayload(id: id, approved: approved)
    }

    private func sendResponse(id: String, approved: Bool, on connection: NWConnection) {
        guard let payloadData = Self.responsePayload(id: id, approved: approved) else { return }

        connection.send(
            content: payloadData,
            completion: .contentProcessed { _ in }
        )
    }

    // MARK: - Notifications

    private func postNotification(for request: ApprovalRequest) {
        let content = UNMutableNotificationContent()
        if request.destructive {
            content.title = L("hitl.destructiveAction")
        } else if request.sensitive {
            content.title = L("hitl.sensitiveAction")
        } else {
            content.title = L("hitl.toolConfirmation")
        }
        content.body = L("hitl.toolPrefix", request.tool)
        if !request.args.isEmpty {
            let argsPreview = request.args
                .map { "\($0.key): \($0.value)" }
                .prefix(3)
                .joined(separator: ", ")
            content.body += "\n\(argsPreview)"
        }
        content.sound = .default
        content.categoryIdentifier = "HITL_APPROVAL"
        content.userInfo = ["tool": request.tool]

        let notificationRequest = UNNotificationRequest(
            identifier: request.id,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(notificationRequest)
    }

    // MARK: - Notification Registration

    static func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        ) { granted, error in
            if let error {
                NSLog("[AirMCP] Notification permission error: \(error.localizedDescription)")
            }
            if !granted {
                NSLog("[AirMCP] Notification permission denied — HITL approval requests will auto-deny on timeout")
            }
        }
    }

    static func registerNotificationCategory() {
        let approve = UNNotificationAction(
            identifier: "APPROVE",
            title: L("hitl.approve"),
            options: []
        )
        let deny = UNNotificationAction(
            identifier: "DENY",
            title: L("hitl.deny"),
            options: [.destructive]
        )
        let category = UNNotificationCategory(
            identifier: "HITL_APPROVAL",
            actions: [approve, deny],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    // MARK: - Helpers

    private func removeSocketFile() {
        try? FileManager.default.removeItem(atPath: socketPath)
    }
}
