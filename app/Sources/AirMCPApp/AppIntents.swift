import AppIntents
import Foundation
import AirMCPKit

// MARK: - AirMCP App Intents
// These make AirMCP actions accessible via Siri, Spotlight, and Shortcuts.
// MCP clients use the HTTP/stdio AirMCP surfaces; App Intents are the Apple
// system-surface path for Siri, Shortcuts, Spotlight, and Apple Intelligence.

// MARK: - Existing Intents

struct SearchNotesIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Search Notes"
    nonisolated(unsafe) static var description = IntentDescription("Search Apple Notes via AirMCP")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Query")
    var query: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("search_notes", args: ["query": query])
        return .result(value: result)
    }
}

struct DailyBriefingIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Daily Briefing"
    nonisolated(unsafe) static var description = IntentDescription("Get today's events, reminders, and notes summary")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("summarize_context", args: [:])
        return .result(value: result)
    }
}

struct CheckCalendarIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Check Calendar"
    nonisolated(unsafe) static var description = IntentDescription("List today's calendar events")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("today_events", args: [:])
        return .result(value: result)
    }
}

@available(iOS 18, macOS 15, *)
struct CreateReminderIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Create Reminder"
    nonisolated(unsafe) static var description = IntentDescription("Create a new reminder via AirMCP")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Title")
    var title: String

    @Parameter(title: "Due Date")
    var dueDate: Date?

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: Any] = ["title": title]
        if let date = dueDate {
            args["dueDate"] = ISO8601DateFormatter().string(from: date)
        }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Reminder with AirMCP? Create a new reminder via AirMCP.")
        )
        let result = try await runAirMCPTool("create_reminder", args: args)
        return .result(value: result)
    }
}

// MARK: - MCP Bridge Read-Only Intents

struct SearchContactsIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Search Contacts"
    nonisolated(unsafe) static var description = IntentDescription(
        "Search contacts by name, email, phone, or organization"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Search Query")
    var query: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("search_contacts", args: ["query": query])
        return .result(value: result)
    }
}

struct DueRemindersIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Overdue Reminders"
    nonisolated(unsafe) static var description = IntentDescription(
        "Show reminders that are past due and not yet completed"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("list_reminders", args: [
            "completed": false,
            "dueBefore": ISO8601DateFormatter().string(from: Date()),
        ])
        return .result(value: result)
    }
}

struct ListCalendarsIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "List Calendars"
    nonisolated(unsafe) static var description = IntentDescription(
        "List all available calendars with their names, colors, and write status"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("list_calendars", args: [:])
        return .result(value: result)
    }
}

#if canImport(HealthKit)
@available(iOS 18, macOS 15, *)
struct HealthSummaryIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Health Summary"
    nonisolated(unsafe) static var description = IntentDescription(
        "Get an aggregated health summary including steps, heart rate, sleep, and exercise"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Health Summary with AirMCP? Get an aggregated health summary including steps, heart rate, sleep, and exercise.")
        )
        let result = try await runAirMCPTool("health_summary", args: [:])
        return .result(value: result)
    }
}
#endif

// MARK: - App Shortcuts (Siri trigger phrases)
//
// AirMCP's `AppShortcutsProvider` is `AirMCPGeneratedShortcuts` in
// `swift/Sources/AirMCPKit/Generated/MCPIntents.swift` — auto-generated
// from the tool manifest with 1 + 9 entries (AskAirMCPIntent + 9 top tools)
// pinned per Apple's 10-entry app cap.
//
// Apple constrains an app target to a single `AppShortcutsProvider`
// conformance. The hand-written `AirMCPShortcuts` that previously lived
// here pre-dated the codegen and conflicted with the generated one;
// keeping both produced an ambiguity at build time and a runtime tie
// that Apple resolves arbitrarily.
//
// The hand-written-only intents (`DailyBriefingIntent`,
// `HealthSummaryIntent`) stay defined as standalone `AppIntent` types
// above — they remain invocable from the Shortcuts app, Spotlight, and
// Action Button. They just aren't pinned as Siri-first phrases. A future
// codegen `APP_SHORTCUTS_TOP` entry can re-pin them by adding their tool
// names to `scripts/gen-swift-intents.mjs` once the corresponding tools
// (`daily_briefing`, `health_summary`) are first-party tool manifest
// entries.

// MARK: - MCPIntentRouter wiring (RFC 0007 Phase A.2a)

