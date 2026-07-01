import SwiftUI
import AppKit

// MARK: - Localization Helper

func L(_ key: String) -> String {
    NSLocalizedString(key, bundle: .module, comment: "")
}

func L(_ key: String, _ args: CVarArg...) -> String {
    String(format: NSLocalizedString(key, bundle: .module, comment: ""), arguments: args)
}

// MARK: - Module Definitions

private struct ModuleInfo: Identifiable {
    let id: String
    let nameKey: String
    let descKey: String
    let icon: String
    let toolCount: Int
    let minMacosVersion: Int?

    init(id: String, icon: String, toolCount: Int, minMacosVersion: Int? = nil) {
        self.id = id
        self.nameKey = "module.\(id)"
        self.descKey = "module.\(id).desc"
        self.icon = icon
        self.toolCount = toolCount
        self.minMacosVersion = minMacosVersion
    }

    var localizedName: String { L(nameKey) }
    var localizedDescription: String { L(descKey) }

    var isAvailableOnCurrentOS: Bool {
        guard let required = minMacosVersion else { return true }
        return Self.currentMacOSVersion >= required
    }

    private static let currentMacOSVersion = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
}

private struct ModulePackInfo: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let packageName: String
    let icon: String
    let required: Bool

    var localizedTitle: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var installCommand: String { "npx airmcp modules enable \(id) --install" }
}

private struct WorkflowInfo: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let promptKey: String
    let safetyKey: String
    let siriKey: String?
    let icon: String
    let tools: [String]

    var title: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var prompt: String { L(promptKey) }
    var safety: String { L(safetyKey) }
    var siriPhrase: String? {
        guard let siriKey else { return nil }
        return L(siriKey)
    }
}

private let allModules: [ModuleInfo] = [
    ModuleInfo(id: "notes", icon: "note.text", toolCount: 12),
    ModuleInfo(id: "reminders", icon: "checklist", toolCount: 11),
    ModuleInfo(id: "calendar", icon: "calendar", toolCount: 10),
    ModuleInfo(id: "contacts", icon: "person.2", toolCount: 10),
    ModuleInfo(id: "mail", icon: "envelope", toolCount: 11),
    ModuleInfo(id: "messages", icon: "bubble.left", toolCount: 6),
    ModuleInfo(id: "music", icon: "music.note", toolCount: 13),
    ModuleInfo(id: "finder", icon: "folder", toolCount: 8),
    ModuleInfo(id: "safari", icon: "safari", toolCount: 12),
    ModuleInfo(id: "system", icon: "gearshape", toolCount: 17),
    ModuleInfo(id: "photos", icon: "photo", toolCount: 9),
    ModuleInfo(id: "shortcuts", icon: "command", toolCount: 11),
    ModuleInfo(id: "ui", icon: "hand.tap", toolCount: 6),
    ModuleInfo(id: "intelligence", icon: "brain", toolCount: 8, minMacosVersion: 26),
    ModuleInfo(id: "tv", icon: "tv", toolCount: 6),
    ModuleInfo(id: "screen", icon: "camera.viewfinder", toolCount: 5),
    ModuleInfo(id: "maps", icon: "map", toolCount: 6),
    ModuleInfo(id: "podcasts", icon: "antenna.radiowaves.left.and.right.circle", toolCount: 6),
    ModuleInfo(id: "weather", icon: "cloud.sun", toolCount: 3),
    ModuleInfo(id: "pages", icon: "doc.richtext", toolCount: 7),
    ModuleInfo(id: "numbers", icon: "tablecells", toolCount: 9),
    ModuleInfo(id: "keynote", icon: "play.rectangle", toolCount: 9),
    ModuleInfo(id: "location", icon: "location", toolCount: 2),
    ModuleInfo(id: "bluetooth", icon: "wave.3.right", toolCount: 4),
    ModuleInfo(id: "google", icon: "globe", toolCount: 16),
    ModuleInfo(id: "speech", icon: "waveform", toolCount: 3),
    ModuleInfo(id: "health", icon: "heart", toolCount: 5),
    ModuleInfo(id: "memory", icon: "brain.head.profile", toolCount: 4),
    ModuleInfo(id: "audit", icon: "doc.text.magnifyingglass", toolCount: 2),
    ModuleInfo(id: "spatial_prep", icon: "visionpro", toolCount: 2),
]

