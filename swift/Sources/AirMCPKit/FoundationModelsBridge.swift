// AirMCPKit — Foundation Models ↔ AirMCP bidirectional bridge.
// Exposes AirMCP tools (Calendar, Reminders, Contacts) as Foundation Models
// Tool protocol conformances so Apple's on-device LLM can call them autonomously.

import Foundation

// FoundationModels requires the macro plugin (FoundationModelsMacros) which ships
// with Xcode 26+/Swift 6.3+. The `compiler(>=6.3)` guard prevents build failures on
// toolchains that have the SDK headers but lack the macro binary (e.g. Swift 6.2.x).
#if canImport(FoundationModels) && compiler(>=6.3)
import FoundationModels

// MARK: - AirMCP Tools for Foundation Models

/// Calendar tool: Get today's events via Foundation Models tool calling.
@available(macOS 26, iOS 26, *)
public final class TodayEventsTool: Tool {
    public let name = "today_events"
    public let description = "Get today's calendar events with titles, times, and locations."

    @Generable
    public struct Arguments {}

    public init() {}

    public func call(arguments: Arguments) async throws -> ToolOutput {
        let service = EventKitService()
        let result = try await service.todayEvents()
        let data = try JSONEncoder().encode(result)
        return ToolOutput(String(data: data, encoding: .utf8) ?? "[]")
    }
}

/// Reminders tool: Get due reminders.
@available(macOS 26, iOS 26, *)
public final class DueRemindersTool: Tool {
    public let name = "due_reminders"
    public let description = "Get reminders that are due today or overdue."

    @Generable
    public struct Arguments {}

    public init() {}

    public func call(arguments: Arguments) async throws -> ToolOutput {
        let service = EventKitService()
        let input = ListRemindersInput(list: nil, completed: false, limit: 20, offset: 0)
        let result = try await service.listReminders(input)
        let data = try JSONEncoder().encode(result)
        return ToolOutput(String(data: data, encoding: .utf8) ?? "[]")
    }
}

/// Contacts search tool.
@available(macOS 26, iOS 26, *)
public final class SearchContactsTool: Tool {
    public let name = "search_contacts"
    public let description = "Search contacts by name, email, or phone number."

    @Generable
    public struct Arguments {
        @Guide(description: "Search query — name, email, or phone number")
        var query: String
    }

    public init() {}

    public func call(arguments: Arguments) async throws -> ToolOutput {
        let service = ContactsService()
        let input = SearchContactsInput(query: arguments.query, limit: nil)
        let results = try await service.searchContacts(input)
        let data = try JSONEncoder().encode(results)
        return ToolOutput(String(data: data, encoding: .utf8) ?? "[]")
    }
}

/// Create reminder tool.
@available(macOS 26, iOS 26, *)
public final class CreateReminderTool: Tool {
    public let name = "create_reminder"
    public let description = "Create a new reminder with a title and optional due date."

    @Generable
    public struct Arguments {
        @Guide(description: "Reminder title")
        var title: String
        @Guide(description: "Optional due date in ISO 8601 format (e.g. 2026-03-23T09:00:00Z)")
        var dueDate: String?
    }

    public init() {}

    public func call(arguments: Arguments) async throws -> ToolOutput {
        let service = EventKitService()
        let input = CreateReminderInput(title: arguments.title, body: nil, dueDate: arguments.dueDate, priority: nil, list: nil)
        let result = try await service.createReminder(input)
        let data = try JSONEncoder().encode(result)
        return ToolOutput(String(data: data, encoding: .utf8) ?? "{}")
    }
}

/// Create note tool.
@available(macOS 26, iOS 26, *)
public final class CreateNoteTool: Tool {
    public let name = "create_note"
    public let description = "Create a new Apple Note. Returns the requested content for confirmation — actual creation requires the MCP bridge."

    @Generable
    public struct Arguments {
        @Guide(description: "Note body content")
        var body: String
        @Guide(description: "Optional folder name")
        var folder: String?
    }

    public init() {}

    public func call(arguments: Arguments) async throws -> ToolOutput {
        // Notes API requires JXA on macOS — return instruction for the bridge
        return ToolOutput("Note creation requested: \(arguments.body.prefix(100))")
    }
}

// MARK: - Bridge: On-device LLM + AirMCP tools

/// Bridge that creates a Foundation Models session with AirMCP tools registered.
/// This allows Apple's on-device LLM to autonomously use AirMCP capabilities.
@available(macOS 26, iOS 26, *)
public actor FoundationModelsBridge {

    public init() {}

    /// Get all AirMCP tools for Foundation Models.
    public func allTools() -> [any Tool] {
        [
            TodayEventsTool(),
            DueRemindersTool(),
            SearchContactsTool(),
            CreateReminderTool(),
            CreateNoteTool(),
        ]
    }

    /// Run a prompt with AirMCP tools available to the on-device LLM.
    /// The model will autonomously decide which tools to call.
    public func run(prompt: String, systemInstruction: String? = nil) async throws -> String {
        let tools = allTools()
        let instruction = systemInstruction ?? "You are a helpful assistant with access to the user's Apple apps (Calendar, Reminders, Contacts, Notes). Use the available tools to answer questions about the user's data."
        let session = LanguageModelSession(instructions: instruction, tools: tools)
        let response = try await session.respond(to: prompt)
        return response.content
    }
}

#else

// Stub for platforms without Foundation Models
@available(macOS 14, iOS 16, *)
public actor FoundationModelsBridge {
    public init() {}
    public func run(prompt: String, systemInstruction: String? = nil) async throws -> String {
        throw NSError(domain: "AirMCPKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Foundation Models not available on this platform"])
    }
}

#endif