/// Install the macOS transport handler on `MCPIntentRouter.shared`. Called
/// once from `AirMCPApp.init()` so every code-generated AppIntent in
/// `swift/Sources/AirMCPKit/Generated/MCPIntents.swift` lands on the same
/// execFile stdio bridge the hand-written intents already use.
///
/// Re-calling is safe — the router replaces the prior handler rather than
/// stacking. Tests that swap in a fake can call `setHandler` again.
///
/// Uses `Task { @MainActor in ... }` at default priority instead of the
/// previous `Task.detached(priority: .utility)`. The actor hop into
/// `MCPIntentRouter.shared.setHandler` is unavoidable (the router is an
/// actor), but raising the priority + dropping `.detached` shrinks the
/// cold-launch race window from "seconds" (utility queue can sit behind
/// other low-priority work) to "milliseconds before the first runloop
/// tick". For a Siri / Shortcuts cold-launch the system's first AppIntent
/// invocation lands well after that window, so `handlerNotInstalled`
/// effectively can't fire — but if it ever does, the error path already
/// surfaces the requested tool name so the stack trace is debuggable.
func installMCPIntentRouterForMacOS() {
    Task { @MainActor in
        await MCPIntentRouter.shared.setHandler { tool, args in
            // Cast from [String: any Sendable] → [String: Any] for the
            // existing runAirMCPTool(args:) signature. All inbound values
            // come from @Parameter-wrapped primitives so the cast is safe.
            let anyArgs: [String: Any] = args.reduce(into: [:]) { acc, kv in acc[kv.key] = kv.value }
            return try await runAirMCPTool(tool, args: anyArgs)
        }
    }
}

// MARK: - AirMCP Tool Runner

private enum AppIntentMCPTransportError: Error {
    case invalidRuntimeURL
    case missingSessionID
    case httpStatus(Int, String)
    case invalidJSONResponse(String)
    case rpcError(String)
    case missingToolText
    case toolCallUncertain(Error)
}

/// Execute an AirMCP MCP tool through the app-owned HTTP runtime when it is
/// already available, then fall back to the legacy stdio bridge. The fallback
/// keeps cold Shortcuts/Siri invocations working while the preferred path
/// shares the same token-gated, app-owned runtime as Claude/Codex/Cursor.
private func runAirMCPTool(_ toolName: String, args: [String: Any]) async throws -> String {
    do {
        return try await runAirMCPToolViaAppRuntime(toolName, args: args)
    } catch {
        if let transportError = error as? AppIntentMCPTransportError,
           case .toolCallUncertain = transportError {
            throw error
        }
        return try await runAirMCPToolViaStdio(toolName, args: args)
    }
}

private func runAirMCPToolViaAppRuntime(_ toolName: String, args: [String: Any]) async throws -> String {
    let token = try AppRuntimeToken.ensure()
    let initResponse = try await postAppRuntimeMCPRequest(
        [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": [
                "protocolVersion": AirMcpConstants.mcpProtocolVersion,
                "capabilities": [:] as [String: Any],
                "clientInfo": ["name": "AirMCPAppIntents", "version": "1.0"],
            ],
        ],
        token: token
    )
    guard let sessionID = initResponse.sessionID else {
        throw AppIntentMCPTransportError.missingSessionID
    }
    defer {
        Task {
            try? await closeAppRuntimeMCPSession(sessionID: sessionID, token: token)
        }
    }

    _ = try await postAppRuntimeMCPRequest(
        ["jsonrpc": "2.0", "method": "notifications/initialized", "params": [:] as [String: Any]],
        token: token,
        sessionID: sessionID,
        allowsEmptyResponse: true
    )

    do {
        let toolResponse = try await postAppRuntimeMCPRequest(
            [
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": ["name": toolName, "arguments": args],
            ],
            token: token,
            sessionID: sessionID,
            timeoutInterval: 30
        )
        return try extractToolText(from: toolResponse.json)
    } catch {
        throw AppIntentMCPTransportError.toolCallUncertain(error)
    }
}

