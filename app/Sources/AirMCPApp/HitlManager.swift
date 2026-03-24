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

    private func parseRequest(_ data: Data) -> ApprovalRequest? {
        guard let json = try? JSONSerialization.jsonObject(with: Data(data)) as? [String: Any],
              let id = json["id"] as? String,
              let type = json["type"] as? String,
              type == "hitl_request",
              let tool = json["tool"] as? String
        else {
            return nil
        }

        var argsDict: [String: String] = [:]
        if let args = json["args"] as? [String: Any] {
            for (key, value) in args {
                argsDict[key] = "\(value)"
            }
        }

        let destructive = json["destructive"] as? Bool ?? false
        let openWorld = json["openWorld"] as? Bool ?? false

        return ApprovalRequest(
            id: id,
            tool: tool,
            args: argsDict,
            destructive: destructive,
            openWorld: openWorld,
            timestamp: Date()
        )
    }

    // MARK: - Request Handling

    private func handleRequest(_ request: ApprovalRequest) {
        pendingTools[request.id] = request.tool
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

    private func sendResponse(id: String, approved: Bool, on connection: NWConnection) {
        let responseDict: [String: Any] = [
            "id": id,
            "type": "hitl_response",
            "approved": approved,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: responseDict),
              var payload = String(data: jsonData, encoding: .utf8)
        else {
            return
        }

        payload += "\n"
        guard let payloadData = payload.data(using: .utf8) else { return }

        connection.send(
            content: payloadData,
            completion: .contentProcessed { _ in }
        )
    }

    // MARK: - Notifications

    private func postNotification(for request: ApprovalRequest) {
        let content = UNMutableNotificationContent()
        content.title = request.destructive ? L("hitl.destructiveAction") : L("hitl.toolConfirmation")
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
        ) { _, _ in }
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
