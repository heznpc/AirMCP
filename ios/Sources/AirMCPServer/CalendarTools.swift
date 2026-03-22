// AirMCPServer — Calendar MCP tools wrapping EventKitService.

import Foundation
import AirMCPKit

// MARK: - JSON Decoding Helper

/// Decode a Decodable type from a [String: Any] dictionary via JSON round-trip.
private func decodeInput<T: Decodable>(_ type: T.Type, from arguments: [String: Any]) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: arguments)
    return try JSONDecoder().decode(type, from: data)
}

// MARK: - ListCalendarsTool

public struct ListCalendarsTool: MCPTool {
    public static let name = "calendar_list"
    public static let description = "List all calendars available on the device"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let calendars = try await service.listCalendars()
        return .ok(calendars)
    }
}

// MARK: - TodayEventsTool

public struct TodayEventsTool: MCPTool {
    public static let name = "calendar_today"
    public static let description = "List all events scheduled for today"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let output = try await service.todayEvents()
        return .ok(output)
    }
}

// MARK: - ListEventsTool

public struct ListEventsTool: MCPTool {
    public static let name = "calendar_list_events"
    public static let description = "List events within a date range, optionally filtered by calendar name"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "startDate": [
                "type": "string",
                "description": "Start date in ISO 8601 format",
            ] as [String: Any],
            "endDate": [
                "type": "string",
                "description": "End date in ISO 8601 format",
            ] as [String: Any],
            "calendar": [
                "type": "string",
                "description": "Optional calendar name to filter by",
            ] as [String: Any],
            "limit": [
                "type": "integer",
                "description": "Maximum number of events to return (default 100)",
            ] as [String: Any],
            "offset": [
                "type": "integer",
                "description": "Number of events to skip for pagination (default 0)",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["startDate", "endDate"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["startDate"] is String,
              arguments["endDate"] is String else {
            return .err("Missing required parameters: startDate, endDate")
        }
        let input = try decodeInput(ListEventsInput.self, from: arguments)
        let output = try await service.listEvents(input)
        return .ok(output)
    }
}

// MARK: - SearchEventsTool

public struct SearchEventsTool: MCPTool {
    public static let name = "calendar_search"
    public static let description = "Search events by text query within a date range"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "query": [
                "type": "string",
                "description": "Search text to match against event title and notes",
            ] as [String: Any],
            "startDate": [
                "type": "string",
                "description": "Start date in ISO 8601 format",
            ] as [String: Any],
            "endDate": [
                "type": "string",
                "description": "End date in ISO 8601 format",
            ] as [String: Any],
            "limit": [
                "type": "integer",
                "description": "Maximum number of results to return (default 50)",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["query", "startDate", "endDate"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["query"] is String,
              arguments["startDate"] is String,
              arguments["endDate"] is String else {
            return .err("Missing required parameters: query, startDate, endDate")
        }
        let input = try decodeInput(SearchEventsInput.self, from: arguments)
        let output = try await service.searchEvents(input)
        return .ok(output)
    }
}

// MARK: - ReadEventTool

public struct ReadEventTool: MCPTool {
    public static let name = "calendar_read_event"
    public static let description = "Read full details of a calendar event by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The event identifier",
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
        let input = try decodeInput(ReadEventInput.self, from: arguments)
        let output = try await service.readEvent(input)
        return .ok(output)
    }
}

// MARK: - CreateEventTool

public struct CreateEventTool: MCPTool {
    public static let name = "calendar_create_event"
    public static let description = "Create a new calendar event"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "title": [
                "type": "string",
                "description": "Event title",
            ] as [String: Any],
            "startDate": [
                "type": "string",
                "description": "Start date in ISO 8601 format",
            ] as [String: Any],
            "endDate": [
                "type": "string",
                "description": "End date in ISO 8601 format",
            ] as [String: Any],
            "location": [
                "type": "string",
                "description": "Optional event location",
            ] as [String: Any],
            "notes": [
                "type": "string",
                "description": "Optional event notes",
            ] as [String: Any],
            "calendar": [
                "type": "string",
                "description": "Optional calendar name (uses default if omitted)",
            ] as [String: Any],
            "allDay": [
                "type": "boolean",
                "description": "Whether this is an all-day event",
            ] as [String: Any],
        ] as [String: Any],
        "required": ["title", "startDate", "endDate"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: EventKitService
    public init(service: EventKitService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["title"] is String,
              arguments["startDate"] is String,
              arguments["endDate"] is String else {
            return .err("Missing required parameters: title, startDate, endDate")
        }
        let input = try decodeInput(CreateEventInput.self, from: arguments)
        let output = try await service.createEvent(input)
        return .ok(output)
    }
}

// MARK: - UpdateEventTool

public struct UpdateEventTool: MCPTool {
    public static let name = "calendar_update_event"
    public static let description = "Update an existing calendar event by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The event identifier",
            ] as [String: Any],
            "title": [
                "type": "string",
                "description": "New event title",
            ] as [String: Any],
            "startDate": [
                "type": "string",
                "description": "New start date in ISO 8601 format",
            ] as [String: Any],
            "endDate": [
                "type": "string",
                "description": "New end date in ISO 8601 format",
            ] as [String: Any],
            "location": [
                "type": "string",
                "description": "New event location",
            ] as [String: Any],
            "notes": [
                "type": "string",
                "description": "New event notes",
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
        let input = try decodeInput(UpdateEventInput.self, from: arguments)
        let output = try await service.updateEvent(input)
        return .ok(output)
    }
}

// MARK: - DeleteEventTool

public struct DeleteEventTool: MCPTool {
    public static let name = "calendar_delete_event"
    public static let description = "Delete a calendar event by its ID"
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": [
                "type": "string",
                "description": "The event identifier to delete",
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
        let input = try decodeInput(DeleteEventInput.self, from: arguments)
        let output = try await service.deleteEvent(input)
        return .ok(output)
    }
}

// MARK: - Registration

public func registerCalendarTools(on server: MCPServer, service: EventKitService) async {
    await server.registerTool(ListCalendarsTool(service: service))
    await server.registerTool(TodayEventsTool(service: service))
    await server.registerTool(ListEventsTool(service: service))
    await server.registerTool(SearchEventsTool(service: service))
    await server.registerTool(ReadEventTool(service: service))
    await server.registerTool(CreateEventTool(service: service))
    await server.registerTool(UpdateEventTool(service: service))
    await server.registerTool(DeleteEventTool(service: service))
}
