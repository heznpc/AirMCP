import WidgetKit
import EventKit

private struct UncheckedSendable<T>: @unchecked Sendable {
    let value: T
}

// MARK: - Timeline Provider

struct BriefingProvider: TimelineProvider {
    nonisolated(unsafe) private static let eventStore = EKEventStore()

    func placeholder(in context: Context) -> BriefingEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (BriefingEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
            return
        }
        let cb = UncheckedSendable(value: completion)
        Task {
            let entry = await Self.fetchBriefing()
            cb.value(entry)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BriefingEntry>) -> Void) {
        let cb = UncheckedSendable(value: completion)
        Task {
            let entry = await Self.fetchBriefing()
            let refreshDate = Self.nextRefreshDate(after: entry.date, events: entry.events)
            let timeline = Timeline(entries: [entry], policy: .after(refreshDate))
            cb.value(timeline)
        }
    }

    // MARK: - Data fetching

    private static func fetchBriefing() async -> BriefingEntry {
        let now = Date()
        let cal = Calendar.current

        async let calAuth = authorizeCalendar()
        async let remAuth = authorizeReminders()
        let (hasCalendar, hasReminder) = await (calAuth, remAuth)

        let events: [BriefingEvent] = hasCalendar ? fetchEventsForDay(offset: 0, cal: cal, now: now, limit: 8) : []
        let tomorrowEvents: [BriefingEvent] = hasCalendar ? fetchEventsForDay(offset: 1, cal: cal, now: now, limit: 3) : []
        let (reminders, overdueCount) = hasReminder ? await fetchActiveReminders(now: now, cal: cal) : ([], 0)

        return BriefingEntry(
            date: now,
            events: events,
            reminders: reminders,
            overdueCount: overdueCount,
            tomorrowEvents: tomorrowEvents,
            hasCalendarAccess: hasCalendar,
            hasReminderAccess: hasReminder
        )
    }

    // MARK: - Calendar events

    private static func fetchEventsForDay(offset: Int, cal: Calendar, now: Date, limit: Int) -> [BriefingEvent] {
        let baseStart = cal.startOfDay(for: now)
        guard let start = cal.date(byAdding: .day, value: offset, to: baseStart),
              let end = cal.date(byAdding: .day, value: offset + 1, to: baseStart)
        else { return [] }

        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let ekEvents = eventStore.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .prefix(limit)

        return ekEvents.map { ev in
            BriefingEvent(
                title: ev.title ?? "",
                startDate: ev.startDate,
                endDate: ev.endDate,
                isAllDay: ev.isAllDay,
                location: ev.location ?? "",
                calendarColorHex: cgColorToHex(ev.calendar.cgColor),
                calendarName: ev.calendar.title
            )
        }
    }

    // MARK: - Reminders

    private static func fetchActiveReminders(now: Date, cal: Calendar) async -> ([BriefingReminder], Int) {
        let predicate = eventStore.predicateForReminders(in: nil)

        let (items, overdueCount): ([(String, Date?, Bool, String, Int)], Int) = await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { result in
                let incomplete = (result ?? []).filter { !$0.isCompleted }

                var overdue = 0
                var extracted: [(title: String, due: Date?, isOverdue: Bool, list: String, priority: Int)] = []

                for r in incomplete {
                    let dueDate = r.dueDateComponents.flatMap { cal.date(from: $0) }
                    let isOverdue = dueDate.map { $0 < now } ?? false
                    if isOverdue { overdue += 1 }
                    extracted.append((r.title ?? "", dueDate, isOverdue, r.calendar.title, r.priority))
                }

                extracted.sort { a, b in
                    if a.isOverdue != b.isOverdue { return a.isOverdue }
                    if let ad = a.due, let bd = b.due { return ad < bd }
                    if a.due != nil { return true }
                    return false
                }

                continuation.resume(returning: (Array(extracted.prefix(8)), overdue))
            }
        }

        return (items.map { BriefingReminder(title: $0.0, dueDate: $0.1, isOverdue: $0.2, listName: $0.3, priority: $0.4) }, overdueCount)
    }

    // MARK: - Authorization

    private static func authorizeCalendar() async -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        switch status {
        case .authorized, .fullAccess: return true
        case .notDetermined: return (try? await eventStore.requestFullAccessToEvents()) ?? false
        default: return false
        }
    }

    private static func authorizeReminders() async -> Bool {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        switch status {
        case .authorized, .fullAccess: return true
        case .notDetermined: return (try? await eventStore.requestFullAccessToReminders()) ?? false
        default: return false
        }
    }

    // MARK: - Helpers

    private static func cgColorToHex(_ cgColor: CGColor) -> String? {
        guard let components = cgColor.components, components.count >= 3 else { return nil }
        let r = Int(components[0] * 255)
        let g = Int(components[1] * 255)
        let b = Int(components[2] * 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }

    private static func nextRefreshDate(after now: Date, events: [BriefingEvent]) -> Date {
        let cal = Calendar.current
        let thirtyMin = cal.date(byAdding: .minute, value: 30, to: now)!

        if let next = events.flatMap({ [$0.startDate, $0.endDate] }).filter({ $0 > now }).min() {
            let afterBoundary = cal.date(byAdding: .minute, value: 1, to: next)!
            return min(afterBoundary, thirtyMin)
        }

        return thirtyMin
    }
}
