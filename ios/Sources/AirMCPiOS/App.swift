// AirMCP iOS — SwiftUI app with embedded MCP server.

import SwiftUI
import AirMCPKit
import AirMCPServer

@main
struct AirMCPiOSApp: App {
    @State private var serverManager = ServerManager()

    var body: some Scene {
        WindowGroup {
            ContentView(serverManager: serverManager)
                .task { await serverManager.start() }
        }
    }
}

// MARK: - Server Manager

@Observable
@MainActor
final class ServerManager {
    private(set) var isRunning = false
    private(set) var toolCount = 0
    private(set) var token = ""
    private(set) var errorMessage: String?

    func start() async {
        let mcp = MCPServer(name: "airmcp-ios", version: "1.0.0")

        // iOS is a preview, not the macOS shipping surface. Its server and
        // AppIntent router expose the same small, read-only demonstrator set
        // until the shared HITL/rate-limit/audit governance path exists here.
        await registerIOSPreviewTools(on: mcp)

        toolCount = await mcp.toolCount

        // Route generated AppIntents directly into this in-process server.
        // MCPServer.callToolText enforces IOSPreviewContract again, so an
        // unlisted generated action fails closed even if invoked by the OS.
        await MCPIntentRouter.shared.setHandler { [mcp] tool, args in
            return try await mcp.callToolText(name: tool, args: args)
        }

        // `MCPHTTPServer.make(...)` is the persistence-aware factory: it
        // looks up the Bearer token in Keychain and only generates a new
        // one on first launch. Synchronous `MCPHTTPServer.init(token:)`
        // is reserved for tests / explicit-pairing flows where the
        // caller already has a token in hand.
        let server = await MCPHTTPServer.make(mcp: mcp, port: 3847)
        token = await server.authToken

        isRunning = true
        do {
            try await server.start()
        } catch {
            isRunning = false
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Content View

struct ContentView: View {
    let serverManager: ServerManager

    var body: some View {
        NavigationStack {
            List {
                Section("Server") {
                    HStack {
                        Image(systemName: serverManager.isRunning ? "circle.fill" : "circle")
                            .foregroundStyle(serverManager.isRunning ? .green : .gray)
                            .font(.caption)
                        Text(serverManager.isRunning ? "Running" : "Starting...")
                        Spacer()
                        Text("\(serverManager.toolCount) tools")
                            .foregroundStyle(.secondary)
                    }
                    if serverManager.isRunning {
                        LabeledContent("Endpoint") {
                            Text("localhost:3847/mcp")
                                .font(.caption.monospaced())
                        }
                        LabeledContent("Token") {
                            Text(serverManager.token.prefix(8) + "...")
                                .font(.caption.monospaced())
                        }
                    }
                    if let error = serverManager.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }

                Section("Read-only preview") {
                    Label("Calendar", systemImage: "calendar")
                    Label("Reminders", systemImage: "checklist")
                    Label("Contacts", systemImage: "person.crop.circle")
                    Label("Location permission", systemImage: "location")
                }
            }
            .navigationTitle("AirMCP")
        }
    }
}
