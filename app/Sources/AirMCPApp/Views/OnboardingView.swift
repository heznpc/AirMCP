import SwiftUI
import AppKit

// MARK: - Onboarding Module Item

private struct OnboardingModule: Identifiable {
    let id: String
    let icon: String

    var localizedName: String { L("module.\(id)") }
    var localizedDescription: String { L("module.\(id).desc") }
}

private struct OnboardingWorkflow: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let promptKey: String
    let safetyKey: String
    let accessKey: String
    let siriKey: String?
    let icon: String
    let requiredModules: Set<String>

    var title: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var prompt: String { L(promptKey) }
    var safety: String { L(safetyKey) }
    var accessSummary: String { L(accessKey) }
    var siriPhrase: String? {
        guard let siriKey else { return nil }
        return L(siriKey)
    }
}

// Order matters: the first block is what a typical first-run user wants
// (Apple's built-in productivity apps), followed by Intelligence/automation
// since v2.10 surfaced skills + context memory as first-class, and finally
// the specialised modules that are off by default but worth advertising.
private let onboardingModules: [OnboardingModule] = [
    // Everyday productivity
    OnboardingModule(id: "notes", icon: "note.text"),
    OnboardingModule(id: "reminders", icon: "checklist"),
    OnboardingModule(id: "calendar", icon: "calendar"),
    OnboardingModule(id: "contacts", icon: "person.2"),
    OnboardingModule(id: "mail", icon: "envelope"),
    OnboardingModule(id: "messages", icon: "bubble.left"),
    OnboardingModule(id: "safari", icon: "safari"),
    OnboardingModule(id: "finder", icon: "folder"),
    // Media
    OnboardingModule(id: "music", icon: "music.note"),
    OnboardingModule(id: "photos", icon: "photo"),
    OnboardingModule(id: "tv", icon: "tv"),
    OnboardingModule(id: "podcasts", icon: "headphones"),
    // System + automation
    OnboardingModule(id: "system", icon: "gearshape"),
    OnboardingModule(id: "shortcuts", icon: "command"),
    OnboardingModule(id: "ui", icon: "hand.tap"),
    OnboardingModule(id: "screen", icon: "display"),
    // Intelligence + v2.10 introspection
    OnboardingModule(id: "intelligence", icon: "brain"),
    OnboardingModule(id: "memory", icon: "brain.head.profile"),
    OnboardingModule(id: "audit", icon: "doc.text.magnifyingglass"),
    // Context sensors
    OnboardingModule(id: "weather", icon: "cloud.sun"),
    OnboardingModule(id: "location", icon: "location"),
    OnboardingModule(id: "maps", icon: "map"),
    OnboardingModule(id: "bluetooth", icon: "dot.radiowaves.left.and.right"),
    // Integrations
    OnboardingModule(id: "google", icon: "at"),
]

private let onboardingModuleIds = Set(onboardingModules.map(\.id))

private let onboardingWorkflows: [OnboardingWorkflow] = [
    OnboardingWorkflow(
        id: "daily-briefing",
        titleKey: "workflow.dailyBriefing",
        descKey: "workflow.dailyBriefing.desc",
        promptKey: "workflow.dailyBriefing.prompt",
        safetyKey: "workflow.dailyBriefing.safety",
        accessKey: "workflow.dailyBriefing.access",
        siriKey: "workflow.dailyBriefing.siri",
        icon: "sun.max",
        requiredModules: ["calendar", "reminders", "mail", "notes"]
    ),
    OnboardingWorkflow(
        id: "inbox-triage",
        titleKey: "workflow.inboxTriage",
        descKey: "workflow.inboxTriage.desc",
        promptKey: "workflow.inboxTriage.prompt",
        safetyKey: "workflow.inboxTriage.safety",
        accessKey: "workflow.inboxTriage.access",
        siriKey: "workflow.inboxTriage.siri",
        icon: "tray.full",
        requiredModules: ["mail", "reminders"]
    ),
    OnboardingWorkflow(
        id: "meeting-prep",
        titleKey: "workflow.meetingPrep",
        descKey: "workflow.meetingPrep.desc",
        promptKey: "workflow.meetingPrep.prompt",
        safetyKey: "workflow.meetingPrep.safety",
        accessKey: "workflow.meetingPrep.access",
        siriKey: nil,
        icon: "person.2.wave.2",
        requiredModules: ["calendar", "notes", "contacts", "finder", "reminders"]
    ),
    OnboardingWorkflow(
        id: "project-digest",
        titleKey: "workflow.projectDigest",
        descKey: "workflow.projectDigest.desc",
        promptKey: "workflow.projectDigest.prompt",
        safetyKey: "workflow.projectDigest.safety",
        accessKey: "workflow.projectDigest.access",
        siriKey: "workflow.projectDigest.siri",
        icon: "folder",
        requiredModules: ["memory", "notes", "calendar", "reminders", "mail", "finder"]
    ),
    OnboardingWorkflow(
        id: "focus-blocks",
        titleKey: "workflow.focusBlocks",
        descKey: "workflow.focusBlocks.desc",
        promptKey: "workflow.focusBlocks.prompt",
        safetyKey: "workflow.focusBlocks.safety",
        accessKey: "workflow.focusBlocks.access",
        siriKey: nil,
        icon: "calendar.badge.clock",
        requiredModules: ["reminders", "calendar"]
    ),
    OnboardingWorkflow(
        id: "research-output",
        titleKey: "workflow.researchOutput",
        descKey: "workflow.researchOutput.desc",
        promptKey: "workflow.researchOutput.prompt",
        safetyKey: "workflow.researchOutput.safety",
        accessKey: "workflow.researchOutput.access",
        siriKey: nil,
        icon: "doc.text.magnifyingglass",
        requiredModules: ["safari", "intelligence", "notes", "mail"]
    ),
]

