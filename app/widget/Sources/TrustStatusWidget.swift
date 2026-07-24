import WidgetKit
import SwiftUI
import WidgetSnapshotKit

// MARK: - Entry

struct TrustStatusEntry: TimelineEntry {
    let date: Date
    /// nil when the app has not published a trust summary yet (or the container
    /// is unreachable) — the view shows an "unknown / open the app" state.
    let trust: WidgetSnapshot.TrustSummary?
    let runtimeStatus: WidgetSnapshot.RuntimeStatus
    let stale: Bool

    static let placeholder = TrustStatusEntry(
        date: Date(),
        trust: WidgetSnapshot.TrustSummary(
            hitlLevel: "sensitive-only",
            emergencyStopActive: false,
            pendingApprovalCount: 0,
            integrityVerifiedAt: Date()
        ),
        runtimeStatus: .running,
        stale: false
    )
}

// MARK: - Provider

struct TrustStatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> TrustStatusEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TrustStatusEntry) -> Void) {
        completion(context.isPreview ? .placeholder : Self.currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TrustStatusEntry>) -> Void) {
        let entry = Self.currentEntry()
        // Trust state changes on approvals / emergency stop; refresh often but
        // stay within the widget's update budget.
        let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date) ?? entry.date
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    /// Reads the governance summary from the shared snapshot. Never re-runs any
    /// audit verification of its own — it only presents what the app published.
    static func currentEntry(now: Date = Date()) -> TrustStatusEntry {
        let store = WidgetSnapshotStore(appGroupID: WidgetSnapshotConfig.appGroupID)
        guard let url = store.containerURL(), let snapshot = try? store.read(from: url) else {
            return TrustStatusEntry(date: now, trust: nil, runtimeStatus: .unknown, stale: false)
        }
        return TrustStatusEntry(
            date: now,
            trust: snapshot.trust,
            runtimeStatus: snapshot.runtimeStatus,
            stale: snapshot.isStale(now: now)
        )
    }
}

// MARK: - View

struct TrustStatusWidgetEntryView: View {
    var entry: TrustStatusEntry

    private var runtimeLabel: String {
        switch entry.runtimeStatus {
        case .running: return NSLocalizedString("trust.running", bundle: .module, comment: "")
        case .stopped: return NSLocalizedString("trust.stopped", bundle: .module, comment: "")
        case .unknown: return NSLocalizedString("trust.unknown", bundle: .module, comment: "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(entry.trust?.emergencyStopActive == true ? .red : .green)
                Text("AirMCP")
                    .font(.headline)
                Spacer()
                if entry.stale {
                    Image(systemName: "clock.badge.exclamationmark")
                        .foregroundStyle(.secondary)
                }
            }

            if let trust = entry.trust {
                row(NSLocalizedString("trust.runtime", bundle: .module, comment: ""), runtimeLabel)
                row(NSLocalizedString("trust.hitl", bundle: .module, comment: ""), trust.hitlLevel)
                row(NSLocalizedString("trust.pending", bundle: .module, comment: ""), "\(trust.pendingApprovalCount)")
                if trust.emergencyStopActive {
                    Text(NSLocalizedString("trust.emergencyStop", bundle: .module, comment: ""))
                        .font(.caption).bold()
                        .foregroundStyle(.red)
                }
            } else {
                Text(NSLocalizedString("trust.noData", bundle: .module, comment: ""))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding()
        // Deep link opens the app (Trust Center); no tool details are shown here.
        .widgetURL(URL(string: "airmcp://trust"))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption).bold()
        }
    }
}

// MARK: - Widget

struct TrustStatusWidget: Widget {
    let kind = "com.heznpc.AirMCP.TrustStatusWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TrustStatusProvider()) { entry in
            TrustStatusWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("AirMCP Trust Status")
        .description("Runtime status, HITL level, emergency stop, and pending approvals at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
