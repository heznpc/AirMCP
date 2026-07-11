import Foundation
import AppKit

@MainActor
@Observable
final class SetupManager {

    enum SetupState: Equatable {
        case idle
        case step(Int, String)
        case done
        case failed(String)
    }

    var state: SetupState = .idle

    var isRunning: Bool {
        if case .step = state { return true }
        return false
    }

    var progressLabel: String? {
        switch state {
        case .idle: return nil
        case .step(let n, let msg): return L("setup.step", n) + msg
        case .done: return L("setup.done")
        case .failed(let msg): return L("setup.failed", msg)
        }
    }

    func runSetup(
        permissionManager: PermissionManager,
        serverManager: ServerManager,
        hitlLevel: HitlLevel
    ) {
        guard !isRunning else { return }

        if RuntimeStartConsentPolicy.shouldRequestApprovalNotifications(
            hitlLevel: hitlLevel,
            userInitiated: true
        ) {
            // Quick Setup is an explicit user action. It is therefore allowed
            // to request the approval-notification permission that passive app
            // initialization must not request.
            HitlManager.requestNotificationPermission()
        }

        state = .step(1, L("setup.permissions"))

        Task { [weak self] in
            // Step 1: Permissions
            permissionManager.runSetup()

            // Wait for permission setup to complete
            while permissionManager.isRunning {
                try? await Task.sleep(nanoseconds: 300_000_000)
            }

            // Step 2: Start server
            await MainActor.run {
                self?.state = .step(2, L("setup.startingServer"))
            }

            serverManager.startServer()

            // Wait for server to come up (up to 15 seconds)
            var attempts = 0
            while serverManager.status != .running && attempts < 30 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                serverManager.checkStatus()
                attempts += 1
            }

            guard Self.runtimeReadyForConfiguration(serverManager.status) else {
                await MainActor.run {
                    self?.state = .failed(serverManager.statusLabel)
                }
                return
            }

            // Step 3: Copy config
            await MainActor.run {
                self?.state = .step(3, L("setup.copyingConfig"))
            }

            try? await Task.sleep(nanoseconds: 500_000_000)

            await MainActor.run {
                AirMcpConstants.copyToClipboard(AirMcpConstants.claudeDesktopConfig())
                self?.state = .done
            }
        }
    }

    nonisolated static func runtimeReadyForConfiguration(
        _ status: ServerManager.Status
    ) -> Bool {
        if case .running = status { return true }
        return false
    }

    func reset() {
        state = .idle
    }
}
