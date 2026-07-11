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

/// Resolve the persistent runtime-start preference at the end of one explicit
/// Setup activation attempt. A failed attempt must be observational with
/// respect to an existing preference, while an authenticated ready receipt is
/// the only outcome that can record a new opt-in.
enum OnboardingAutoStartConsentPolicy {
    static func resolvedValue(previouslyEnabled: Bool, activationReady: Bool) -> Bool {
        previouslyEnabled || activationReady
    }
}

/// A successful activation receipt is only a point-in-time observation: the
/// child can exit before Setup records auto-start consent. Commit that consent
/// first, ask ServerManager to recover a known-stopped runtime, then require a
/// fresh authenticated receipt. If the lightweight recovery races with process
/// termination, the full activation transaction is the final fallback.
@MainActor
enum OnboardingRuntimeReadyBarrier {
    static func stabilize(
        commitAutoStart: () -> Void,
        requestAutoStart: () -> Void,
        scopeIsCurrent: () -> Bool,
        validate: () async -> ServerManager.OnboardingRuntimeActivationResult,
        recover: () async -> ServerManager.OnboardingRuntimeActivationResult
    ) async -> ServerManager.OnboardingRuntimeActivationResult? {
        commitAutoStart()
        requestAutoStart()

        let validation = await validate()
        guard scopeIsCurrent() else { return nil }
        if case .failed = validation {
            let recovered = await recover()
            guard scopeIsCurrent() else { return nil }
            return recovered
        }
        return validation
    }
}

// MARK: - Onboarding View

struct OnboardingView: View {
    static let preferredContentSize = NSSize(width: 640, height: 520)

    let configManager: ConfigManager
    let serverManager: ServerManager
    let onComplete: () -> Void

    @State private var currentStep: Int
    @State private var nodeAvailable = false
    @State private var nodeChecking = true
    @State private var selectedWorkflowID: String
    @State private var disabledModules: Set<String>
    @State private var unmanagedDisabledModules: Set<String>
    @State private var appliedScopeFingerprint: String?
    @State private var runtimeReceipt: ServerManager.OnboardingRuntimeReceipt?
    @State private var mcpClients: [MCPClient] = []
    @State private var patchingClients: Set<String> = []
    @State private var patchResults: [String: Bool] = [:]
    @State private var firstRunChecking = false
    @State private var firstRunReady = false
    @State private var firstRunMessage = L("onboarding.firstRunWaiting")
    @State private var completionError: String?

    private let totalSteps = 6

    init(
        configManager: ConfigManager,
        serverManager: ServerManager,
        onComplete: @escaping () -> Void
    ) {
        self.configManager = configManager
        self.serverManager = serverManager
        self.onComplete = onComplete

        let defaults = UserDefaults.standard
        let firstWorkflow = onboardingWorkflows[0]
        let onboardingCompleted = defaults.bool(forKey: AirMcpConstants.keyOnboardingCompleted)
        let fallback = OnboardingDraftStore.fallbackState(
            onboardingCompleted: onboardingCompleted,
            configuredDisabledModules: configManager.disabledModules,
            defaultWorkflowID: firstWorkflow.id,
            defaultDisabledModules: onboardingModuleIds.subtracting(firstWorkflow.requiredModules),
            validModuleIDs: onboardingModuleIds
        )
        // A completed Setup has no resumable draft: reopening is an editor and
        // must reflect the currently persisted module selection. Only an
        // incomplete first run restores its workflow/module draft.
        let draft = onboardingCompleted
            ? fallback
            : OnboardingDraftStore.load(
                defaults: defaults,
                validWorkflowIDs: Set(onboardingWorkflows.map(\.id)),
                validModuleIDs: onboardingModuleIds,
                fallback: fallback
            )
        _currentStep = State(
            initialValue: min(
                max(defaults.integer(forKey: AirMcpConstants.keyOnboardingStep), 0),
                5
            )
        )
        _selectedWorkflowID = State(initialValue: draft.workflowID)
        _disabledModules = State(initialValue: draft.disabledModules)
        _appliedScopeFingerprint = State(initialValue: draft.appliedScopeFingerprint)
        _runtimeReceipt = State(initialValue: nil)
        _unmanagedDisabledModules = State(
            initialValue: OnboardingDraftStore.unmanagedDisabledModules(
                onboardingCompleted: onboardingCompleted,
                configuredDisabledModules: configManager.disabledModules,
                managedModuleIDs: onboardingModuleIds,
                allModuleIDs: Set(allModules.map(\.id))
            )
        )
    }

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

