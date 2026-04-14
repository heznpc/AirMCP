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
]

// MARK: - Shared Constants

enum AirMcpConstants {
    static let npmPackageName = "airmcp"
    static let mcpProtocolVersion = "2025-03-26"
    static let keyAutoStart = "autoStartServer"
    static let keyOnboardingCompleted = "onboardingCompleted"

    static let claudeDesktopConfig = """
    {
      "mcpServers": {
        "airmcp": {
          "command": "npx",
          "args": ["-y", "\(npmPackageName)"]
        }
      }
    }
    """

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

    var body: some View {
        // ── 1. Server Status ────────────────────────────────
        serverStatusSection

        Divider()

        // ── 2. Update & Quick Setup ────────────────────────
        updateSection
        quickSetupSection

        // ── 3. Modules ─────────────────────────────────────
        modulesSection

        // ── 4. Swift Bridge ────────────────────────────────
        swiftBridgeStatus

        Divider()

        // ── 5. Settings ────────────────────────────────────
        settingsMenu

        Divider()

        // ── 6. Logs ────────────────────────────────────────
        logsMenu

        // ── 7. Configuration & Help ────────────────────────
        configSection

        Divider()

        // ── 8. Footer ──────────────────────────────────────
        footerSection
    }

    // MARK: 1 - Server Status

    @ViewBuilder
    private var serverStatusSection: some View {
        Label(serverManager.statusLabel, systemImage: serverManager.statusIcon)
            .foregroundStyle(serverManager.status == .running ? .green : .secondary)

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
        case .stopped:
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
        let showGetStarted = serverManager.status == .stopped
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

    // MARK: 3 - Modules

    @ViewBuilder
    private var modulesSection: some View {
        Menu(L("menu.modules")) {
            ForEach(allModules) { module in
                moduleToggle(for: module)
            }
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

    // MARK: 4 - Swift Bridge

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

    // MARK: 5 - Settings

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

    // MARK: 6 - Logs

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

    // MARK: 7 - Configuration & Help

    @ViewBuilder
    private var configSection: some View {
        Button(permissionManager.isRunning ? L("menu.settingUp") : L("menu.setupPermissions")) {
            permissionManager.runSetup()
        }
        .disabled(permissionManager.isRunning)

        Button(L("menu.copyClaudeConfig")) {
            AirMcpConstants.copyToClipboard(AirMcpConstants.claudeDesktopConfig)
        }
        .keyboardShortcut("c")

        Button(L("menu.copyClaudeCodeConfig")) {
            AirMcpConstants.copyToClipboard("claude mcp add airmcp -- npx -y \(AirMcpConstants.npmPackageName)")
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

    // MARK: 8 - Footer

    @ViewBuilder
    private var footerSection: some View {
        Text("AirMCP v\(updateManager.currentVersionString)")
            .foregroundStyle(.secondary)

        Button(L("menu.quit")) {
            serverManager.stopServer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
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
