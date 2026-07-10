import SwiftUI
import AppKit

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
    static let preferredContentSize = NSSize(width: 640, height: 520)

    let configManager: ConfigManager
    let serverManager: ServerManager
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
    @State private var firstRunChecking = false
    @State private var firstRunReady = false
    @State private var firstRunMessage = L("onboarding.firstRunWaiting")

    private let totalSteps = 6

    private var currentStepTitle: String {
        let titles = [
            L("onboarding.stepWelcome"),
            L("onboarding.stepRuntime"),
            L("onboarding.stepWorkflow"),
            L("onboarding.stepAccess"),
            L("onboarding.stepPermissions"),
            L("onboarding.stepConnect"),
        ]
        return titles[currentStep]
    }

    private var selectedWorkflow: OnboardingWorkflow {
        onboardingWorkflows.first { $0.id == selectedWorkflowID } ?? onboardingWorkflows[0]
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(currentStepTitle)
                        .font(.headline)

                    Spacer()

                    Text(L("onboarding.progress", currentStep + 1, totalSteps))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                ProgressView(value: Double(currentStep + 1), total: Double(totalSteps))
                    .progressViewStyle(.linear)
                    .controlSize(.small)
                    .tint(Color.accentColor)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 14)

            Divider()

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

            Divider()

            HStack {
                if currentStep > 0 {
                    Button(L("onboarding.back")) {
                        currentStep -= 1
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
                    .disabled(!firstRunReady)
                }
            }
            .padding(.horizontal, 20)
            .frame(height: 58)
        }
        .frame(
            width: Self.preferredContentSize.width,
            height: Self.preferredContentSize.height
        )
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Step 1: Welcome

    private var welcomeStep: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 18) {
                appIcon(size: 64)

                VStack(alignment: .leading, spacing: 7) {
                    Text(L("onboarding.welcome"))
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text(L("onboarding.welcomeDesc"))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 0) {
                welcomeFeatureRow(
                    icon: "macbook.and.iphone",
                    title: L("onboarding.welcomeLocalTitle"),
                    detail: L("onboarding.welcomeLocalDesc")
                )
                Divider().padding(.leading, 42)
                welcomeFeatureRow(
                    icon: "checkmark.shield",
                    title: L("onboarding.welcomeControlTitle"),
                    detail: L("onboarding.welcomeControlDesc")
                )
                Divider().padding(.leading, 42)
                welcomeFeatureRow(
                    icon: "point.3.connected.trianglepath.dotted",
                    title: L("onboarding.welcomeClientTitle"),
                    detail: L("onboarding.welcomeClientDesc")
                )
            }
            .padding(.horizontal, 14)
            .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

            Label(L("onboarding.welcomeTime"), systemImage: "clock")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: 540)
        .padding(.horizontal, 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    @ViewBuilder
    private func appIcon(size: CGFloat) -> some View {
        if let iconURL = Bundle.module.url(forResource: "AppIcon@2x", withExtension: "png"),
           let nsImage = NSImage(contentsOf: iconURL) {
            Image(nsImage: nsImage)
                .resizable()
                .interpolation(.high)
                .frame(width: size, height: size)
        } else {
            Image(systemName: "a.square.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(Color.accentColor)
                .frame(width: size, height: size)
        }
    }

    private func welcomeFeatureRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.callout)
                    .fontWeight(.semibold)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
    }

    // MARK: - Step 2: Node.js Check

    private var nodeCheckStep: some View {
        VStack(spacing: 16) {
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
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
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
                    .foregroundStyle(.secondary)
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
                .foregroundStyle(.secondary)
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
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
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
        ScrollView {
            VStack(spacing: 14) {
                Image(systemName: "app.connected.to.app.below.fill")
                    .font(.system(size: 38))
                    .foregroundStyle(Color.accentColor)

                Text(L("onboarding.connectClient"))
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(L("onboarding.connectClientDesc"))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 460)

                selectedWorkflowActions

                firstRunStatusCard

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
                        .frame(maxWidth: 420)
                }
            }
            .padding(.vertical, 18)
        }
        .padding(.horizontal, 24)
        .task {
            detectClients()
            await prepareFirstRun()
        }
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

    private var firstRunStatusCard: some View {
        HStack(alignment: .top, spacing: 10) {
            if firstRunChecking {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 18, height: 18)
            } else {
                Image(systemName: firstRunReady ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(firstRunReady ? .green : .orange)
                    .frame(width: 18)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(firstRunReady ? L("onboarding.firstRunReady") : L("onboarding.firstRunNotReady"))
                    .font(.caption)
                    .fontWeight(.semibold)
                Text(firstRunMessage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            Button(L("onboarding.firstRunCheckAgain")) {
                Task { await prepareFirstRun(force: true) }
            }
            .controlSize(.small)
            .disabled(firstRunChecking)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.05))
        )
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func clientRow(client: MCPClient) -> some View {
        HStack {
            Image(systemName: client.icon)
                .frame(width: 24)
                .foregroundStyle(client.detected ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(client.name)
                    .fontWeight(.medium)
                Text(client.detected ? L("onboarding.installed") : L("onboarding.notFound"))
                    .font(.caption)
                    .foregroundStyle(client.detected ? .green : .secondary)
                if client.id == "codex" && client.detected {
                    Text(L("onboarding.codexStartupDisclosure"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("onboarding.codexStartupDisclosure")
                }
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
                    Button(client.id == "codex" ? L("onboarding.enableInCodex") : L("onboarding.autoPatch")) {
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
        currentStep += 1
    }

    private func checkNode() async {
        if AirMcpConstants.bundledServerRuntime != nil {
            nodeChecking = false
            nodeAvailable = true
            return
        }
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
            await prepareFirstRun(force: true)
        }
    }

    private func prepareFirstRun(force: Bool = false) async {
        if firstRunChecking && !force { return }
        firstRunChecking = true
        firstRunReady = false
        firstRunMessage = L("onboarding.firstRunStarting")

        do {
            _ = try AppRuntimeToken.ensure()
        } catch {
            firstRunChecking = false
            firstRunMessage = L("onboarding.firstRunTokenFailed", error.localizedDescription)
            return
        }

        serverManager.autoStartEnabled = true
        if serverManager.status != .running {
            serverManager.startServer()
        }

        for _ in 0..<24 {
            if let version = await ServerManager.authenticatedAppOwnedRuntimeVersion() {
                firstRunReady = true
                firstRunChecking = false
                firstRunMessage = L("onboarding.firstRunReadyDesc", version, selectedWorkflow.title)
                return
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }

        firstRunChecking = false
        firstRunMessage = L("onboarding.firstRunRuntimeFailed")
    }

    private nonisolated static func patchCodexConfig() -> Bool {
        guard let codex = NodeEnvironment.findExecutable(named: "codex") else {
            return false
        }
        guard let token = try? AppRuntimeToken.ensure() else {
            return false
        }

        let existing = runProcessCaptured(codex, arguments: ["mcp", "get", "airmcp", "--json"])
        if existing.success && !runProcess(codex, arguments: ["mcp", "remove", "airmcp"]) {
            return false
        }

        let added = runProcess(
            codex,
            arguments: [
                "mcp",
                "add",
                "--env",
                "AIRMCP_HTTP_TOKEN=\(token)",
                "airmcp",
                "--",
                AirMcpConstants.appOwnedProxyCommand,
            ] + AirMcpConstants.appOwnedProxyArgs
        )
        if added { return true }

        // `codex mcp add` has no in-place update operation. If the replacement
        // fails after removal, reconstruct the prior entry captured above.
        if existing.success {
            _ = restoreCodexConfig(codex, json: existing.output)
        }
        return false
    }

    private nonisolated static func restoreCodexConfig(_ codex: String, json: String) -> Bool {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let transport = object["transport"] as? [String: Any],
              let type = transport["type"] as? String
        else { return false }

        if type == "stdio",
           let command = transport["command"] as? String,
           let commandArgs = transport["args"] as? [String] {
            var arguments = ["mcp", "add"]
            if let environment = transport["env"] as? [String: String] {
                for key in environment.keys.sorted() {
                    if let value = environment[key] {
                        arguments.append(contentsOf: ["--env", "\(key)=\(value)"])
                    }
                }
            }
            arguments.append(contentsOf: ["airmcp", "--", command])
            arguments.append(contentsOf: commandArgs)
            return runProcess(codex, arguments: arguments)
        }

        if type == "streamable_http", let url = transport["url"] as? String {
            return runProcess(codex, arguments: ["mcp", "add", "airmcp", "--url", url])
        }
        return false
    }

    private nonisolated static func runProcessCaptured(
        _ executable: String,
        arguments: [String]
    ) -> (success: Bool, output: String) {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = NodeEnvironment.buildEnv()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus == 0, String(data: data, encoding: .utf8) ?? "")
        } catch {
            return (false, "")
        }
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

    nonisolated static func patchConfig(at path: String) -> Bool {
        let fm = FileManager.default

        // Ensure directory exists
        let dir = (path as NSString).deletingLastPathComponent
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // Read existing config or start fresh. A malformed existing file is
        // never replaced with an empty object.
        var config: [String: Any]
        if fm.fileExists(atPath: path) {
            guard let data = fm.contents(atPath: path),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return false }
            config = json
        } else {
            config = [:]
        }

        // Build the token-gated app-owned runtime entry
        guard let token = try? AppRuntimeToken.ensure() else {
            return false
        }
        let airmcpEntry = AirMcpConstants.appOwnedProxyEntry(token: token)

        // Merge into mcpServers
        if config["mcpServers"] != nil && !(config["mcpServers"] is [String: Any]) {
            return false
        }
        var servers = config["mcpServers"] as? [String: Any] ?? [:]
        servers["airmcp"] = airmcpEntry
        config["mcpServers"] = servers

        // Write back. The proxy entry contains the local bearer token, so the
        // destination and backup must never be created world-readable.
        do {
            let data = try JSONSerialization.data(
                withJSONObject: config,
                options: [.prettyPrinted, .sortedKeys]
            )
            guard (try JSONSerialization.jsonObject(with: data)) is [String: Any] else {
                return false
            }
            let backupPath = path + ".airmcp-backup"
            let originalData = fm.contents(atPath: path)
            let originalPermissions = ((try? fm.attributesOfItem(atPath: path)[.posixPermissions]) as? NSNumber)?.intValue

            if let originalData {
                try installFileAtomically(originalData, at: backupPath, permissions: 0o600)
            }

            do {
                try installFileAtomically(data, at: path, permissions: 0o600)
            } catch {
                // Keep the operation transactional: a failed permission or
                // replacement step must not leave a partially patched config.
                if let originalData {
                    try? installFileAtomically(
                        originalData,
                        at: path,
                        permissions: originalPermissions ?? 0o600
                    )
                } else {
                    try? fm.removeItem(atPath: path)
                }
                return false
            }
            return true
        } catch {
            return false
        }
    }

    private nonisolated static func installFileAtomically(
        _ data: Data,
        at path: String,
        permissions: Int
    ) throws {
        let fm = FileManager.default
        let destination = URL(fileURLWithPath: path)
        let temporary = destination.deletingLastPathComponent().appendingPathComponent(
            ".\(destination.lastPathComponent).airmcp-\(UUID().uuidString).tmp"
        )
        let attributes: [FileAttributeKey: Any] = [
            .posixPermissions: NSNumber(value: permissions),
        ]

        guard fm.createFile(atPath: temporary.path, contents: data, attributes: attributes) else {
            throw NSError(
                domain: "AirMCPOnboardingConfig",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create an owner-only client config."]
            )
        }
        defer { try? fm.removeItem(at: temporary) }
        try fm.setAttributes(attributes, ofItemAtPath: temporary.path)

        if fm.fileExists(atPath: path) {
            _ = try fm.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try fm.moveItem(at: temporary, to: destination)
        }
        try fm.setAttributes(attributes, ofItemAtPath: path)
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
