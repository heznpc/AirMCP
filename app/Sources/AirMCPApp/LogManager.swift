import Foundation

@MainActor
@Observable
final class LogManager {

    struct LogEntry: Identifiable, Sendable {
        let id = UUID()
        let timestamp: Date
        let message: String
        let isError: Bool
    }

    private(set) var entries: [LogEntry] = []
    private static let maxEntries = 100

    /// Pipes to capture process stdout/stderr.
    /// Call `makePipes()` before launching the server process.
    nonisolated func makePipes() -> (stdout: Pipe, stderr: Pipe) {
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        stdoutPipe.fileHandleForReading.readabilityHandler = { @Sendable [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty,
                  let text = String(data: data, encoding: .utf8)
            else { return }
            Task { @MainActor [weak self] in
                self?.append(text, isError: false)
            }
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { @Sendable [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty,
                  let text = String(data: data, encoding: .utf8)
            else { return }
            Task { @MainActor [weak self] in
                self?.append(text, isError: true)
            }
        }

        return (stdoutPipe, stderrPipe)
    }

    /// Stop reading from pipes (call when server stops).
    nonisolated func detachPipes(stdout: Pipe?, stderr: Pipe?) {
        stdout?.fileHandleForReading.readabilityHandler = nil
        stderr?.fileHandleForReading.readabilityHandler = nil
    }

    func append(_ text: String, isError: Bool) {
        let lines = text.components(separatedBy: .newlines)
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else { return }

        var updated = entries
        for line in lines {
            updated.append(LogEntry(timestamp: Date(), message: line, isError: isError))
        }
        if updated.count > Self.maxEntries {
            updated.removeFirst(updated.count - Self.maxEntries)
        }
        entries = updated
    }

    func clear() {
        entries.removeAll()
    }

    var recentLines: [LogEntry] {
        Array(entries.suffix(20))
    }
}
