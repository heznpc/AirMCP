import SwiftUI
import AppKit

// MARK: - Module Definitions

private struct ModuleInfo: Identifiable {
    let id: String
    let name: String
    let icon: String
    let description: String
    let toolCount: Int
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
               description: "Playback, playlists, library", toolCount: 9),
    ModuleInfo(id: "finder", name: "Finder", icon: "folder",
               description: "Files, folders, search", toolCount: 8),
    ModuleInfo(id: "safari", name: "Safari", icon: "safari",
               description: "Tabs, bookmarks, reading list", toolCount: 8),
    ModuleInfo(id: "system", name: "System", icon: "gearshape",
               description: "Preferences, clipboard, display", toolCount: 10),
    ModuleInfo(id: "photos", name: "Photos", icon: "photo",
               description: "Browse, search, albums", toolCount: 9),
    ModuleInfo(id: "shortcuts", name: "Shortcuts", icon: "command",
               description: "Run, list shortcuts", toolCount: 4),
    ModuleInfo(id: "intelligence", name: "Intelligence", icon: "brain",
               description: "AI summarize, rewrite (macOS 26+)", toolCount: 3),
    ModuleInfo(id: "tv", name: "TV", icon: "tv",
               description: "Playback, library, search", toolCount: 6),
]

// MARK: - Shared Constants

enum IConnectConstants {
    static let npmPackageName = "iconnect-mcp"

    static let claudeDesktopConfig = """
    {
      "mcpServers": {
        "iconnect": {
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
        .filter { !disabledModules.contains($0.id) }
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

        Text("iConnect v0.1.2")
            .foregroundStyle(.secondary)

        Button("Quit") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
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
        IConnectConstants.copyToClipboard(IConnectConstants.claudeDesktopConfig)
    }

    private func copyClaudeCodeConfig() {
        IConnectConstants.copyToClipboard("claude mcp add iconnect -- npx -y \(IConnectConstants.npmPackageName)")
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
