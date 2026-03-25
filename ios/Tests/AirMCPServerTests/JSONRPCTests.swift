// AirMCPServer — JSON-RPC types and MCP server tests.

import XCTest
@testable import AirMCPServer

// MARK: - JSON-RPC Request Parsing

final class JSONRPCRequestTests: XCTestCase {

    func testParseStringId() throws {
        let json = """
        {"jsonrpc": "2.0", "id": "abc-123", "method": "tools/list"}
        """
        let request = try JSONDecoder().decode(JSONRPCRequest.self, from: Data(json.utf8))
        XCTAssertEqual(request.jsonrpc, "2.0")
        XCTAssertEqual(request.method, "tools/list")
        if case .string(let s) = request.id {
            XCTAssertEqual(s, "abc-123")
        } else {
            XCTFail("Expected string ID")
        }
    }

    func testParseIntId() throws {
        let json = """
        {"jsonrpc": "2.0", "id": 42, "method": "ping"}
        """
        let request = try JSONDecoder().decode(JSONRPCRequest.self, from: Data(json.utf8))
        if case .int(let i) = request.id {
            XCTAssertEqual(i, 42)
        } else {
            XCTFail("Expected integer ID")
        }
    }

    func testParseNotification() throws {
        let json = """
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
        """
        let request = try JSONDecoder().decode(JSONRPCRequest.self, from: Data(json.utf8))
        XCTAssertNil(request.id)
        XCTAssertEqual(request.method, "notifications/initialized")
    }

    func testParseWithParams() throws {
        let json = """
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "calendar_list", "arguments": {}}}
        """
        let request = try JSONDecoder().decode(JSONRPCRequest.self, from: Data(json.utf8))
        XCTAssertNotNil(request.params)
        XCTAssertEqual(request.params?["name"]?.value as? String, "calendar_list")
    }
}

// MARK: - JSON-RPC Response Encoding

final class JSONRPCResponseTests: XCTestCase {

    func testSuccessResponseEncodes() throws {
        let response = JSONRPCResponse.success(
            id: .int(1),
            result: ["key": "value"] as [String: String]
        )
        let data = try JSONEncoder().encode(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["jsonrpc"] as? String, "2.0")
        XCTAssertNil(json?["error"])
    }

    func testErrorResponseEncodes() throws {
        let response = JSONRPCResponse.error(
            id: .string("req-1"),
            code: -32601,
            message: "Method not found"
        )
        let data = try JSONEncoder().encode(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["jsonrpc"] as? String, "2.0")
        let error = json?["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? Int, -32601)
        XCTAssertEqual(error?["message"] as? String, "Method not found")
    }

    func testNullIdResponseEncodes() throws {
        let response = JSONRPCResponse.success(id: nil, result: [:] as [String: String])
        let data = try JSONEncoder().encode(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["jsonrpc"] as? String, "2.0")
    }
}

// MARK: - AnyCodable

final class AnyCodableTests: XCTestCase {

    func testEncodeString() throws {
        let value = AnyCodable("hello")
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(String(data: data, encoding: .utf8), "\"hello\"")
    }

    func testEncodeInt() throws {
        let value = AnyCodable(42)
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(String(data: data, encoding: .utf8), "42")
    }

    func testEncodeBool() throws {
        let value = AnyCodable(true)
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(String(data: data, encoding: .utf8), "true")
    }

    func testEncodeNestedDict() throws {
        let value = AnyCodable(["key": "value"] as [String: Any])
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["key"] as? String, "value")
    }

    func testDecodeMixedTypes() throws {
        let json = """
        {"string": "hello", "number": 42, "bool": true, "array": [1, 2, 3]}
        """
        let decoded = try JSONDecoder().decode([String: AnyCodable].self, from: Data(json.utf8))
        XCTAssertEqual(decoded["string"]?.value as? String, "hello")
        XCTAssertEqual(decoded["number"]?.value as? Int, 42)
        XCTAssertEqual(decoded["bool"]?.value as? Bool, true)
    }

    func testRoundtrip() throws {
        let original: [String: AnyCodable] = [
            "name": AnyCodable("test"),
            "count": AnyCodable(5),
            "active": AnyCodable(true),
        ]
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode([String: AnyCodable].self, from: data)
        XCTAssertEqual(decoded["name"]?.value as? String, "test")
        XCTAssertEqual(decoded["count"]?.value as? Int, 5)
        XCTAssertEqual(decoded["active"]?.value as? Bool, true)
    }
}

// MARK: - MCPToolResult

final class MCPToolResultTests: XCTestCase {

    func testOkString() {
        let result = MCPToolResult.ok("success")
        XCTAssertFalse(result.isError)
        XCTAssertEqual(result.content.count, 1)
        XCTAssertEqual(result.content[0].type, "text")
        XCTAssertEqual(result.content[0].text, "success")
    }

    func testOkEncodable() {
        struct TestData: Encodable { let value: Int }
        let result = MCPToolResult.ok(TestData(value: 42))
        XCTAssertFalse(result.isError)
        XCTAssertTrue(result.content[0].text.contains("42"))
    }

    func testErrResult() {
        let result = MCPToolResult.err("something failed")
        XCTAssertTrue(result.isError)
        XCTAssertEqual(result.content[0].text, "something failed")
    }
}

// MARK: - MCPServer Dispatch

final class MCPServerDispatchTests: XCTestCase {

    func testInitializeResponse() async throws {
        let server = MCPServer(name: "test-server", version: "0.1.0")
        let request = try decodeRequest("""
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        """)
        let response = await server.handle(request)
        let data = try JSONEncoder().encode(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let result = json?["result"] as? [String: Any]
        XCTAssertEqual(result?["protocolVersion"] as? String, "2025-03-26")
        let serverInfo = result?["serverInfo"] as? [String: Any]
        XCTAssertEqual(serverInfo?["name"] as? String, "test-server")
    }

    func testPingResponse() async throws {
        let server = MCPServer()
        let request = try decodeRequest("""
        {"jsonrpc": "2.0", "id": "ping-1", "method": "ping"}
        """)
        let response = await server.handle(request)
        XCTAssertNil(response.error)
    }

    func testUnknownMethodReturnsError() async throws {
        let server = MCPServer()
        let request = try decodeRequest("""
        {"jsonrpc": "2.0", "id": 1, "method": "unknown/method"}
        """)
        let response = await server.handle(request)
        XCTAssertNotNil(response.error)
        XCTAssertEqual(response.error?.code, -32601)
    }

    func testEmptyToolsList() async throws {
        let server = MCPServer()
        let request = try decodeRequest("""
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        """)
        let response = await server.handle(request)
        let data = try JSONEncoder().encode(response)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let result = json?["result"] as? [String: Any]
        let tools = result?["tools"] as? [Any]
        XCTAssertEqual(tools?.count, 0)
    }

    func testUnknownToolCallReturnsError() async throws {
        let server = MCPServer()
        let request = try decodeRequest("""
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "nonexistent"}}
        """)
        let response = await server.handle(request)
        // Unknown tool returns a JSON-RPC error (not result with isError)
        XCTAssertNotNil(response.error)
        XCTAssertEqual(response.error?.code, -32602)
    }

    // MARK: - Helper

    private func decodeRequest(_ json: String) throws -> JSONRPCRequest {
        try JSONDecoder().decode(JSONRPCRequest.self, from: Data(json.utf8))
    }
}
