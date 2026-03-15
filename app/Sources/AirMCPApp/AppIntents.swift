import AppIntents
import Foundation

// MARK: - AirMCP App Intents
// These make AirMCP actions accessible via Siri, Spotlight, and Shortcuts.
// When Apple ships the system-level MCP↔App Intents bridge,
// these will automatically be available to all MCP clients.

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

// MARK: - App Shortcuts (Siri trigger phrases)

struct AirMCPShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DailyBriefingIntent(),
            phrases: [
                "Daily briefing in \(.applicationName)",
                "What's on my schedule in \(.applicationName)",
            ],
            shortTitle: "Daily Briefing",
            systemImageName: "calendar.badge.clock"
        )
        AppShortcut(
            intent: SearchNotesIntent(),
            phrases: [
                "Search notes in \(.applicationName)",
                "Find in my notes with \(.applicationName)",
            ],
            shortTitle: "Search Notes",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: CheckCalendarIntent(),
            phrases: [
                "Check my calendar in \(.applicationName)",
                "Today's events in \(.applicationName)",
            ],
            shortTitle: "Today's Events",
            systemImageName: "calendar"
        )
    }
}

// MARK: - AirMCP Tool Runner

/// Execute an AirMCP MCP tool by calling the Node.js server via stdio.
/// This is a lightweight bridge: sends a JSON-RPC request to the airmcp process.
private func runAirMCPTool(_ toolName: String, args: [String: Any]) async throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["npx", "-y", "airmcp"]

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
            "protocolVersion": "2025-03-26",
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
