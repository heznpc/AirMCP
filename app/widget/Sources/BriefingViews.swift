import SwiftUI
import WidgetKit

private func WL(_ key: String) -> String {
    NSLocalizedString(key, bundle: .module, comment: "")
}

private func WL(_ key: String, _ args: CVarArg...) -> String {
    String(format: NSLocalizedString(key, bundle: .module, comment: ""), arguments: args)
}

// MARK: - Small Widget

struct BriefingSmallView: View {
    let entry: BriefingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            headerRow
            Spacer(minLength: 2)

            if !entry.hasCalendarAccess {
                accessDeniedView
            } else if let next = nextEvent {
                nextEventView(next)
            } else {
                noEventsView
            }

            Spacer(minLength: 2)

            if entry.overdueCount > 0 {
                Label(WL("widget.overdueCount", entry.overdueCount), systemImage: "exclamationmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.red)
            } else if !entry.reminders.isEmpty {
                Label(WL("widget.reminderCount", entry.reminders.count), systemImage: "checklist")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
    }

    private var headerRow: some View {
        HStack {
            Image(systemName: "a.square.fill")
                .font(.caption)
                .foregroundStyle(.blue)
            Text(dayString)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var nextEvent: BriefingEvent? {
        entry.events.first { $0.endDate > entry.date || $0.isAllDay }
    }

    private func nextEventView(_ event: BriefingEvent) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(WL("widget.next"))
                .font(.caption2)
                .foregroundStyle(.secondary)
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(event.calendarColor)
                    .frame(width: 3)
                VStack(alignment: .leading, spacing: 1) {
                    Text(event.title)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(2)
                    Text(event.isAllDay ? WL("widget.allDay") : event.timeString)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var noEventsView: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(WL("widget.noMoreEvents"))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(WL("widget.today"))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private var accessDeniedView: some View {
        VStack(alignment: .leading, spacing: 2) {
            Image(systemName: "lock.shield")
                .foregroundStyle(.secondary)
            Text(WL("widget.grantAccess"))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private static let dayFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateFormat = "E, MMM d"
        return fmt
    }()

    private var dayString: String {
        Self.dayFormatter.string(from: entry.date)
    }
}

// MARK: - Medium Widget

struct BriefingMediumView: View {
    let entry: BriefingEntry

    var body: some View {
        HStack(spacing: 12) {
            // Left: Events
            VStack(alignment: .leading, spacing: 4) {
                dateHeader
                if !entry.hasCalendarAccess {
                    Spacer()
                    accessLabel(WL("widget.calendarAccessRequired"))
                    Spacer()
                } else if entry.events.isEmpty {
                    Spacer()
                    Text(WL("widget.noEventsToday"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    ForEach(Array(entry.events.prefix(4).enumerated()), id: \.offset) { _, event in
                        eventRow(event)
                    }
                    if entry.events.count > 4 {
                        Text(WL("widget.moreEvents", entry.events.count - 4))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Right: Reminders summary
            VStack(alignment: .leading, spacing: 4) {
                Label(WL("widget.reminders"), systemImage: "checklist")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if !entry.hasReminderAccess {
                    accessLabel(WL("widget.accessRequired"))
                } else if entry.reminders.isEmpty {
                    Text(WL("widget.allClear"))
                        .font(.caption)
                        .foregroundStyle(.green)
                } else {
                    if entry.overdueCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.red)
                            Text(WL("widget.overdueCount", entry.overdueCount))
                                .font(.caption2)
                                .foregroundStyle(.red)
                        }
                    }
                    ForEach(Array(entry.reminders.prefix(3).enumerated()), id: \.offset) { _, reminder in
                        reminderRow(reminder)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(width: 100)
        }
        .padding(12)
    }

    private var dateHeader: some View {
        HStack(spacing: 4) {
            Image(systemName: "a.square.fill")
                .font(.caption2)
                .foregroundStyle(.blue)
            Text(dateString)
                .font(.caption)
                .fontWeight(.semibold)
        }
    }

    private func eventRow(_ event: BriefingEvent) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(event.calendarColor)
                .frame(width: 3, height: 20)
            VStack(alignment: .leading, spacing: 0) {
                Text(event.title)
                    .font(.caption2)
                    .fontWeight(.medium)
                    .lineLimit(1)
                HStack(spacing: 3) {
                    Text(event.timeString)
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                    if !event.location.isEmpty {
                        Text(event.location)
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private func reminderRow(_ reminder: BriefingReminder) -> some View {
        HStack(spacing: 3) {
            Image(systemName: reminder.isOverdue ? "circle.badge.exclamationmark" : "circle")
                .font(.system(size: 8))
                .foregroundStyle(reminder.isOverdue ? .red : .secondary)
            Text(reminder.title)
                .font(.system(size: 9))
                .lineLimit(1)
                .foregroundStyle(reminder.isOverdue ? .primary : .secondary)
        }
    }

    private func accessLabel(_ text: String) -> some View {
        Label(text, systemImage: "lock.shield")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }

    private static let dateFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateFormat = "EEEE, MMM d"
        return fmt
    }()

    private var dateString: String {
        Self.dateFormatter.string(from: entry.date)
    }
}

// MARK: - Large Widget

struct BriefingLargeView: View {
    let entry: BriefingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "a.square.fill")
                    .foregroundStyle(.blue)
                Text(WL("widget.dailyBriefing"))
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Text(dateString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            if !entry.hasCalendarAccess && !entry.hasReminderAccess {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "lock.shield")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text(WL("widget.grantAccess"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                eventsSection
                Divider()
                remindersSection

                if !entry.tomorrowEvents.isEmpty {
                    Divider()
                    tomorrowSection
                }

                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }

    private var eventsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(WL("widget.todaySection"), systemImage: "calendar")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            if entry.events.isEmpty {
                Text(WL("widget.noEventsScheduled"))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 8)
            } else {
                ForEach(Array(entry.events.prefix(5).enumerated()), id: \.offset) { _, event in
                    largeEventRow(event)
                }
                if entry.events.count > 5 {
                    Text(WL("widget.moreEventsCount", entry.events.count - 5))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.leading, 8)
                }
            }
        }
    }

    private var remindersSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(WL("widget.remindersSection"), systemImage: "checklist")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                if entry.overdueCount > 0 {
                    Spacer()
                    Text(WL("widget.overdueCount", entry.overdueCount))
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.red)
                }
            }

            if entry.reminders.isEmpty {
                Text(WL("widget.allClear"))
                    .font(.caption)
                    .foregroundStyle(.green)
                    .padding(.leading, 8)
            } else {
                ForEach(Array(entry.reminders.prefix(5).enumerated()), id: \.offset) { _, reminder in
                    largeReminderRow(reminder)
                }
            }
        }
    }

    private var tomorrowSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(WL("widget.tomorrowSection"), systemImage: "sunrise")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            ForEach(Array(entry.tomorrowEvents.prefix(3).enumerated()), id: \.offset) { _, event in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(event.calendarColor)
                        .frame(width: 3, height: 16)
                    Text(event.timeString)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, alignment: .leading)
                    Text(event.title)
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
        }
    }

    private func largeEventRow(_ event: BriefingEvent) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(event.calendarColor)
                .frame(width: 3, height: 28)

            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if event.isAllDay {
                        Text(WL("widget.allDay"))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(event.timeString) - \(event.endTimeString)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !event.location.isEmpty {
                        HStack(spacing: 1) {
                            Image(systemName: "mappin")
                                .font(.system(size: 7))
                            Text(event.location)
                                .lineLimit(1)
                        }
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    private func largeReminderRow(_ reminder: BriefingReminder) -> some View {
        HStack(spacing: 6) {
            Image(systemName: reminder.isOverdue ? "exclamationmark.circle.fill" : "circle")
                .font(.caption2)
                .foregroundStyle(reminder.isOverdue ? .red : .secondary)
            VStack(alignment: .leading, spacing: 0) {
                Text(reminder.title)
                    .font(.caption)
                    .lineLimit(1)
                    .foregroundStyle(reminder.isOverdue ? .primary : .secondary)
                if let due = reminder.dueDate {
                    Text(relativeDateString(due))
                        .font(.system(size: 9))
                        .foregroundStyle(reminder.isOverdue ? Color.red : Color.secondary)
                }
            }
        }
        .padding(.leading, 4)
    }

    private static let relativeDateFormatter: RelativeDateTimeFormatter = {
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt
    }()

    private func relativeDateString(_ date: Date) -> String {
        Self.relativeDateFormatter.localizedString(for: date, relativeTo: entry.date)
    }

    private static let dateFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateFormat = "EEEE, MMM d"
        return fmt
    }()

    private var dateString: String {
        Self.dateFormatter.string(from: entry.date)
    }
}

// MARK: - Widget Entry View (size dispatcher)

struct BriefingWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: BriefingEntry

    private var destination: URL {
        URL(string: "airmcp://briefing")!
    }

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                BriefingSmallView(entry: entry)
            case .systemMedium:
                BriefingMediumView(entry: entry)
            case .systemLarge, .systemExtraLarge:
                BriefingLargeView(entry: entry)
            @unknown default:
                BriefingMediumView(entry: entry)
            }
        }
        .widgetURL(destination)
    }
}
