// AirMCPServer — JSON-RPC 2.0 types for MCP protocol.

import Foundation

// MARK: - Request

public struct JSONRPCRequest: Decodable, Sendable {
    public let jsonrpc: String
    public let id: RequestID?
    public let method: String
    public let params: [String: AnyCodable]?

    public enum RequestID: Decodable, Sendable {
        case string(String)
        case int(Int)

        public init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let v = try? container.decode(Int.self) { self = .int(v); return }
            if let v = try? container.decode(String.self) { self = .string(v); return }
            throw DecodingError.typeMismatch(RequestID.self, .init(
                codingPath: decoder.codingPath, debugDescription: "Expected String or Int"))
        }
    }
}

// MARK: - Response

public struct JSONRPCResponse: Encodable, Sendable {
    public let jsonrpc: String
    public let id: AnyCodable?
    public let result: AnyCodable?
    public let error: JSONRPCError?

    public static func success(id: JSONRPCRequest.RequestID?, result: Any) -> JSONRPCResponse {
        JSONRPCResponse(
            jsonrpc: "2.0",
            id: id.map { encodeID($0) },
            result: AnyCodable(result),
            error: nil
        )
    }

    public static func error(id: JSONRPCRequest.RequestID?, code: Int, message: String) -> JSONRPCResponse {
        JSONRPCResponse(
            jsonrpc: "2.0",
            id: id.map { encodeID($0) },
            result: nil,
            error: JSONRPCError(code: code, message: message)
        )
    }

    private static func encodeID(_ id: JSONRPCRequest.RequestID) -> AnyCodable {
        switch id {
        case .string(let s): AnyCodable(s)
        case .int(let i): AnyCodable(i)
        }
    }
}

public struct JSONRPCError: Encodable, Sendable {
    public let code: Int
    public let message: String
}

// MARK: - AnyCodable (minimal, type-erased wrapper)
// @unchecked Sendable: wraps `Any` for JSON-RPC flexibility.
// Values are immutable after init; the type erasure prevents compiler verification.

public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { value = NSNull(); return }
        if let v = try? container.decode(Bool.self) { value = v; return }
        if let v = try? container.decode(Int.self) { value = v; return }
        if let v = try? container.decode(Double.self) { value = v; return }
        if let v = try? container.decode(String.self) { value = v; return }
        if let v = try? container.decode([AnyCodable].self) { value = v.map(\.value); return }
        if let v = try? container.decode([String: AnyCodable].self) {
            value = v.mapValues(\.value); return
        }
        throw DecodingError.typeMismatch(AnyCodable.self, .init(
            codingPath: decoder.codingPath, debugDescription: "Unsupported type"))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let v as Bool: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [Any]: try container.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try container.encode(v.mapValues { AnyCodable($0) })
        default: try container.encodeNil()
        }
    }
}