private func runAirMCPToolViaStdio(_ toolName: String, args: [String: Any]) async throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["npx", "-y", AirMcpConstants.npmPackageSpecifier]

    let stdinPipe = Pipe()
    let stdoutPipe = Pipe()
    process.standardInput = stdinPipe
    process.standardOutput = stdoutPipe
    process.standardError = FileHandle.nullDevice

    try process.run()

    // Send MCP initialize + tool call
    let initRequest: [String: Any] = [
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": [
            "protocolVersion": AirMcpConstants.mcpProtocolVersion,
            "capabilities": [:] as [String: Any],
            "clientInfo": ["name": "AirMCPApp", "version": "1.0"]
        ]
    ]
    let toolRequest: [String: Any] = [
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": ["name": toolName, "arguments": args]
    ]

    let encoder = JSONSerialization.self
    var requests = Data()
    requests.append(try encoder.data(withJSONObject: initRequest))
    requests.append(Data("\n".utf8))
    requests.append(try encoder.data(withJSONObject: ["jsonrpc": "2.0", "method": "notifications/initialized"]))
    requests.append(Data("\n".utf8))
    requests.append(try encoder.data(withJSONObject: toolRequest))
    requests.append(Data("\n".utf8))

    stdinPipe.fileHandleForWriting.write(requests)
    stdinPipe.fileHandleForWriting.closeFile()

    process.waitUntilExit()

    let outputData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
    let output = String(data: outputData, encoding: .utf8) ?? ""

    // Parse the last JSON-RPC response (tool result)
    let lines = output.split(separator: "\n")
    if let lastLine = lines.last,
       let json = try? JSONSerialization.jsonObject(with: Data(lastLine.utf8)) as? [String: Any],
       let result = json["result"] as? [String: Any],
       let content = result["content"] as? [[String: Any]],
       let text = content.first?["text"] as? String {
        return text
    }

    return output.prefix(500).description
}

private func appRuntimeURL() throws -> URL {
    guard let url = URL(string: AirMcpConstants.appOwnedHttpURL) else {
        throw AppIntentMCPTransportError.invalidRuntimeURL
    }
    return url
}

private func postAppRuntimeMCPRequest(
    _ payload: [String: Any],
    token: String,
    sessionID: String? = nil,
    allowsEmptyResponse: Bool = false,
    timeoutInterval: TimeInterval = 2
) async throws -> (json: [String: Any], sessionID: String?) {
    var request = URLRequest(url: try appRuntimeURL())
    request.httpMethod = "POST"
    request.timeoutInterval = timeoutInterval
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let sessionID {
        request.setValue(sessionID, forHTTPHeaderField: "Mcp-Session-Id")
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
        throw AppIntentMCPTransportError.invalidJSONResponse("missing HTTP response")
    }
    guard (200..<300).contains(http.statusCode) else {
        let body = String(data: data, encoding: .utf8) ?? ""
        throw AppIntentMCPTransportError.httpStatus(http.statusCode, body)
    }
    if data.isEmpty && allowsEmptyResponse {
        return ([:], http.value(forHTTPHeaderField: "Mcp-Session-Id"))
    }
    let json = try decodeMCPHTTPBody(data, allowsEmptyResponse: allowsEmptyResponse)
    return (json, http.value(forHTTPHeaderField: "Mcp-Session-Id"))
}

private func closeAppRuntimeMCPSession(sessionID: String, token: String) async throws {
    var request = URLRequest(url: try appRuntimeURL())
    request.httpMethod = "DELETE"
    request.timeoutInterval = 1
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(sessionID, forHTTPHeaderField: "Mcp-Session-Id")
    _ = try await URLSession.shared.data(for: request)
}

private func decodeMCPHTTPBody(_ data: Data, allowsEmptyResponse: Bool = false) throws -> [String: Any] {
    if data.isEmpty {
        if allowsEmptyResponse { return [:] }
        throw AppIntentMCPTransportError.invalidJSONResponse("empty response")
    }
    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        return json
    }
    let text = String(data: data, encoding: .utf8) ?? ""
    for line in text.split(separator: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("data:") else { continue }
        let payload = String(trimmed.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces)
        guard !payload.isEmpty, payload != "[DONE]" else { continue }
        if let json = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] {
            return json
        }
    }
    if allowsEmptyResponse { return [:] }
    throw AppIntentMCPTransportError.invalidJSONResponse(String(text.prefix(500)))
}

private func extractToolText(from json: [String: Any]) throws -> String {
    if let error = json["error"] as? [String: Any] {
        let message = error["message"] as? String ?? String(describing: error)
        throw AppIntentMCPTransportError.rpcError(message)
    }
    guard
        let result = json["result"] as? [String: Any],
        let content = result["content"] as? [[String: Any]],
        let text = content.first?["text"] as? String
    else {
        throw AppIntentMCPTransportError.missingToolText
    }
    return text
}
