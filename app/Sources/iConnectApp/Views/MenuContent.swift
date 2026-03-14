import SwiftUI
import AppKit

// MARK: - Module Definitions

private struct ModuleInfo: Identifiable {
    let id: String
    let name: String
    let icon: String
    let description: String
    let toolCount: Int
    /// Minimum macOS version required, or nil if available on all versions.
    let minMacosVersion: Int?

    init(id: String, name: String, icon: String, description: String, toolCount: Int, minMacosVersion: Int? = nil) {
        self.id = id
        self.name = name
        self.icon = icon
        self.description = description
        self.toolCount = toolCount
        self.minMacosVersion = minMacosVersion
    }

    /// Whether this module is available on the current macOS version.
    var isAvailableOnCurrentOS: Bool {
        guard let required = minMacosVersion else { return true }
        return Self.currentMacOSVersion >= required
    }

    private static let currentMacOSVersion = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
}

private let allModules: [ModuleInfo] = [
    ModuleInfo(id: "notes", name: "Notes", icon: "note.text",
               description: "Read, create, search", toolCount: 12),
    ModuleInfo(id: "reminders", name: "Reminders", icon: "checklist",
               description: "Create, complete, manage lists", toolCount: 11),
    ModuleInfo(id: "calendar", name: "Calendar", icon: "calendar",
               description: "Events, schedules, availability", toolCount: 10),
    ModuleInfo(id: "contacts", name: "Contacts", icon: "person.2",
               description: "Look up, create, update", toolCount: 10),
    ModuleInfo(id: "mail", name: "Mail", icon: "envelope",
               description: "Read, search, compose", toolCount: 11),
    ModuleInfo(id: "messages", name: "Messages", icon: "bubble.left",
               description: "Read, search, send", toolCount: 6),
    ModuleInfo(id: "music", name: "Music", icon: "music.note",
               description: "Playback, playlists, library", toolCount: 13),
    ModuleInfo(id: "finder", name: "Finder", icon: "folder",
               description: "Files, folders, search", toolCount: 8),
    ModuleInfo(id: "safari", name: "Safari", icon: "safari",
               description: "Tabs, bookmarks, reading list", toolCount: 12),
    ModuleInfo(id: "system", name: "System", icon: "gearshape",
               description: "Preferences, clipboard, display", toolCount: 17),
    ModuleInfo(id: "photos", name: "Photos", icon: "photo",
               description: "Browse, search, albums", toolCount: 9),
    ModuleInfo(id: "shortcuts", name: "Shortcuts", icon: "command",
               description: "Run, list, import, export shortcuts", toolCount: 10),
    ModuleInfo(id: "ui", name: "UI Automation", icon: "hand.tap",
               description: "Accessibility-based app control", toolCount: 6),
    ModuleInfo(id: "intelligence", name: "Intelligence", icon: "brain",
               description: "AI summarize, rewrite, generate (macOS 26+)", toolCount: 8, minMacosVersion: 26),
    ModuleInfo(id: "tv", name: "TV", icon: "tv",
               description: "Playback, library, search", toolCount: 6),
    ModuleInfo(id: "screen", name: "Screen", icon: "camera.viewfinder",
               description: "Screenshot, window list, recording", toolCount: 5),
    ModuleInfo(id: "maps", name: "Maps", icon: "map",
               description: "Search, directions, pins", toolCount: 6),
    ModuleInfo(id: "podcasts", name: "Podcasts", icon: "antenna.radiowaves.left.and.right.circle",
               description: "Shows, episodes, playback", toolCount: 6),
]

// MARK: - Shared Constants

enum AirMcpConstants {
    static let npmPackageName = "airmcp"
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
        // Server Status
        Label(serverManager.statusLabel, systemImage: serverManager.statusIcon)
            .foregroundStyle(serverManager.status == .running ? .green : .secondary)

        // Active Tools Count
        toolCountLabel

        // Server Control: Start / Stop
        serverControlButton

        Button("Refresh Status") {
            serverManager.checkStatus()
        }
        .keyboardShortcut("r")

        Divider()

        // Update notification
        updateSection

        // Quick Setup (visible when server not running)
        quickSetupSection

        // Module Status
        Menu("Modules") {
            ForEach(allModules) { module in
                moduleToggle(for: module)
            }
        }