    private var currentRuntimeScope: OnboardingRuntimeScope {
        OnboardingRuntimeScope(
            workflowID: selectedWorkflowID,
            disabledModules: disabledModules.union(unmanagedDisabledModules)
        )
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
                        setCurrentStep(currentStep - 1)
                    }
                    .keyboardShortcut(.cancelAction)
                    .disabled(firstRunChecking || !patchingClients.isEmpty)
                }

                Spacer()

                if currentStep < totalSteps - 1 {
                    Button(L("onboarding.next")) {
                        advanceStep()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(
                        (currentStep == 1 && !nodeAvailable)
                            || firstRunChecking
                            || !patchingClients.isEmpty
                    )
                } else {
                    Button(L("onboarding.finish")) {
                        Task { await saveAndComplete() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(firstRunChecking || !patchingClients.isEmpty)
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
        .alert(
            L("onboarding.saveFailed"),
            isPresented: Binding(
                get: { completionError != nil },
                set: { if !$0 { completionError = nil } }
            )
        ) {
            Button(L("trust.ok")) { completionError = nil }
        } message: {
            Text(completionError ?? "")
        }
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
        guard !firstRunChecking, patchingClients.isEmpty else { return }
        let nextDisabledModules = onboardingModuleIds.subtracting(workflow.requiredModules)
        guard selectedWorkflowID != workflow.id || disabledModules != nextDisabledModules else { return }
        selectedWorkflowID = workflow.id
        disabledModules = nextDisabledModules
        scopeSelectionDidChange()
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
                    guard !firstRunChecking, patchingClients.isEmpty else { return }
                    guard !disabledModules.isEmpty else { return }
                    disabledModules.removeAll()
                    scopeSelectionDidChange()
                }
                .font(.caption)
                .disabled(firstRunChecking || !patchingClients.isEmpty)
                Button(L("onboarding.disableAll")) {
                    guard !firstRunChecking, patchingClients.isEmpty else { return }
                    let allDisabled = Set(onboardingModules.map(\.id))
                    guard disabledModules != allDisabled else { return }
                    disabledModules = allDisabled
                    scopeSelectionDidChange()
                }
                .font(.caption)
                .disabled(firstRunChecking || !patchingClients.isEmpty)
            }
        }
        .padding(.horizontal, 24)
    }

    @ViewBuilder
    private func moduleCard(_ module: OnboardingModule) -> some View {
        let isEnabled = !disabledModules.contains(module.id)

        Button {
            guard !firstRunChecking, patchingClients.isEmpty else { return }
            if isEnabled {
                disabledModules.insert(module.id)
            } else {
                disabledModules.remove(module.id)
            }
            scopeSelectionDidChange()
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
        .disabled(firstRunChecking || !patchingClients.isEmpty)
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

                if !firstRunReady {
                    Label(L("onboarding.clientNeedsRuntime"), systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                }

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
            await checkFirstRunReadiness()
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

            Button(firstRunReady ? L("onboarding.firstRunCheckAgain") : L("onboarding.startRuntime")) {
                Task {
                    if firstRunReady {
                        await checkFirstRunReadiness()
                    } else {
                        await startFirstRunRuntime()
                    }
                }
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
                } else if patchingClients.contains(client.id) {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Button(client.id == "codex" ? L("onboarding.enableInCodex") : L("onboarding.autoPatch")) {
                        patchClient(client)
                    }
                    .controlSize(.small)
                    .disabled(!firstRunReady || firstRunChecking || !patchingClients.isEmpty)
                    .help(firstRunReady ? "" : L("onboarding.clientNeedsRuntime"))
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
        guard !firstRunChecking, patchingClients.isEmpty else { return }
        setCurrentStep(currentStep + 1)
    }

    private func setCurrentStep(_ step: Int) {
        guard !firstRunChecking, patchingClients.isEmpty else { return }
        currentStep = min(max(step, 0), totalSteps - 1)
        UserDefaults.standard.set(currentStep, forKey: AirMcpConstants.keyOnboardingStep)
    }

    private func persistOnboardingDraft() {
        OnboardingDraftStore.save(
            OnboardingDraftState(
                workflowID: selectedWorkflowID,
                disabledModules: disabledModules,
                appliedScopeFingerprint: appliedScopeFingerprint
            )
        )
    }

    private func scopeSelectionDidChange() {
        guard !firstRunChecking, patchingClients.isEmpty else { return }
        appliedScopeFingerprint = nil
        runtimeReceipt = nil
        firstRunReady = false
        firstRunMessage = L("onboarding.firstRunScopeChanged")
        patchResults.removeAll()
        persistOnboardingDraft()
        serverManager.noteOnboardingScopeChanged()
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
        // Client configuration writes are transactional but share the local
        // runtime token. Keep the consent action single-flight across rows.
        let scope = currentRuntimeScope
        let capturedStep = currentStep
        guard patchingClients.isEmpty,
              firstRunReady,
              capturedStep == totalSteps - 1,
              appliedScopeFingerprint == scope.draftFingerprint,
              let authorizedReceipt = runtimeReceipt,
              authorizedReceipt.draftFingerprint == scope.draftFingerprint,
              authorizedReceipt.runtimeFingerprint == scope.runtimeFingerprint,
              let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil,
              authorizedReceipt.tokenFingerprint == AppRuntimeToken.fingerprint(for: runtimeToken),
              configManager.isOnboardingRuntimeScopePersisted(scope)
        else { return }
        patchingClients.insert(client.id)
        Task {
            let validation = await serverManager.validateOnboardingRuntime(
                for: scope,
                authorizedDraftFingerprint: scope.draftFingerprint,
                runtimeToken: runtimeToken,
                configManager: configManager
            )
            guard runtimeReceipt == authorizedReceipt,
                  case .ready(let receipt) = validation
            else {
                firstRunReady = false
                runtimeReceipt = nil
                if case .manualRuntime = validation {
                    firstRunMessage = L("onboarding.firstRunManualRuntime")
                } else {
                    firstRunMessage = L("onboarding.firstRunScopeChanged")
                }
                patchingClients.remove(client.id)
                return
            }
            runtimeReceipt = receipt
            guard clientPatchAuthorizationIsCurrent(
                clientID: client.id,
                capturedStep: capturedStep,
                scope: scope,
                receipt: receipt,
                runtimeToken: runtimeToken
            ) else {
                firstRunReady = false
                runtimeReceipt = nil
                firstRunMessage = L("onboarding.firstRunScopeChanged")
                patchingClients.remove(client.id)
                return
            }
            let success = await Task.detached {
                switch client.kind {
                case .jsonConfig:
                    return Self.patchConfig(at: client.configPath, token: runtimeToken)
                case .codexCli:
                    return Self.patchCodexConfig(token: runtimeToken)
                }
            }.value
            let authorizationStillCurrent = clientPatchAuthorizationIsCurrent(
                clientID: client.id,
                capturedStep: capturedStep,
                scope: scope,
                receipt: receipt,
                runtimeToken: runtimeToken
            )
            patchResults[client.id] = success && authorizationStillCurrent
            patchingClients.remove(client.id)
            guard success, authorizationStillCurrent else {
                firstRunReady = false
                runtimeReceipt = nil
                firstRunMessage = L("onboarding.firstRunScopeChanged")
                return
            }
            await checkFirstRunReadiness()
        }
    }

    private func clientPatchAuthorizationIsCurrent(
        clientID: String,
        capturedStep: Int,
        scope: OnboardingRuntimeScope,
        receipt: ServerManager.OnboardingRuntimeReceipt,
        runtimeToken: String
    ) -> Bool {
        currentStep == capturedStep
            && capturedStep == totalSteps - 1
            && patchingClients == [clientID]
            && currentRuntimeScope == scope
            && appliedScopeFingerprint == scope.draftFingerprint
            && runtimeReceipt == receipt
            && receipt.draftFingerprint == scope.draftFingerprint
            && receipt.runtimeFingerprint == scope.runtimeFingerprint
            && receipt.tokenFingerprint == AppRuntimeToken.fingerprint(for: runtimeToken)
            && scope.assessRuntimeSurface(
                enabledModules: receipt.enabledModules,
                unavailableModules: receipt.unavailableModules
            ).isAcceptable
            && configManager.isOnboardingRuntimeScopePersisted(scope)
            && AppRuntimeToken.matchesExisting(runtimeToken)
    }

    /// Readiness checks are observational. Entering the final onboarding step
    /// must not create credentials, enable auto-start, or launch a process.
    private func checkFirstRunReadiness() async {
        if firstRunChecking { return }
        firstRunChecking = true
        firstRunReady = false

        let scope = currentRuntimeScope
        guard serverManager.autoStartEnabled,
              let appliedScopeFingerprint,
              appliedScopeFingerprint == scope.draftFingerprint,
              let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil,
              configManager.isOnboardingRuntimeScopePersisted(scope)
        else {
            firstRunChecking = false
            firstRunMessage = appliedScopeFingerprint == nil
                ? L("onboarding.firstRunWaiting")
                : L("onboarding.firstRunScopeChanged")
            return
        }

        let validation = await serverManager.validateOnboardingRuntime(
            for: scope,
            authorizedDraftFingerprint: appliedScopeFingerprint,
            runtimeToken: runtimeToken,
            configManager: configManager
        )
        guard currentRuntimeScope == scope,
              self.appliedScopeFingerprint == appliedScopeFingerprint
        else {
            firstRunChecking = false
            firstRunMessage = L("onboarding.firstRunScopeChanged")
            return
        }
        if case .ready(let receipt) = validation {
            runtimeReceipt = receipt
            firstRunReady = true
            firstRunChecking = false
            firstRunMessage = readyMessage(receipt)
            return
        }

        runtimeReceipt = nil
        firstRunChecking = false
        if case .manualRuntime = validation {
            firstRunMessage = L("onboarding.firstRunManualRuntime")
        } else {
            firstRunMessage = L("onboarding.firstRunRuntimeFailed")
        }
    }

    /// This is the sole onboarding action allowed to create the local token,
    /// opt into automatic startup, and launch the app-owned runtime.
    private func startFirstRunRuntime() async {
        if firstRunChecking { return }
        let previousAutoStartEnabled = serverManager.autoStartEnabled
        var activationReady = false
        defer {
            serverManager.autoStartEnabled = OnboardingAutoStartConsentPolicy.resolvedValue(
                previouslyEnabled: previousAutoStartEnabled,
                activationReady: activationReady
            )
            firstRunChecking = false
        }
        firstRunChecking = true
        firstRunReady = false
        firstRunMessage = L("onboarding.firstRunStarting")

        // This button is the first explicit runtime consent in Setup. Keep
        // notification authorization coupled to that action rather than app
        // launch or passive readiness checks.
        if RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(
            hitlLevel: configManager.hitlLevel,
            userInitiated: true
        ) {
            HitlManager.requestNotificationPermission()
        }

        do {
            _ = try AppRuntimeToken.ensure()
        } catch {
            firstRunMessage = L("onboarding.firstRunTokenFailed", error.localizedDescription)
            return
        }

        let scope = currentRuntimeScope
        runtimeReceipt = nil
        let result = await serverManager.activateOnboardingRuntime(
            for: scope,
            configManager: configManager
        )
        guard currentRuntimeScope == scope else {
            firstRunReady = false
            firstRunMessage = L("onboarding.firstRunScopeChanged")
            return
        }
        switch result {
        case .ready:
            let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil
            let stabilized = await OnboardingRuntimeReadyBarrier.stabilize(
                commitAutoStart: {
                    // Temporary restart authority only. The deferred consent
                    // transaction restores the previous preference unless the
                    // final authenticated barrier also returns `.ready`.
                    serverManager.autoStartEnabled = true
                },
                requestAutoStart: {
                    serverManager.autoStartIfNeeded()
                },
                scopeIsCurrent: {
                    currentRuntimeScope == scope
                },
                validate: {
                    guard let runtimeToken else {
                        return .failed("The app runtime token disappeared after activation.")
                    }
                    return await serverManager.validateOnboardingRuntime(
                        for: scope,
                        authorizedDraftFingerprint: scope.draftFingerprint,
                        runtimeToken: runtimeToken,
                        configManager: configManager
                    )
                },
                recover: {
                    await serverManager.activateOnboardingRuntime(
                        for: scope,
                        configManager: configManager
                    )
                }
            )
            guard let stabilized else {
                firstRunReady = false
                firstRunMessage = L("onboarding.firstRunScopeChanged")
                return
            }
            switch stabilized {
            case .ready(let receipt):
                activationReady = true
                runtimeReceipt = receipt
                appliedScopeFingerprint = scope.draftFingerprint
                persistOnboardingDraft()
                firstRunReady = true
                firstRunMessage = readyMessage(receipt)
            case .manualRuntime:
                appliedScopeFingerprint = nil
                persistOnboardingDraft()
                firstRunReady = false
                firstRunMessage = L("onboarding.firstRunManualRuntime")
            case .failed(let message):
                firstRunReady = false
                firstRunMessage = L("onboarding.firstRunConfigFailed", message)
            }
        case .manualRuntime:
            appliedScopeFingerprint = nil
            persistOnboardingDraft()
            firstRunReady = false
            firstRunMessage = L("onboarding.firstRunManualRuntime")
        case .failed(let message):
            firstRunReady = false
            firstRunMessage = L("onboarding.firstRunConfigFailed", message)
        }
    }

    private func readyMessage(_ receipt: ServerManager.OnboardingRuntimeReceipt) -> String {
        let ready = L("onboarding.firstRunReadyDesc", receipt.version, selectedWorkflow.title)
        let unavailable = receipt.unavailableModules.map(\.module).sorted()
        guard !unavailable.isEmpty else { return ready }
        return ready + "\n" + L("onboarding.firstRunUnavailableModules", unavailable.joined(separator: ", "))
    }

    private nonisolated static func patchCodexConfig(token: String) -> Bool {
        guard let codex = NodeEnvironment.findExecutable(named: "codex") else {
            return false
        }

        return CodexOnboardingConfigurator.configure(
            codex: codex,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
            token: token,
            proxyCommand: AirMcpConstants.appOwnedProxyCommand,
            proxyArguments: AirMcpConstants.appOwnedProxyArgs,
            tokenStillCurrent: { AppRuntimeToken.matchesExisting(token) }
        )
    }

    nonisolated static func patchConfig(
        at path: String,
        token: String,
        tokenValidator: (() -> Bool)? = nil
    ) -> Bool {
        let fm = FileManager.default
        let tokenIsCurrent = tokenValidator ?? { AppRuntimeToken.matchesExisting(token) }

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

        // The caller authenticated runtime-state with this exact existing
        // token. Never call ensure() here: replacement/deletion must fail the
        // transaction instead of silently writing a different credential.
        guard tokenIsCurrent() else { return false }
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
            let originalBackupData = fm.contents(atPath: backupPath)
            let originalBackupPermissions = ((try? fm.attributesOfItem(atPath: backupPath)[.posixPermissions]) as? NSNumber)?.intValue

            func restoreSnapshot(_ snapshot: Data?, at destination: String, permissions: Int?) {
                if let snapshot {
                    try? installFileAtomically(snapshot, at: destination, permissions: permissions ?? 0o600)
                } else {
                    try? fm.removeItem(atPath: destination)
                }
            }

            func rollbackClientFiles() {
                restoreSnapshot(originalData, at: path, permissions: originalPermissions)
                restoreSnapshot(originalBackupData, at: backupPath, permissions: originalBackupPermissions)
            }

            guard tokenIsCurrent() else { return false }

            if let originalData {
                try installFileAtomically(originalData, at: backupPath, permissions: 0o600)
            }

            guard tokenIsCurrent() else {
                rollbackClientFiles()
                return false
            }

            do {
                try installFileAtomically(data, at: path, permissions: 0o600)
            } catch {
                // Keep the operation transactional: a failed permission or
                // replacement step must not leave a partially patched config.
                rollbackClientFiles()
                return false
            }
            guard tokenIsCurrent() else {
                rollbackClientFiles()
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

    private func saveAndComplete() async {
        guard !firstRunChecking else { return }
        firstRunChecking = true
        defer { firstRunChecking = false }

        let scope = currentRuntimeScope
        var exactRuntimeRequiredAtCompletion = false
        let initialProbe = await ServerManager.probeAppOwnedRuntime()
        guard currentRuntimeScope == scope else {
            completionError = L("onboarding.firstRunScopeChanged")
            return
        }

        switch initialProbe {
        case .ready(_, appOwned: false):
            completionError = L("onboarding.firstRunManualRuntime")
            return
        case .ready(let version, appOwned: true):
            guard let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil,
                  let state = try? await AppRuntimeClient.runtimeState(token: runtimeToken),
                  let expectedOwnerFingerprint = try? AppRuntimeToken.expectedOwnerFingerprint(),
                  ServerManager.authenticatedOwnedRuntimeIdentity(
                      state: state,
                      expectedVersion: version,
                      expectedOwnerFingerprint: expectedOwnerFingerprint
                  ) != nil
            else {
                completionError = L("onboarding.firstRunRuntimeFailed")
                return
            }
            let surfaceAssessment = scope.assessRuntimeSurface(
                enabledModules: state.enabledModules,
                unavailableModules: state.unavailableModules
            )
            let runtimeMatches = AppRuntimeToken.matchesExisting(runtimeToken)
                && state.disabledModules == scope.disabledModules
                && state.scopeFingerprint == scope.runtimeFingerprint
                && surfaceAssessment.isAcceptable

            if !runtimeMatches {
                let result = await serverManager.activateOnboardingRuntime(
                    for: scope,
                    configManager: configManager
                )
                guard currentRuntimeScope == scope else {
                    completionError = L("onboarding.firstRunScopeChanged")
                    return
                }
                switch result {
                case .ready(let receipt):
                    runtimeReceipt = receipt
                    appliedScopeFingerprint = scope.draftFingerprint
                    persistOnboardingDraft()
                    exactRuntimeRequiredAtCompletion = true
                case .manualRuntime:
                    completionError = L("onboarding.firstRunManualRuntime")
                    return
                case .failed(let message):
                    completionError = L("onboarding.firstRunConfigFailed", message)
                    return
                }
            } else if !configManager.isOnboardingRuntimeScopePersisted(scope) {
                guard let transaction = configManager.beginOnboardingRuntimeScopeTransaction(scope) else {
                    completionError = configManager.lastPersistenceError
                        ?? L("onboarding.firstRunConfigFailed", "unknown")
                    return
                }
                guard currentRuntimeScope == scope else {
                    _ = configManager.rollbackOnboardingRuntimeScope(transaction)
                    completionError = L("onboarding.firstRunScopeChanged")
                    return
                }
            }
            exactRuntimeRequiredAtCompletion = true
        case .unavailable:
            if serverManager.canStopRuntime {
                let result = await serverManager.activateOnboardingRuntime(
                    for: scope,
                    configManager: configManager
                )
                switch result {
                case .ready(let receipt):
                    runtimeReceipt = receipt
                    appliedScopeFingerprint = scope.draftFingerprint
                    persistOnboardingDraft()
                    exactRuntimeRequiredAtCompletion = true
                    break
                case .manualRuntime:
                    completionError = L("onboarding.firstRunManualRuntime")
                    return
                case .failed(let message):
                    completionError = L("onboarding.firstRunConfigFailed", message)
                    return
                }
                break
            }
            // Finishing first-run Setup is not runtime consent. Persist and
            // verify the selection, but do not create a token or start Node.
            guard let transaction = configManager.beginOnboardingRuntimeScopeTransaction(scope) else {
                completionError = configManager.lastPersistenceError
                    ?? L("onboarding.firstRunConfigFailed", "unknown")
                return
            }
            guard currentRuntimeScope == scope else {
                _ = configManager.rollbackOnboardingRuntimeScope(transaction)
                completionError = L("onboarding.firstRunScopeChanged")
                return
            }

            // Close the probe→save race. If a process appeared, accept only an
            // exact scope; otherwise restore and require an explicit retry.
            let postSaveProbe = await ServerManager.probeAppOwnedRuntime()
            if case .ready(_, appOwned: false) = postSaveProbe {
                _ = configManager.rollbackOnboardingRuntimeScope(transaction)
                completionError = L("onboarding.firstRunManualRuntime")
                return
            } else if case .ready(let version, appOwned: true) = postSaveProbe {
                guard let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil,
                      case .ready(let receipt) = await serverManager.validateOnboardingRuntime(
                          for: scope,
                          authorizedDraftFingerprint: scope.draftFingerprint,
                          runtimeToken: runtimeToken,
                          configManager: configManager
                      ),
                      receipt.version == version
                else {
                    _ = configManager.rollbackOnboardingRuntimeScope(transaction)
                    completionError = L("onboarding.firstRunManualRuntime")
                    return
                }
                runtimeReceipt = receipt
                exactRuntimeRequiredAtCompletion = true
            } else if postSaveProbe != .unavailable {
                _ = configManager.rollbackOnboardingRuntimeScope(transaction)
                completionError = L("onboarding.firstRunRuntimeFailed")
                return
            }
        case .portOccupied, .versionMismatch, .authenticationFailed:
            completionError = serverManager.statusLabel
            return
        }

        guard currentRuntimeScope == scope,
              configManager.isOnboardingRuntimeScopePersisted(scope)
        else {
            completionError = configManager.lastPersistenceError
                ?? L("onboarding.firstRunConfigFailed", "verification failed")
            return
        }

        // Final completion barrier. The scope captured before any await must
        // still be current and byte-for-byte persisted. A consented runtime is
        // re-authenticated against that exact scope/surface; the no-consent path
        // proves the runtime is still absent immediately before setting the flag.
        if exactRuntimeRequiredAtCompletion {
            guard let runtimeToken = (try? AppRuntimeToken.loadExisting()) ?? nil,
                  case .ready(let finalReceipt) = await serverManager.validateOnboardingRuntime(
                      for: scope,
                      authorizedDraftFingerprint: scope.draftFingerprint,
                      runtimeToken: runtimeToken,
                      configManager: configManager
                  ),
                  currentRuntimeScope == scope,
                  configManager.isOnboardingRuntimeScopePersisted(scope),
                  finalReceipt.draftFingerprint == scope.draftFingerprint,
                  finalReceipt.runtimeFingerprint == scope.runtimeFingerprint,
                  finalReceipt.tokenFingerprint == AppRuntimeToken.fingerprint(for: runtimeToken)
            else {
                completionError = L("onboarding.firstRunRuntimeFailed")
                return
            }
            runtimeReceipt = finalReceipt
        } else {
            let finalProbe = await ServerManager.probeAppOwnedRuntime()
            guard currentRuntimeScope == scope,
                  configManager.isOnboardingRuntimeScopePersisted(scope),
                  finalProbe == .unavailable
            else {
                if case .ready(_, appOwned: false) = finalProbe {
                    completionError = L("onboarding.firstRunManualRuntime")
                } else {
                    completionError = L("onboarding.firstRunRuntimeFailed")
                }
                return
            }
        }

        // Mark onboarding complete
        UserDefaults.standard.set(true, forKey: AirMcpConstants.keyOnboardingCompleted)
        UserDefaults.standard.removeObject(forKey: AirMcpConstants.keyOnboardingStep)
        OnboardingDraftStore.clear()

        onComplete()

        // Close the onboarding window
        OnboardingWindowHolder.shared.window?.close()
    }
}