private let allModulePacks: [ModulePackInfo] = [
    ModulePackInfo(
        id: "core",
        titleKey: "addon.core",
        descKey: "addon.core.desc",
        packageName: "airmcp",
        icon: "square.stack.3d.up",
        required: true
    ),
    ModulePackInfo(
        id: "communications",
        titleKey: "addon.communications",
        descKey: "addon.communications.desc",
        packageName: "@heznpc/airmcp-communications",
        icon: "bubble.left.and.bubble.right",
        required: false
    ),
    ModulePackInfo(
        id: "productivity",
        titleKey: "addon.productivity",
        descKey: "addon.productivity.desc",
        packageName: "@heznpc/airmcp-productivity",
        icon: "doc.on.doc",
        required: false
    ),
    ModulePackInfo(
        id: "browser",
        titleKey: "addon.browser",
        descKey: "addon.browser.desc",
        packageName: "@heznpc/airmcp-browser",
        icon: "safari",
        required: false
    ),
    ModulePackInfo(
        id: "media",
        titleKey: "addon.media",
        descKey: "addon.media.desc",
        packageName: "@heznpc/airmcp-media",
        icon: "play.rectangle",
        required: false
    ),
    ModulePackInfo(
        id: "visual",
        titleKey: "addon.visual",
        descKey: "addon.visual.desc",
        packageName: "@heznpc/airmcp-visual",
        icon: "photo.on.rectangle",
        required: false
    ),
    ModulePackInfo(
        id: "location",
        titleKey: "addon.location",
        descKey: "addon.location.desc",
        packageName: "@heznpc/airmcp-location",
        icon: "map",
        required: false
    ),
    ModulePackInfo(
        id: "device",
        titleKey: "addon.device",
        descKey: "addon.device.desc",
        packageName: "@heznpc/airmcp-device",
        icon: "dot.radiowaves.left.and.right",
        required: false
    ),
    ModulePackInfo(
        id: "intelligence",
        titleKey: "addon.intelligence",
        descKey: "addon.intelligence.desc",
        packageName: "@heznpc/airmcp-intelligence",
        icon: "brain",
        required: false
    ),
    ModulePackInfo(
        id: "google-workspace",
        titleKey: "addon.google",
        descKey: "addon.google.desc",
        packageName: "@heznpc/airmcp-google",
        icon: "globe",
        required: false
    ),
    ModulePackInfo(
        id: "spatial",
        titleKey: "addon.spatial",
        descKey: "addon.spatial.desc",
        packageName: "@heznpc/airmcp-spatial",
        icon: "visionpro",
        required: false
    ),
]

private let featuredWorkflows: [WorkflowInfo] = [
    WorkflowInfo(
        id: "daily-briefing",
        titleKey: "workflow.dailyBriefing",
        descKey: "workflow.dailyBriefing.desc",
        promptKey: "workflow.dailyBriefing.prompt",
        safetyKey: "workflow.dailyBriefing.safety",
        siriKey: "workflow.dailyBriefing.siri",
        icon: "sun.max",
        tools: ["skill_daily-briefing", "summarize_context", "today_events", "list_reminders", "get_unread_count", "list_notes"]
    ),
    WorkflowInfo(
        id: "inbox-triage",
        titleKey: "workflow.inboxTriage",
        descKey: "workflow.inboxTriage.desc",
        promptKey: "workflow.inboxTriage.prompt",
        safetyKey: "workflow.inboxTriage.safety",
        siriKey: "workflow.inboxTriage.siri",
        icon: "tray.full",
        tools: ["skill_inbox-triage", "skill_sender-to-tasks", "search_messages", "create_reminder"]
    ),
    WorkflowInfo(
        id: "meeting-prep",
        titleKey: "workflow.meetingPrep",
        descKey: "workflow.meetingPrep.desc",
        promptKey: "workflow.meetingPrep.prompt",
        safetyKey: "workflow.meetingPrep.safety",
        siriKey: nil,
        icon: "person.2.wave.2",
        tools: ["today_events", "search_notes", "search_contacts", "recent_files", "list_reminders"]
    ),
    WorkflowInfo(
        id: "project-digest",
        titleKey: "workflow.projectDigest",
        descKey: "workflow.projectDigest.desc",
        promptKey: "workflow.projectDigest.prompt",
        safetyKey: "workflow.projectDigest.safety",
        siriKey: "workflow.projectDigest.siri",
        icon: "folder",
        tools: ["semantic_index", "skill_project-digest", "semantic_search", "find_related"]
    ),
    WorkflowInfo(
        id: "focus-blocks",
        titleKey: "workflow.focusBlocks",
        descKey: "workflow.focusBlocks.desc",
        promptKey: "workflow.focusBlocks.prompt",
        safetyKey: "workflow.focusBlocks.safety",
        siriKey: nil,
        icon: "calendar.badge.clock",
        tools: ["skill_focus-block-planner", "list_reminders", "create_event"]
    ),
    WorkflowInfo(
        id: "research-output",
        titleKey: "workflow.researchOutput",
        descKey: "workflow.researchOutput.desc",
        promptKey: "workflow.researchOutput.prompt",
        safetyKey: "workflow.researchOutput.safety",
        siriKey: nil,
        icon: "doc.text.magnifyingglass",
        tools: ["list_tabs", "read_page_content", "summarize_text", "create_note", "send_mail"]
    ),
]

