import WidgetKit
import SwiftUI

struct BriefingEvent: Sendable {
    let title: String
    let startDate: Date
    let endDate: Date
    let isAllDay: Bool
    let location: String
    let calendarColorHex: String?
    let calendarName: String

    private static let timeFormatter: DateFormatter = {
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        return fmt
    }()

    var calendarColor: Color {
        guard let hex = calendarColorHex else { return .blue }
        return Color(hex: hex)
    }

    var timeString: String {
        if isAllDay { return "All day" }
        return Self.timeFormatter.string(from: startDate)
    }

    var endTimeString: String {
        Self.timeFormatter.string(from: endDate)
    }
}

struct BriefingReminder: Sendable {
    let title: String
    let dueDate: Date?
    let isOverdue: Bool
    let listName: String
    let priority: Int
}

struct BriefingEntry: TimelineEntry {
    let date: Date
    let events: [BriefingEvent]
    let reminders: [BriefingReminder]
    let overdueCount: Int
    let tomorrowEvents: [BriefingEvent]
    let hasCalendarAccess: Bool
    let hasReminderAccess: Bool

    static let placeholder: BriefingEntry = {
        let cal = Calendar.current
        let now = Date()
        let h10 = cal.date(bySettingHour: 10, minute: 0, second: 0, of: now)!
        let h11 = cal.date(bySettingHour: 11, minute: 0, second: 0, of: now)!
        let h14 = cal.date(bySettingHour: 14, minute: 0, second: 0, of: now)!
        let h15 = cal.date(bySettingHour: 15, minute: 0, second: 0, of: now)!
        let h16 = cal.date(bySettingHour: 16, minute: 30, second: 0, of: now)!
        let h17 = cal.date(bySettingHour: 17, minute: 0, second: 0, of: now)!

        return BriefingEntry(
            date: now,
            events: [
                BriefingEvent(title: "Team Standup", startDate: h10, endDate: h11,
                              isAllDay: false, location: "Zoom", calendarColorHex: "#007AFF", calendarName: "Work"),
                BriefingEvent(title: "Design Review", startDate: h14, endDate: h15,
                              isAllDay: false, location: "Room A", calendarColorHex: "#34C759", calendarName: "Work"),
                BriefingEvent(title: "1:1 Meeting", startDate: h16, endDate: h17,
                              isAllDay: false, location: "", calendarColorHex: "#007AFF", calendarName: "Work"),
            ],
            reminders: [
                BriefingReminder(title: "Submit report", dueDate: cal.date(byAdding: .day, value: -1, to: now),
                                 isOverdue: true, listName: "Work", priority: 1),
                BriefingReminder(title: "Buy groceries", dueDate: now,
                                 isOverdue: false, listName: "Personal", priority: 0),
            ],
            overdueCount: 1,
            tomorrowEvents: [
                BriefingEvent(title: "Weekly Sync", startDate: h10, endDate: h11,
                              isAllDay: false, location: "", calendarColorHex: "#FF9500", calendarName: "Work"),
            ],
            hasCalendarAccess: true,
            hasReminderAccess: true
        )
    }()
}

// MARK: - Color hex extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255.0
        let g = Double((int >> 8) & 0xFF) / 255.0
        let b = Double(int & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
