import Darwin
import Foundation
import Network
import UserNotifications

@MainActor
@Observable
final class HitlManager {

    // MARK: - Types

    struct ApprovalRequest: Identifiable, Sendable {
        let id: String
        let correlationId: String?
        let tool: String
        let args: [String: String]
        let destructive: Bool
        let sensitive: Bool
        let openWorld: Bool
        let timestamp: Date
    }

    struct ApprovalRecord: Identifiable, Sendable {
        let id: String
        let correlationId: String?
        let tool: String
        let approved: Bool
        let reason: HitlResponseReason
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
    private var ownedSocketIdentity: SocketFileIdentity?
    /// Max un-terminated bytes buffered per connection before the peer is
    /// dropped — prevents a newline-less stream from exhausting the app's memory.
    private static let maxReceiveBufferBytes = 64 * 1024

    private struct SocketFileIdentity: Equatable {
        let device: UInt64
        let inode: UInt64
    }

    private struct SocketPathConfiguration {
        let path: String?
        let isOverride: Bool
    }

    private let socketPathConfiguration = HitlManager.configuredSocketPath()

    var timeoutSeconds: Int = 30

    // MARK: - Lifecycle

    func startListening() {
        guard listener == nil else { return }
        guard let socketPath = socketPathConfiguration.path else {
            state = .idle
            return
        }

        // Tighten only a directory AirMCP owns: the default leaf, or an override
        // leaf created by this call. An existing arbitrary override parent (for
        // example /tmp) must never have its permissions rewritten.
        let configDir = (socketPath as NSString).deletingLastPathComponent
        var isDirectory: ObjCBool = false
        let parentExisted = FileManager.default.fileExists(atPath: configDir, isDirectory: &isDirectory)
        guard !parentExisted || isDirectory.boolValue else {
            state = .idle
            return
        }

        do {
            if !parentExisted {
                try FileManager.default.createDirectory(
                    atPath: configDir,
                    withIntermediateDirectories: true
                )
            }
            if !socketPathConfiguration.isOverride || !parentExisted {
                try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: configDir)
            }
        } catch {
            state = .idle
            return
        }

        // A regular file/symlink is never unlinked. An existing live socket
        // belongs to another listener and is left intact. Only a socket inode
        // that fails a connect probe and remains unchanged is treated as stale.
        guard Self.prepareSocketPathForBind(socketPath) else {
            state = .idle
            return
        }

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
        let ownedIdentity = ownedSocketIdentity
        ownedSocketIdentity = nil
        let notificationIds = pendingRequests.map(\.id)

        for timer in pendingTimers.values {
            timer.cancel()
        }
        pendingTimers.removeAll()
        pendingConnections.removeAll()
        pendingRequests.removeAll()
        pendingTools.removeAll()

        for connection in connections {
            connection.cancel()
        }
        connections.removeAll()
        receiveBuffers.removeAll()

        listener?.cancel()
        listener = nil

        if let socketPath = socketPathConfiguration.path,
           let ownedIdentity
        {
            Self.removeSocketFile(at: socketPath, ifIdentityMatches: ownedIdentity)
        }
        Self.removeNotifications(withIdentifiers: notificationIds)
        state = .idle
    }

    // MARK: - Listener State

    private func handleListenerState(_ newState: NWListener.State) {
        switch newState {
        case .ready:
            guard let socketPath = socketPathConfiguration.path,
                  let identity = Self.socketFileIdentity(at: socketPath)
            else {
                listener?.cancel()
                state = .idle
                return
            }
            ownedSocketIdentity = identity
            // Tighten the socket file to owner-only (defense in depth alongside
            // the 0700 dir); NWListener creates it at default perms when it binds.
            if Self.socketFileIdentity(at: socketPath) == identity {
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: socketPath)
            }
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
        let orphanedRequests = pendingRequests.filter { request in
            guard let pendingConnection = pendingConnections[request.id] else { return false }
            return pendingConnection === connection
        }
        for request in orphanedRequests {
            pendingTimers[request.id]?.cancel()
            pendingTimers.removeValue(forKey: request.id)
            pendingConnections.removeValue(forKey: request.id)
            pendingTools.removeValue(forKey: request.id)
            pendingRequests.removeAll { $0.id == request.id }
            recordRecentRequest(request, approved: false, reason: .unavailable)
        }
        Self.removeNotifications(withIdentifiers: orphanedRequests.map(\.id))
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

        // Guard against an unbounded line: if a peer streams bytes without ever
        // sending a newline, the un-terminated remainder grows without limit.
        // Drop the connection once it exceeds the cap.
        if buffer.count > Self.maxReceiveBufferBytes {
            removeConnection(connection)
            connection.cancel()
        }
    }

