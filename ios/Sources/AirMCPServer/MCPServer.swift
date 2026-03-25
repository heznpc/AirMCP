// AirMCPServer — MCP protocol handler with tool registration and dispatch.

import Foundation

// MARK: - Tool Protocol

public protocol MCPTool: Sendable {
    static var name: String { get }
    static var description: String { get }
    nonisolated(unsafe) static var inputSchema: [String: Any] { get }
    static var readOnly: Bool { get }
    static var destructive: Bool { get }
    func execute(arguments: [String: Any]) async throws -> MCPToolResult
}

public struct MCPToolResult: Sendable {
    public let content: [ContentItem]
    public let isError: Bool

    public static func ok<T: Encodable>(_ value: T) -> MCPToolResult {
        let data = (try? JSONEncoder().encode(value)) ?? Data("{}".utf8)
        let text = String(data: data, encoding: .utf8) ?? "{}"
        return MCPToolResult(content: [.init(type: "text", text: text)], isError: false)
    }

    public static func ok(_ text: String) -> MCPToolResult {
        MCPToolResult(content: [.init(type: "text", text: text)], isError: false)
    }

    public static func err(_ message: String) -> MCPToolResult {
        MCPToolResult(content: [.init(type: "text", text: message)], isError: true)
    }

    public struct ContentItem: Sendable {
        public let type: String
        public let text: String
    }
}

// MARK: - Tool Box (type-erased wrapper)
// @unchecked Sendable: all fields are immutable after init. The `[String: Any]`
// inputSchema and closure capture prevent automatic Sendable inference.

struct ToolBox: @unchecked Sendable {
    let name: String
    let description: String
    let inputSchema: [String: Any]
    let readOnly: Bool
    let destructive: Bool
    let execute: @Sendable ([String: Any]) async throws -> MCPToolResult

    init<T: MCPTool>(_ tool: T) {
        self.name = type(of: tool).name
        self.description = type(of: tool).description
        self.inputSchema = type(of: tool).inputSchema
        self.readOnly = type(of: tool).readOnly
        self.destructive = type(of: tool).destructive
        self.execute = { args in try await tool.execute(arguments: args) }
    }
}

// MARK: - MCP Server

public actor MCPServer {
    private var tools: [String: ToolBox] = [:]
    private let serverName: String
    private let serverVersion: String

    public init(name: String = "airmcp-ios", version: String = "1.0.0") {
        self.serverName = name
        self.serverVersion = version
    }

    public func registerTool<T: MCPTool>(_ tool: T) {
        tools[type(of: tool).name] = ToolBox(tool)
    }

    public var toolCount: Int { tools.count }

    // MARK: - JSON-RPC Dispatch

    public func handle(_ request: JSONRPCRequest) async -> JSONRPCResponse {
        switch request.method {
        case "initialize":
            return handleInitialize(id: request.id)
        case "notifications/initialized":
            return .success(id: request.id, result: [:] as [String: String])
        case "tools/list":
            return handleToolsList(id: request.id)
        case "tools/call":
            return await handleToolCall(id: request.id, params: request.params)
        case "resources/list":
            return .success(id: request.id, result: ["resources": [] as [Any]])
        case "prompts/list":
            return .success(id: request.id, result: ["prompts": [] as [Any]])
        case "ping":
            return .success(id: request.id, result: [:] as [String: String])
        default:
            return .error(id: request.id, code: -32601, message: "Method not found: \(request.method)")
        }
    }

    // MARK: - Handlers

    private func handleInitialize(id: JSONRPCRequest.RequestID?) -> JSONRPCResponse {
        .success(id: id, result: [
            "protocolVersion": "2025-03-26",
            "capabilities": [
                "tools": ["listChanged": false],
                "resources": ["subscribe": false, "listChanged": false],
                "prompts": ["listChanged": false],
            ] as [String: Any],
            "serverInfo": [
                "name": serverName,
                "version": serverVersion,
            ] as [String: Any],
        ] as [String: Any])
    }

    private func handleToolsList(id: JSONRPCRequest.RequestID?) -> JSONRPCResponse {
        let toolList = tools.values.map { tool -> [String: Any] in
            var schema = tool.inputSchema
            if schema.isEmpty {
                schema = ["type": "object", "properties": [:] as [String: Any]]
            }
            return [
                "name": tool.name,
                "description": tool.description,
                "inputSchema": schema,
                "annotations": [
                    "readOnlyHint": tool.readOnly,
                    "destructiveHint": tool.destructive,
                    "idempotentHint": tool.readOnly,
                    "openWorldHint": false,
                ] as [String: Any],
            ]
        }
        return .success(id: id, result: ["tools": toolList])
    }

    private func handleToolCall(
        id: JSONRPCRequest.RequestID?,
        params: [String: AnyCodable]?
    ) async -> JSONRPCResponse {
        guard let params,
              let name = params["name"]?.value as? String else {
            return .error(id: id, code: -32602, message: "Missing 'name' in params")
        }

        guard let tool = tools[name] else {
            return .error(id: id, code: -32602, message: "Unknown tool: \(name)")
        }

        let args = (params["arguments"]?.value as? [String: Any]) ?? [:]

        do {
            let result = try await tool.execute(args)
            let content = result.content.map { item -> [String: Any] in
                ["type": item.type, "text": item.text]
            }
            var response: [String: Any] = ["content": content]
            if result.isError { response["isError"] = true }
            return .success(id: id, result: response)
        } catch {
            return .success(id: id, result: [
                "content": [["type": "text", "text": "Error: \(error.localizedDescription)"]],
                "isError": true,
            ] as [String: Any])
        }
    }
}
