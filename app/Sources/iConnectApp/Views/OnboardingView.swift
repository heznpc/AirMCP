import SwiftUI
import AppKit

// MARK: - Onboarding Module Item

private struct OnboardingModule: Identifiable {
    let id: String
    let name: String
    let icon: String
    let description: String
}

private let onboardingModules: [OnboardingModule] = [
    OnboardingModule(id: "notes", name: "Notes", icon: "note.text", description: "Read, create, and search notes"),
    OnboardingModule(id: "reminders", name: "Reminders", icon: "checklist", description: "Create and manage reminders"),
    OnboardingModule(id: "calendar", name: "Calendar", icon: "calendar", description: "Events and scheduling"),
    OnboardingModule(id: "contacts", name: "Contacts", icon: "person.2", description: "Look up and manage contacts"),
    OnboardingModule(id: "mail", name: "Mail", icon: "envelope", description: "Read, search, and compose mail"),
    OnboardingModule(id: "messages", name: "Messages", icon: "bubble.left", description: "Read, search, and send messages"),
    OnboardingModule(id: "music", name: "Music", icon: "music.note", description: "Playback and library control"),
    OnboardingModule(id: "finder", name: "Finder", icon: "folder", description: "Files and folder management"),
    OnboardingModule(id: "safari", name: "Safari", icon: "safari", description: "Tabs and bookmarks"),
    OnboardingModule(id: "system", name: "System", icon: "gearshape", description: "System preferences and clipboard"),
    OnboardingModule(id: "photos", name: "Photos", icon: "photo", description: "Browse and search photos"),
    OnboardingModule(id: "shortcuts", name: "Shortcuts", icon: "command", description: "Run and manage shortcuts"),
    OnboardingModule(id: "ui", name: "UI Automation", icon: "hand.tap", description: "Accessibility-based app control"),
    OnboardingModule(id: "intelligence", name: "Intelligence", icon: "brain", description: "AI features (macOS 26+)"),
    OnboardingModule(id: "tv", name: "TV", icon: "tv", description: "Playback and library"),
]

// MARK: - MCP Client

private struct MCPClient: Identifiable {
    let id: String
    let name: String
    let icon: String
    let configPath: String
    var detected: Bool
}

// MARK: - Onboarding View

struct OnboardingView: View {
    let configManager: ConfigManager
    let onComplete: () -> Void

    @State private var currentStep = 0
    @State private var nodeAvailable = false
    @State private var nodeChecking = true
    @State private var disabledModules: Set<String> = []
    @State private var mcpClients: [MCPClient] = []
    @State private var patchingClient: String?
    @State private var patchResults: [String: Bool] = [:]

    private let totalSteps = 5