// MARK: - Shared Constants

enum AirMcpConstants {
    static let npmPackageName = "airmcp"
    static let npmPackageVersion = "2.15.0"
    static var npmPackageSpecifier: String {
        ProcessInfo.processInfo.environment["AIRMCP_NPM_PACKAGE_SPECIFIER"]
            ?? "\(npmPackageName)@\(npmPackageVersion)"
    }
    static let mcpProtocolVersion = "2025-03-26"
    static let appOwnedHttpPort = 3847
    static let appOwnedHttpURL = "http://127.0.0.1:\(appOwnedHttpPort)/mcp"
    static let appOwnedHealthURL = "http://127.0.0.1:\(appOwnedHttpPort)/health"
    static let keyAutoStart = "autoStartServer"
    static let keyOnboardingCompleted = "onboardingCompleted"
    static let envForceAppRuntime = "AIRMCP_FORCE_APP_RUNTIME"

    static var appOwnedProxyArgs: [String] {
        ["-y", npmPackageSpecifier, "connect", "--url", appOwnedHttpURL]
    }

    static func appOwnedProxyEntry(token: String) -> [String: Any] {
        [
            "command": "npx",
            "args": appOwnedProxyArgs,
            "env": [
                "AIRMCP_HTTP_TOKEN": token,
            ],
        ]
    }

    static func tokenForConfig() -> String {
        (try? AppRuntimeToken.ensure()) ?? "<token>"
    }

    static func claudeDesktopConfig() -> String {
        let token = tokenForConfig()
        return """
        {
          "mcpServers": {
            "airmcp": {
              "command": "npx",
              "args": ["-y", "\(npmPackageSpecifier)", "connect", "--url", "\(appOwnedHttpURL)"],
              "env": {
                "AIRMCP_HTTP_TOKEN": "\(token)"
              }
            }
          }
        }
        """
    }

    static func claudeCodeConfig() -> String {
        "claude mcp add --env AIRMCP_HTTP_TOKEN=\(tokenForConfig()) airmcp -- npx -y \(npmPackageSpecifier) connect --url \(appOwnedHttpURL)"
    }

    static func codexConfig() -> String {
        "codex mcp add --env AIRMCP_HTTP_TOKEN=\(tokenForConfig()) airmcp -- npx -y \(npmPackageSpecifier) connect --url \(appOwnedHttpURL)"
    }

    static func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

// MARK: - Tool Count Helpers

private func activeToolCount(disabledModules: [String]) -> Int {
    allModules
        .filter { !disabledModules.contains($0.id) && $0.isAvailableOnCurrentOS }
        .reduce(0) { $0 + $1.toolCount }
}

private func disabledModuleCount(disabledModules: [String]) -> Int {
    allModules.filter { disabledModules.contains($0.id) }.count
}

// MARK: - Menu Content

struct MenuContent: View {
    let serverManager: ServerManager
    let permissionManager: PermissionManager
    let configManager: ConfigManager
    let setupManager: SetupManager
    let hitlManager: HitlManager
    let logManager: LogManager
    let updateManager: UpdateManager
    let addonManager: AddonManager

