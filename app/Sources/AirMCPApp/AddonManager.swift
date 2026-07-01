import Foundation

@MainActor
@Observable
final class AddonManager {
    enum State: Equatable {
        case idle
        case running(String)
        case done(String)
        case failed(String)
    }

    private enum CommandResult: Sendable {
        case success(String)
        case failure(String)
    }

    var state: State = .idle

    var isRunning: Bool {
        if case .running = state { return true }
        return false
    }

    var statusLabel: String? {
        switch state {
        case .idle:
            return nil
        case .running(let pack):
            return L("addons.installing", pack)
        case .done(let message):
            return message
        case .failed(let message):
            return L("addons.failed", message)
        }
    }

    func install(pack: String, configManager: ConfigManager) {
        run(action: "enable", pack: pack, flag: "--install", configManager: configManager)
    }

    func uninstall(pack: String, configManager: ConfigManager) {
        run(action: "uninstall", pack: pack, flag: nil, configManager: configManager)
    }

    func reset() {
        state = .idle
    }

    private func run(action: String, pack: String, flag: String?, configManager: ConfigManager) {
        guard !isRunning else { return }
        state = .running(pack)

        var args = ["modules", action, pack]
        if let flag {
            args.append(flag)
        }

        Task {
            let result = await Self.runAirMcp(args)
            switch result {
            case .success:
                configManager.load()
                state = .done(L("addons.doneRestart"))
            case .failure(let message):
                state = .failed(message)
            }
        }
    }

    private nonisolated static func runAirMcp(_ args: [String]) async -> CommandResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                guard let npxPath = NodeEnvironment.findExecutable(named: "npx") else {
                    continuation.resume(returning: .failure("Node.js not found. Install Node.js first."))
                    return
                }

                let process = Process()
                process.executableURL = URL(fileURLWithPath: npxPath)
                process.arguments = ["-y", AirMcpConstants.npmPackageSpecifier] + args
                process.environment = NodeEnvironment.buildEnv()

                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr

                do {
                    try process.run()
                    process.waitUntilExit()
                    let out = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    let err = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    if process.terminationStatus == 0 {
                        continuation.resume(returning: .success(out))
                    } else {
                        let message = err.trimmingCharacters(in: .whitespacesAndNewlines)
                        continuation.resume(returning: .failure(message.isEmpty ? out : message))
                    }
                } catch {
                    continuation.resume(returning: .failure(error.localizedDescription))
                }
            }
        }
    }
}
