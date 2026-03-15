import Foundation

private let appProbes: [(name: String, script: String)] = [
    ("Notes", "Application('Notes'); void 0"),
    ("Reminders", "Application('Reminders'); void 0"),
    ("Calendar", "Application('Calendar'); void 0"),
    ("Contacts", "Application('Contacts'); void 0"),
    ("Mail", "Application('Mail'); void 0"),
    ("Music", "Application('Music'); void 0"),
    ("Finder", "Application('Finder'); void 0"),
    ("Safari", "Application('Safari'); void 0"),
    ("System Events", "Application('System Events'); void 0"),
    ("Photos", "Application('Photos'); void 0"),
]

@MainActor
@Observable
final class PermissionManager {

    struct AppPermission: Identifiable, Sendable {
        let id: String
        let name: String
        var status: PermissionStatus
    }

    enum PermissionStatus: Sendable {
        case pending
        case granted
        case failed(String)
    }

    var apps: [AppPermission] = []
    var isRunning = false

    func runSetup() {
        guard !isRunning else { return }
        isRunning = true
        apps = appProbes.map { AppPermission(id: $0.name, name: $0.name, status: .pending) }

        let probes = appProbes
        Task { [weak self] in
            for (index, probe) in probes.enumerated() {
                let result = await Task.detached {
                    Self.runProbe(script: probe.script)
                }.value
                self?.apps[index].status = result
            }
            self?.isRunning = false
        }
    }

    private nonisolated static func runProbe(script: String) -> PermissionStatus {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-l", "JavaScript", "-e", script]

        let errorPipe = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                return .granted
            } else {
                let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let errorMessage = String(data: errorData, encoding: .utf8) ?? "Unknown error"
                return .failed(errorMessage.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}
