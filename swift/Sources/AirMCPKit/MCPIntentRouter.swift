// RFC 0007 Phase A — shared entry point for every code-generated AppIntent.
//
// Generated/MCPIntents.swift calls `MCPIntentRouter.shared.call(...)`. The
// actual transport (execFile stdio on macOS, in-process on iOS) varies by
// host, and the host owns components AirMCPKit can't depend on upward:
//   macOS app → uses app/Sources/AirMCPApp/AppIntents.swift:runAirMCPTool
//               (Process + Pipe machinery against the npx-installed airmcp)
//   iOS app   → uses ios/Sources/AirMCPServer/MCPServer.swift in-process
//               (no IPC; just an actor.call with JSONRPCRequest).
//
// Rather than conditional compilation against those upper modules
// (which would introduce a circular dependency), the router accepts an
// async handler that the host installs at launch. AirMCPKit stays
// dependency-free; the host is responsible for wiring the transport.
//
// Phase A.2a (this file): handler injection + stable public API.
// Phase A.2b (follow-up): broaden generated intents from 10 → ~150 and
// switch ReturnsValue<String> to typed payload.

import Foundation

public enum MCPIntentError: Error, Sendable {
    /// No host handler was registered before an AppIntent fired. Surfaced
    /// verbatim in the AppIntent failure dialog so debugging is easy.
    case handlerNotInstalled(tool: String)
    /// The host handler ran but the tool reported a failure.
    case toolCallFailed(tool: String, message: String)
}

/// Signature hosts must implement: take a tool name + plain-object args,
/// return the tool's primary text output (string). Typed payloads arrive
/// in Phase A.2b; A.2a keeps the interface minimal so A.1's generated
/// file doesn't need to change when A.2b lands.
///
/// `args` is constrained to `any Sendable` rather than `Any` so the actor
/// boundary check at `call(...)` passes under Swift 6 strict concurrency.
/// The generated intents only pass primitives (String, Int, Double, Bool),
/// each of which conforms to Sendable.
public typealias MCPIntentHandler = @Sendable (
    _ tool: String,
    _ args: [String: any Sendable]
) async throws -> String

public actor MCPIntentRouter {
    public static let shared = MCPIntentRouter()

    private var handler: MCPIntentHandler?

    private init() {}

    /// Install the transport. Call exactly once at app launch. If called
    /// more than once, the most recent handler wins — tests overriding
    /// the production handler benefit from this (the prior handler is
    /// discarded, not stacked).
    public func setHandler(_ handler: @escaping MCPIntentHandler) {
        self.handler = handler
    }

    /// Invoke an AirMCP tool and return its primary text content.
    ///
    /// Throws `MCPIntentError.handlerNotInstalled` if the host never
    /// registered a handler — this is almost always a launch-order bug,
    /// so the error includes the requested tool name to make the stack
    /// trace obvious.
    public func call(tool: String, args: [String: any Sendable]) async throws -> String {
        guard let handler else {
            throw MCPIntentError.handlerNotInstalled(tool: tool)
        }
        return try await handler(tool, args)
    }
}
