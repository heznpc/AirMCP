import SwiftUI
import UserNotifications
import AppKit
import WidgetKit

private var acceptanceHarnessForcesAppRuntime: Bool {
    #if AIRMCP_ACCEPTANCE_HARNESS
    return ProcessInfo.processInfo.environment[AirMcpConstants.envForceAppRuntime] == "1"
    #else
    return false
    #endif
}

@main
struct AirMCPApp: App {
    @NSApplicationDelegateAdaptor(AirMCPApplicationDelegate.self)
    private var applicationDelegate

    @State private var serverManager = ServerManager()
    @State private var permissionManager = PermissionManager()
    @State private var configManager = ConfigManager()
    @State private var setupManager = SetupManager()
    @State private var hitlManager = HitlManager()
    @State private var logManager = LogManager()
    @State private var updateManager = UpdateManager()
    @State private var addonManager = AddonManager()
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

        // RFC 0007 Phase A.2a: route generated AppIntents through the
        // existing stdio bridge. Must run before any AppIntent fires,
        // but AppIntents are resolved lazily by the system so this init
        // location is early enough.
        installMCPIntentRouterForMacOS()

        // Defer NSApp-dependent setup to after the application is fully initialized
        DispatchQueue.main.async {
            UNUserNotificationCenter.current().delegate = delegate

            if let iconURL = Bundle.moduleResources.url(forResource: "AppIcon@2x", withExtension: "png"),
               let icon = NSImage(contentsOf: iconURL) {
                NSApp?.applicationIconImage = icon
            }

            NSApp?.servicesProvider = ServicesProvider()

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
                updateManager: updateManager,
                addonManager: addonManager,
                onShowOnboarding: showOnboardingWindow
            )
            .onAppear {
                initializeRuntimeIfNeeded()
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
            // `label:` — unlike `content:` (MenuContent) above — is the actual
            // status-bar item view. MenuBarExtra(content:label:) tears content
            // down whenever the dropdown closes but keeps label instantiated
            // for as long as the status item is shown, i.e. the app's entire
            // run (this file already relies on that fact for the one-time
            // initializeRuntimeIfNeeded() call below). The HITL visual-fallback
            // subscription must live here, not in MenuContent: a request that
            // needs the fallback arrives precisely when the user isn't looking
            // at the menu, so content may not exist to receive it.
            HitlFallbackMenuBarLabel(hitlManager: hitlManager, onAppear: initializeRuntimeIfNeeded)
        }
        .menuBarExtraStyle(.menu)

        Window(L("trust.title"), id: AirMcpConstants.trustCenterWindowID) {
            TrustCenterView(
                serverManager: serverManager,
                permissionManager: permissionManager,
                configManager: configManager,
                hitlManager: hitlManager
            )
        }
        .defaultSize(width: 900, height: 700)
    }

    private func initializeRuntimeIfNeeded() {
        guard applicationDelegate.guardPrimaryInstance() else {
            applicationDelegate.redirectDuplicateLaunch()
            return
        }
        applicationDelegate.serverManager = serverManager
        serverManager.logManager = logManager
        URLSchemeHandler.shared.configure(serverManager: serverManager)
        serverManager.startPolling()
        if !hitlInitialized {
            hitlInitialized = true
            setupHitl()
        }
        if !appInitialized {
            appInitialized = true
            addonManager.refreshIfNeeded()
            updateManager.startPeriodicChecks()
            let defaults = UserDefaults.standard
            let onboardingCompleted = defaults.bool(forKey: AirMcpConstants.keyOnboardingCompleted)
            let onboardingPresented = defaults.bool(forKey: AirMcpConstants.keyOnboardingPresented)

            if ProcessInfo.processInfo.environment[AirMcpConstants.envShowOnboarding] == "1" {
                showOnboardingWindow()
            } else if acceptanceHarnessForcesAppRuntime {
                serverManager.startServer()
            } else if !onboardingCompleted && !onboardingPresented {
                showOnboardingWindow()
            } else if onboardingCompleted || serverManager.autoStartEnabled {
                // Only an explicit runtime-start action opts into auto-start.
                // Completing or revisiting onboarding does not change it.
                serverManager.autoStartIfNeeded()
            }
        }
    }

    private func setupHitl() {
        hitlManager.timeoutSeconds = configManager.hitlTimeout
        if configManager.hitlLevel != .off {
            // Register the local approval channel without prompting at launch.
            // macOS notification authorization is requested from an explicit
            // user-initiated runtime start action, or lazily by HitlManager
            // when the first gated request actually arrives — a reachable
            // socket alone must never be mistaken for a visible prompt.
            HitlManager.registerNotificationCategory()
            hitlManager.startListening()
        } else {
            hitlManager.stopListening()
        }
    }

    private func showOnboardingWindow() {
        UserDefaults.standard.set(true, forKey: AirMcpConstants.keyOnboardingPresented)

        if let existingWindow = OnboardingWindowHolder.shared.window {
            existingWindow.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }

        let onboardingView = OnboardingView(
            configManager: configManager,
            serverManager: serverManager,
            onComplete: {}
        )

        let hostingController = NSHostingController(rootView: onboardingView)
        let window = NSWindow(contentViewController: hostingController)
        window.title = L("onboarding.windowTitle")
        window.styleMask = [.titled, .closable]
        window.setContentSize(OnboardingView.preferredContentSize)
        window.contentMinSize = OnboardingView.preferredContentSize
        window.contentMaxSize = OnboardingView.preferredContentSize
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()

        // Keep a reference so the window isn't deallocated
        OnboardingWindowHolder.shared.setWindow(window)
    }
}

