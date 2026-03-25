// AirMCPKit — Types & ISO 8601 formatting tests.
// Uses XCTest for broad toolchain compatibility (CommandLineTools + Xcode).
// Migrate to Swift Testing (`import Testing`) when Xcode toolchain is the default.

import XCTest
@testable import AirMCPKit

// MARK: - ISO 8601 Formatting

final class ISO8601FormattingTests: XCTestCase {

    func testFormatProducesValidISO8601String() {
        let date = Date(timeIntervalSince1970: 0) // 1970-01-01T00:00:00Z
        let result = formatISO8601(date)
        XCTAssertTrue(result.contains("1970"))
        XCTAssertTrue(result.contains("T"))
        XCTAssertTrue(result.hasSuffix("Z"))
    }

    func testParseStandardFormat() {
        let input = "2025-03-15T10:30:00Z"
        let date = parseISO8601(input)
        XCTAssertNotNil(date)

        let calendar = Calendar(identifier: .gregorian)
        let components = calendar.dateComponents(in: TimeZone(identifier: "UTC")!, from: date!)
        XCTAssertEqual(components.year, 2025)
        XCTAssertEqual(components.month, 3)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 10)
        XCTAssertEqual(components.minute, 30)
    }

    func testParseFractionalSeconds() {
        let input = "2025-06-01T14:30:00.123Z"
        let date = parseISO8601(input)
        XCTAssertNotNil(date)
    }

    func testParseInvalidInput() {
        XCTAssertNil(parseISO8601("not-a-date"))
        XCTAssertNil(parseISO8601(""))
    }

    func testRoundtrip() {
        let original = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14
        let formatted = formatISO8601(original)
        let parsed = parseISO8601(formatted)
        XCTAssertNotNil(parsed)
        XCTAssertLessThan(abs(parsed!.timeIntervalSince(original)), 1.0)
    }
}

// MARK: - Type Encoding/Decoding

final class TypeCodableTests: XCTestCase {

    func testAirMCPOutputEncodes() throws {
        let output = AirMCPOutput(output: "hello")
        let data = try JSONEncoder().encode(output)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["output"] as? String, "hello")
    }

    func testAirMCPErrorEncodes() throws {
        let error = AirMCPError(error: "something went wrong")
        let data = try JSONEncoder().encode(error)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["error"] as? String, "something went wrong")
    }

    func testRecurrenceInputDecodes() throws {
        let json = """
        {
            "frequency": "weekly",
            "interval": 2,
            "endDate": "2025-12-31T00:00:00Z",
            "count": null,
            "daysOfWeek": [1, 3, 5]
        }
        """
        let input = try JSONDecoder().decode(RecurrenceInput.self, from: Data(json.utf8))
        XCTAssertEqual(input.frequency, "weekly")
        XCTAssertEqual(input.interval, 2)
        XCTAssertEqual(input.endDate, "2025-12-31T00:00:00Z")
        XCTAssertNil(input.count)
        XCTAssertEqual(input.daysOfWeek, [1, 3, 5])
    }

    func testCreateReminderInputDecodes() throws {
        let json = """
        {"title": "Buy groceries"}
        """
        let input = try JSONDecoder().decode(CreateReminderInput.self, from: Data(json.utf8))
        XCTAssertEqual(input.title, "Buy groceries")
        XCTAssertNil(input.body)
        XCTAssertNil(input.dueDate)
        XCTAssertNil(input.priority)
        XCTAssertNil(input.list)
    }

    func testListEventsInputDecodes() throws {
        let json = """
        {"startDate": "2025-01-01T00:00:00Z", "endDate": "2025-01-31T23:59:59Z", "limit": 50}
        """
        let input = try JSONDecoder().decode(ListEventsInput.self, from: Data(json.utf8))
        XCTAssertEqual(input.startDate, "2025-01-01T00:00:00Z")
        XCTAssertEqual(input.endDate, "2025-01-31T23:59:59Z")
        XCTAssertEqual(input.limit, 50)
        XCTAssertNil(input.calendar)
    }

    func testSearchContactsInputDecodes() throws {
        let json = """
        {"query": "John", "limit": 10}
        """
        let input = try JSONDecoder().decode(SearchContactsInput.self, from: Data(json.utf8))
        XCTAssertEqual(input.query, "John")
        XCTAssertEqual(input.limit, 10)
    }

    func testEventOutputEncodes() throws {
        let output = EventOutput(id: "E1", title: "Meeting", recurring: false)
        let data = try JSONEncoder().encode(output)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["id"] as? String, "E1")
        XCTAssertEqual(json?["title"] as? String, "Meeting")
        XCTAssertEqual(json?["recurring"] as? Bool, false)
    }

    func testCalendarInfoEncodes() throws {
        let info = CalendarInfo(id: "C1", name: "Work", color: "#FF0000", writable: true)
        let data = try JSONEncoder().encode(info)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(json?["id"] as? String, "C1")
        XCTAssertEqual(json?["name"] as? String, "Work")
        XCTAssertEqual(json?["color"] as? String, "#FF0000")
        XCTAssertEqual(json?["writable"] as? Bool, true)
    }
}

// MARK: - Error Types

final class ErrorTests: XCTestCase {

    func testErrorDescriptions() {
        let cases: [(AirMCPKitError, String)] = [
            (.permissionDenied("denied"), "denied"),
            (.invalidInput("bad input"), "bad input"),
            (.notFound("missing"), "missing"),
            (.unsupported("nope"), "nope"),
        ]
        for (error, expected) in cases {
            XCTAssertEqual(error.localizedDescription, expected)
        }
    }

    func testErrorsConformToSendable() {
        let error: any Sendable = AirMCPKitError.permissionDenied("test")
        XCTAssertTrue(error is AirMCPKitError)
    }
}