    static func parseApprovalRequest(
        from data: Data,
        timestamp: Date = Date()
    ) -> ApprovalRequest? {
        guard let parsed = HitlProtocol.parseApprovalRequest(from: data, timestamp: timestamp) else { return nil }
        return ApprovalRequest(
            id: parsed.id,
            correlationId: parsed.correlationId,
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
                self.respond(
                    id: request.id,
                    approved: false,
                    tool: request.tool,
                    reason: .timedOut
                )
            }
        }
        pendingTimers[request.id] = timeout
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .seconds(timeoutSeconds),
            execute: timeout
        )
    }

    func respond(
        id: String,
        approved: Bool,
        tool _: String,
        reason: HitlResponseReason? = nil
    ) {
        guard let request = pendingRequests.first(where: { $0.id == id }) else {
            // A delivered notification can be acted on after timeout. It is
            // stale and must never create a second, misleading approval record.
            Self.removeNotifications(withIdentifiers: [id])
            return
        }
        let responseReason = reason ?? (approved ? .approved : .denied)
        // Cancel the timeout timer
        pendingTimers[id]?.cancel()
        pendingTimers.removeValue(forKey: id)
        pendingTools.removeValue(forKey: id)
        pendingRequests.removeAll { $0.id == id }
        Self.removeNotifications(withIdentifiers: [id])

        // Send the response over the socket
        if let connection = pendingConnections.removeValue(forKey: id) {
            sendResponse(id: id, approved: approved, reason: responseReason, on: connection)
        }

        recordRecentRequest(request, approved: approved, reason: responseReason)
    }

    private func recordRecentRequest(
        _ request: ApprovalRequest,
        approved: Bool,
        reason: HitlResponseReason
    ) {
        let record = ApprovalRecord(
            id: request.id,
            correlationId: request.correlationId,
            tool: request.tool,
            approved: approved,
            reason: reason,
            timestamp: Date()
        )
        recentRequests.insert(record, at: 0)
        if recentRequests.count > 5 { recentRequests.removeLast() }
    }

    // MARK: - Send Response

    static func responsePayload(
        id: String,
        approved: Bool,
        reason: HitlResponseReason? = nil
    ) -> Data? {
        HitlProtocol.responsePayload(id: id, approved: approved, reason: reason)
    }

    private func sendResponse(
        id: String,
        approved: Bool,
        reason: HitlResponseReason,
        on connection: NWConnection
    ) {
        guard let payloadData = Self.responsePayload(id: id, approved: approved, reason: reason) else { return }

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
                NSLog("[AirMCP] Notification permission denied — HITL approval requests will time out")
            }
        }
    }

    static func registerNotificationCategory() {
        let approve = UNNotificationAction(
            identifier: "APPROVE",
            title: L("hitl.approve"),
            options: [.authenticationRequired]
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

    static func normalizedSocketPath(
        override rawOverride: String?,
        homeDirectory: String = NSHomeDirectory()
    ) -> String? {
        let trimmed = rawOverride?.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate: String
        if let trimmed, !trimmed.isEmpty {
            candidate = trimmed
        } else {
            candidate = (homeDirectory as NSString).appendingPathComponent(".config/airmcp/hitl.sock")
        }
        let expanded: String
        if candidate == "~" {
            expanded = homeDirectory
        } else if candidate.hasPrefix("~/") {
            expanded = (homeDirectory as NSString).appendingPathComponent(String(candidate.dropFirst(2)))
        } else {
            expanded = candidate
        }
        guard expanded.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: expanded).standardizedFileURL.path
    }

    private static func configuredSocketPath() -> SocketPathConfiguration {
        let rawOverride = ProcessInfo.processInfo.environment["AIRMCP_HITL_SOCKET_PATH"]
        let trimmed = rawOverride?.trimmingCharacters(in: .whitespacesAndNewlines)
        return SocketPathConfiguration(
            path: normalizedSocketPath(override: rawOverride),
            isOverride: trimmed?.isEmpty == false
        )
    }

    private static func fileStatus(at path: String) -> stat? {
        var info = stat()
        guard Darwin.lstat(path, &info) == 0 else { return nil }
        return info
    }

    private static func socketFileIdentity(at path: String) -> SocketFileIdentity? {
        guard let info = fileStatus(at: path),
              (info.st_mode & S_IFMT) == S_IFSOCK
        else { return nil }
        return SocketFileIdentity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }

    private static func isSocketReachable(at path: String) -> Bool {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8CString)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard pathBytes.count <= capacity else { return false }
        withUnsafeMutablePointer(to: &address.sun_path.0) { destination in
            pathBytes.withUnsafeBufferPointer { source in
                destination.update(from: source.baseAddress!, count: pathBytes.count)
            }
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.connect(
                    descriptor,
                    socketAddress,
                    socklen_t(MemoryLayout<sockaddr_un>.size)
                ) == 0
            }
        }
    }

    private static func prepareSocketPathForBind(_ path: String) -> Bool {
        guard let status = fileStatus(at: path) else {
            return errno == ENOENT
        }
        guard (status.st_mode & S_IFMT) == S_IFSOCK else {
            return false
        }
        let identity = SocketFileIdentity(device: UInt64(status.st_dev), inode: UInt64(status.st_ino))
        if isSocketReachable(at: path) {
            return false
        }
        guard socketFileIdentity(at: path) == identity else {
            return false
        }
        return Darwin.unlink(path) == 0
    }

    private static func removeSocketFile(
        at path: String,
        ifIdentityMatches expected: SocketFileIdentity
    ) {
        guard socketFileIdentity(at: path) == expected else { return }
        _ = Darwin.unlink(path)
    }

    private static func removeNotifications(withIdentifiers identifiers: [String]) {
        guard !identifiers.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}
