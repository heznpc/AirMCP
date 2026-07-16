import Foundation
import EventKit
import WidgetKit
import WidgetSnapshotKit

/// Writes the display-only ``WidgetSnapshot`` that the widget reads. Making the
/// APP the reader of EventKit — and the widget a pure reader of this snapshot —
/// removes the widget's independent, ungoverned calendar/reminder access.
///
/// Every path degrades gracefully: when the App Group container is unreachable
/// (unsigned build / missing entitlement) `containerURL()` is nil and we simply
/// do nothing, leaving the widget to fall back to its OS-native EventKit read.
struct WidgetSnapshotWriter {
    /// Must match the widget's `StaticConfiguration(kind:)`.
    static let widgetKind = "com.heznpc.AirMCP.BriefingWidget"

    private let store = EKEventStore()
    private let snapshotStore = WidgetSnapshotStore(appGroupID: WidgetSnapshotConfig.appGroupID)
    private let ttl: TimeInterval
    private let maxItems = 8

    init(ttl: TimeInterval = 30 * 60) {
        self.ttl = ttl
    }

    /// Build a fresh snapshot from the app's EventKit access and persist it,
    /// then reload the widget's timeline. Best-effort — a container or write
    /// failure just leaves the previous snapshot in place.
    func refresh(
        privacyMode: WidgetSnapshot.PrivacyMode = .titles,
        runtimeStatus: WidgetSnapshot.RuntimeStatus = .unknown,
        now: Date = Date()
    ) async {
        guard let url = snapshotStore.containerURL() else { return }
        // Nothing to govern if the app has no access at all — leave the widget
        // to its OS-native fallback (which shows the grant-access prompt).
        guard authorized(for: .event) || authorized(for: .reminder) else { return }
        let snapshot = await buildSnapshot(now: now, privacyMode: privacyMode, runtimeStatus: runtimeStatus)
        guard (try? snapshotStore.write(snapshot, to: url)) != nil else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
    }

    /// Assemble the snapshot from today's events + active reminders. Titles are
    /// left intact here; `WidgetSnapshotStore.write` redacts them before
    /// persisting when the privacy mode is counts-only.
    func buildSnapshot(
        now: Date,
        privacyMode: WidgetSnapshot.PrivacyMode,
        runtimeStatus: WidgetSnapshot.RuntimeStatus
    ) async -> WidgetSnapshot {
        let cal = Calendar.current
        let (events, eventTotal) = fetchTodayEvents(cal: cal, now: now)
        let (reminders, overdue) = await fetchActiveReminders(cal: cal, now: now)
        return WidgetSnapshot(
            generatedAt: now,
            staleAt: now.addingTimeInterval(ttl),
            privacyMode: privacyMode,
            runtimeStatus: runtimeStatus,
            events: events,
            reminders: reminders,
            eventCount: eventTotal,
            overdueReminderCount: overdue,
            calendarAuthorized: authorized(for: .event),
            reminderAuthorized: authorized(for: .reminder)
        )
    }

    // MARK: - EventKit

    private func fetchTodayEvents(cal: Calendar, now: Date) -> ([WidgetSnapshot.Event], Int) {
        guard authorized(for: .event) else { return ([], 0) }
        let start = cal.startOfDay(for: now)
        guard let end = cal.date(byAdding: .day, value: 1, to: start) else { return ([], 0) }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let all = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
        let mapped = all.prefix(maxItems).map { ev in
            WidgetSnapshot.Event(
                title: ev.title ?? "",
                start: ev.startDate,
                end: ev.endDate,
                isAllDay: ev.isAllDay,
                location: ev.location,
                calendarColorHex: Self.hex(ev.calendar.cgColor)
            )
        }
        return (Array(mapped), all.count)
    }

    private func fetchActiveReminders(cal: Calendar, now: Date) async -> ([WidgetSnapshot.Reminder], Int) {
        guard authorized(for: .reminder) else { return ([], 0) }
        let predicate = store.predicateForReminders(in: nil)
        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { result in
                let incomplete = (result ?? []).filter { !$0.isCompleted }
                var overdue = 0
                var mapped: [WidgetSnapshot.Reminder] = []
                for r in incomplete {
                    let due = r.dueDateComponents.flatMap { cal.date(from: $0) }
                    let isOverdue = due.map { $0 < now } ?? false
                    if isOverdue { overdue += 1 }
                    mapped.append(WidgetSnapshot.Reminder(title: r.title ?? "", dueDate: due, isOverdue: isOverdue))
                }
                mapped.sort { a, b in
                    if a.isOverdue != b.isOverdue { return a.isOverdue }
                    if let ad = a.dueDate, let bd = b.dueDate { return ad < bd }
                    return a.dueDate != nil
                }
                continuation.resume(returning: (Array(mapped.prefix(self.maxItems)), overdue))
            }
        }
    }

    private func authorized(for entity: EKEntityType) -> Bool {
        switch EKEventStore.authorizationStatus(for: entity) {
        case .authorized, .fullAccess: return true
        default: return false
        }
    }

    private static func hex(_ cgColor: CGColor?) -> String? {
        guard let c = cgColor?.components, c.count >= 3 else { return nil }
        return String(format: "#%02X%02X%02X", Int(c[0] * 255), Int(c[1] * 255), Int(c[2] * 255))
    }
}
