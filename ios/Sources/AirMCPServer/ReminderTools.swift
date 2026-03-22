// AirMCPServer — Reminder MCP tools wrapping EventKitService.

import Foundation
import AirMCPKit

// MARK: - JSON Decoding Helper

/// Decode a Decodable type from a [String: Any] dictionary via JSON round-trip.
private func decodeInput<T: Decodable>(_ type: T.Type, from arguments: [String: Any]) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: arguments)
    return try JSONDecoder().decode(type, from: data)
}

// MARK: - ListReminderListsTool

public struct ListReminderListsTool: MCPTool {
    public static let name = "reminders_list_lists"
    public static let description = "List all reminder lists with their reminder counts"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let lists = try await service.listReminderLists()
        return .ok(lists)
    }
}

// MARK: - ListRemindersTool

public struct ListRemindersTool: MCPTool {
    public static let name = "reminders_list"
    public static let description = "List reminders, optionally filtered by list name and completion status"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "list": [
                "type": "string",
                "description": "Optional reminder list name to filter by",
            ] as [String: Any],
            "completed": [
                "type": "boolean",
                "description": "Filter by completion status (omit to include all)",
            ] as [String: Any],
            "limit": [
                "type": "integer",
                "description": "Maximum number of reminders to return (default 200)",
            ] as [String: Any],
            "offset": [
                "type": "integer",
                "description": "Number of reminders to skip for pagination (default 0)",
            ] as [String: Any],
        ] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let input = try decodeInput(ListRemindersInput.self, from: arguments)
        let output = try await service.listReminders(input)
        return .ok(output)
    }
}

// MARK: - SearchRemindersTool

public struct SearchRemindersTool: MCPTool {
    public static let name = "reminders_search"
    public static let description = "Search reminders by text query across title and notes"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "query": [
                "type": "string",
                "description": "Search text to match against reminder title and notes",
            ] as [String: Any],
            "limit": [
                "type": "integer",
                "description": "Maximum number of results to return (default 30)",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["query"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["query"] is String else {
            return .err("Missing required parameter: query")
        }
        let input = try decodeInput(SearchRemindersInput.self, from: arguments)
        let output = try await service.searchReminders(input)
        return .ok(output)
    }
}

// MARK: - ReadReminderTool

public struct ReadReminderTool: MCPTool {
    public static let name = "reminders_read"
    public static let description = "Read full details of a reminder by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The reminder identifier",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required parameter: id")
        }
        let input = try decodeInput(ReadReminderInput.self, from: arguments)
        let output = try await service.readReminder(input)
        return .ok(output)
    }
}

// MARK: - CreateReminderTool

public struct CreateReminderTool: MCPTool {
    public static let name = "reminders_create"
    public static let description = "Create a new reminder"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "title": [
                "type": "string",
                "description": "Reminder title",
            ] as [String: Any],
            "body": [
                "type": "string",
                "description": "Optional reminder notes/body",
            ] as [String: Any],
            "dueDate": [
                "type": "string",
                "description": "Optional due date in ISO 8601 format",
            ] as [String: Any],
            "priority": [
                "type": "integer",
                "description": "Optional priority (0=none, 1=high, 5=medium, 9=low)",
            ] as [String: Any],
            "list": [
                "type": "string",
                "description": "Optional reminder list name (uses default if omitted)",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["title"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["title"] is String else {
            return .err("Missing required parameter: title")
        }
        let input = try decodeInput(CreateReminderInput.self, from: arguments)
        let output = try await service.createReminder(input)
        return .ok(output)
    }
}

// MARK: - UpdateReminderTool

public struct UpdateReminderTool: MCPTool {
    public static let name = "reminders_update"
    public static let description = "Update an existing reminder by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The reminder identifier",
            ] as [String: Any],
            "title": [
                "type": "string",
                "description": "New reminder title",
            ] as [String: Any],
            "body": [
                "type": "string",
                "description": "New reminder notes/body",
            ] as [String: Any],
            "dueDate": [
                "type": "string",
                "description": "New due date in ISO 8601 format",
            ] as [String: Any],
            "priority": [
                "type": "integer",
                "description": "New priority (0=none, 1=high, 5=medium, 9=low)",
            ] as [String: Any],
            "flagged": [
                "type": "boolean",
                "description": "Set flagged status",
            ] as [String: Any],
            "clearDueDate": [
                "type": "boolean",
                "description": "Set to true to remove the due date",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required parameter: id")
        }
        let input = try decodeInput(UpdateReminderInput.self, from: arguments)
        let output = try await service.updateReminder(input)
        return .ok(output)
    }
}

// MARK: - CompleteReminderTool

public struct CompleteReminderTool: MCPTool {
    public static let name = "reminders_complete"
    public static let description = "Mark a reminder as completed or incomplete"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The reminder identifier",
            ] as [String: Any],
            "completed": [
                "type": "boolean",
                "description": "Set to true to mark complete, false to mark incomplete",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["id", "completed"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String,
              arguments["completed"] is Bool else {
            return .err("Missing required parameters: id, completed")
        }
        let input = try decodeInput(CompleteReminderInput.self, from: arguments)
        let output = try await service.completeReminder(input)
        return .ok(output)
    }
}

// MARK: - DeleteReminderTool

public struct DeleteReminderTool: MCPTool {
    public static let name = "reminders_delete"
    public static let description = "Delete a reminder by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The reminder identifier to delete",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = false
    public static let destructive = true

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required parameter: id")
        }
        let input = try decodeInput(DeleteReminderInput.self, from: arguments)
        let output = try await service.deleteReminder(input)
        return .ok(output)
    }
}

// MARK: - Registration

public func registerReminderTools(on server: MCPServer, service: EventKitService) async {
    await server.registerTool(ListReminderListsTool(service: service))
    await server.registerTool(ListRemindersTool(service: service))
    await server.registerTool(SearchRemindersTool(service: service))
    await server.registerTool(ReadReminderTool(service: service))
    await server.registerTool(CreateReminderTool(service: service))
    await server.registerTool(UpdateReminderTool(service: service))
    await server.registerTool(CompleteReminderTool(service: service))
    await server.registerTool(DeleteReminderTool(service: service))
}