    var body: some View {
        // ── 1. Server Status ────────────────────────────────
        serverStatusSection

        Divider()

        // ── 2. Update & Quick Setup ────────────────────────
        updateSection
        quickSetupSection

        // ── 3. Workflows ───────────────────────────────────
        workflowsSection

        // ── 4. Modules ─────────────────────────────────────
        modulesSection

        // ── 5. Swift Bridge ────────────────────────────────
        swiftBridgeStatus

        Divider()

        // ── 6. Settings ────────────────────────────────────
        settingsMenu

        Divider()

        // ── 7. Logs ────────────────────────────────────────
        logsMenu

        // ── 8. Configuration & Help ────────────────────────
        configSection

        Divider()

        // ── 9. Footer ──────────────────────────────────────
        footerSection
    }

    // MARK: 1 - Server Status

    @ViewBuilder
    private var serverStatusSection: some View {
        Label(serverManager.statusLabel, systemImage: serverManager.statusIcon)
            .foregroundStyle(serverStatusColor)

        toolCountLabel

        serverControlButton

        Button(L("menu.refreshStatus")) {
            serverManager.checkStatus()
        }
        .keyboardShortcut("r")
    }

    @ViewBuilder
    private var serverControlButton: some View {
        switch serverManager.status {
        case .running:
            Button {
                serverManager.stopServer()
            } label: {
                Label(L("menu.stopServer"), systemImage: "stop.circle")
            }
        case .stopped, .error:
            Button {
                serverManager.startServer()
            } label: {
                Label(L("menu.startServer"), systemImage: "play.circle")
            }
        case .checking:
            Button(L("menu.checking")) {}
                .disabled(true)
        }
    }

    private var serverStatusColor: Color {
        switch serverManager.status {
        case .running: .green
        case .error: .red
        default: .secondary
        }
    }

    @ViewBuilder
    private var toolCountLabel: some View {
        let disabled = configManager.disabledModules
        let active = activeToolCount(disabledModules: disabled)
        let disabledCount = disabledModuleCount(disabledModules: disabled)

        if disabledCount > 0 {
            Label(
                L("menu.toolsAvailableDisabled", active, disabledCount),
                systemImage: "wrench.and.screwdriver"
            )
            .foregroundStyle(.secondary)
            .font(.caption)
        } else {
            Label(
                L("menu.toolsAvailable", active),
                systemImage: "wrench.and.screwdriver"
            )
            .foregroundStyle(.secondary)
            .font(.caption)
        }
    }

    // MARK: 2 - Update

    @ViewBuilder
    private var updateSection: some View {
        if let version = updateManager.availableVersion {
            Label(L("menu.updateAvailable", version), systemImage: "arrow.down.circle.fill")
                .foregroundStyle(.orange)

            if updateManager.isUpdating {
                Label(L("menu.updating"), systemImage: "progress.indicator")
                    .foregroundStyle(.secondary)
            } else {
                Button(L("menu.updateNow")) {
                    updateManager.performUpdate()
                }
            }

            if let error = updateManager.updateError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Divider()
        }
    }

    // MARK: 2b - Quick Setup

