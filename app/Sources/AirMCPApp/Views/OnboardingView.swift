import SwiftUI
import AppKit

// MARK: - Onboarding Module Item

private struct OnboardingModule: Identifiable {
    let id: String
    let icon: String

    var localizedName: String { L("module.\(id)") }
    var localizedDescription: String { L("module.\(id).desc") }
}

private let onboardingModules: [OnboardingModule] = [
    OnboardingModule(id: "notes", icon: "note.text"),
    OnboardingModule(id: "reminders", icon: "checklist"),
    OnboardingModule(id: "calendar", icon: "calendar"),
    OnboardingModule(id: "contacts", icon: "person.2"),
    OnboardingModule(id: "mail", icon: "envelope"),
    OnboardingModule(id: "messages", icon: "bubble.left"),
    OnboardingModule(id: "music", icon: "music.note"),
    OnboardingModule(id: "finder", icon: "folder"),
    OnboardingModule(id: "safari", icon: "safari"),
    OnboardingModule(id: "system", icon: "gearshape"),
    OnboardingModule(id: "photos", icon: "photo"),
    OnboardingModule(id: "shortcuts", icon: "command"),
    OnboardingModule(id: "ui", icon: "hand.tap"),
    OnboardingModule(id: "intelligence", icon: "brain"),
    OnboardingModule(id: "tv", icon: "tv"),
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
                    Button(L("onboarding.back")) {
                        withAnimation { currentStep -= 1 }
                    }
                    .keyboardShortcut(.cancelAction)
                }

                Spacer()

                if currentStep < totalSteps - 1 {
                    Button(L("onboarding.next")) {
                        advanceStep()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(currentStep == 1 && !nodeAvailable)
                } else {
                    Button(L("onboarding.finish")) {
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

            Text(L("onboarding.welcome"))
                .font(.title)
                .fontWeight(.bold)

            Text(L("onboarding.welcomeDesc"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)

            Text(L("onboarding.welcomeTime"))
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

            Text(L("onboarding.nodeRequired"))
                .font(.title2)
                .fontWeight(.semibold)

            if nodeChecking {
                ProgressView()
                    .controlSize(.small)
                Text(L("onboarding.nodeChecking"))
                    .foregroundStyle(.secondary)
            } else if nodeAvailable {
                Label(L("onboarding.nodeFound"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.headline)
            } else {
                Label(L("onboarding.nodeNotFound"), systemImage: "xmark.circle.fill")
                    .foregroundStyle(.red)
                    .font(.headline)

                Text(L("onboarding.nodeInstallHint"))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 380)

                Link(L("onboarding.nodeDownload"), destination: URL(string: "https://nodejs.org")!)
                    .font(.headline)

                Button(L("onboarding.nodeCheckAgain")) {
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
            Text(L("onboarding.chooseModules"))
                .font(.title2)
                .fontWeight(.semibold)

            Text(L("onboarding.chooseModulesDesc"))
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
                Button(L("onboarding.enableAll")) {
                    disabledModules.removeAll()
                }
                .font(.caption)
                Button(L("onboarding.disableAll")) {
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
                    Text(module.localizedName)
                        .font(.callout)
                        .fontWeight(.medium)
                    Text(module.localizedDescription)
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

            Text(L("onboarding.permissions"))
                .font(.title2)
                .fontWeight(.semibold)

            Text(L("onboarding.permissionsDesc"))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 400)

            VStack(alignment: .leading, spacing: 10) {
                permissionRow(
                    icon: "checkmark.shield",
                    title: L("onboarding.permAutomation"),
                    detail: L("onboarding.permAutomationDesc")
                )
                permissionRow(
                    icon: "accessibility",
                    title: L("onboarding.permAccessibility"),
                    detail: L("onboarding.permAccessibilityDesc")
                )
                permissionRow(
                    icon: "bell.badge",
                    title: L("onboarding.permNotifications"),
                    detail: L("onboarding.permNotificationsDesc")
                )
            }
            .padding(.horizontal, 32)

            Button(L("onboarding.openSettings")) {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
                    NSWorkspace.shared.open(url)
                }
            }
            .controlSize(.large)

            Text(L("onboarding.permRuntimeHint"))
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

            Text(L("onboarding.connectClient"))
                .font(.title2)
                .fontWeight(.semibold)

            Text(L("onboarding.connectClientDesc"))
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
                Text(L("onboarding.noClients"))
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
                Text(client.detected ? L("onboarding.installed") : L("onboarding.notFound"))
                    .font(.caption)
                    .foregroundStyle(client.detected ? .green : .secondary)
            }

            Spacer()

            if client.detected {
                if let result = patchResults[client.id] {
                    Label(result ? L("onboarding.patched") : L("onboarding.failed"), systemImage: result ? "checkmark.circle.fill" : "xmark.circle")
                        .foregroundStyle(result ? .green : .red)
                        .font(.caption)
                } else if patchingClient == client.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button(L("onboarding.autoPatch")) {
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
