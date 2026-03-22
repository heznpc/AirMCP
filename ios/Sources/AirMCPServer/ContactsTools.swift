// AirMCPServer — MCPTool wrappers for ContactsService.

import Foundation
import AirMCPKit

// MARK: - JSON Decoding Helper

/// Decode a Decodable type from a [String: Any] dictionary via JSON round-trip.
private func decodeInput<T: Decodable>(_ type: T.Type, from arguments: [String: Any]) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: arguments)
    return try JSONDecoder().decode(type, from: data)
}

// MARK: - List Contacts

public struct ListContactsTool: MCPTool {
    public static let name = "contacts_list"
    public static let description = "List contacts with pagination (limit/offset)."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "limit": ["type": "integer", "description": "Max contacts to return (default 100)"],
            "offset": ["type": "integer", "description": "Number of contacts to skip (default 0)"],
        ] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let limit = arguments["limit"] as? Int
        let offset = arguments["offset"] as? Int
        let input = ListContactsInput(limit: limit, offset: offset)
        let result = try await service.listContacts(input)
        return .ok(result)
    }
}

// MARK: - Search Contacts

public struct SearchContactsTool: MCPTool {
    public static let name = "contacts_search"
    public static let description = "Search contacts by name, organization, email, or phone."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "query": ["type": "string", "description": "Search query string"],
            "limit": ["type": "integer", "description": "Max results to return (default 50)"],
        ] as [String: Any],
        "required": ["query"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["query"] is String else {
            return .err("Missing required argument: query")
        }
        let input = try decodeInput(SearchContactsInput.self, from: arguments)
        let result = try await service.searchContacts(input)
        return .ok(result)
    }
}

// MARK: - Read Contact

public struct ReadContactTool: MCPTool {
    public static let name = "contacts_read"
    public static let description = "Read full details of a single contact by ID."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": ["type": "string", "description": "Contact identifier"],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required argument: id")
        }
        let input = try decodeInput(ReadContactInput.self, from: arguments)
        let result = try await service.readContact(input)
        return .ok(result)
    }
}

// MARK: - Create Contact

public struct CreateContactTool: MCPTool {
    public static let name = "contacts_create"
    public static let description = "Create a new contact with name and optional details."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "firstName": ["type": "string", "description": "First name"],
            "lastName": ["type": "string", "description": "Last name"],
            "email": ["type": "string", "description": "Email address"],
            "phone": ["type": "string", "description": "Phone number"],
            "organization": ["type": "string", "description": "Organization name"],
            "jobTitle": ["type": "string", "description": "Job title"],
            "note": ["type": "string", "description": "Note text"],
        ] as [String: Any],
        "required": ["firstName", "lastName"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["firstName"] is String else {
            return .err("Missing required argument: firstName")
        }
        guard arguments["lastName"] is String else {
            return .err("Missing required argument: lastName")
        }
        let input = try decodeInput(CreateContactInput.self, from: arguments)
        let result = try await service.createContact(input)
        return .ok(result)
    }
}

// MARK: - Update Contact

public struct UpdateContactTool: MCPTool {
    public static let name = "contacts_update"
    public static let description = "Update an existing contact's fields by ID."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": ["type": "string", "description": "Contact identifier"],
            "firstName": ["type": "string", "description": "New first name"],
            "lastName": ["type": "string", "description": "New last name"],
            "organization": ["type": "string", "description": "New organization name"],
            "jobTitle": ["type": "string", "description": "New job title"],
            "note": ["type": "string", "description": "New note text"],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required argument: id")
        }
        let input = try decodeInput(UpdateContactInput.self, from: arguments)
        let result = try await service.updateContact(input)
        return .ok(result)
    }
}

// MARK: - Delete Contact

public struct DeleteContactTool: MCPTool {
    public static let name = "contacts_delete"
    public static let description = "Permanently delete a contact by ID."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "id": ["type": "string", "description": "Contact identifier to delete"],
        ] as [String: Any],
        "required": ["id"],
    ]
    public static let readOnly = false
    public static let destructive = true

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        guard arguments["id"] is String else {
            return .err("Missing required argument: id")
        }
        let input = try decodeInput(DeleteContactInput.self, from: arguments)
        let result = try await service.deleteContact(input)
        return .ok(result)
    }
}

// MARK: - List Groups

public struct ListGroupsTool: MCPTool {
    public static let name = "contacts_list_groups"
    public static let description = "List all contact groups."
    nonisolated(unsafe) public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [:] as [String: Any],
    ]
    public static let readOnly = true
    public static let destructive = false

    private let service: ContactsService

    public init(service: ContactsService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> MCPToolResult {
        let result = try await service.listGroups()
        return .ok(result)
    }
}

// MARK: - Registration Helper

public func registerContactsTools(on server: MCPServer, service: ContactsService) async {
    await server.registerTool(ListContactsTool(service: service))
    await server.registerTool(SearchContactsTool(service: service))
    await server.registerTool(ReadContactTool(service: service))
    await server.registerTool(CreateContactTool(service: service))
    await server.registerTool(UpdateContactTool(service: service))
    await server.registerTool(DeleteContactTool(service: service))
    await server.registerTool(ListGroupsTool(service: service))
}