@MainActor
final class AirMCPApplicationDelegate: NSObject, NSApplicationDelegate {
    weak var serverManager: ServerManager?
    private(set) var isDuplicateLaunch = false
    private var existingApplication: NSRunningApplication?

    func applicationWillFinishLaunching(_ notification: Notification) {
        guardPrimaryInstance()
        // Register before SwiftUI scene construction so a launch-time GetURL
        // event can be buffered until the ServerManager is attached.
        NSAppleEventManager.shared().setEventHandler(
            URLSchemeHandler.shared,
            andSelector: #selector(URLSchemeHandler.handleURL(_:withReply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if isDuplicateLaunch {
            redirectDuplicateLaunch()
            return
        }
        // Publish a fresh widget snapshot so the widget renders from the governed
        // App Group container instead of reading EventKit itself. Best-effort and
        // no-op when unsigned / no entitlement. (A follow-up drives this off
        // EventKit change events; launch-time refresh is the first increment.)
        Task { await WidgetSnapshotWriter().refresh() }
    }

    /// Runtime fallback for launches that bypass LaunchServices (for example,
    /// directly invoking an archived app executable). The Info.plist guard is
    /// the first line of defense, while this check prevents a second copy from
    /// opening Setup or starting another app-owned runtime.
    @discardableResult
    func guardPrimaryInstance() -> Bool {
        if isDuplicateLaunch { return false }
        // Acceptance binaries are launched directly and use isolated state and
        // a private loopback port. Production builds compile this override out.
        if acceptanceHarnessForcesAppRuntime { return true }
        guard let bundleIdentifier = Bundle.main.bundleIdentifier else { return true }

        let runningApplications = NSRunningApplication.runningApplications(
            withBundleIdentifier: bundleIdentifier
        )
        var snapshots = runningApplications.map {
            RunningApplicationSnapshot(
                processIdentifier: $0.processIdentifier,
                bundleIdentifier: $0.bundleIdentifier,
                launchDate: $0.launchDate,
                isTerminated: $0.isTerminated
            )
        }
        let currentProcessIdentifier = ProcessInfo.processInfo.processIdentifier
        if !snapshots.contains(where: { $0.processIdentifier == currentProcessIdentifier }) {
            let currentApplication = NSRunningApplication.current
            snapshots.append(
                RunningApplicationSnapshot(
                    processIdentifier: currentProcessIdentifier,
                    bundleIdentifier: currentApplication.bundleIdentifier ?? bundleIdentifier,
                    launchDate: currentApplication.launchDate,
                    isTerminated: currentApplication.isTerminated
                )
            )
        }
        guard let existingProcessIdentifier = SingleInstancePolicy.existingProcessIdentifier(
            bundleIdentifier: bundleIdentifier,
            currentProcessIdentifier: currentProcessIdentifier,
            candidates: snapshots
        ) else { return true }

        isDuplicateLaunch = true
        existingApplication = runningApplications.first {
            $0.processIdentifier == existingProcessIdentifier
        } ?? NSRunningApplication(processIdentifier: existingProcessIdentifier)
        return false
    }

