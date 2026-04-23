// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.1 — 10 hand-picked read-only tools.
// Run `npm run gen:intents` to refresh after tool metadata changes.
// CI guards against drift via `npm run gen:intents:check`.
//
// Runtime behavior is stubbed in MCPIntentRouter until Phase A.2; these
// structs compile and register with the system (for Shortcuts / Spotlight
// indexing + golden-sample regression) but `perform()` will throw a
// `MCPIntentError.notImplementedOnPlatform` until A.2 lands the macOS
// execFile bridge and iOS in-process path.

#if canImport(AppIntents)
import AppIntents
import Foundation

// Tool: list_calendars
public struct ListCalendarsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Calendars"
    nonisolated(unsafe) public static var description = IntentDescription("List all calendars with name, color, and writable status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_calendars",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: today_events
public struct TodayEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Today's Events"
    nonisolated(unsafe) public static var description = IntentDescription("Get all calendar events for today.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "today_events",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: list_reminder_lists
public struct ListReminderListsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reminder Lists"
    nonisolated(unsafe) public static var description = IntentDescription("List all reminder lists with reminder counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_reminder_lists",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: list_folders
public struct ListFoldersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Folders"
    nonisolated(unsafe) public static var description = IntentDescription("List all folders across all accounts with note counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_folders",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: list_shortcuts
public struct ListShortcutsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Shortcuts"
    nonisolated(unsafe) public static var description = IntentDescription("List all available Siri Shortcuts on this Mac.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_shortcuts",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: list_accounts
public struct ListAccountsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Mail Accounts"
    nonisolated(unsafe) public static var description = IntentDescription("List all mail accounts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_accounts",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: list_bookmarks
public struct ListBookmarksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Bookmarks"
    nonisolated(unsafe) public static var description = IntentDescription("List all Safari bookmarks across all folders, including subfolder paths.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_bookmarks",
            args: [:]
        )
        return .result(value: result)
    }
}

// Tool: search_notes
public struct SearchNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Notes"
    nonisolated(unsafe) public static var description = IntentDescription("Search notes by keyword in title and body.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_notes",
            args: ["query": query]
        )
        return .result(value: result)
    }
}

// Tool: search_contacts
public struct SearchContactsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Contacts"
    nonisolated(unsafe) public static var description = IntentDescription("Search contacts by name, email, phone, or organization.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword (matches name)")
    public var query: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_contacts",
            args: ["query": query]
        )
        return .result(value: result)
    }
}

// Tool: get_upcoming_events
public struct GetUpcomingEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Upcoming Events"
    nonisolated(unsafe) public static var description = IntentDescription("Get the next N upcoming events from now (searches up to 30 days ahead).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_upcoming_events",
            args: [:]
        )
        return .result(value: result)
    }
}

#endif