        // Swift Bridge Status
        if configManager.swiftBridgeAvailable {
            Label("Swift Bridge: Available", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else {
            Label("Swift Bridge: Not Built", systemImage: "xmark.circle")
                .foregroundStyle(.secondary)
            Text("Build with: npm run swift-build")
                .font(.caption)
                .foregroundStyle(.secondary)
        }

        Divider()

        // Quick Settings
        Menu("Settings") {
            Toggle("Start Server on Launch", isOn: Binding(
                get: { serverManager.autoStartEnabled },
                set: { serverManager.autoStartEnabled = $0 }
            ))

            Divider()

            Toggle("Include Shared Notes", isOn: Binding(
                get: { configManager.includeShared },
                set: { configManager.includeShared = $0 }
            ))

            Toggle("Allow Send Messages", isOn: Binding(
                get: { configManager.allowSendMessages },
                set: { configManager.allowSendMessages = $0 }
            ))

            Toggle("Allow Send Mail", isOn: Binding(
                get: { configManager.allowSendMail },
                set: { configManager.allowSendMail = $0 }
            ))

            Divider()

            Text("Share Approval")
                .font(.caption)
                .foregroundStyle(.secondary)

            shareApprovalToggles

            Divider()

            Text("HITL Confirmation")
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker("Level", selection: Binding(
                get: { configManager.hitlLevel },
                set: { configManager.hitlLevel = $0 }
            )) {
                Text("Off").tag("off")
                Text("Destructive Only").tag("destructive-only")
                Text("All Writes").tag("all-writes")
                Text("All").tag("all")
            }

            Stepper(
                "Timeout: \(configManager.hitlTimeout)s",
                value: Binding(
                    get: { configManager.hitlTimeout },
                    set: { configManager.hitlTimeout = $0 }
                ),
                in: 10...120,
                step: 5
            )

            hitlStatusLabel

            Divider()

            Text("Restart server after changes")
                .font(.caption)
                .foregroundStyle(.secondary)
        }

        Divider()

        // Log Viewer
        Menu("View Logs (\(logManager.entries.count))") {
            if logManager.entries.isEmpty {
                Text("No log entries yet")
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
                    Text("\(logManager.entries.count - 20) more lines...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Divider()

                Button("Clear Logs") {
                    logManager.clear()
                }
            }
        }

        // Permissions & Config
        Button(permissionManager.isRunning ? "Setting Up..." : "Setup Permissions...") {
            permissionManager.runSetup()
        }
        .disabled(permissionManager.isRunning)

        Button("Copy Claude Config") {
            copyClaudeConfig()
        }
        .keyboardShortcut("c")

        Button("Copy Claude Code Config") {
            copyClaudeCodeConfig()
        }

        Divider()

        Button("Open Documentation") {
            if let url = URL(string: "https://github.com/heznpc/iConnect") {
                NSWorkspace.shared.open(url)
            }
        }

        Divider()

        Text("AirMCP v0.3.0")
            .foregroundStyle(.secondary)

        Button("Quit") {
            serverManager.stopServer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NSApplication.shared.terminate(nil)
            }
        }
        .keyboardShortcut("q")
    }

    // MARK: - Update Section

    @ViewBuilder
    private var updateSection: some View {
        if let version = updateManager.availableVersion {
            Label("Update Available: v\(version)", systemImage: "arrow.down.circle.fill")
                .foregroundStyle(.orange)

            if updateManager.isUpdating {
                Label("Updating...", systemImage: "progress.indicator")
                    .foregroundStyle(.secondary)
            } else {
                Button("Update Now") {
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

    // MARK: - Server Control Button

    @ViewBuilder
    private var serverControlButton: some View {
        switch serverManager.status {
        case .running:
            Button {
                serverManager.stopServer()
            } label: {
                Label("Stop Server", systemImage: "stop.circle")
            }
        case .stopped:
            Button {
                serverManager.startServer()
            } label: {
                Label("Start Server", systemImage: "play.circle")
            }
        case .checking:
            Button("Checking...") {}
                .disabled(true)
        }
    }

    // MARK: - Tool Count Label

    @ViewBuilder
    private var toolCountLabel: some View {
        let disabled = configManager.disabledModules
        let active = activeToolCount(disabledModules: disabled)
        let disabledCount = disabledModuleCount(disabledModules: disabled)

        if disabledCount > 0 {
            let noun = disabledCount == 1 ? "module" : "modules"
            Label(
                "\(active) tools available (\(disabledCount) \(noun) disabled)",
                systemImage: "wrench.and.screwdriver"
            )
            .foregroundStyle(.secondary)
            .font(.caption)
        } else {
            Label(
                "\(active) tools available",
                systemImage: "wrench.and.screwdriver"
            )
            .foregroundStyle(.secondary)
            .font(.caption)
        }
    }

    // MARK: - Module Toggle

    @ViewBuilder
    private func moduleToggle(for module: ModuleInfo) -> some View {
        let isDisabled = configManager.disabledModules.contains(module.id)
        let label = "\(module.name) \u{2014} \(module.description)"

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
            Label("\(label) — requires macOS \(module.minMacosVersion ?? 0)+", systemImage: module.icon)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Quick Setup Section

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
                Label("Get Started", systemImage: "sparkles")
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

    // MARK: - Clipboard Helpers

    private func copyClaudeConfig() {
        AirMcpConstants.copyToClipboard(AirMcpConstants.claudeDesktopConfig)
    }

    private func copyClaudeCodeConfig() {
        AirMcpConstants.copyToClipboard("claude mcp add airmcp -- npx -y \(AirMcpConstants.npmPackageName)")
    }

    // MARK: - Share Approval Toggles

    /// Modules that support share-approval gating (have shared item handling).
    private static let shareApprovalCapableModules: [(id: String, name: String)] = [
        ("notes", "Notes"),
        ("reminders", "Reminders"),
        ("calendar", "Calendar"),
    ]

    @ViewBuilder
    private var shareApprovalToggles: some View {
        ForEach(Self.shareApprovalCapableModules, id: \.id) { module in
            Toggle(module.name, isOn: Binding(
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

        Text("Require HITL approval before accessing shared items")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    // MARK: - HITL Status

    @ViewBuilder
    private var hitlStatusLabel: some View {
        switch hitlManager.state {
        case .connected:
            Label("HITL: Connected", systemImage: "antenna.radiowaves.left.and.right")
                .foregroundStyle(.green)
        case .listening:
            Label("HITL: Waiting", systemImage: "antenna.radiowaves.left.and.right.slash")
                .foregroundStyle(.secondary)
        case .idle:
            Label("HITL: Inactive", systemImage: "antenna.radiowaves.left.and.right.slash")
                .foregroundStyle(.secondary)
        }

        if !hitlManager.recentRequests.isEmpty {
            Divider()
            Text("Recent Approvals")
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(hitlManager.recentRequests) { record in
                Label(
                    "\(record.tool) — \(record.approved ? "Approved" : "Denied")",
                    systemImage: record.approved ? "checkmark.circle" : "xmark.circle"
                )
                .foregroundStyle(record.approved ? .green : .red)
                .font(.caption)
            }
        }
    }
}
