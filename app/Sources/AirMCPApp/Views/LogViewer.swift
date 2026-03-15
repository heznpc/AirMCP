import SwiftUI

struct LogViewer: View {
    let logManager: LogManager

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("Server Logs")
                    .font(.headline)
                Spacer()
                Text("\(logManager.entries.count) lines")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Clear") {
                    logManager.clear()
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Log entries
            if logManager.entries.isEmpty {
                VStack {
                    Spacer()
                    Text("No log entries yet.")
                        .foregroundStyle(.secondary)
                    Text("Start the server to see output here.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(logManager.entries) { entry in
                            logEntryRow(entry)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
            }
        }
        .frame(width: 480, height: 320)
    }

    @ViewBuilder
    private func logEntryRow(_ entry: LogManager.LogEntry) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(entry.timestamp, format: .dateTime.hour().minute().second())
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 60, alignment: .leading)

            Text(entry.message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(entry.isError ? .red : .primary)
                .textSelection(.enabled)
        }
    }
}
