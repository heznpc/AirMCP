import Foundation

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

    private var timer: Timer?
    private var serverProcess: Process?
    var logManager: LogManager?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

    // MARK: - Crash Restart Tracking

    private var restartTimestamps: [Date] = []
    private static let maxRestartAttempts = 3
    private static let restartWindowSeconds: TimeInterval = 300  // 5 minutes

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
            let isRunning = await Self.httpServerHealthy()
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
        guard status != .running, status != .checking else { return }
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
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                checkStatus()
            case .failure(let error):
                if let pipes, let logManager {
                    logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
                }
                logManager?.append(error, isError: true)
                status = .error(error)
            }
        }
    }

    /// Auto-start server if enabled. Call after onboarding completes.
    func autoStartIfNeeded() {
        guard autoStartEnabled, status != .running else { return }
        startServer()
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
                guard let npxPath = NodeEnvironment.findExecutable(named: "npx") else {
                    continuation.resume(returning: .failure(
                        "Node.js not found. Install from nodejs.org or via Homebrew: brew install node"
                    ))
                    return
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
                process.executableURL = URL(fileURLWithPath: npxPath)
                process.arguments = [
                    "-y",
                    AirMcpConstants.npmPackageSpecifier,
                    "--http",
                    "--port",
                    "\(AirMcpConstants.appOwnedHttpPort)",
                ]
                process.standardOutput = stdoutPipe ?? FileHandle.nullDevice
                process.standardError = stderrPipe ?? FileHandle.nullDevice
                var env = NodeEnvironment.buildEnv()
                env["AIRMCP_ALLOW_NETWORK"] = "with-token"
                env["AIRMCP_HTTP_TOKEN"] = token
                env["AIRMCP_APP_OWNED_RUNTIME"] = "1"
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

    private nonisolated static func httpServerHealthy() async -> Bool {
        guard let url = URL(string: AirMcpConstants.appOwnedHealthURL) else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.0
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
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
