import SwiftUI
import UserNotifications
import AppKit
import WidgetKit

@main
struct AirMCPApp: App {
    @State private var serverManager = ServerManager()
    @State private var permissionManager = PermissionManager()
    @State private var configManager = ConfigManager()
    @State private var setupManager = SetupManager()
    @State private var hitlManager = HitlManager()
    @State private var logManager = LogManager()
    @State private var updateManager = UpdateManager()
    @State private var hitlInitialized = false
    @State private var appInitialized = false

    private let notificationDelegate: HitlNotificationDelegate

    init() {
        let delegate = HitlNotificationDelegate { requestId, approved in
            Task { @MainActor in
                NotificationCenter.default.post(
                    name: .hitlNotificationResponse,
                    object: nil,
                    userInfo: ["id": requestId, "approved": approved]
                )
            }
        }
        self.notificationDelegate = delegate

        // Defer NSApp-dependent setup to after the application is fully initialized
        DispatchQueue.main.async {
            UNUserNotificationCenter.current().delegate = delegate

            if let iconURL = Bundle.module.url(forResource: "AppIcon@2x", withExtension: "png", subdirectory: "Resources"),
               let icon = NSImage(contentsOf: iconURL) {
                NSApp?.applicationIconImage = icon
            }

            NSApp?.servicesProvider = ServicesProvider()

            // Register URL scheme handler (airmcp://)
            NSAppleEventManager.shared().setEventHandler(
                URLSchemeHandler.shared,
                andSelector: #selector(URLSchemeHandler.handleURL(_:withReply:)),
                forEventClass: AEEventClass(kInternetEventClass),
                andEventID: AEEventID(kAEGetURL)
            )
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuContent(
                serverManager: serverManager,
                permissionManager: permissionManager,
                configManager: configManager,
                setupManager: setupManager,
                hitlManager: hitlManager,
                logManager: logManager,
                updateManager: updateManager
            )
            .onAppear {
                serverManager.logManager = logManager
                serverManager.startPolling()
                if !hitlInitialized {
                    hitlInitialized = true
                    setupHitl()
                }
                if !appInitialized {
                    appInitialized = true
                    updateManager.startPeriodicChecks()
                    if !UserDefaults.standard.bool(forKey: AirMcpConstants.keyOnboardingCompleted) {
                        showOnboardingWindow()
                    } else {
                        serverManager.autoStartIfNeeded()
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .hitlNotificationResponse)) { notification in
                guard let userInfo = notification.userInfo,
                      let requestId = userInfo["id"] as? String,
                      let approved = userInfo["approved"] as? Bool
                else { return }
                let tool = hitlManager.pendingTools[requestId] ?? "unknown"
                hitlManager.respond(id: requestId, approved: approved, tool: tool)
            }
        } label: {
            Label("AirMCP", systemImage: "a.square.fill")
        }
        .menuBarExtraStyle(.menu)
    }

    private func setupHitl() {
        HitlManager.requestNotificationPermission()
        HitlManager.registerNotificationCategory()
        hitlManager.timeoutSeconds = configManager.hitlTimeout
        if configManager.hitlLevel != .off {
            hitlManager.startListening()
        }
    }

    private func showOnboardingWindow() {
        let onboardingView = OnboardingView(configManager: configManager) { [serverManager] in
            // Enable auto-start by default after first onboarding
            serverManager.autoStartEnabled = true
            serverManager.autoStartIfNeeded()
        }

        let hostingController = NSHostingController(rootView: onboardingView)
        let window = NSWindow(contentViewController: hostingController)
        window.title = "AirMCP Setup"
        window.styleMask = [.titled, .closable]
        window.setContentSize(NSSize(width: 520, height: 480))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()

        // Keep a reference so the window isn't deallocated
        OnboardingWindowHolder.shared.setWindow(window)
    }
}

/// Holds a reference to the onboarding window to prevent deallocation.
@MainActor
final class OnboardingWindowHolder: NSObject {
    static let shared = OnboardingWindowHolder()
    var window: NSWindow?

    func setWindow(_ newWindow: NSWindow) {
        NotificationCenter.default.removeObserver(self)
        window = newWindow
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowWillClose),
            name: NSWindow.willCloseNotification,
            object: newWindow
        )
    }

    @objc private func windowWillClose(_ notification: Notification) {
        window = nil
    }

    private override init() { super.init() }
}

extension Notification.Name {
    static let hitlNotificationResponse = Notification.Name("hitlNotificationResponse")
}

// MARK: - URL Scheme Handler (airmcp://)

@MainActor
final class URLSchemeHandler: NSObject {
    static let shared = URLSchemeHandler()

    @objc func handleURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let url = URL(string: urlString),
              url.scheme == "airmcp"
        else { return }

        switch url.host {
        case "briefing":
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Calendar.app"))
        default:
            NSApp.activate()
        }
    }
}