    @ViewBuilder
    private var quickSetupSection: some View {
        let isStopped: Bool = {
            switch serverManager.status {
            case .stopped, .error: return true
            default: return false
            }
        }()
        let showGetStarted = isStopped
            && !setupManager.isRunning
            && setupManager.state == .idle

        if showGetStarted {
            Button {
                setupManager.runSetup(
                    permissionManager: permissionManager,
                    serverManager: serverManager
                )
            } label: {
                Label(L("menu.getStarted"), systemImage: "sparkles")
            }

            Divider()
        }

        if let label = setupManager.progressLabel {
            if case .done = setupManager.state {
                Label(label, systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                Divider()
            } else if case .failed = setupManager.state {
                Label(label, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                Divider()
            } else {
                Label(label, systemImage: "progress.indicator")
                    .foregroundStyle(.secondary)
                Divider()
            }
        }
    }

    // MARK: 3 - Workflows

    @ViewBuilder
    private var workflowsSection: some View {
        Menu(L("menu.workflows")) {
            Text(L("workflow.menuHint"))
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()

            ForEach(featuredWorkflows) { workflow in
                Menu {
                    Text(workflow.localizedDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(workflow.safety)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Divider()

                    Button(L("workflow.copyPrompt")) {
                        AirMcpConstants.copyToClipboard(workflow.prompt)
                    }

                    if let siriPhrase = workflow.siriPhrase {
                        Button(L("workflow.copySiriPhrase")) {
                            AirMcpConstants.copyToClipboard("Hey Siri, \(siriPhrase)")
                        }
                    }

                    Button(L("workflow.copyToolList")) {
                        AirMcpConstants.copyToClipboard(workflow.tools.joined(separator: ", "))
                    }
                } label: {
                    Label(workflow.title, systemImage: workflow.icon)
                }
            }

            Divider()

            Button(L("workflow.openShortcutsDoc")) {
                if let url = URL(string: "https://github.com/heznpc/AirMCP/blob/main/docs/shortcuts.md") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }

    // MARK: 4 - Modules

    @ViewBuilder
    private var modulesSection: some View {
        Menu(L("menu.modules")) {
            addOnsMenu
            Divider()
            ForEach(allModules) { module in
                moduleToggle(for: module)
            }
        }
    }

    @ViewBuilder
    private var addOnsMenu: some View {
        Menu(L("addons.menu")) {
            if let status = addonManager.statusLabel {
                Label(status, systemImage: addonStatusIcon)
                    .foregroundStyle(addonStatusColor)
                Divider()
            }

            Button(L("addons.refresh")) {
                addonManager.refresh()
            }
            .disabled(addonManager.isRunning)

            Divider()

            ForEach(allModulePacks) { pack in
                addOnMenu(for: pack)
            }

            Divider()

            Text(L("settings.restartHint"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func addOnMenu(for pack: ModulePackInfo) -> some View {
        let isActive = configManager.modulePacks.contains(pack.id)
        let isInstalled = addonManager.isInstalled(pack: pack.id)
        let isActiveButMissing = isActive && !isInstalled

        Menu {
            Text(pack.localizedDescription)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(pack.packageName)
                .font(.caption)
                .foregroundStyle(.secondary)

            Label(
                addonInstallStatusText(isInstalled: isInstalled, isActiveButMissing: isActiveButMissing),
                systemImage: addonInstallStatusIcon(isInstalled: isInstalled, isActiveButMissing: isActiveButMissing)
            )

            Divider()

            Toggle(L("addons.active"), isOn: Binding(
                get: { isActive },
                set: { enabled in
                    configManager.setModulePack(pack.id, enabled: enabled)
                }
            ))
            .disabled(pack.required)

            if !pack.required {
                Button(L("addons.install")) {
                    addonManager.install(pack: pack.id, configManager: configManager)
                }
                .disabled(addonManager.isRunning)

                Button(L("addons.uninstall")) {
                    addonManager.uninstall(pack: pack.id, configManager: configManager)
                }
                .disabled(addonManager.isRunning || !isInstalled)

                Button(L("addons.copyInstallCommand")) {
                    AirMcpConstants.copyToClipboard(pack.installCommand)
                }
            }
        } label: {
            Label(pack.localizedTitle, systemImage: addOnMenuIcon(pack: pack, isActive: isActive, isInstalled: isInstalled))
        }
    }

    private func addOnMenuIcon(pack: ModulePackInfo, isActive: Bool, isInstalled: Bool) -> String {
        if isActive && !isInstalled {
            return "exclamationmark.triangle"
        }
        if isActive {
            return "checkmark.circle"
        }
        return pack.icon
    }

    private func addonInstallStatusText(isInstalled: Bool, isActiveButMissing: Bool) -> String {
        if !addonManager.hasLoadedInstallStatus {
            return L("addons.statusUnknown")
        }
        if isActiveButMissing {
            return L("addons.activeButMissing")
        }
        return L(isInstalled ? "addons.installed" : "addons.notInstalled")
    }

    private func addonInstallStatusIcon(isInstalled: Bool, isActiveButMissing: Bool) -> String {
        if !addonManager.hasLoadedInstallStatus {
            return "questionmark.circle"
        }
        if isActiveButMissing {
            return "exclamationmark.triangle"
        }
        return isInstalled ? "checkmark.seal" : "icloud.and.arrow.down"
    }

    private var addonStatusIcon: String {
        switch addonManager.state {
        case .idle:
            "circle"
        case .running:
            "progress.indicator"
        case .done:
            "checkmark.circle.fill"
        case .failed:
            "exclamationmark.triangle"
        }
    }

    private var addonStatusColor: Color {
        switch addonManager.state {
        case .done:
            .green
        case .failed:
            .red
        default:
            .secondary
        }
    }

    @ViewBuilder
    private func moduleToggle(for module: ModuleInfo) -> some View {
        let isDisabled = configManager.disabledModules.contains(module.id)
        let label = "\(module.localizedName) \u{2014} \(module.localizedDescription)"

        if module.isAvailableOnCurrentOS {
            Toggle(isOn: Binding(
                get: { !isDisabled },
                set: { enabled in
                    var modules = configManager.disabledModules
                    if enabled {
                        modules.removeAll { $0 == module.id }
                    } else {
                        modules.append(module.id)
                    }
                    configManager.disabledModules = modules
                }
            )) {
                Label(label, systemImage: module.icon)
            }
        } else {
            Label(
                "\(label) — \(L("module.requiresMacOS", module.minMacosVersion ?? 0))",
                systemImage: module.icon
            )
            .foregroundStyle(.secondary)
        }
    }

    // MARK: 5 - Swift Bridge

    @ViewBuilder
    private var swiftBridgeStatus: some View {
        if configManager.swiftBridgeAvailable {
            Label(L("menu.swiftBridgeAvailable"), systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else {
            Label(L("menu.swiftBridgeNotBuilt"), systemImage: "xmark.circle")
                .foregroundStyle(.secondary)
            Text(L("menu.swiftBuildHint"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: 6 - Settings

    @ViewBuilder
    private var settingsMenu: some View {
        Menu(L("menu.settings")) {
            // General
            Toggle(L("settings.autoStart"), isOn: Binding(
                get: { serverManager.autoStartEnabled },
                set: { serverManager.autoStartEnabled = $0 }
            ))

            Divider()

            // Permissions
            Toggle(L("settings.includeShared"), isOn: Binding(
                get: { configManager.includeShared },
                set: { configManager.includeShared = $0 }
            ))

            Toggle(L("settings.allowMessages"), isOn: Binding(
                get: { configManager.allowSendMessages },
                set: { configManager.allowSendMessages = $0 }
            ))

            Toggle(L("settings.allowMail"), isOn: Binding(
                get: { configManager.allowSendMail },
                set: { configManager.allowSendMail = $0 }
            ))

            Divider()

            // Share Approval
            Text(L("settings.shareApproval"))
                .font(.caption)
                .foregroundStyle(.secondary)

            shareApprovalToggles

            Divider()

            // HITL
            Text(L("settings.hitl"))
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker(L("settings.hitlLevel"), selection: Binding(
                get: { configManager.hitlLevel },
                set: { configManager.hitlLevel = $0 }
            )) {
                Text(L("settings.hitlOff")).tag(HitlLevel.off)
                Text(L("settings.hitlDestructiveOnly")).tag(HitlLevel.destructiveOnly)
                Text(L("settings.hitlSensitiveOnly")).tag(HitlLevel.sensitiveOnly)
                Text(L("settings.hitlAllWrites")).tag(HitlLevel.allWrites)
                Text(L("settings.hitlAll")).tag(HitlLevel.all)
            }

            Stepper(
                L("settings.hitlTimeout", configManager.hitlTimeout),
                value: Binding(
                    get: { configManager.hitlTimeout },
                    set: { configManager.hitlTimeout = $0 }
                ),
                in: 10...120,
                step: 5
            )

            hitlStatusLabel

            Divider()

            Text(L("settings.restartHint"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: 7 - Logs

    @ViewBuilder
    private var logsMenu: some View {
        Menu(L("menu.viewLogs", logManager.entries.count)) {
            if logManager.entries.isEmpty {
                Text(L("menu.noLogs"))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(logManager.recentLines) { entry in
                    Text(entry.message)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(entry.isError ? .red : .primary)
                        .lineLimit(1)
                }

                if logManager.entries.count > 20 {
                    Divider()
                    Text(L("menu.moreLines", logManager.entries.count - 20))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Button(L("menu.clearLogs")) {
                    logManager.clear()
                }
            }
        }
    }

    // MARK: 8 - Configuration & Help

    @ViewBuilder
    private var configSection: some View {
        Button(permissionManager.isRunning ? L("menu.settingUp") : L("menu.setupPermissions")) {
            permissionManager.runSetup()
        }
        .disabled(permissionManager.isRunning)

        Button(L("menu.copyClaudeConfig")) {
            AirMcpConstants.copyToClipboard(AirMcpConstants.claudeDesktopConfig())
        }
        .keyboardShortcut("c")

        Button(L("menu.copyClaudeCodeConfig")) {
            AirMcpConstants.copyToClipboard(AirMcpConstants.claudeCodeConfig())
        }

        Button(L("menu.copyCodexConfig")) {
            AirMcpConstants.copyToClipboard(AirMcpConstants.codexConfig())
        }

        Button(L("menu.addWidget")) {
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Library/CoreServices/NotificationCenter.app"))
        }

        Divider()

        Button(L("menu.openDocumentation")) {
            if let url = URL(string: "https://github.com/heznpc/AirMCP") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    // MARK: 9 - Footer

    @ViewBuilder
    private var footerSection: some View {
        Text("AirMCP v\(updateManager.currentVersionString)")
            .foregroundStyle(.secondary)

        Button(L("menu.quit")) {
            serverManager.stopServer()
            Task {
                // Wait for the server process to actually terminate, up to 5 seconds
                let deadline = Date().addingTimeInterval(5.0)
                while Date() < deadline {
                    if case .stopped = serverManager.status { break }
                    if case .error = serverManager.status { break }
                    try? await Task.sleep(nanoseconds: 200_000_000)
                }
                NSApplication.shared.terminate(nil)
            }
        }
        .keyboardShortcut("q")
    }

    // MARK: - Share Approval Toggles

    private static let shareApprovalCapableModules: [(id: String, nameKey: String)] = [
        ("notes", "module.notes"),
        ("reminders", "module.reminders"),
        ("calendar", "module.calendar"),
    ]

    @ViewBuilder
    private var shareApprovalToggles: some View {
        ForEach(Self.shareApprovalCapableModules, id: \.id) { module in
            Toggle(L(module.nameKey), isOn: Binding(
                get: { configManager.shareApprovalModules.contains(module.id) },
                set: { enabled in
                    var modules = configManager.shareApprovalModules
                    if enabled {
                        if !modules.contains(module.id) {
                            modules.append(module.id)
                        }
                    } else {
                        modules.removeAll { $0 == module.id }
                    }
                    configManager.shareApprovalModules = modules
                }
            ))
        }

        Text(L("settings.shareApprovalHint"))
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    // MARK: - HITL Status

    @ViewBuilder
    private var hitlStatusLabel: some View {
        switch hitlManager.state {
        case .connected:
            Label(L("settings.hitlConnected"), systemImage: "antenna.radiowaves.left.and.right")
                .foregroundStyle(.green)
        case .listening:
            Label(L("settings.hitlWaiting"), systemImage: "antenna.radiowaves.left.and.right.slash")
                .foregroundStyle(.secondary)
        case .idle:
            Label(L("settings.hitlInactive"), systemImage: "antenna.radiowaves.left.and.right.slash")
                .foregroundStyle(.secondary)
        }

        if !hitlManager.pendingRequests.isEmpty {
            Divider()
            Text(L("settings.pendingApprovals"))
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(hitlManager.pendingRequests) { request in
                VStack(alignment: .leading, spacing: 4) {
                    Label(
                        request.tool,
                        systemImage: request.destructive || request.sensitive ? "exclamationmark.triangle" : "questionmark.circle"
                    )
                        .font(.caption)
                        .foregroundStyle(request.destructive || request.sensitive ? .orange : .primary)
                    HStack {
                        Button(L("hitl.approve")) {
                            hitlManager.respond(id: request.id, approved: true, tool: request.tool)
                        }
                        Button(L("hitl.deny")) {
                            hitlManager.respond(id: request.id, approved: false, tool: request.tool)
                        }
                    }
                }
            }
        }

        if !hitlManager.recentRequests.isEmpty {
            Divider()
            Text(L("settings.recentApprovals"))
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(hitlManager.recentRequests) { record in
                Label(
                    "\(record.tool) — \(record.approved ? L("settings.approved") : L("settings.denied"))",
                    systemImage: record.approved ? "checkmark.circle" : "xmark.circle"
                )
                .foregroundStyle(record.approved ? .green : .red)
                .font(.caption)
            }
        }
    }
}