    func redirectDuplicateLaunch() {
        guard isDuplicateLaunch else { return }
        existingApplication?.activate(options: [.activateAllWindows])
        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverManager?.prepareForApplicationTermination()
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
    /// A pending HITL approval cannot be surfaced as a macOS notification
    /// (authorization denied or just refused) — the scene layer must bring the
    /// in-app approval UI to the foreground instead.
    static let hitlApprovalNeedsAttention = Notification.Name("hitlApprovalNeedsAttention")
}

/// The `label:` view of the menu bar's `MenuBarExtra` — i.e. the status-bar
/// icon itself, not its dropdown. SwiftUI keeps this view instantiated for as
/// long as the status item is visible (the app's entire run under
/// `.menuBarExtraStyle(.menu)`), unlike `content:`, which SwiftUI tears down
/// and rebuilds every time the dropdown closes/opens. A `.onReceive` placed on
/// `content` (as an earlier version of this fix did) only fires when the
/// dropdown happens to already be open — precisely the state a user who needs
/// the visual fallback is *not* in. Placing the subscription on this label
/// view instead is what makes it fire regardless of menu state: this view's
/// lifetime is provably the app's lifetime, not the dropdown's.
private struct HitlFallbackMenuBarLabel: View {
    @Environment(\.openWindow) private var openWindow
    let hitlManager: HitlManager
    let onAppear: () -> Void

    /// Reading `hitlManager.pendingRequests` here is what makes this view
    /// re-render on change — @Observable tracks properties read from `body`
    /// (or, as here, a computed var body reads), the same mechanism every
    /// other manager-driven view in this app already relies on.
    private var iconState: HitlManager.MenuBarIconState {
        HitlManager.menuBarIconState(pendingCount: hitlManager.pendingRequests.count)
    }

    var body: some View {
        // The status-item icon is the one signal with no z-order failure
        // mode: a hidden window or an unheard sound both still leave this
        // visible. Swap glyph + tint together so "something needs you" is
        // legible even to someone who only glances at the menu bar.
        Label("AirMCP", systemImage: iconState.systemImageName)
            .foregroundStyle(iconState == .pendingApproval ? Color.orange : Color.primary)
            .onAppear(perform: onAppear)
            .onReceive(NotificationCenter.default.publisher(for: .hitlApprovalNeedsAttention)) { _ in
                // Reuse the existing Trust Center window path (same call the
                // menu's "Trust Center" button and onboarding's link use).
                // LSUIElement apps need an explicit activate to come forward
                // since there's no Dock icon to click.
                openWindow(id: AirMcpConstants.trustCenterWindowID)
                NSApp.activate()
            }
    }
}

// MARK: - URL Scheme Handler (airmcp://)

enum RuntimeStartURLPolicy {
    static let canonicalURL = "airmcp://runtime/start"

    static func accepts(_ url: URL) -> Bool {
        url.absoluteString == canonicalURL
    }
}

@MainActor
final class URLSchemeHandler: NSObject {
    static let shared = URLSchemeHandler()
    private weak var serverManager: ServerManager?
    private var pendingRuntimeStart = false

    func configure(serverManager: ServerManager) {
        self.serverManager = serverManager
        guard pendingRuntimeStart else { return }
        pendingRuntimeStart = false
        requestRuntimeStart()
    }

    private func requestRuntimeStart() {
        guard let serverManager else {
            // A launch-time GetURL event can arrive before SwiftUI instantiates
            // the persistent menu-bar label. Drain it once the manager is wired.
            pendingRuntimeStart = true
            return
        }
        // A deep link may resume only a runtime the user already consented to
        // auto-start. It cannot create first-run consent or change preferences.
        serverManager.requestConnectorRuntimeStart()
    }

    @objc func handleURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let url = URL(string: urlString),
              url.scheme == "airmcp"
        else { return }

        switch url.host {
        case "briefing":
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Calendar.app"))
        case "trust":
            // From the Trust Status widget — bring the app forward so the user
            // can open the Trust Center. No tool details are conveyed in the URL.
            NSApp.activate()
        case "runtime":
            guard RuntimeStartURLPolicy.accepts(url) else { return }
            requestRuntimeStart()
        default:
            NSApp.activate()
        }
    }
}
