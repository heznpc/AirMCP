import Foundation

private let appProbes: [(name: String, script: String)] = [
    ("Notes", "const a=Application('Notes'); JSON.stringify({ok:true,count:a.folders().length})"),
    ("Reminders", "const a=Application('Reminders'); JSON.stringify({ok:true,count:a.lists().length})"),
    ("Calendar", "const a=Application('Calendar'); JSON.stringify({ok:true,count:a.calendars().length})"),
    ("Contacts", "const a=Application('Contacts'); JSON.stringify({ok:true,count:a.people().length})"),
    ("Mail", "const a=Application('Mail'); JSON.stringify({ok:true,count:a.accounts().length})"),
    ("Music", "const a=Application('Music'); JSON.stringify({ok:true,count:a.playlists().length})"),
    ("Finder", "const a=Application('Finder'); JSON.stringify({ok:true,name:a.startupDisk().name()})"),
    ("Safari", "const a=Application('Safari'); JSON.stringify({ok:true,count:a.windows().length})"),
    ("System Events", "const a=Application('System Events'); JSON.stringify({ok:true,count:a.applicationProcesses().length})"),
    ("Photos", "const a=Application('Photos'); JSON.stringify({ok:true,count:a.mediaItems().length})"),
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
    var lastCheckedAt: Date?

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
            self?.lastCheckedAt = Date()
        }
    }

    private nonisolated static func runProbe(script: String) -> PermissionStatus {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-l", "JavaScript", "-e", script]

        let errorPipe = Pipe()
        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: outputData, encoding: .utf8) ?? ""
                return output.contains("\"ok\":true")
                    ? .granted
                    : .failed("Permission probe did not complete a real read")
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
