// AirMCPServer — Hummingbird HTTP transport for MCP protocol.
// Binds to localhost only. Bearer token auth on /mcp endpoint.

import Foundation
import Hummingbird

public actor MCPHTTPServer {
    private let mcp: MCPServer
    private let host: String
    private let port: Int
    private let token: String

    public init(
        mcp: MCPServer,
        host: String = "127.0.0.1",
        port: Int = 3847,
        token: String? = nil
    ) {
        self.mcp = mcp
        self.host = host
        self.port = port
        self.token = token ?? Self.generateToken()
    }

    public var authToken: String { token }

    // MARK: - Start

    public func start() async throws {
        let mcpRef = mcp
        let authToken = token
        let serverPort = port

        let router = Router()

        // Health check — no auth
        router.get("/health") { _, _ in
            let count = await mcpRef.toolCount
            let body = """
            {"status":"ok","server":"airmcp-ios","tools":\(count)}
            """
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: .init(string: body))
            )
        }

        // Server card — no auth
        router.get("/.well-known/mcp.json") { _, _ in
            let body = """
            {"name":"airmcp-ios","version":"1.0.0","transport":{"type":"streamable-http","url":"http://127.0.0.1:\(serverPort)/mcp"}}
            """
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: .init(string: body))
            )
        }

        // MCP endpoint — bearer token auth
        router.post("/mcp") { request, _ in
            // Auth check
            if !authToken.isEmpty {
                let authHeader = request.headers[.authorization]
                guard authHeader == "Bearer \(authToken)" else {
                    return Response(
                        status: .unauthorized,
                        headers: [.contentType: "application/json"],
                        body: .init(byteBuffer: .init(string: "{\"error\":\"Unauthorized\"}"))
                    )
                }
            }

            // Parse JSON-RPC request
            let bodyData: Data
            do {
                let collected = try await request.body.collect(upTo: 1_048_576)
                bodyData = Data(buffer: collected)
            } catch {
                return Self.jsonRPCError(id: nil, code: -32700, message: "Parse error")
            }

            let rpcRequest: JSONRPCRequest
            do {
                rpcRequest = try JSONDecoder().decode(JSONRPCRequest.self, from: bodyData)
            } catch {
                return Self.jsonRPCError(id: nil, code: -32700, message: "Invalid JSON-RPC: \(error.localizedDescription)")
            }

            // Dispatch to MCP server
            let rpcResponse = await mcpRef.handle(rpcRequest)

            // Encode response
            do {
                let responseData = try JSONEncoder().encode(rpcResponse)
                return Response(
                    status: .ok,
                    headers: [.contentType: "application/json"],
                    body: .init(byteBuffer: .init(data: responseData))
                )
            } catch {
                return Self.jsonRPCError(id: rpcRequest.id, code: -32603, message: "Internal error")
            }
        }

        // Start server
        let app = Application(
            router: router,
            configuration: .init(address: .hostname(host, port: port))
        )

        print("[AirMCP-iOS] MCP server listening on http://\(host):\(port)")
        if !token.isEmpty {
            print("[AirMCP-iOS] Auth token: \(token)")
        }

        try await app.run()
    }

    // MARK: - Helpers

    private static func jsonRPCError(id: JSONRPCRequest.RequestID?, code: Int, message: String) -> Response {
        let response = JSONRPCResponse.error(id: id, code: code, message: message)
        let data = (try? JSONEncoder().encode(response)) ?? Data("{\"error\":\"encode failed\"}".utf8)
        return Response(
            status: .ok,
            headers: [.contentType: "application/json"],
            body: .init(byteBuffer: .init(data: data))
        )
    }

    private static func generateToken() -> String {
        let bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        return Data(bytes).base64EncodedString()
    }
}
