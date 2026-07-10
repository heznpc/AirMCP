import Foundation
import ServiceManagement

@MainActor
@Observable
final class ServerManager {

    enum Status: Sendable, Equatable {
        case running
        case stopped
        case checking
        case error(String)
    }

    var status: Status = .checking
    var autoStartEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: AirMcpConstants.keyAutoStart) }
        set { UserDefaults.standard.set(newValue, forKey: AirMcpConstants.keyAutoStart) }
    }
    var launchAtLoginEnabled: Bool
    var launchAtLoginError: String?

    private var timer: Timer?
    private var serverProcess: Process?
    var logManager: LogManager?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var isShuttingDown = false

    // MARK: - Crash Restart Tracking

    private var restartTimestamps: [Date] = []
    private static let maxRestartAttempts = 3
    private static let restartWindowSeconds: TimeInterval = 300  // 5 minutes

    init() {
        launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
                autoStartEnabled = true
            } else {
                try SMAppService.mainApp.unregister()
            }
            launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
            launchAtLoginError = nil
        } catch {
            launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
            launchAtLoginError = error.localizedDescription
        }
    }

    // MARK: - Polling

    func startPolling() {
        guard timer == nil else { return }
        checkStatus()
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkStatus()
            }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func checkStatus() {
        Task.detached {
            let isRunning = await Self.appOwnedRuntimeHealthy()
            let newStatus: Status = isRunning ? .running : .stopped
            await MainActor.run { [weak self] in
                guard let self else { return }
                // Clear error state when server is found running, or preserve error on stop
                switch self.status {
                case .error:
                    if case .running = newStatus { self.status = newStatus }
                default:
                    if self.status != newStatus { self.status = newStatus }
                }
            }
        }
    }

    // MARK: - Server Control

    func startServer() {
        guard status != .running, serverProcess?.isRunning != true else { return }
        status = .checking

        Task {
            var pipes: (stdout: Pipe, stderr: Pipe)?
            if let logManager {
                pipes = logManager.makePipes()
            }
            let result = await Self.launchServer(stdoutPipe: pipes?.stdout, stderrPipe: pipes?.stderr)
            switch result {
            case .success(let process):
                serverProcess = process
                stdoutPipe = pipes?.stdout
                stderrPipe = pipes?.stderr
                installTerminationHandler(on: process)
                if await Self.waitForAppOwnedRuntime() {
                    status = .running
                } else {
                    status = .error("App-owned runtime failed authenticated readiness")
                }
            case .failure(let error):
                if let pipes, let logManager {
                    logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
                }
                logManager?.append(error, isError: true)
                status = .error(error)
            }
        }
    }

    /// Auto-start the server after the user enables it. This also resumes an
    /// interrupted final onboarding step where runtime access was already
    /// granted before the user pressed Finish.
    func autoStartIfNeeded() {
        guard autoStartEnabled, status != .running else { return }
        Task {
            if await Self.appOwnedRuntimeHealthy() {
                status = .running
            } else {
                startServer()
            }
        }
    }

    func stopServer() {
        status = .checking
        logManager?.detachPipes(stdout: stdoutPipe, stderr: stderrPipe)
        stdoutPipe = nil
        stderrPipe = nil

        if let process = serverProcess, process.isRunning {
            process.terminate()
            serverProcess = nil
            Task {
                try? await Task.sleep(nanoseconds: 500_000_000)
                checkStatus()
            }
        } else {
            // Kill externally started processes
            Task {
                await Self.performPkill()
                try? await Task.sleep(nanoseconds: 500_000_000)
                status = .stopped
            }
        }
    }

    /// Synchronous best-effort cleanup for the macOS application lifecycle.
    /// Normal UI shutdown already calls `stopServer()`, but logout/restart and
    /// other AppKit termination paths must also signal the owned Node child so
    /// it cannot remain listening after the menu bar process exits.
    func prepareForApplicationTermination() {
        isShuttingDown = true
        stopPolling()
        logManager?.detachPipes(stdout: stdoutPipe, stderr: stderrPipe)
        stdoutPipe = nil
        stderrPipe = nil
        serverProcess?.terminationHandler = nil
        if serverProcess?.isRunning == true {
            serverProcess?.terminate()
        }
        serverProcess = nil
    }

    // MARK: - Crash Detection & Auto-Restart

    private func installTerminationHandler(on process: Process) {
        process.terminationHandler = { [weak self] terminatedProcess in
            let exitCode = terminatedProcess.terminationStatus
            let reason = terminatedProcess.terminationReason
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.logManager?.detachPipes(stdout: self.stdoutPipe, stderr: self.stderrPipe)
                self.stdoutPipe = nil
                self.stderrPipe = nil
                self.serverProcess = nil

                if self.isShuttingDown {
                    self.status = .stopped
                    return
                }

                if reason == .uncaughtSignal || exitCode != 0 {
                    let message = "Server process terminated unexpectedly (exit code: \(exitCode))"
                    self.logManager?.append(message, isError: true)
                    self.status = .stopped

                    if self.autoStartEnabled && self.canAttemptRestart() {
                        self.logManager?.append("Auto-restarting server in 3 seconds...", isError: false)
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        self.startServer()
                    }
                } else {
                    self.status = .stopped
                }
            }
        }
    }

    private func canAttemptRestart() -> Bool {
        let now = Date()
        restartTimestamps = restartTimestamps.filter {
            now.timeIntervalSince($0) < Self.restartWindowSeconds
        }
        guard restartTimestamps.count < Self.maxRestartAttempts else {
            logManager?.append(
                "Auto-restart skipped: \(Self.maxRestartAttempts) restarts within \(Int(Self.restartWindowSeconds / 60)) minutes",
                isError: true
            )
            return false
        }
        restartTimestamps.append(now)
        return true
    }

    // MARK: - Static Process Launchers (nonisolated)

    private enum LaunchResult: Sendable {
        case success(Process)
        case failure(String)
    }

    private static func launchServer(
        stdoutPipe: Pipe?,
        stderrPipe: Pipe?
    ) async -> LaunchResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let executable: String
                let arguments: [String]
                if let runtime = AirMcpConstants.bundledServerRuntime {
                    executable = runtime.node
                    arguments = [runtime.entry, "--http", "--port", "\(AirMcpConstants.appOwnedHttpPort)"]
                } else {
                    guard let npxPath = NodeEnvironment.findExecutable(named: "npx") else {
                        continuation.resume(returning: .failure(
                            "Bundled runtime is unavailable and Node.js was not found"
                        ))
                        return
                    }
                    executable = npxPath
                    arguments = [
                        "-y",
                        AirMcpConstants.npmPackageSpecifier,
                        "--http",
                        "--port",
                        "\(AirMcpConstants.appOwnedHttpPort)",
                    ]
                }
                let token: String
                do {
                    token = try AppRuntimeToken.ensure()
                } catch {
                    continuation.resume(returning: .failure(
                        "Failed to prepare app runtime token: \(error.localizedDescription)"
                    ))
                    return
                }

                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                process.standardOutput = stdoutPipe ?? FileHandle.nullDevice
                process.standardError = stderrPipe ?? FileHandle.nullDevice
                var env = NodeEnvironment.buildEnv()
                env["AIRMCP_ALLOW_NETWORK"] = "with-token"
                env["AIRMCP_HTTP_TOKEN"] = token
                env["AIRMCP_APP_OWNED_RUNTIME"] = "1"
                if let bridge = AirMcpConstants.bundledBridgePath {
                    env["AIRMCP_BRIDGE_PATH"] = bridge
                }
                process.environment = env

                do {
                    try process.run()
                    continuation.resume(returning: .success(process))
                } catch {
                    continuation.resume(returning: .failure(
                        "Failed to launch server: \(error.localizedDescription)"
                    ))
                }
            }
        }
    }

    private static func performPkill() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async {
                pkillAirMcp()
                continuation.resume()
            }
        }
    }

    // MARK: - Process Utilities

    /// Returns the exact version of the authenticated app-owned runtime.
    /// A bare health response is not sufficient because another AirMCP copy
    /// can own the port; the runtime must match this app and complete an MCP
    /// initialize/tools-list round trip with the current owner-only token.
    nonisolated static func authenticatedAppOwnedRuntimeVersion() async -> String? {
        guard let url = URL(string: AirMcpConstants.appOwnedHealthURL) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.0
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (json["status"] as? String) == "ok",
                  let version = json["version"] as? String,
                  version == AirMcpConstants.npmPackageVersion,
                  await AppRuntimeClient.probe()
            else { return nil }
            return version
        } catch {
            return nil
        }
    }

    private nonisolated static func appOwnedRuntimeHealthy() async -> Bool {
        await authenticatedAppOwnedRuntimeVersion() != nil
    }

    private nonisolated static func waitForAppOwnedRuntime() async -> Bool {
        for _ in 0..<40 {
            if await appOwnedRuntimeHealthy() { return true }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return false
    }

    private nonisolated static func pkillAirMcp() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        process.arguments = ["-f", "airmcp.*--http.*--port \(AirMcpConstants.appOwnedHttpPort)"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            // Ignore errors
        }
    }

    // MARK: - Display Helpers

    var statusLabel: String {
        switch status {
        case .running: L("server.running")
        case .stopped: L("server.stopped")
        case .checking: L("server.checking")
        case .error(let message): message
        }
    }

    var statusIcon: String {
        switch status {
        case .running: "circle.fill"
        case .stopped: "circle"
        case .checking: "circle.dotted"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}
