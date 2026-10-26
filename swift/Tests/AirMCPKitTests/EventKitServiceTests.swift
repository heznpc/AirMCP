// AirMCPKit — EventKitService unit tests (non-authorization paths).

import XCTest
import EventKit
@testable import AirMCPKit

final class EventKitServiceTests: XCTestCase {

    let service = EventKitService()

    // In-memory EventKit objects only: no authorization or reminder store reads.
    func testPriorityDoesNotImplyFlag() {
        let store = EKEventStore()
        let reminder = EKReminder(eventStore: store)
        reminder.calendar = EKCalendar(for: .reminder, eventStore: store)
        reminder.calendar.title = "Fixture"
        reminder.priority = 1
        XCTAssertNil(service.reminderToListItem(reminder).flagged)
    }

    func testFlagUpdatesAreRejectedWithoutChangingPriorityOrTitle() throws {
        let store = EKEventStore()
        for (flagged, priority) in [(false, 1), (true, 0)] {
            let reminder = EKReminder(eventStore: store)
            reminder.title = "Original"
            reminder.priority = priority
            let input = try JSONDecoder().decode(UpdateReminderInput.self, from: Data(
                "{\"id\":\"fixture\",\"title\":\"Changed\",\"flagged\":\(flagged)}".utf8
            ))
            XCTAssertThrowsError(try service.applyReminderUpdate(input, to: reminder))
            XCTAssertEqual(reminder.priority, priority)
            XCTAssertEqual(reminder.title, "Original")
        }
    }

    // MARK: - Recurrence Rule Building

    func testDailyRecurrenceRule() throws {
        let input = RecurrenceInput(
            frequency: "daily", interval: 1,
            endDate: nil, count: nil, daysOfWeek: nil
        )
        let rule = try service.buildRecurrenceRule(input)
        XCTAssertEqual(rule.frequency, .daily)
        XCTAssertEqual(rule.interval, 1)
        XCTAssertNil(rule.recurrenceEnd)
    }

    func testWeeklyRecurrenceWithDays() throws {
        let input = RecurrenceInput(
            frequency: "weekly", interval: 2,
            endDate: nil, count: 10, daysOfWeek: [2, 4, 6] // Mon, Wed, Fri
        )
        let rule = try service.buildRecurrenceRule(input)
        XCTAssertEqual(rule.frequency, .weekly)
        XCTAssertEqual(rule.interval, 2)
        XCTAssertEqual(rule.daysOfTheWeek?.count, 3)
        XCTAssertEqual(rule.recurrenceEnd?.occurrenceCount, 10)
    }

    func testMonthlyRecurrence() throws {
        let input = RecurrenceInput(
            frequency: "monthly", interval: 1,
            endDate: "2025-12-31T00:00:00Z", count: nil, daysOfWeek: nil
        )
        let rule = try service.buildRecurrenceRule(input)
        XCTAssertEqual(rule.frequency, .monthly)
        XCTAssertNotNil(rule.recurrenceEnd)
    }

    func testYearlyRecurrence() throws {
        let input = RecurrenceInput(
            frequency: "yearly", interval: 1,
            endDate: nil, count: 5, daysOfWeek: nil
        )
        let rule = try service.buildRecurrenceRule(input)
        XCTAssertEqual(rule.frequency, .yearly)
        XCTAssertEqual(rule.recurrenceEnd?.occurrenceCount, 5)
    }

    func testInvalidFrequencyThrows() {
        let input = RecurrenceInput(
            frequency: "biweekly", interval: 1,
            endDate: nil, count: nil, daysOfWeek: nil
        )
        XCTAssertThrowsError(try service.buildRecurrenceRule(input)) { error in
            XCTAssertTrue(error is AirMCPKitError)
        }
    }

    func testInvalidDaysOfWeekFiltered() throws {
        let input = RecurrenceInput(
            frequency: "weekly", interval: 1,
            endDate: nil, count: nil, daysOfWeek: [0, 1, 8, 3] // 0 and 8 are invalid
        )
        let rule = try service.buildRecurrenceRule(input)
        XCTAssertEqual(rule.daysOfTheWeek?.count, 2)
    }
}
