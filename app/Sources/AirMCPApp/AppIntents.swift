import AppIntents
import Foundation
import AirMCPKit

// MARK: - AirMCP App Intents
// These make AirMCP actions accessible via Siri, Spotlight, and Shortcuts.
// When Apple ships the system-level MCP↔App Intents bridge (iOS 26.1),
// these will automatically be available to all MCP clients.

// MARK: - Existing Intents

struct SearchNotesIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Search Notes"
    nonisolated(unsafe) static var description = IntentDescription("Search Apple Notes via AirMCP")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Query")
    var query: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await runAirMCPTool("search_notes", args: ["query": query])
        return .result(value: result)
    }
}

struct DailyBriefingIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Daily Briefing"
    nonisolated(unsafe) static var description = IntentDescription("Get today's events, reminders, and notes summary")
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

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
struct HealthSummaryIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Health Summary"
    nonisolated(unsafe) static var description = IntentDescription(
        "Get an aggregated health summary including steps, heart rate, sleep, and exercise"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
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
func installMCPIntentRouterForMacOS() {
    Task.detached(priority: .utility) {
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

/// Execute an AirMCP MCP tool by calling the Node.js server via stdio.
/// This is a lightweight bridge: sends a JSON-RPC request to the airmcp process.
private func runAirMCPTool(_ toolName: String, args: [String: Any]) async throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["npx", "-y", AirMcpConstants.npmPackageName]

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