// MARK: - MCP Client

private enum MCPClientKind: Sendable {
    case jsonConfig
    case codexCli
}

private struct MCPClient: Identifiable {
    let id: String
    let name: String
    let icon: String
    let configPath: String
    let kind: MCPClientKind
    var detected: Bool
}

// MARK: - Onboarding View

struct OnboardingView: View {
    let configManager: ConfigManager
    let onComplete: () -> Void

    @State private var currentStep = 0
    @State private var nodeAvailable = false
    @State private var nodeChecking = true
    @State private var selectedWorkflowID = "daily-briefing"
    @State private var disabledModules: Set<String> = onboardingModuleIds.subtracting(
        onboardingWorkflows.first?.requiredModules ?? []
    )
    @State private var mcpClients: [MCPClient] = []
    @State private var patchingClient: String?
    @State private var patchResults: [String: Bool] = [:]

    private let totalSteps = 6

    private var selectedWorkflow: OnboardingWorkflow {
        onboardingWorkflows.first { $0.id == selectedWorkflowID } ?? onboardingWorkflows[0]
    }

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
                case 2: workflowSelectionStep
                case 3: moduleSelectionStep
                case 4: permissionStep
                case 5: clientDetectionStep
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

    // MARK: - Step 3: Workflow Selection

    private var workflowSelectionStep: some View {
        VStack(spacing: 12) {
            Text(L("onboarding.chooseWorkflow"))
                .font(.title2)
                .fontWeight(.semibold)

            Text(L("onboarding.chooseWorkflowDesc"))
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)

            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(onboardingWorkflows) { workflow in
                        workflowCard(workflow)
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(maxHeight: 300)
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func workflowCard(_ workflow: OnboardingWorkflow) -> some View {
        let isSelected = selectedWorkflowID == workflow.id

        Button {
            applyWorkflowPreset(workflow)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: workflow.icon)
                        .frame(width: 20)
                        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)

                    Text(workflow.title)
                        .font(.callout)
                        .fontWeight(.semibold)
                        .lineLimit(1)

                    Spacer()

                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? .green : .secondary)
                }

                Text(workflow.localizedDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Label(workflow.accessSummary, systemImage: "checkmark.shield")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }
            .frame(minHeight: 108, alignment: .top)
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isSelected ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isSelected ? Color.accentColor.opacity(0.3) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func applyWorkflowPreset(_ workflow: OnboardingWorkflow) {
        selectedWorkflowID = workflow.id
        disabledModules = onboardingModuleIds.subtracting(workflow.requiredModules)
    }

    // MARK: - Step 4: Module Selection

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

            Text(L("onboarding.workflowPresetHint", selectedWorkflow.title))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)

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

    // MARK: - Step 5: Permissions

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
                .fixedSize(horizontal: false, vertical: true)

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

    // MARK: - Step 6: Client Detection

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

            selectedWorkflowActions

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

    private var selectedWorkflowActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(selectedWorkflow.title, systemImage: selectedWorkflow.icon)
                .font(.headline)

            Text(selectedWorkflow.prompt)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                Button(L("onboarding.copyPrompt")) {
                    AirMcpConstants.copyToClipboard(selectedWorkflow.prompt)
                }
                .controlSize(.small)

                Button(L("onboarding.copyCodexPrompt")) {
                    AirMcpConstants.copyToClipboard(selectedWorkflow.prompt)
                }
                .controlSize(.small)

                if let siriPhrase = selectedWorkflow.siriPhrase {
                    Button(L("onboarding.copySiriPhrase")) {
                        AirMcpConstants.copyToClipboard("Hey Siri, \(siriPhrase)")
                    }
                    .controlSize(.small)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.accentColor.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.accentColor.opacity(0.2), lineWidth: 1)
        )
        .padding(.horizontal, 24)
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
                kind: .jsonConfig,
                detected: false
            ),
            MCPClient(
                id: "codex",
                name: "Codex",
                icon: "terminal",
                configPath: "",
                kind: .codexCli,
                detected: false
            ),
            MCPClient(
                id: "cursor",
                name: "Cursor",
                icon: "cursorarrow",
                configPath: "\(home)/.cursor/mcp.json",
                kind: .jsonConfig,
                detected: false
            ),
            MCPClient(
                id: "windsurf",
                name: "Windsurf",
                icon: "wind",
                configPath: "\(home)/.codeium/windsurf/mcp_config.json",
                kind: .jsonConfig,
                detected: false
            ),
        ]

        mcpClients = clients.map { client in
            var c = client
            if client.kind == .codexCli {
                c.detected = NodeEnvironment.findExecutable(named: "codex") != nil
                return c
            }

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
                switch client.kind {
                case .jsonConfig:
                    return Self.patchConfig(at: client.configPath)
                case .codexCli:
                    return Self.patchCodexConfig()
                }
            }.value
            patchResults[client.id] = success
            patchingClient = nil
        }
    }

    private nonisolated static func patchCodexConfig() -> Bool {
        guard let codex = NodeEnvironment.findExecutable(named: "codex") else {
            return false
        }

        if runProcess(codex, arguments: ["mcp", "get", "airmcp"]) {
            return true
        }

        return runProcess(codex, arguments: ["mcp", "add", "airmcp", "--", "npx", "-y", AirMcpConstants.npmPackageName])
    }

    private nonisolated static func runProcess(_ executable: String, arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = NodeEnvironment.buildEnv()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
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
