import Foundation

@MainActor
@Observable
final class ServerManager {

    enum Status: Sendable, Equatable {
        case running
        case stopped
        case checking
    }

    var status: Status = .checking
    var autoStartEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: IConnectConstants.keyAutoStart) }
        set { UserDefaults.standard.set(newValue, forKey: IConnectConstants.keyAutoStart) }
    }

    private var timer: Timer?
    private var serverProcess: Process?
    var logManager: LogManager?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

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
            let isRunning = Self.pgrepIConnect()
            let newStatus: Status = isRunning ? .running : .stopped
            await MainActor.run { [weak self] in
                guard self?.status != newStatus else { return }
                self?.status = newStatus
            }
        }
    }

    // MARK: - Server Control

    func startServer() {
        guard status != .running else { return }
        status = .checking

        Task {
            var pipes: (stdout: Pipe, stderr: Pipe)?
            if let logManager {
                pipes = logManager.makePipes()
            }
            let process = await Self.launchServer(stdoutPipe: pipes?.stdout, stderrPipe: pipes?.stderr)
            if let process {
                serverProcess = process
                stdoutPipe = pipes?.stdout
                stderrPipe = pipes?.stderr
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                checkStatus()
            } else {
                if let pipes, let logManager {
                    logManager.detachPipes(stdout: pipes.stdout, stderr: pipes.stderr)
                }
                status = .stopped
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

    // MARK: - Static Process Launchers (nonisolated)

    private static func launchServer(stdoutPipe: Pipe?, stderrPipe: Pipe?) async -> Process? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                guard let npxPath = NodeEnvironment.findExecutable(named: "npx") else {
                    continuation.resume(returning: nil)
                    return
                }

                let process = Process()
                process.executableURL = URL(fileURLWithPath: npxPath)
                process.arguments = ["-y", IConnectConstants.npmPackageName]
                process.standardOutput = stdoutPipe ?? FileHandle.nullDevice
                process.standardError = stderrPipe ?? FileHandle.nullDevice
                process.environment = NodeEnvironment.buildEnv()

                do {
                    try process.run()
                    continuation.resume(returning: process)
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private static func performPkill() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async {
                pkillIConnect()
                continuation.resume()
            }
        }
    }

    // MARK: - Process Utilities

    private nonisolated static func pgrepIConnect() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", "node.*iconnect"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    private nonisolated static func pkillIConnect() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        process.arguments = ["-f", "node.*iconnect"]
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
        case .running: "Server Running"
        case .stopped: "Server Stopped"
        case .checking: "Checking..."
        }
    }

    var statusIcon: String {
        switch status {
        case .running: "circle.fill"
        case .stopped: "circle"
        case .checking: "circle.dotted"
        }
    }
}