    var body: some View {
        VStack(spacing: 0) {
            // Progress dots
            HStack(spacing: 8) {
                ForEach(0..<totalSteps, id: \.self) { step in
                    Circle()
                        .fill(step == currentStep ? Color.accentColor : Color.secondary.opacity(0.3))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.top, 20)
            .padding(.bottom, 16)

            // Step content
            Group {
                switch currentStep {
                case 0: welcomeStep
                case 1: nodeCheckStep
                case 2: moduleSelectionStep
                case 3: permissionStep
                case 4: clientDetectionStep
                default: EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Navigation buttons
            HStack {
                if currentStep > 0 {
                    Button("Back") {
                        withAnimation { currentStep -= 1 }
                    }
                    .keyboardShortcut(.cancelAction)
                }

                Spacer()

                if currentStep < totalSteps - 1 {
                    Button("Next") {
                        advanceStep()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(currentStep == 1 && !nodeAvailable)
                } else {
                    Button("Finish") {
                        saveAndComplete()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
        }
        .frame(width: 520, height: 480)
    }

    // MARK: - Step 1: Welcome

    private var welcomeStep: some View {
        VStack(spacing: 16) {
            Spacer()

            if let iconURL = Bundle.module.url(forResource: "AppIcon@2x", withExtension: "png", subdirectory: "Resources"),
               let nsImage = NSImage(contentsOf: iconURL) {
                Image(nsImage: nsImage)
                    .resizable()
                    .frame(width: 72, height: 72)
            }

            Text("Welcome to AirMCP")
                .font(.title)
                .fontWeight(.bold)

            Text("AirMCP lets AI assistants like Claude interact with your Mac apps \u{2014} Notes, Calendar, Mail, Reminders, and more \u{2014} through the Model Context Protocol (MCP).")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)

            Text("This setup will take about a minute.")
                .font(.callout)
                .foregroundStyle(.tertiary)

            Spacer()
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Step 2: Node.js Check

    private var nodeCheckStep: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "shippingbox")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)

            Text("Node.js Required")
                .font(.title2)
                .fontWeight(.semibold)

            if nodeChecking {
                ProgressView()
                    .controlSize(.small)
                Text("Checking for Node.js...")
                    .foregroundStyle(.secondary)
            } else if nodeAvailable {
                Label("Node.js found", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.headline)
            } else {
                Label("Node.js not found", systemImage: "xmark.circle.fill")
                    .foregroundStyle(.red)
                    .font(.headline)

                Text("AirMCP requires Node.js to run. Please install it and relaunch the app.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 380)

                Link("Download Node.js", destination: URL(string: "https://nodejs.org")!)
                    .font(.headline)

                Button("Check Again") {
                    nodeChecking = true
                    Task { await checkNode() }
                }
            }

            Spacer()
        }
        .padding(.horizontal, 32)
        .task { await checkNode() }
    }

    // MARK: - Step 3: Module Selection

    private var moduleSelectionStep: some View {
        VStack(spacing: 12) {
            Text("Choose Modules")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Select which Mac apps AirMCP can access. You can change these later in Settings.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)

            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(onboardingModules) { module in
                        moduleCard(module)
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(maxHeight: 260)

            HStack(spacing: 16) {
                Button("Enable All") {
                    disabledModules.removeAll()
                }
                .font(.caption)
                Button("Disable All") {
                    disabledModules = Set(onboardingModules.map(\.id))
                }
                .font(.caption)
            }
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func moduleCard(_ module: OnboardingModule) -> some View {
        let isEnabled = !disabledModules.contains(module.id)

        Button {
            if isEnabled {
                disabledModules.insert(module.id)
            } else {
                disabledModules.remove(module.id)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: module.icon)
                    .frame(width: 20)
                    .foregroundStyle(isEnabled ? Color.accentColor : Color.secondary)

                VStack(alignment: .leading, spacing: 1) {
                    Text(module.name)
                        .font(.callout)
                        .fontWeight(.medium)
                    Text(module.description)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: isEnabled ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isEnabled ? .green : .secondary)
            }
            .padding(8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isEnabled ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isEnabled ? Color.accentColor.opacity(0.3) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step 4: Permissions

    private var permissionStep: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "lock.shield")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)

            Text("macOS Permissions")
                .font(.title2)
                .fontWeight(.semibold)

            Text("AirMCP uses AppleScript to communicate with Mac apps. macOS will ask for permission the first time each app is accessed.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)

            VStack(alignment: .leading, spacing: 10) {
                permissionRow(
                    icon: "checkmark.shield",
                    title: "Automation",
                    detail: "Allow AirMCP to control apps when prompted"
                )
                permissionRow(
                    icon: "accessibility",
                    title: "Accessibility (optional)",
                    detail: "Needed for some System module features"
                )
                permissionRow(
                    icon: "bell.badge",
                    title: "Notifications",
                    detail: "For approval prompts (HITL confirmation)"
                )
            }
            .padding(.horizontal, 32)

            Button("Open System Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
                    NSWorkspace.shared.open(url)
                }
            }
            .controlSize(.large)

            Text("You can also grant permissions as they are requested at runtime.")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Spacer()
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func permissionRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.accentColor)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .fontWeight(.medium)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Step 5: Client Detection

    private var clientDetectionStep: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "app.connected.to.app.below.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)

            Text("Connect to an AI Client")
                .font(.title2)
                .fontWeight(.semibold)

            Text("AirMCP detected the following MCP-compatible clients. Patch their config to add AirMCP automatically.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)

            VStack(spacing: 8) {
                ForEach($mcpClients) { $client in
                    clientRow(client: client)
                }
            }
            .padding(.horizontal, 24)

            if mcpClients.allSatisfy({ !$0.detected }) {
                Text("No supported clients detected. You can configure manually later using the \"Copy Config\" menu items.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 380)
            }

            Spacer()
        }
        .padding(.horizontal, 24)
        .task { detectClients() }
    }

    @ViewBuilder
    private func clientRow(client: MCPClient) -> some View {
        HStack {
            Image(systemName: client.icon)
                .frame(width: 24)
                .foregroundStyle(client.detected ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading) {
                Text(client.name)
                    .fontWeight(.medium)
                Text(client.detected ? "Installed" : "Not found")
                    .font(.caption)
                    .foregroundStyle(client.detected ? .green : .secondary)
            }

            Spacer()

            if client.detected {
                if let result = patchResults[client.id] {
                    Label(result ? "Patched" : "Failed", systemImage: result ? "checkmark.circle.fill" : "xmark.circle")
                        .foregroundStyle(result ? .green : .red)
                        .font(.caption)
                } else if patchingClient == client.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button("Auto-Patch") {
                        patchClient(client)
                    }
                    .controlSize(.small)
                }
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.05))
        )
    }

    // MARK: - Logic

    private func advanceStep() {
        withAnimation { currentStep += 1 }
    }

    private func checkNode() async {
        let found = await Task.detached {
            Self.nodeExists()
        }.value
        nodeChecking = false
        nodeAvailable = found
    }

    private nonisolated static func nodeExists() -> Bool {
        NodeEnvironment.nodeExists()
    }

    private func detectClients() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let clients = [
            MCPClient(
                id: "claude-desktop",
                name: "Claude Desktop",
                icon: "message",
                configPath: "\(home)/Library/Application Support/Claude/claude_desktop_config.json",
                detected: false
            ),
            MCPClient(
                id: "cursor",
                name: "Cursor",
                icon: "cursorarrow",
                configPath: "\(home)/.cursor/mcp.json",
                detected: false
            ),
            MCPClient(
                id: "windsurf",
                name: "Windsurf",
                icon: "wind",
                configPath: "\(home)/.codeium/windsurf/mcp_config.json",
                detected: false
            ),
        ]

        mcpClients = clients.map { client in
            var c = client
            // Check if the parent directory exists (app is installed even without config)
            let configDir = (client.configPath as NSString).deletingLastPathComponent
            let configExists = FileManager.default.fileExists(atPath: client.configPath)
            let dirExists = FileManager.default.isReadableFile(atPath: configDir)
            c.detected = configExists || dirExists
            return c
        }
    }

    private func patchClient(_ client: MCPClient) {
        patchingClient = client.id
        Task {
            let success = await Task.detached {
                Self.patchConfig(at: client.configPath)
            }.value
            patchResults[client.id] = success
            patchingClient = nil
        }
    }

    private nonisolated static func patchConfig(at path: String) -> Bool {
        let fm = FileManager.default

        // Ensure directory exists
        let dir = (path as NSString).deletingLastPathComponent
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // Read existing config or start fresh
        var config: [String: Any]
        if let data = fm.contents(atPath: path),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            config = json
        } else {
            config = [:]
        }

        // Build the airmcp entry
        let airmcpEntry: [String: Any] = [
            "command": "npx",
            "args": ["-y", AirMcpConstants.npmPackageName],
        ]

        // Merge into mcpServers
        var servers = config["mcpServers"] as? [String: Any] ?? [:]
        servers["airmcp"] = airmcpEntry
        config["mcpServers"] = servers

        // Write back
        do {
            let data = try JSONSerialization.data(
                withJSONObject: config,
                options: [.prettyPrinted, .sortedKeys]
            )
            try data.write(to: URL(fileURLWithPath: path), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func saveAndComplete() {
        // Save module selection
        configManager.disabledModules = Array(disabledModules)

        // Mark onboarding complete
        UserDefaults.standard.set(true, forKey: AirMcpConstants.keyOnboardingCompleted)

        onComplete()

        // Close the onboarding window
        OnboardingWindowHolder.shared.window?.close()
    }
}
