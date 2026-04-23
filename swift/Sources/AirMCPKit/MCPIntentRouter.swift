// RFC 0007 Phase A — shared entry point for every code-generated AppIntent.
//
// Generated/MCPIntents.swift calls `MCPIntentRouter.shared.call(...)`; this
// file is the hand-written host-side implementation. In A.1 the macOS path
// is a placeholder — the real execFile-based stdio bridge (already prototyped
// in app/Sources/AirMCPApp/AppIntents.swift:runAirMCPTool) lands in A.2 so we
// can keep the golden-sample intent untouched this round.
//
// iOS path is unimplemented; A.2 will wire the in-process AirMCPServer from
// ios/Sources/AirMCPServer/MCPServer.swift.

import Foundation

public enum MCPIntentError: Error {
    case notImplementedOnPlatform(String)
    case toolCallFailed(String)
}

public actor MCPIntentRouter {
    public static let shared = MCPIntentRouter()

    private init() {}

    /// Invoke an AirMCP tool and return its primary text content.
    ///
    /// Phase A.1 scope: throws `notImplementedOnPlatform` — codegen'd
    /// AppIntents compile and register with the system (so Shortcuts /
    /// Spotlight indexing + golden-sample regression works), but runtime
    /// invocation will report a typed error until A.2 ports the stdio
    /// bridge from `AppIntents.swift:runAirMCPTool` into this actor.
    public func call(tool: String, args: [String: Any]) async throws -> String {
        #if os(macOS)
        throw MCPIntentError.notImplementedOnPlatform(
            "macOS router stub — lands in RFC 0007 Phase A.2. Tool requested: \(tool)"
        )
        #elseif os(iOS)
        throw MCPIntentError.notImplementedOnPlatform(
            "iOS router stub — lands in RFC 0007 Phase A.2 (in-process AirMCPServer). Tool requested: \(tool)"
        )
        #else
        throw MCPIntentError.notImplementedOnPlatform(
            "MCPIntentRouter is only wired for Apple platforms. Tool requested: \(tool)"
        )
        #endif
    }
}
