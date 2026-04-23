// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.2b.2 + A.4.1 — 154 auto-selected read-only
// tools (50 with typed drift-guards + Interactive Snippet
// SwiftUI views) + 9 AppShortcutsProvider entries.
// Run `npm run gen:intents` to refresh after tool metadata changes.
// CI guards against drift via `npm run gen:intents:check`.
//
// Router runtime is live as of PR #103 (A.2a): macOS execFile stdio and
// iOS in-process MCPServer.callToolText. Every generated intent's
// `perform()` hits that router. Typed intents additionally decode the
// router's String result through JSONDecoder.
//
// Snippet views (§3.7) are SwiftUI View structs matching each typed
// output shape. A.4.1 ships the views; A.4.2 will plug them into the
// intents' `.result(value:, view:)` overloads. Kept in a separate
// #if so iOS 17 builds stay green.

#if canImport(AppIntents)
import AppIntents
import Foundation

// MARK: - Typed output structs

// Output type for: ai_plan_metrics
public struct MCPAiPlanMetricsOutput: Codable, Sendable {
    public struct PercaseItem: Codable, Sendable {
        public let name: String
        public let total: Double
        public let matchedExpected: [String]
        public let leakedForbidden: [String]
        public let stepCount: Double
        public let unknownTools: [String]
    }

    public let sampled: Double
    public let averageScore: Double
    public let parseRate: Double
    public let expectedCoverageAvg: Double
    public let leakedForbiddenTotal: Double
    public let perCase: [PercaseItem]
}

// Output type for: audit_summary
public struct MCPAuditSummaryOutput: Codable, Sendable {
    public struct ToptoolsItem: Codable, Sendable {
        public let tool: String
        public let count: Double
        public let errors: Double
    }

    public let since: String
    public let total: Double
    public let errors: Double
    public let errorRate: Double
    public let scannedFiles: Double
    public let topTools: [ToptoolsItem]
}

// Output type for: discover_tools
public struct MCPDiscoverToolsOutput: Codable, Sendable {
    public struct MatchesItem: Codable, Sendable {
        public let name: String
        public let title: String?
        public let description: String?
    }

    public let query: String
    public let matches: [MatchesItem]
    public let total: Double?
    public let method: String?
    public let hint: String?
}

// Output type for: get_clipboard
public struct MCPGetClipboardOutput: Codable, Sendable {
    public let content: String
    public let length: Double
    public let truncated: Bool
}

// Output type for: get_current_tab
public struct MCPGetCurrentTabOutput: Codable, Sendable {
    public let title: String
    public let url: String
}

// Output type for: get_current_weather
public struct MCPGetCurrentWeatherOutput: Codable, Sendable {
    public struct Units: Codable, Sendable {
        public let temperature: String
        public let windSpeed: String
        public let precipitation: String
    }

    public let temperature: Double
    public let feelsLike: Double
    public let humidity: Double
    public let weatherCode: Double
    public let weatherDescription: String
    public let windSpeed: Double
    public let windDirection: Double
    public let precipitation: Double
    public let cloudCover: Double
    public let units: Units
}

// Output type for: get_file_info
public struct MCPGetFileInfoOutput: Codable, Sendable {
    public let path: String
    public let name: String
    public let kind: String
    public let size: Double
    public let creationDate: String
    public let modificationDate: String
    public let tags: [String]
}

// Output type for: get_frontmost_app
public struct MCPGetFrontmostAppOutput: Codable, Sendable {
    public let name: String
    public let bundleIdentifier: String
    public let pid: Double
}

// Output type for: get_shortcut_detail
public struct MCPGetShortcutDetailOutput: Codable, Sendable {
    public let shortcut: String
    public let detail: String
}

// Output type for: get_unread_count
public struct MCPGetUnreadCountOutput: Codable, Sendable {
    public struct MailboxesItem: Codable, Sendable {
        public let account: String
        public let mailbox: String
        public let unread: Double
    }

    public let totalUnread: Double
    public let mailboxes: [MailboxesItem]
}

// Output type for: get_upcoming_events
public struct MCPGetUpcomingEventsOutput: Codable, Sendable {
    public struct EventsItem: Codable, Sendable {
        public let id: String
        public let summary: String
        public let startDate: String
        public let endDate: String
        public let allDay: Bool
        public let calendar: String
        public let location: String
    }

    public let total: Double
    public let returned: Double
    public let events: [EventsItem]
}

// Output type for: get_volume
public struct MCPGetVolumeOutput: Codable, Sendable {
    public let outputVolume: Double
    public let inputVolume: Double
    public let outputMuted: Bool
}

// Output type for: list_accounts
public struct MCPListAccountsOutput: Codable, Sendable {
    public struct AccountsItem: Codable, Sendable {
        public let name: String
        public let fullName: String?
        public let emailAddresses: [String]
    }

    public let accounts: [AccountsItem]
}

// Output type for: list_bookmarks
public struct MCPListBookmarksOutput: Codable, Sendable {
    public struct BookmarksItem: Codable, Sendable {
        public let title: String
        public let url: String
        public let folder: String
    }

    public let count: Double
    public let bookmarks: [BookmarksItem]
}

// Output type for: list_calendars
public struct MCPListCalendarsOutput: Codable, Sendable {
    public struct CalendarsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let color: String?
        public let writable: Bool
    }

    public let calendars: [CalendarsItem]
}

// Output type for: list_chats
public struct MCPListChatsOutput: Codable, Sendable {
    public struct ChatsItem: Codable, Sendable {
        public struct ParticipantsItem: Codable, Sendable {
            public let name: String?
            public let handle: String?
        }

        public let id: String
        public let name: String?
        public let participants: [ParticipantsItem]
        public let updated: String?
    }

    public let total: Double
    public let returned: Double
    public let chats: [ChatsItem]
}

// Output type for: list_contacts
public struct MCPListContactsOutput: Codable, Sendable {
    public struct ContactsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let email: String?
        public let phone: String?
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let contacts: [ContactsItem]
}

// Output type for: list_directory
public struct MCPListDirectoryOutput: Codable, Sendable {
    public struct ItemsItem: Codable, Sendable {
        public let name: String
        public let kind: String
        public let size: Double?
        public let modificationDate: String?
    }

    public let total: Double
    public let returned: Double
    public let items: [ItemsItem]
}

// Output type for: list_events
public struct MCPListEventsOutput: Codable, Sendable {
    public struct EventsItem: Codable, Sendable {
        public let id: String
        public let summary: String
        public let startDate: String
        public let endDate: String
        public let allDay: Bool
        public let calendar: String
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let events: [EventsItem]
}

// Output type for: list_folders
public struct MCPListFoldersOutput: Codable, Sendable {
    public struct FoldersItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let account: String
        public let noteCount: Double
        public let shared: Bool
    }

    public let folders: [FoldersItem]
}

// Output type for: list_group_members
public struct MCPListGroupMembersOutput: Codable, Sendable {
    public struct ContactsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let email: String?
        public let phone: String?
    }

    public let group: String
    public let total: Double
    public let returned: Double
    public let contacts: [ContactsItem]
}

// Output type for: list_groups
public struct MCPListGroupsOutput: Codable, Sendable {
    public struct GroupsItem: Codable, Sendable {
        public let id: String
        public let name: String
    }

    public let groups: [GroupsItem]
}

// Output type for: list_mailboxes
public struct MCPListMailboxesOutput: Codable, Sendable {
    public struct MailboxesItem: Codable, Sendable {
        public let name: String
        public let account: String
        public let unreadCount: Double
    }

    public let mailboxes: [MailboxesItem]
}

// Output type for: list_messages
public struct MCPListMessagesOutput: Codable, Sendable {
    public struct MessagesItem: Codable, Sendable {
        public let id: String
        public let subject: String
        public let sender: String
        public let dateReceived: String?
        public let read: Bool
        public let flagged: Bool
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let messages: [MessagesItem]
}

// Output type for: list_notes
public struct MCPListNotesOutput: Codable, Sendable {
    public struct NotesItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let folder: String
        public let shared: Bool
        public let creationDate: String
        public let modificationDate: String
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let notes: [NotesItem]
}

// Output type for: list_participants
public struct MCPListParticipantsOutput: Codable, Sendable {
    public struct ParticipantsItem: Codable, Sendable {
        public let name: String?
        public let handle: String?
    }

    public let chatId: String
    public let chatName: String?
    public let participants: [ParticipantsItem]
}

// Output type for: list_playlists
public struct MCPListPlaylistsOutput: Codable, Sendable {
    public struct PlaylistsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let duration: Double
        public let trackCount: Double
    }

    public let playlists: [PlaylistsItem]
}

// Output type for: list_reading_list
public struct MCPListReadingListOutput: Codable, Sendable {
    public struct ItemsItem: Codable, Sendable {
        public let title: String
        public let url: String
    }

    public let count: Double
    public let items: [ItemsItem]
}

// Output type for: list_reminder_lists
public struct MCPListReminderListsOutput: Codable, Sendable {
    public struct ListsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let reminderCount: Double
    }

    public let lists: [ListsItem]
}

// Output type for: list_reminders
public struct MCPListRemindersOutput: Codable, Sendable {
    public struct RemindersItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let completed: Bool
        public let dueDate: String?
        public let priority: Double
        public let flagged: Bool
        public let list: String
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let reminders: [RemindersItem]
}

// Output type for: list_shortcuts
public struct MCPListShortcutsOutput: Codable, Sendable {
    public let total: Double
    public let shortcuts: [String]
}

// Output type for: list_tabs
public struct MCPListTabsOutput: Codable, Sendable {
    public struct TabsItem: Codable, Sendable {
        public let windowIndex: Double
        public let tabIndex: Double
        public let title: String
        public let url: String
    }

    public let tabs: [TabsItem]
}

// Output type for: list_tracks
public struct MCPListTracksOutput: Codable, Sendable {
    public struct TracksItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let artist: String?
        public let album: String?
        public let duration: Double?
        public let trackNumber: Double?
        public let genre: String?
        public let year: Double?
    }

    public let total: Double
    public let returned: Double
    public let tracks: [TracksItem]
}

// Output type for: memory_query
public struct MCPMemoryQueryOutput: Codable, Sendable {
    public struct EntriesItem: Codable, Sendable {
        public let id: String
        public let kind: String
        public let key: String
        public let value: String
        public let tags: [String]
        public let source: String?
        public let createdAt: String
        public let updatedAt: String
        public let expiresAt: String?
    }

    public let total: Double
    public let entries: [EntriesItem]
}

// Output type for: memory_stats
public struct MCPMemoryStatsOutput: Codable, Sendable {
    public struct Bykind: Codable, Sendable {
        public let fact: Double
        public let entity: Double
        public let episode: Double
    }

    public let total: Double
    public let byKind: Bykind
    public let oldest: String?
    public let newest: String?
    public let expiredSwept: Double
    public let path: String
}

// Output type for: now_playing
public struct MCPNowPlayingOutput: Codable, Sendable {
    public let playerState: String
    public let track: String
}

// Output type for: proactive_context
public struct MCPProactiveContextOutput: Codable, Sendable {
    public struct Timecontext: Codable, Sendable {
        public let period: String
        public let hour: Double
        public let isWeekend: Bool
    }
    public struct SuggestedtoolsItem: Codable, Sendable {
        public let tool: String
        public let reason: String
    }

    public let timeContext: Timecontext
    public let suggestedTools: [SuggestedtoolsItem]
    public let suggestedWorkflows: [String]
}

// Output type for: read_chat
public struct MCPReadChatOutput: Codable, Sendable {
    public struct ParticipantsItem: Codable, Sendable {
        public let name: String?
        public let handle: String?
    }

    public let id: String
    public let name: String?
    public let participants: [ParticipantsItem]
    public let updated: String?
}

// Output type for: read_contact
public struct MCPReadContactOutput: Codable, Sendable {
    public struct EmailsItem: Codable, Sendable {
        public let value: String
        public let label: String
    }
    public struct PhonesItem: Codable, Sendable {
        public let value: String
        public let label: String
    }
    public struct AddressesItem: Codable, Sendable {
        public let street: String
        public let city: String
        public let state: String
        public let zip: String
        public let country: String
        public let label: String
    }

    public let id: String
    public let name: String
    public let firstName: String
    public let lastName: String
    public let organization: String?
    public let jobTitle: String?
    public let department: String?
    public let note: String?
    public let emails: [EmailsItem]
    public let phones: [PhonesItem]
    public let addresses: [AddressesItem]
}

// Output type for: read_event
public struct MCPReadEventOutput: Codable, Sendable {
    public struct AttendeesItem: Codable, Sendable {
        public let name: String?
        public let email: String?
        public let status: String?
    }

    public let id: String
    public let summary: String
    public let description: String?
    public let location: String?
    public let startDate: String
    public let endDate: String
    public let allDay: Bool
    public let recurrence: String?
    public let url: String?
    public let calendar: String
    public let attendees: [AttendeesItem]
}

// Output type for: read_note
public struct MCPReadNoteOutput: Codable, Sendable {
    public let id: String
    public let name: String
    public let body: String
    public let plaintext: String
    public let creationDate: String
    public let modificationDate: String
    public let folder: String
    public let shared: Bool
    public let passwordProtected: Bool
}

// Output type for: read_reminder
public struct MCPReadReminderOutput: Codable, Sendable {
    public let id: String
    public let name: String
    public let body: String
    public let completed: Bool
    public let completionDate: String?
    public let creationDate: String
    public let modificationDate: String
    public let dueDate: String?
    public let priority: Double
    public let flagged: Bool
    public let list: String
}

// Output type for: search_chats
public struct MCPSearchChatsOutput: Codable, Sendable {
    public struct ChatsItem: Codable, Sendable {
        public struct ParticipantsItem: Codable, Sendable {
            public let name: String?
            public let handle: String?
        }

        public let id: String
        public let name: String?
        public let participants: [ParticipantsItem]
        public let updated: String?
    }

    public let total: Double
    public let returned: Double
    public let chats: [ChatsItem]
}

// Output type for: search_contacts
public struct MCPSearchContactsOutput: Codable, Sendable {
    public struct ContactsItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let organization: String?
        public let email: String?
        public let phone: String?
        public let matchedField: String
    }

    public let total: Double
    public let returned: Double
    public let contacts: [ContactsItem]
}

// Output type for: search_events
public struct MCPSearchEventsOutput: Codable, Sendable {
    public struct EventsItem: Codable, Sendable {
        public let id: String
        public let summary: String
        public let startDate: String
        public let endDate: String
        public let allDay: Bool
        public let calendar: String
    }

    public let total: Double
    public let events: [EventsItem]
}

// Output type for: search_notes
public struct MCPSearchNotesOutput: Codable, Sendable {
    public struct NotesItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let folder: String
        public let preview: String
        public let creationDate: String
        public let modificationDate: String
    }

    public let total: Double
    public let returned: Double
    public let offset: Double
    public let notes: [NotesItem]
}

// Output type for: search_reminders
public struct MCPSearchRemindersOutput: Codable, Sendable {
    public struct RemindersItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let completed: Bool
        public let dueDate: String?
        public let priority: Double
        public let flagged: Bool
        public let list: String
    }

    public let returned: Double
    public let reminders: [RemindersItem]
}

// Output type for: search_shortcuts
public struct MCPSearchShortcutsOutput: Codable, Sendable {
    public let total: Double
    public let shortcuts: [String]
}

// Output type for: suggest_next_tools
public struct MCPSuggestNextToolsOutput: Codable, Sendable {
    public struct SuggestionsItem: Codable, Sendable {
        public let tool: String
        public let count: Double
    }

    public let after: String
    public let suggestions: [SuggestionsItem]
    public let totalCalls: Double
    public let hint: String?
}

// Output type for: today_events
public struct MCPTodayEventsOutput: Codable, Sendable {
    public struct EventsItem: Codable, Sendable {
        public let id: String
        public let summary: String
        public let startDate: String
        public let endDate: String
        public let allDay: Bool
        public let calendar: String
        public let location: String
    }

    public let total: Double
    public let events: [EventsItem]
}

// MARK: - AppIntents

// Tool: ai_chat
public struct AiChatIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "AI Chat"
    nonisolated(unsafe) public static var description = IntentDescription("Send a message to an on-device AI session using Apple Foundation Models.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name for this chat session (use same name to continue a conversation)")
    public var sessionName: String

    @Parameter(title: "The message to send to the AI")
    public var message: String

    @Parameter(title: "Optional system instruction for this session")
    public var systemInstruction: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["sessionName"] = sessionName
        args["message"] = message
        if let v = systemInstruction { args["systemInstruction"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "ai_chat",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ai_plan_metrics
public struct AiPlanMetricsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "AI Plan Metrics"
    nonisolated(unsafe) public static var description = IntentDescription("Run a sample of planner goals against the on-device Foundation Model and repo...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Number of cases to sample from GOLDEN_PLANS (default: 5, max: 50).", default: 5, inclusiveRange: (1, 50))
    public var limit: Int

    @Parameter(title: "Deterministic seed for case selection (default: time-based). Fixing this is usef")
    public var seed: Int?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["limit"] = limit
        if let v = seed { args["seed"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "ai_plan_metrics",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "ai_plan_metrics", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPAiPlanMetricsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: ai_status
public struct AiStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "AI Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check availability and status of Apple's on-device Foundation Models.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "ai_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: audit_log
public struct AuditLogIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Audit Log"
    nonisolated(unsafe) public static var description = IntentDescription("Query the on-device audit log of tool calls.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Lower-bound ISO 8601 timestamp. Entries older than this are dropped. Defaults to")
    public var since: Date?

    @Parameter(title: "Filter to a single tool name (exact match).")
    public var tool: String?

    @Parameter(title: "Filter by status. Omit to include both. · Allowed: ok, error")
    public var status: String?

    @Parameter(title: "Max entries to return (default: 100, max: 1000).", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = since { args["since"] = ISO8601DateFormatter().string(from: v) }
        if let v = tool { args["tool"] = v }
        if let v = status { args["status"] = v }
        args["limit"] = limit
        let result = try await MCPIntentRouter.shared.call(
            tool: "audit_log",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: audit_summary
public struct AuditSummaryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Audit Summary"
    nonisolated(unsafe) public static var description = IntentDescription("Aggregate the audit log over a time window — total call count, error rate, an...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Lower-bound ISO 8601 timestamp. Defaults to 7 days ago.")
    public var since: Date?

    @Parameter(title: "Top-N busiest tools (default: 10).", default: 10, inclusiveRange: (1, 50))
    public var topN: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = since { args["since"] = ISO8601DateFormatter().string(from: v) }
        args["topN"] = topN
        let result = try await MCPIntentRouter.shared.call(
            tool: "audit_summary",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "audit_summary", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPAuditSummaryOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: calendar_week_view
public struct CalendarWeekViewIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Calendar Week View"
    nonisolated(unsafe) public static var description = IntentDescription("Display an interactive calendar week view showing events for a 7-day period.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Start date (YYYY-MM-DD). Defaults to current week's Monday.")
    public var startDate: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = startDate { args["startDate"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "calendar_week_view",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: classify_image
public struct ClassifyImageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Classify Image"
    nonisolated(unsafe) public static var description = IntentDescription("Classify an image using Apple Vision framework.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the image file")
    public var imagePath: String

    @Parameter(title: "Max labels (default: 10)", default: 10, inclusiveRange: (1, 50))
    public var maxResults: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "classify_image",
            args: ["imagePath": imagePath, "maxResults": maxResults]
        )
        return .result(value: result)
    }
}

// Tool: cloud_sync_status
public struct CloudSyncStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "iCloud Sync Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check iCloud sync status — see what usage data and config is synced across yo...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "cloud_sync_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: compare_notes
public struct CompareNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Compare Notes"
    nonisolated(unsafe) public static var description = IntentDescription("Retrieve full plaintext content of 2-5 notes at once for comparison.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Array of 2-5 note IDs to compare")
    public var ids: [String]

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "compare_notes",
            args: ["ids": ids]
        )
        return .result(value: result)
    }
}

// Tool: discover_tools
public struct DiscoverToolsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Discover Tools"
    nonisolated(unsafe) public static var description = IntentDescription("Search available tools by keyword.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search query — e.g. 'calendar', 'send email', 'music playback'")
    public var query: String

    @Parameter(title: "Max results (default 20)", inclusiveRange: (1, 50))
    public var limit: Double?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["query"] = query
        if let v = limit { args["limit"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "discover_tools",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "discover_tools", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPDiscoverToolsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: event_status
public struct EventStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Event Monitor Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check if real-time event monitoring is active.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "event_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: event_subscribe
public struct EventSubscribeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Subscribe to Events"
    nonisolated(unsafe) public static var description = IntentDescription("Start real-time monitoring of Apple data changes: calendar, reminders, clipbo...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "event_subscribe",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: find_related
public struct FindRelatedIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Find Related Items"
    nonisolated(unsafe) public static var description = IntentDescription("Given a note, event, reminder, or email ID, find semantically related items a...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Item ID (as stored in the vector index)")
    public var id: String

    @Parameter(title: "Max results (default 10)", inclusiveRange: (1, 50))
    public var limit: Int?

    @Parameter(title: "Minimum similarity (default 0.6)", inclusiveRange: (0, 1))
    public var threshold: Double?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["id"] = id
        if let v = limit { args["limit"] = v }
        if let v = threshold { args["threshold"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "find_related",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: generate_plan
public struct GeneratePlanIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Generate Plan"
    nonisolated(unsafe) public static var description = IntentDescription("Use Apple's on-device Foundation Model to analyze a goal and generate a sugge...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "What you want to accomplish (e.g. 'organize my day', 'prepare for meeting')")
    public var goal: String

    @Parameter(title: "Additional context (max 10K chars, e.g. snapshot text, recent events)")
    public var context: String?

    @Parameter(title: "List of available tool names to plan with. Defaults to common tools.")
    public var availableTools: [String]?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["goal"] = goal
        if let v = context { args["context"] = v }
        if let v = availableTools { args["availableTools"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "generate_plan",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: generate_text
public struct GenerateTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Generate Text"
    nonisolated(unsafe) public static var description = IntentDescription("Generate text using Apple's on-device Foundation Model with custom system ins...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The user prompt / instruction for text generation")
    public var prompt: String

    @Parameter(title: "Optional system instruction to guide the model's behavior")
    public var systemInstruction: String?

    @Parameter(title: "Sampling temperature (0-2). Lower = more deterministic", inclusiveRange: (0, 2))
    public var temperature: Double?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["prompt"] = prompt
        if let v = systemInstruction { args["systemInstruction"] = v }
        if let v = temperature { args["temperature"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "generate_text",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: geocode
public struct GeocodeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Geocode"
    nonisolated(unsafe) public static var description = IntentDescription("Convert a place name or address to geographic coordinates.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Place name or address (e.g. 'Seoul', 'Tokyo Tower', '1600 Pennsylvania Ave')")
    public var query: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "geocode",
            args: ["query": query]
        )
        return .result(value: result)
    }
}

// Tool: get_battery_status
public struct GetBatteryStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Battery Status"
    nonisolated(unsafe) public static var description = IntentDescription("Get battery percentage, charging state, power source, and estimated time rema...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_battery_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_bluetooth_state
public struct GetBluetoothStateIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Bluetooth State"
    nonisolated(unsafe) public static var description = IntentDescription("Check whether Bluetooth is powered on, off, or unauthorized.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_bluetooth_state",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_brightness
public struct GetBrightnessIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Brightness"
    nonisolated(unsafe) public static var description = IntentDescription("Get the current display brightness level.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_brightness",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_clipboard
public struct GetClipboardIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Clipboard"
    nonisolated(unsafe) public static var description = IntentDescription("Read the current text content of the system clipboard.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_clipboard",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_clipboard", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetClipboardOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_current_location
public struct GetCurrentLocationIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Current Location"
    nonisolated(unsafe) public static var description = IntentDescription("Get the device's current geographic location (latitude, longitude, altitude).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_current_location",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_current_tab
public struct GetCurrentTabIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Current Tab"
    nonisolated(unsafe) public static var description = IntentDescription("Get the title and URL of the active Safari tab.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_current_tab",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_current_tab", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetCurrentTabOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_current_weather
public struct GetCurrentWeatherIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Current Weather"
    nonisolated(unsafe) public static var description = IntentDescription("Get current weather conditions for a location using coordinates.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate", inclusiveRange: (-180, 180))
    public var longitude: Double

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_current_weather",
            args: ["latitude": latitude, "longitude": longitude]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_current_weather", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetCurrentWeatherOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_daily_forecast
public struct GetDailyForecastIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Daily Forecast"
    nonisolated(unsafe) public static var description = IntentDescription("Get daily weather forecast for a location.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate", inclusiveRange: (-180, 180))
    public var longitude: Double

    @Parameter(title: "Number of forecast days (default: 7)", default: 7, inclusiveRange: (1, 16))
    public var days: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_daily_forecast",
            args: ["latitude": latitude, "longitude": longitude, "days": days]
        )
        return .result(value: result)
    }
}

// Tool: get_file_info
public struct GetFileInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get File Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed file information including size, dates, kind, and tags.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute file path")
    public var path: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_file_info",
            args: ["path": path]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_file_info", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetFileInfoOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_frontmost_app
public struct GetFrontmostAppIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Frontmost App"
    nonisolated(unsafe) public static var description = IntentDescription("Get the name, bundle identifier, and PID of the currently active (frontmost) ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_frontmost_app",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_frontmost_app", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetFrontmostAppOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_hourly_forecast
public struct GetHourlyForecastIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Hourly Forecast"
    nonisolated(unsafe) public static var description = IntentDescription("Get hourly weather forecast for a location.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate", inclusiveRange: (-180, 180))
    public var longitude: Double

    @Parameter(title: "Number of forecast hours (default: 24)", default: 24, inclusiveRange: (1, 168))
    public var hours: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_hourly_forecast",
            args: ["latitude": latitude, "longitude": longitude, "hours": hours]
        )
        return .result(value: result)
    }
}

// Tool: get_location_permission
public struct GetLocationPermissionIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Location Permission"
    nonisolated(unsafe) public static var description = IntentDescription("Check the current Location Services authorization status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_location_permission",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_photo_info
public struct GetPhotoInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Photo Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed metadata for a specific photo by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Photo media item ID")
    public var id: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_photo_info",
            args: ["id": id]
        )
        return .result(value: result)
    }
}

// Tool: get_rating
public struct GetRatingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Rating"
    nonisolated(unsafe) public static var description = IntentDescription("Get the rating, favorited, and disliked status for a track.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name to look up")
    public var trackName: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_rating",
            args: ["trackName": trackName]
        )
        return .result(value: result)
    }
}

// Tool: get_screen_info
public struct GetScreenInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Screen Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get display information including resolution, pixel dimensions, and Retina st...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_screen_info",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_shortcut_detail
public struct GetShortcutDetailIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Shortcut Detail"
    nonisolated(unsafe) public static var description = IntentDescription("Get details about a Siri Shortcut including its actions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Shortcut name (exact match)")
    public var name: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_shortcut_detail",
            args: ["name": name]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_shortcut_detail", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetShortcutDetailOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_track_info
public struct GetTrackInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Track Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed metadata for a specific track by name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name to look up")
    public var trackName: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_track_info",
            args: ["trackName": trackName]
        )
        return .result(value: result)
    }
}

// Tool: get_unread_count
public struct GetUnreadCountIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Unread Count"
    nonisolated(unsafe) public static var description = IntentDescription("Get unread message count across all mailboxes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_unread_count",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_unread_count", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetUnreadCountOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_upcoming_events
public struct GetUpcomingEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Upcoming Events"
    nonisolated(unsafe) public static var description = IntentDescription("Get the next N upcoming events from now (searches up to 30 days ahead).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max events to return (default: 10)", default: 10, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_upcoming_events",
            args: ["limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_upcoming_events", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetUpcomingEventsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_volume
public struct GetVolumeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Volume"
    nonisolated(unsafe) public static var description = IntentDescription("Get the current system output volume level and mute state.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_volume",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_volume", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPGetVolumeOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: get_wifi_status
public struct GetWifiStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get WiFi Status"
    nonisolated(unsafe) public static var description = IntentDescription("Get the current WiFi status including connected network name, signal strength...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_wifi_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: gws_calendar_list
public struct GwsCalendarListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Google Calendar Events"
    nonisolated(unsafe) public static var description = IntentDescription("List upcoming events from Google Calendar.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "maxResults", default: 10, inclusiveRange: (1, 100))
    public var maxResults: Int

    @Parameter(title: "Free-text search within events")
    public var query: String?

    @Parameter(title: "Start time (ISO 8601). Defaults to now.")
    public var timeMin: String?

    @Parameter(title: "End time (ISO 8601)")
    public var timeMax: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["maxResults"] = maxResults
        if let v = query { args["query"] = v }
        if let v = timeMin { args["timeMin"] = v }
        if let v = timeMax { args["timeMax"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_calendar_list",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: gws_docs_read
public struct GwsDocsReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Google Doc"
    nonisolated(unsafe) public static var description = IntentDescription("Read the content of a Google Doc by document ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Google Docs document ID")
    public var documentId: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_docs_read",
            args: ["documentId": documentId]
        )
        return .result(value: result)
    }
}

// Tool: gws_drive_list
public struct GwsDriveListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Drive Files"
    nonisolated(unsafe) public static var description = IntentDescription("List files in Google Drive.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Drive search query (e.g. \"name contains 'report'\" or \"mimeType = 'application/pd")
    public var query: String?

    @Parameter(title: "Max files to return", default: 20, inclusiveRange: (1, 100))
    public var pageSize: Int

    @Parameter(title: "Sort order (e.g. 'modifiedTime desc', 'name')")
    public var orderBy: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = query { args["query"] = v }
        args["pageSize"] = pageSize
        if let v = orderBy { args["orderBy"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_drive_list",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: gws_drive_read
public struct GwsDriveReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Drive File Metadata"
    nonisolated(unsafe) public static var description = IntentDescription("Get metadata for a Google Drive file by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Drive file ID")
    public var fileId: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_drive_read",
            args: ["fileId": fileId]
        )
        return .result(value: result)
    }
}

// Tool: gws_drive_search
public struct GwsDriveSearchIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Drive"
    nonisolated(unsafe) public static var description = IntentDescription("Full-text search across Google Drive files by content or name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search text (searches file names and content)")
    public var query: String

    @Parameter(title: "maxResults", default: 10, inclusiveRange: (1, 50))
    public var maxResults: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_drive_search",
            args: ["query": query, "maxResults": maxResults]
        )
        return .result(value: result)
    }
}

// Tool: gws_gmail_list
public struct GwsGmailListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Gmail Messages"
    nonisolated(unsafe) public static var description = IntentDescription("List recent Gmail messages.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Gmail search query (e.g. 'is:unread', 'from:bob subject:report')")
    public var query: String?

    @Parameter(title: "Max messages to return", default: 20, inclusiveRange: (1, 100))
    public var maxResults: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = query { args["query"] = v }
        args["maxResults"] = maxResults
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_gmail_list",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: gws_gmail_read
public struct GwsGmailReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Gmail Message"
    nonisolated(unsafe) public static var description = IntentDescription("Read a Gmail message by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Gmail message ID")
    public var messageId: String

    @Parameter(title: "Response format · Allowed: full, metadata, minimal", default: "full")
    public var format: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_gmail_read",
            args: ["messageId": messageId, "format": format]
        )
        return .result(value: result)
    }
}

// Tool: gws_people_search
public struct GwsPeopleSearchIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Google Contacts"
    nonisolated(unsafe) public static var description = IntentDescription("Search contacts in Google People/Contacts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search query (name, email, phone)")
    public var query: String

    @Parameter(title: "pageSize", default: 10, inclusiveRange: (1, 30))
    public var pageSize: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_people_search",
            args: ["query": query, "pageSize": pageSize]
        )
        return .result(value: result)
    }
}

// Tool: gws_sheets_read
public struct GwsSheetsReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Google Sheet"
    nonisolated(unsafe) public static var description = IntentDescription("Read cell values from a Google Sheets spreadsheet.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Spreadsheet ID (from URL)")
    public var spreadsheetId: String

    @Parameter(title: "A1 range notation (e.g. 'Sheet1!A1:D10')", default: "Sheet1")
    public var range: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_sheets_read",
            args: ["spreadsheetId": spreadsheetId, "range": range]
        )
        return .result(value: result)
    }
}

// Tool: gws_status
public struct GwsStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Google Workspace Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check if Google Workspace CLI (gws) is installed and authenticated.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: gws_tasks_list
public struct GwsTasksListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Google Tasks"
    nonisolated(unsafe) public static var description = IntentDescription("List tasks from Google Tasks (default task list).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "maxResults", default: 20, inclusiveRange: (1, 100))
    public var maxResults: Int

    @Parameter(title: "Include completed tasks", default: false)
    public var showCompleted: Bool

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_tasks_list",
            args: ["maxResults": maxResults, "showCompleted": showCompleted]
        )
        return .result(value: result)
    }
}

// Tool: is_app_running
public struct IsAppRunningIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Is App Running"
    nonisolated(unsafe) public static var description = IntentDescription("Check whether an application is currently running.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name to check (e.g. 'Safari')")
    public var name: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "is_app_running",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: keynote_get_slide
public struct KeynoteGetSlideIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Keynote Slide"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed content of a specific slide including all text items and present...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Slide number (1-based)")
    public var slideNumber: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_get_slide",
            args: ["document": document, "slideNumber": slideNumber]
        )
        return .result(value: result)
    }
}

// Tool: keynote_list_documents
public struct KeynoteListDocumentsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Keynote Documents"
    nonisolated(unsafe) public static var description = IntentDescription("List all open Keynote presentations.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_list_documents",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: keynote_list_slides
public struct KeynoteListSlidesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Keynote Slides"
    nonisolated(unsafe) public static var description = IntentDescription("List all slides in a Keynote presentation with title, body preview, and prese...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_list_slides",
            args: ["document": document]
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_accounts", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListAccountsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_albums
public struct ListAlbumsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Photo Albums"
    nonisolated(unsafe) public static var description = IntentDescription("List all photo albums with name and item count.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_albums",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_all_windows
public struct ListAllWindowsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List All Windows"
    nonisolated(unsafe) public static var description = IntentDescription("List windows across all running applications with title, size, position, app ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_all_windows",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_bluetooth_devices
public struct ListBluetoothDevicesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Bluetooth Devices"
    nonisolated(unsafe) public static var description = IntentDescription("List paired Bluetooth devices with their connection status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_bluetooth_devices",
            args: [String: any Sendable]()
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_bookmarks", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListBookmarksOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_calendars
public struct ListCalendarsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Calendars"
    nonisolated(unsafe) public static var description = IntentDescription("List all calendars with name, color, and writable status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_calendars",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_calendars", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListCalendarsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_chats
public struct ListChatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Chats"
    nonisolated(unsafe) public static var description = IntentDescription("List recent chats in Messages with participants and last update time.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max chats to return (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_chats",
            args: ["limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_chats", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListChatsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_contacts
public struct ListContactsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Contacts"
    nonisolated(unsafe) public static var description = IntentDescription("List contacts with name, primary email, and phone.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max contacts (default: 100)", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Skip N contacts (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_contacts",
            args: ["limit": limit, "offset": offset]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_contacts", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListContactsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_directory
public struct ListDirectoryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Directory"
    nonisolated(unsafe) public static var description = IntentDescription("List files and folders in a directory with metadata (kind, size, modification...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute directory path")
    public var path: String

    @Parameter(title: "Max items to return (default: 100)", default: 100, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_directory",
            args: ["path": path, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_directory", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListDirectoryOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_events
public struct ListEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Events"
    nonisolated(unsafe) public static var description = IntentDescription("List events within a date range.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Start of range (ISO 8601, e.g. '2026-03-01T00:00:00Z')")
    public var startDate: String

    @Parameter(title: "End of range (ISO 8601, e.g. '2026-03-31T23:59:59Z')")
    public var endDate: String

    @Parameter(title: "Filter by calendar name")
    public var calendar: String?

    @Parameter(title: "Max events to return (default: 100)", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Number of events to skip (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["startDate"] = startDate
        args["endDate"] = endDate
        if let v = calendar { args["calendar"] = v }
        args["limit"] = limit
        args["offset"] = offset
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_events",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_events", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListEventsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_favorites
public struct ListFavoritesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Favorite Photos"
    nonisolated(unsafe) public static var description = IntentDescription("List photos marked as favorites.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max photos (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_favorites",
            args: ["limit": limit]
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_folders", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListFoldersOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_group_members
public struct ListGroupMembersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Group Members"
    nonisolated(unsafe) public static var description = IntentDescription("List contacts in a specific group.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Group name")
    public var groupName: String

    @Parameter(title: "Max contacts (default: 100)", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_group_members",
            args: ["groupName": groupName, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_group_members", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListGroupMembersOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_groups
public struct ListGroupsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Contact Groups"
    nonisolated(unsafe) public static var description = IntentDescription("List all contact groups.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_groups",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_groups", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListGroupsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_mailboxes
public struct ListMailboxesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Mailboxes"
    nonisolated(unsafe) public static var description = IntentDescription("List all mailboxes across accounts with unread counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_mailboxes",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_mailboxes", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListMailboxesOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_messages
public struct ListMessagesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Messages"
    nonisolated(unsafe) public static var description = IntentDescription("List recent messages in a mailbox (e.g.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Mailbox name (e.g. 'INBOX', 'Sent Messages')")
    public var mailbox: String

    @Parameter(title: "Account name. Defaults to first account.")
    public var account: String?

    @Parameter(title: "Max messages (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    @Parameter(title: "Pagination offset (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["mailbox"] = mailbox
        if let v = account { args["account"] = v }
        args["limit"] = limit
        args["offset"] = offset
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_messages",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_messages", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListMessagesOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_notes
public struct ListNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Notes"
    nonisolated(unsafe) public static var description = IntentDescription("List all notes with title, folder, and dates.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by folder name")
    public var folder: String?

    @Parameter(title: "Max number of notes to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Number of notes to skip for pagination (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = folder { args["folder"] = v }
        args["limit"] = limit
        args["offset"] = offset
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_notes",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_notes", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListNotesOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_participants
public struct ListParticipantsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Chat Participants"
    nonisolated(unsafe) public static var description = IntentDescription("List all participants in a specific chat.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Chat ID")
    public var chatId: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_participants",
            args: ["chatId": chatId]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_participants", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListParticipantsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_photos
public struct ListPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Photos"
    nonisolated(unsafe) public static var description = IntentDescription("List photos in an album with metadata.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Album name")
    public var album: String

    @Parameter(title: "Max photos (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Offset for pagination (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_photos",
            args: ["album": album, "limit": limit, "offset": offset]
        )
        return .result(value: result)
    }
}

// Tool: list_playlists
public struct ListPlaylistsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Playlists"
    nonisolated(unsafe) public static var description = IntentDescription("List all Music playlists with track counts and duration.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_playlists",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_playlists", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListPlaylistsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_podcast_episodes
public struct ListPodcastEpisodesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Podcast Episodes"
    nonisolated(unsafe) public static var description = IntentDescription("List episodes of a podcast show with title, date, duration, and played status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Podcast show name")
    public var showName: String

    @Parameter(title: "Max episodes (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_podcast_episodes",
            args: ["showName": showName, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: list_podcast_shows
public struct ListPodcastShowsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Podcast Shows"
    nonisolated(unsafe) public static var description = IntentDescription("List all subscribed podcast shows with episode counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_podcast_shows",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_reading_list
public struct ListReadingListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reading List"
    nonisolated(unsafe) public static var description = IntentDescription("List all items in Safari's Reading List.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_reading_list",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_reading_list", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListReadingListOutput.self, from: data)
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_reminder_lists", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListReminderListsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_reminders
public struct ListRemindersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reminders"
    nonisolated(unsafe) public static var description = IntentDescription("List reminders.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by list name")
    public var list: String?

    @Parameter(title: "Filter by completed status (true/false). Omit to list all.")
    public var completed: Bool?

    @Parameter(title: "Max number of reminders to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Number of reminders to skip for pagination (default: 0)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = list { args["list"] = v }
        if let v = completed { args["completed"] = v }
        args["limit"] = limit
        args["offset"] = offset
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_reminders",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_reminders", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListRemindersOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_running_apps
public struct ListRunningAppsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Running Apps"
    nonisolated(unsafe) public static var description = IntentDescription("List all running applications with name, bundle identifier, PID, and visibility.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_running_apps",
            args: [String: any Sendable]()
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_shortcuts", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListShortcutsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_tabs
public struct ListTabsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Safari Tabs"
    nonisolated(unsafe) public static var description = IntentDescription("List all open tabs across all Safari windows with title and URL.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_tabs",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_tabs", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListTabsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_tracks
public struct ListTracksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Tracks"
    nonisolated(unsafe) public static var description = IntentDescription("List tracks in a playlist with name, artist, album, and duration.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playlist name")
    public var playlist: String

    @Parameter(title: "Max tracks (default: 100)", default: 100, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_tracks",
            args: ["playlist": playlist, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_tracks", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPListTracksOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: list_triggers
public struct ListTriggersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Event Triggers"
    nonisolated(unsafe) public static var description = IntentDescription("Show all skills with event triggers (calendar_changed, reminders_changed, pas...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_triggers",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_windows
public struct ListWindowsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Windows"
    nonisolated(unsafe) public static var description = IntentDescription("List all visible windows across all running applications.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_windows",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: local_llm_generate
public struct LocalLlmGenerateIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Local LLM Generate"
    nonisolated(unsafe) public static var description = IntentDescription("Generate text using a local Ollama model.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The prompt to send to the local LLM")
    public var prompt: String

    @Parameter(title: "Ollama model name (default: llama3.2)")
    public var model: String?

    @Parameter(title: "System instruction for the model")
    public var system: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["prompt"] = prompt
        if let v = model { args["model"] = v }
        if let v = system { args["system"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "local_llm_generate",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: local_llm_status
public struct LocalLlmStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Local LLM Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check if a local Ollama LLM is available and list installed models.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "local_llm_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: memory_query
public struct MemoryQueryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query Context Memory"
    nonisolated(unsafe) public static var description = IntentDescription("List non-expired memory entries.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Restrict to one kind · Allowed: fact, entity, episode")
    public var kind: String?

    @Parameter(title: "Case-insensitive substring in key or value")
    public var contains: String?

    @Parameter(title: "Match entries carrying ALL given tags")
    public var tags: [String]?

    @Parameter(title: "Max rows (default 50, cap 500)", inclusiveRange: (1, 500))
    public var limit: Int?

    @Parameter(title: "Sort by updatedAt (default desc) · Allowed: desc, asc")
    public var order: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = kind { args["kind"] = v }
        if let v = contains { args["contains"] = v }
        if let v = tags { args["tags"] = v }
        if let v = limit { args["limit"] = v }
        if let v = order { args["order"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "memory_query",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "memory_query", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPMemoryQueryOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: memory_stats
public struct MemoryStatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Context Memory Stats"
    nonisolated(unsafe) public static var description = IntentDescription("Summarize the context-memory store: counts by kind, oldest/newest timestamps,...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "memory_stats",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "memory_stats", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPMemoryStatsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: music_player
public struct MusicPlayerIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Music Player"
    nonisolated(unsafe) public static var description = IntentDescription("Display an interactive music player showing the currently playing track.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "music_player",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: now_playing
public struct NowPlayingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Now Playing"
    nonisolated(unsafe) public static var description = IntentDescription("Get the currently playing track and playback state.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "now_playing",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "now_playing", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPNowPlayingOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: numbers_get_cell
public struct NumbersGetCellIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Numbers Cell"
    nonisolated(unsafe) public static var description = IntentDescription("Read a single cell value by address (e.g.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Cell address (e.g. 'A1', 'B3')")
    public var cell: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_get_cell",
            args: ["document": document, "sheet": sheet, "cell": cell]
        )
        return .result(value: result)
    }
}

// Tool: numbers_list_documents
public struct NumbersListDocumentsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Numbers Documents"
    nonisolated(unsafe) public static var description = IntentDescription("List all open Numbers spreadsheets.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_list_documents",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: numbers_list_sheets
public struct NumbersListSheetsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Numbers Sheets"
    nonisolated(unsafe) public static var description = IntentDescription("List all sheets (tabs) in a Numbers spreadsheet.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_list_sheets",
            args: ["document": document]
        )
        return .result(value: result)
    }
}

// Tool: numbers_read_cells
public struct NumbersReadCellsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Numbers Cell Range"
    nonisolated(unsafe) public static var description = IntentDescription("Read a range of cells from a sheet.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Start row index (0-based)")
    public var startRow: Int

    @Parameter(title: "Start column index (0-based)")
    public var startCol: Int

    @Parameter(title: "End row index (inclusive)")
    public var endRow: Int

    @Parameter(title: "End column index (inclusive)")
    public var endCol: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_read_cells",
            args: ["document": document, "sheet": sheet, "startRow": startRow, "startCol": startCol, "endRow": endRow, "endCol": endCol]
        )
        return .result(value: result)
    }
}

// Tool: pages_get_body_text
public struct PagesGetBodyTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Pages Body Text"
    nonisolated(unsafe) public static var description = IntentDescription("Get the body text content of an open Pages document.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name (as shown in title bar)")
    public var document: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "pages_get_body_text",
            args: ["document": document]
        )
        return .result(value: result)
    }
}

// Tool: pages_list_documents
public struct PagesListDocumentsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Pages Documents"
    nonisolated(unsafe) public static var description = IntentDescription("List all open Pages documents with name, path, and modified status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "pages_list_documents",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: podcast_now_playing
public struct PodcastNowPlayingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Podcast Now Playing"
    nonisolated(unsafe) public static var description = IntentDescription("Get the currently playing podcast episode and playback state.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "podcast_now_playing",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: proactive_context
public struct ProactiveContextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Proactive Context"
    nonisolated(unsafe) public static var description = IntentDescription("Get contextually relevant tool and workflow suggestions based on time of day,...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "proactive_context",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "proactive_context", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPProactiveContextOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: proofread_text
public struct ProofreadTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Proofread Text"
    nonisolated(unsafe) public static var description = IntentDescription("Proofread and correct grammar/spelling using Apple Intelligence (on-device Fo...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to proofread")
    public var text: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "proofread_text",
            args: ["text": text]
        )
        return .result(value: result)
    }
}

// Tool: query_photos
public struct QueryPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query Photos"
    nonisolated(unsafe) public static var description = IntentDescription("Query the Photos library with filters: media type, date range, favorites.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by media type · Allowed: image, video, audio")
    public var mediaType: String?

    @Parameter(title: "Start date (ISO 8601)")
    public var startDate: String?

    @Parameter(title: "End date (ISO 8601)")
    public var endDate: String?

    @Parameter(title: "Only favorites")
    public var favorites: Bool?

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = mediaType { args["mediaType"] = v }
        if let v = startDate { args["startDate"] = v }
        if let v = endDate { args["endDate"] = v }
        if let v = favorites { args["favorites"] = v }
        args["limit"] = limit
        let result = try await MCPIntentRouter.shared.call(
            tool: "query_photos",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: read_chat
public struct ReadChatIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Chat"
    nonisolated(unsafe) public static var description = IntentDescription("Read chat details including participants and last update time by chat ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Chat ID")
    public var chatId: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_chat",
            args: ["chatId": chatId]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_chat", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPReadChatOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: read_contact
public struct ReadContactIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Contact"
    nonisolated(unsafe) public static var description = IntentDescription("Read full details of a contact by ID including all emails, phones, and addres...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Contact ID")
    public var id: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_contact",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_contact", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPReadContactOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: read_event
public struct ReadEventIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Event"
    nonisolated(unsafe) public static var description = IntentDescription("Read full details of a calendar event by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Event UID")
    public var id: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_event",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_event", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPReadEventOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: read_message
public struct ReadMessageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Message"
    nonisolated(unsafe) public static var description = IntentDescription("Read full content of an email message by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Message ID")
    public var id: String

    @Parameter(title: "Max content length (default: 5000)", default: 5000, inclusiveRange: (100, 100000))
    public var maxLength: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_message",
            args: ["id": id, "maxLength": maxLength]
        )
        return .result(value: result)
    }
}

// Tool: read_note
public struct ReadNoteIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Note"
    nonisolated(unsafe) public static var description = IntentDescription("Read the full content of a specific note by its ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Note ID (x-coredata:// format)")
    public var id: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_note",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_note", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPReadNoteOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: read_page_content
public struct ReadPageContentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Page Content"
    nonisolated(unsafe) public static var description = IntentDescription("Read the HTML source of a Safari tab.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Window index (default: 0)", default: 0)
    public var windowIndex: Int

    @Parameter(title: "Tab index (default: 0)", default: 0)
    public var tabIndex: Int

    @Parameter(title: "Max content length (default: 10000)", default: 10000, inclusiveRange: (100, 50000))
    public var maxLength: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_page_content",
            args: ["windowIndex": windowIndex, "tabIndex": tabIndex, "maxLength": maxLength]
        )
        return .result(value: result)
    }
}

// Tool: read_reminder
public struct ReadReminderIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Reminder"
    nonisolated(unsafe) public static var description = IntentDescription("Read the full details of a specific reminder by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Reminder ID")
    public var id: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_reminder",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_reminder", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPReadReminderOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: recent_files
public struct RecentFilesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Recent Files"
    nonisolated(unsafe) public static var description = IntentDescription("Find recently modified files in a folder using Spotlight.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Folder to search (default: home)", default: "~")
    public var folder: String

    @Parameter(title: "Modified within N days (default: 7)", default: 7, inclusiveRange: (1, 365))
    public var days: Int

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "recent_files",
            args: ["folder": folder, "days": days, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: reverse_geocode
public struct ReverseGeocodeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Reverse Geocode"
    nonisolated(unsafe) public static var description = IntentDescription("Convert geographic coordinates to a place name and address.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate", inclusiveRange: (-180, 180))
    public var longitude: Double

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "reverse_geocode",
            args: ["latitude": latitude, "longitude": longitude]
        )
        return .result(value: result)
    }
}

// Tool: rewrite_text
public struct RewriteTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Rewrite Text"
    nonisolated(unsafe) public static var description = IntentDescription("Rewrite text in a specified tone using Apple Intelligence (on-device Foundati...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to rewrite")
    public var text: String

    @Parameter(title: "Target tone (default: professional) · Allowed: professional, friendly, concise", default: "professional")
    public var tone: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "rewrite_text",
            args: ["text": text, "tone": tone]
        )
        return .result(value: result)
    }
}

// Tool: scan_bluetooth
public struct ScanBluetoothIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Scan Bluetooth"
    nonisolated(unsafe) public static var description = IntentDescription("Scan for nearby BLE (Bluetooth Low Energy) devices.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Scan duration in seconds (1-30, default: 5)", default: 5, inclusiveRange: (1, 30))
    public var duration: Double

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "scan_bluetooth",
            args: ["duration": duration]
        )
        return .result(value: result)
    }
}

// Tool: scan_document
public struct ScanDocumentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Scan Document"
    nonisolated(unsafe) public static var description = IntentDescription("Extract text and structure from an image file using Apple Vision framework OCR.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the image file to scan")
    public var imagePath: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "scan_document",
            args: ["imagePath": imagePath]
        )
        return .result(value: result)
    }
}

// Tool: scan_notes
public struct ScanNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Scan Notes"
    nonisolated(unsafe) public static var description = IntentDescription("Bulk scan notes returning metadata and a text preview for each.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by folder name. Omit to scan all notes.")
    public var folder: String?

    @Parameter(title: "Max number of notes to return (default: 100)", default: 100, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Number of notes to skip for pagination (default: 0)", default: 0)
    public var offset: Int

    @Parameter(title: "Preview text length in characters (default: 300)", default: 300, inclusiveRange: (1, 5000))
    public var previewLength: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = folder { args["folder"] = v }
        args["limit"] = limit
        args["offset"] = offset
        args["previewLength"] = previewLength
        let result = try await MCPIntentRouter.shared.call(
            tool: "scan_notes",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: search_chats
public struct SearchChatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Chats"
    nonisolated(unsafe) public static var description = IntentDescription("Search chats by participant name, handle, or chat name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword (matches chat name, participant name, or handle)")
    public var query: String

    @Parameter(title: "Max results (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_chats",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_chats", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchChatsOutput.self, from: data)
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

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_contacts",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_contacts", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchContactsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: search_events
public struct SearchEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Events"
    nonisolated(unsafe) public static var description = IntentDescription("Search events by keyword in title or description within a date range.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Start of range (ISO 8601, e.g. '2026-03-01T00:00:00Z')")
    public var startDate: String

    @Parameter(title: "End of range (ISO 8601, e.g. '2026-03-31T23:59:59Z')")
    public var endDate: String

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_events",
            args: ["query": query, "startDate": startDate, "endDate": endDate, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_events", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchEventsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: search_files
public struct SearchFilesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Files"
    nonisolated(unsafe) public static var description = IntentDescription("Search files using Spotlight (mdfind).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search query (Spotlight syntax)")
    public var query: String

    @Parameter(title: "Folder to search in (default: home)", default: "~")
    public var folder: String

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_files",
            args: ["query": query, "folder": folder, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: search_messages
public struct SearchMessagesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Messages"
    nonisolated(unsafe) public static var description = IntentDescription("Search messages by keyword in subject or sender within a mailbox.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Mailbox to search (default: INBOX)", default: "INBOX")
    public var mailbox: String

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_messages",
            args: ["query": query, "mailbox": mailbox, "limit": limit]
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

    @Parameter(title: "Max results to return (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Number of matching results to skip (for pagination)", default: 0)
    public var offset: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_notes",
            args: ["query": query, "limit": limit, "offset": offset]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_notes", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchNotesOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: search_photos
public struct SearchPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Photos"
    nonisolated(unsafe) public static var description = IntentDescription("Search photos by filename, name, or description keyword.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_photos",
            args: ["query": query, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: search_podcast_episodes
public struct SearchPodcastEpisodesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Podcast Episodes"
    nonisolated(unsafe) public static var description = IntentDescription("Search across all podcast episodes by name or description.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_podcast_episodes",
            args: ["query": query, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: search_reminders
public struct SearchRemindersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Reminders"
    nonisolated(unsafe) public static var description = IntentDescription("Search reminders by keyword in name or body across all lists (case-insensitive).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 500))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_reminders",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_reminders", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchRemindersOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: search_shortcuts
public struct SearchShortcutsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Shortcuts"
    nonisolated(unsafe) public static var description = IntentDescription("Search Siri Shortcuts by name keyword.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword to match against shortcut names")
    public var query: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_shortcuts",
            args: ["query": query]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_shortcuts", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSearchShortcutsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: search_tabs
public struct SearchTabsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Tabs"
    nonisolated(unsafe) public static var description = IntentDescription("Search open Safari tabs by title or URL keyword.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword to match against tab titles and URLs")
    public var query: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_tabs",
            args: ["query": query]
        )
        return .result(value: result)
    }
}

// Tool: search_tracks
public struct SearchTracksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Tracks"
    nonisolated(unsafe) public static var description = IntentDescription("Search tracks in Music library by name, artist, or album.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_tracks",
            args: ["query": query, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: semantic_search
public struct SemanticSearchIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Semantic Search"
    nonisolated(unsafe) public static var description = IntentDescription("Search across Apple app data by meaning, not just keywords.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Natural language search query")
    public var query: String

    @Parameter(title: "Filter by source type")
    public var sources: [String]?

    @Parameter(title: "Max results (default 10)", inclusiveRange: (1, 50))
    public var limit: Int?

    @Parameter(title: "Minimum similarity (default 0.5)", inclusiveRange: (0, 1))
    public var threshold: Double?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["query"] = query
        if let v = sources { args["sources"] = v }
        if let v = limit { args["limit"] = v }
        if let v = threshold { args["threshold"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "semantic_search",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: semantic_status
public struct SemanticStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Semantic Index Status"
    nonisolated(unsafe) public static var description = IntentDescription("Show the current state of the semantic vector index -- total entries, breakdo...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "semantic_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: setup_permissions
public struct SetupPermissionsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Setup Permissions"
    nonisolated(unsafe) public static var description = IntentDescription("Trigger macOS permission prompts for all Apple apps used by AirMCP.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "setup_permissions",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: share_location
public struct ShareLocationIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Share Location"
    nonisolated(unsafe) public static var description = IntentDescription("Generate a shareable Apple Maps link for a location.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate")
    public var latitude: Double

    @Parameter(title: "Longitude coordinate")
    public var longitude: Double

    @Parameter(title: "Optional label for the location")
    public var label: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["latitude"] = latitude
        args["longitude"] = longitude
        if let v = label { args["label"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "share_location",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: skill_calendar-alert
public struct SkillCalendarAlertIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Calendar Change Alert"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Automatically fetches today's events when the calendar is modified.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_calendar-alert",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_clipboard-url-to-reading
public struct SkillClipboardUrlToReadingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Clipboard URL → Reading List"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Listens for clipboard changes and, when a URL is on the pasteboard, p...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_clipboard-url-to-reading",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_daily-journal
public struct SkillDailyJournalIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Daily Journal → Memory"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Captures today's events + open reminders, summarises them on-device, ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Optional free-form note to prepend to the auto-generated summary.", default: "")
    public var note: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_daily-journal",
            args: ["note": note]
        )
        return .result(value: result)
    }
}

// Tool: skill_evening-winddown
public struct SkillEveningWinddownIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Evening Wind-down"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Fires when the screen is locked — drafts a short day-in-review note c...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_evening-winddown",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_focus-block-planner
public struct SkillFocusBlockPlannerIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Focus Block Planner"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Walks today's open reminders and drops a calendar time-block for each...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_focus-block-planner",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_focus-guardian
public struct SkillFocusGuardianIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Focus Mode Guardian"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Auto-snapshots today's events and open reminders whenever the system ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_focus-guardian",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_inbox-triage
public struct SkillInboxTriageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Inbox Triage"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Check unread mail count and list recent messages for triage.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_inbox-triage",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_project-digest
public struct SkillProjectDigestIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Project Digest"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Semantic-search the user's indexed Apple data for a topic, then loop ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_project-digest",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_sender-to-tasks
public struct SkillSenderToTasksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Sender → Tasks"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Scans mail for a keyword and turns each hit into a reminder so nothin...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword in subject/sender (e.g. 'newsletter', 'invoice', 'team@acme.com')", default: "newsletter")
    public var query: String

    @Parameter(title: "Mailbox to search.", default: "INBOX")
    public var mailbox: String

    @Parameter(title: "Max messages to process per run.", default: 10)
    public var limit: Double

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_sender-to-tasks",
            args: ["query": query, "mailbox": mailbox, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: smart_clipboard
public struct SmartClipboardIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Smart Clipboard"
    nonisolated(unsafe) public static var description = IntentDescription("Get clipboard content with automatic type detection (text, URL, email, phone,...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "smart_clipboard",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: speech_availability
public struct SpeechAvailabilityIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Speech Recognition Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check if on-device speech recognition is available and authorized.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "speech_availability",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: suggest_next_tools
public struct SuggestNextToolsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Suggest Next Tools"
    nonisolated(unsafe) public static var description = IntentDescription("Based on your usage patterns, suggest which tools typically follow a given tool.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Tool name to get suggestions for — e.g. 'today_events'")
    public var after: String

    @Parameter(title: "Max suggestions (default 5)", inclusiveRange: (1, 20))
    public var limit: Double?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["after"] = after
        if let v = limit { args["limit"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "suggest_next_tools",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "suggest_next_tools", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPSuggestNextToolsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: summarize_context
public struct SummarizeContextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Summarize Context"
    nonisolated(unsafe) public static var description = IntentDescription("Collect context from all enabled Apple apps and ask the client's LLM to produ...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Optional focus area (e.g. 'meetings', 'overdue tasks', 'project X')")
    public var focus: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = focus { args["focus"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "summarize_context",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: summarize_text
public struct SummarizeTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Summarize Text"
    nonisolated(unsafe) public static var description = IntentDescription("Summarize text using Apple Intelligence (on-device Foundation Models).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to summarize")
    public var text: String

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "summarize_text",
            args: ["text": text]
        )
        return .result(value: result)
    }
}

// Tool: tag_content
public struct TagContentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Tag Content"
    nonisolated(unsafe) public static var description = IntentDescription("Classify and tag content using Apple's on-device Foundation Model.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The text content to classify")
    public var text: String

    @Parameter(title: "List of tag/category names to classify the content against")
    public var tags: [String]

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tag_content",
            args: ["text": text, "tags": tags]
        )
        return .result(value: result)
    }
}

// Tool: timeline_today
public struct TimelineTodayIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Timeline (Today)"
    nonisolated(unsafe) public static var description = IntentDescription("Display today's events and due reminders on a single day-axis timeline.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "timeline_today",
            args: [String: any Sendable]()
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
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "today_events", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(MCPTodayEventsOutput.self, from: data)
        return .result(value: result)
    }
}

// Tool: transcribe_audio
public struct TranscribeAudioIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Transcribe Audio"
    nonisolated(unsafe) public static var description = IntentDescription("Transcribe an audio file to text using Apple's on-device speech recognition.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the audio file")
    public var path: String

    @Parameter(title: "Language code (e.g. 'en-US', 'ko-KR', 'ja-JP'). Defaults to system language.")
    public var language: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["path"] = path
        if let v = language { args["language"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "transcribe_audio",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: tv_list_playlists
public struct TvListPlaylistsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List TV Playlists"
    nonisolated(unsafe) public static var description = IntentDescription("List all playlists (libraries) in Apple TV app.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_list_playlists",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: tv_list_tracks
public struct TvListTracksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List TV Tracks"
    nonisolated(unsafe) public static var description = IntentDescription("List movies/episodes in a TV playlist.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playlist name (e.g. 'Library', 'Movies')")
    public var playlist: String

    @Parameter(title: "Max items (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_list_tracks",
            args: ["playlist": playlist, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: tv_now_playing
public struct TvNowPlayingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "TV Now Playing"
    nonisolated(unsafe) public static var description = IntentDescription("Get currently playing content in Apple TV app.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_now_playing",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: tv_search
public struct TvSearchIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search TV Library"
    nonisolated(unsafe) public static var description = IntentDescription("Search movies and TV shows by name or show title.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var limit: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_search",
            args: ["query": query, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: ui_accessibility_query
public struct UiAccessibilityQueryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query UI Elements"
    nonisolated(unsafe) public static var description = IntentDescription("Search for UI elements by accessibility attributes (role, title, value, descr...")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "App name to search in. If omitted, uses frontmost app.")
    public var app: String?

    @Parameter(title: "AX role filter (e.g. 'AXButton', 'AXTextField', 'AXMenuItem', 'AXStaticText', 'A")
    public var role: String?

    @Parameter(title: "Title text to match (substring, case-insensitive)")
    public var title: String?

    @Parameter(title: "Value text to match (substring, case-insensitive)")
    public var value: String?

    @Parameter(title: "Description text to match (substring)")
    public var description: String?

    @Parameter(title: "AXIdentifier to match (exact)")
    public var identifier: String?

    @Parameter(title: "General label search — matches across name, title, value, and description")
    public var label: String?

    @Parameter(title: "Max results to return (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var maxResults: Int

    @Parameter(title: "Max tree depth to search (default: 8)", default: 8, inclusiveRange: (1, 15))
    public var maxDepth: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = app { args["app"] = v }
        if let v = role { args["role"] = v }
        if let v = title { args["title"] = v }
        if let v = value { args["value"] = v }
        if let v = description { args["description"] = v }
        if let v = identifier { args["identifier"] = v }
        if let v = label { args["label"] = v }
        args["maxResults"] = maxResults
        args["maxDepth"] = maxDepth
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_accessibility_query",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_diff
public struct UiDiffIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Compare UI State"
    nonisolated(unsafe) public static var description = IntentDescription("Compare the current UI state against a previous snapshot to detect changes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "JSON string of previous UI tree snapshot (elements array from ui_traverse)")
    public var beforeSnapshot: String

    @Parameter(title: "App name to compare against")
    public var app: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["beforeSnapshot"] = beforeSnapshot
        if let v = app { args["app"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_diff",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_read
public struct UiReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Accessibility Tree"
    nonisolated(unsafe) public static var description = IntentDescription("Read the accessibility tree of the frontmost app (or specified app).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "App name to read. If omitted, reads the frontmost app.")
    public var appName: String?

    @Parameter(title: "Maximum depth of the UI tree to traverse (default: 3)", default: 3, inclusiveRange: (1, 10))
    public var maxDepth: Int

    @Parameter(title: "Maximum number of UI elements to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var maxElements: Int

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = appName { args["appName"] = v }
        args["maxDepth"] = maxDepth
        args["maxElements"] = maxElements
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_read",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_traverse
public struct UiTraverseIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "BFS Traverse UI Tree"
    nonisolated(unsafe) public static var description = IntentDescription("Breadth-first traversal of the accessibility tree.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "App name to traverse. If omitted, uses frontmost app.")
    public var app: String?

    @Parameter(title: "Process ID for precise targeting (overrides app name lookup)")
    public var pid: Int?

    @Parameter(title: "Max traversal depth (default: 5)", default: 5, inclusiveRange: (1, 15))
    public var maxDepth: Int

    @Parameter(title: "Max elements to collect (default: 500)", default: 500, inclusiveRange: (1, 2000))
    public var maxElements: Int

    @Parameter(title: "Only include elements with visible position/size", default: false)
    public var onlyVisible: Bool

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = app { args["app"] = v }
        if let v = pid { args["pid"] = v }
        args["maxDepth"] = maxDepth
        args["maxElements"] = maxElements
        args["onlyVisible"] = onlyVisible
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_traverse",
            args: args
        )
        return .result(value: result)
    }
}

// MARK: - AppShortcutsProvider

public struct AirMCPGeneratedShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder public static var appShortcuts: [AppShortcut] {
        #if canImport(FoundationModels) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            AppShortcut(
                intent: AskAirMCPIntent(),
                phrases: [
                    "Ask \(.applicationName)",
                    "Ask \(.applicationName) about my day",
                ],
                shortTitle: "Ask AirMCP",
                systemImageName: "brain.head.profile"
            )
        }
        #endif
        AppShortcut(
            intent: TodayEventsIntent(),
            phrases: [
                "Today's Events in \(.applicationName)",
                "today events with \(.applicationName)",
            ],
            shortTitle: "Today's Events",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: ListCalendarsIntent(),
            phrases: [
                "List Calendars in \(.applicationName)",
                "list calendars with \(.applicationName)",
            ],
            shortTitle: "List Calendars",
            systemImageName: "calendar.badge.plus"
        )
        AppShortcut(
            intent: SearchNotesIntent(),
            phrases: [
                "Search Notes in \(.applicationName)",
                "search notes with \(.applicationName)",
            ],
            shortTitle: "Search Notes",
            systemImageName: "note.text"
        )
        AppShortcut(
            intent: SearchContactsIntent(),
            phrases: [
                "Search Contacts in \(.applicationName)",
                "search contacts with \(.applicationName)",
            ],
            shortTitle: "Search Contacts",
            systemImageName: "person.crop.circle"
        )
        AppShortcut(
            intent: ListReminderListsIntent(),
            phrases: [
                "List Reminder Lists in \(.applicationName)",
                "list reminder lists with \(.applicationName)",
            ],
            shortTitle: "List Reminder Lists",
            systemImageName: "checklist"
        )
        AppShortcut(
            intent: ListShortcutsIntent(),
            phrases: [
                "List Shortcuts in \(.applicationName)",
                "list shortcuts with \(.applicationName)",
            ],
            shortTitle: "List Shortcuts",
            systemImageName: "square.stack.3d.up"
        )
        AppShortcut(
            intent: ListBookmarksIntent(),
            phrases: [
                "List Bookmarks in \(.applicationName)",
                "list bookmarks with \(.applicationName)",
            ],
            shortTitle: "List Bookmarks",
            systemImageName: "safari"
        )
        AppShortcut(
            intent: GetCurrentWeatherIntent(),
            phrases: [
                "Get Current Weather in \(.applicationName)",
                "get current weather with \(.applicationName)",
            ],
            shortTitle: "Get Current Weather",
            systemImageName: "cloud.sun"
        )
        AppShortcut(
            intent: SummarizeContextIntent(),
            phrases: [
                "Summarize Context in \(.applicationName)",
                "summarize context with \(.applicationName)",
            ],
            shortTitle: "Summarize Context",
            systemImageName: "sparkles"
        )
    }
}

#endif

// MARK: - Interactive Snippet views (RFC 0007 §3.7, A.4.1)

#if canImport(SwiftUI) && canImport(AppIntents) && compiler(>=6.3)
import SwiftUI

// Snippet view for: ai_plan_metrics  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPAiPlanMetricsSnippetView: View {
    public let data: MCPAiPlanMetricsOutput
    public init(data: MCPAiPlanMetricsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.perCase.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: audit_summary  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPAuditSummarySnippetView: View {
    public let data: MCPAuditSummaryOutput
    public init(data: MCPAuditSummaryOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.topTools.enumerated()), id: \.offset) { _, row in
                Text(row.tool)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: discover_tools  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPDiscoverToolsSnippetView: View {
    public let data: MCPDiscoverToolsOutput
    public init(data: MCPDiscoverToolsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.matches.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: get_clipboard  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetClipboardSnippetView: View {
    public let data: MCPGetClipboardOutput
    public init(data: MCPGetClipboardOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("content"); Spacer(); Text(String(describing: data.content)) }
            HStack { Text("length"); Spacer(); Text(String(describing: data.length)) }
            HStack { Text("truncated"); Spacer(); Text(String(describing: data.truncated)) }
        }
        .padding()
    }
}

// Snippet view for: get_current_tab  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetCurrentTabSnippetView: View {
    public let data: MCPGetCurrentTabOutput
    public init(data: MCPGetCurrentTabOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("title"); Spacer(); Text(String(describing: data.title)) }
            HStack { Text("url"); Spacer(); Text(String(describing: data.url)) }
        }
        .padding()
    }
}

// Snippet view for: get_current_weather  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetCurrentWeatherSnippetView: View {
    public let data: MCPGetCurrentWeatherOutput
    public init(data: MCPGetCurrentWeatherOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("temperature"); Spacer(); Text(String(describing: data.temperature)) }
            HStack { Text("feelsLike"); Spacer(); Text(String(describing: data.feelsLike)) }
            HStack { Text("humidity"); Spacer(); Text(String(describing: data.humidity)) }
            HStack { Text("weatherCode"); Spacer(); Text(String(describing: data.weatherCode)) }
            HStack { Text("weatherDescription"); Spacer(); Text(String(describing: data.weatherDescription)) }
            HStack { Text("windSpeed"); Spacer(); Text(String(describing: data.windSpeed)) }
            HStack { Text("windDirection"); Spacer(); Text(String(describing: data.windDirection)) }
            HStack { Text("precipitation"); Spacer(); Text(String(describing: data.precipitation)) }
            HStack { Text("cloudCover"); Spacer(); Text(String(describing: data.cloudCover)) }
            HStack { Text("units"); Spacer(); Text(String(describing: data.units)) }
        }
        .padding()
    }
}

// Snippet view for: get_file_info  (shape: list-string)
@available(macOS 26, iOS 26, *)
public struct MCPGetFileInfoSnippetView: View {
    public let data: MCPGetFileInfoOutput
    public init(data: MCPGetFileInfoOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.tags.enumerated()), id: \.offset) { _, row in
                Text(row)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: get_frontmost_app  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetFrontmostAppSnippetView: View {
    public let data: MCPGetFrontmostAppOutput
    public init(data: MCPGetFrontmostAppOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("name"); Spacer(); Text(String(describing: data.name)) }
            HStack { Text("bundleIdentifier"); Spacer(); Text(String(describing: data.bundleIdentifier)) }
            HStack { Text("pid"); Spacer(); Text(String(describing: data.pid)) }
        }
        .padding()
    }
}

// Snippet view for: get_shortcut_detail  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetShortcutDetailSnippetView: View {
    public let data: MCPGetShortcutDetailOutput
    public init(data: MCPGetShortcutDetailOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("shortcut"); Spacer(); Text(String(describing: data.shortcut)) }
            HStack { Text("detail"); Spacer(); Text(String(describing: data.detail)) }
        }
        .padding()
    }
}

// Snippet view for: get_unread_count  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPGetUnreadCountSnippetView: View {
    public let data: MCPGetUnreadCountOutput
    public init(data: MCPGetUnreadCountOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.mailboxes.enumerated()), id: \.offset) { _, row in
                Text(row.account)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: get_upcoming_events  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPGetUpcomingEventsSnippetView: View {
    public let data: MCPGetUpcomingEventsOutput
    public init(data: MCPGetUpcomingEventsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.events.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: get_volume  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetVolumeSnippetView: View {
    public let data: MCPGetVolumeOutput
    public init(data: MCPGetVolumeOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("outputVolume"); Spacer(); Text(String(describing: data.outputVolume)) }
            HStack { Text("inputVolume"); Spacer(); Text(String(describing: data.inputVolume)) }
            HStack { Text("outputMuted"); Spacer(); Text(String(describing: data.outputMuted)) }
        }
        .padding()
    }
}

// Snippet view for: list_accounts  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListAccountsSnippetView: View {
    public let data: MCPListAccountsOutput
    public init(data: MCPListAccountsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.accounts.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_bookmarks  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListBookmarksSnippetView: View {
    public let data: MCPListBookmarksOutput
    public init(data: MCPListBookmarksOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.bookmarks.enumerated()), id: \.offset) { _, row in
                Text(row.title)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_calendars  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListCalendarsSnippetView: View {
    public let data: MCPListCalendarsOutput
    public init(data: MCPListCalendarsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.calendars.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_chats  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListChatsSnippetView: View {
    public let data: MCPListChatsOutput
    public init(data: MCPListChatsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.chats.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_contacts  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListContactsSnippetView: View {
    public let data: MCPListContactsOutput
    public init(data: MCPListContactsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.contacts.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_directory  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListDirectorySnippetView: View {
    public let data: MCPListDirectoryOutput
    public init(data: MCPListDirectoryOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.items.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_events  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListEventsSnippetView: View {
    public let data: MCPListEventsOutput
    public init(data: MCPListEventsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.events.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_folders  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListFoldersSnippetView: View {
    public let data: MCPListFoldersOutput
    public init(data: MCPListFoldersOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.folders.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_group_members  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListGroupMembersSnippetView: View {
    public let data: MCPListGroupMembersOutput
    public init(data: MCPListGroupMembersOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.contacts.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_groups  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListGroupsSnippetView: View {
    public let data: MCPListGroupsOutput
    public init(data: MCPListGroupsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.groups.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_mailboxes  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListMailboxesSnippetView: View {
    public let data: MCPListMailboxesOutput
    public init(data: MCPListMailboxesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.mailboxes.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_messages  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListMessagesSnippetView: View {
    public let data: MCPListMessagesOutput
    public init(data: MCPListMessagesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.messages.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_notes  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListNotesSnippetView: View {
    public let data: MCPListNotesOutput
    public init(data: MCPListNotesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.notes.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_participants  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListParticipantsSnippetView: View {
    public let data: MCPListParticipantsOutput
    public init(data: MCPListParticipantsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.participants.enumerated()), id: \.offset) { _, row in
                Text("(row)")
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_playlists  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListPlaylistsSnippetView: View {
    public let data: MCPListPlaylistsOutput
    public init(data: MCPListPlaylistsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.playlists.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_reading_list  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListReadingListSnippetView: View {
    public let data: MCPListReadingListOutput
    public init(data: MCPListReadingListOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.items.enumerated()), id: \.offset) { _, row in
                Text(row.title)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_reminder_lists  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListReminderListsSnippetView: View {
    public let data: MCPListReminderListsOutput
    public init(data: MCPListReminderListsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.lists.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_reminders  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListRemindersSnippetView: View {
    public let data: MCPListRemindersOutput
    public init(data: MCPListRemindersOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.reminders.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_shortcuts  (shape: list-string)
@available(macOS 26, iOS 26, *)
public struct MCPListShortcutsSnippetView: View {
    public let data: MCPListShortcutsOutput
    public init(data: MCPListShortcutsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.shortcuts.enumerated()), id: \.offset) { _, row in
                Text(row)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_tabs  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListTabsSnippetView: View {
    public let data: MCPListTabsOutput
    public init(data: MCPListTabsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.tabs.enumerated()), id: \.offset) { _, row in
                Text(row.title)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_tracks  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListTracksSnippetView: View {
    public let data: MCPListTracksOutput
    public init(data: MCPListTracksOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.tracks.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: memory_query  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPMemoryQuerySnippetView: View {
    public let data: MCPMemoryQueryOutput
    public init(data: MCPMemoryQueryOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.entries.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: memory_stats  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPMemoryStatsSnippetView: View {
    public let data: MCPMemoryStatsOutput
    public init(data: MCPMemoryStatsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("total"); Spacer(); Text(String(describing: data.total)) }
            HStack { Text("byKind"); Spacer(); Text(String(describing: data.byKind)) }
            HStack { Text("oldest"); Spacer(); Text(String(describing: data.oldest)) }
            HStack { Text("newest"); Spacer(); Text(String(describing: data.newest)) }
            HStack { Text("expiredSwept"); Spacer(); Text(String(describing: data.expiredSwept)) }
            HStack { Text("path"); Spacer(); Text(String(describing: data.path)) }
        }
        .padding()
    }
}

// Snippet view for: now_playing  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPNowPlayingSnippetView: View {
    public let data: MCPNowPlayingOutput
    public init(data: MCPNowPlayingOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("playerState"); Spacer(); Text(String(describing: data.playerState)) }
            HStack { Text("track"); Spacer(); Text(String(describing: data.track)) }
        }
        .padding()
    }
}

// Snippet view for: proactive_context  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPProactiveContextSnippetView: View {
    public let data: MCPProactiveContextOutput
    public init(data: MCPProactiveContextOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("timeContext"); Spacer(); Text(String(describing: data.timeContext)) }
            HStack { Text("suggestedTools"); Spacer(); Text(String(describing: data.suggestedTools)) }
            HStack { Text("suggestedWorkflows"); Spacer(); Text(String(describing: data.suggestedWorkflows)) }
        }
        .padding()
    }
}

// Snippet view for: read_chat  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPReadChatSnippetView: View {
    public let data: MCPReadChatOutput
    public init(data: MCPReadChatOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.participants.enumerated()), id: \.offset) { _, row in
                Text("(row)")
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: read_contact  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPReadContactSnippetView: View {
    public let data: MCPReadContactOutput
    public init(data: MCPReadContactOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("id"); Spacer(); Text(String(describing: data.id)) }
            HStack { Text("name"); Spacer(); Text(String(describing: data.name)) }
            HStack { Text("firstName"); Spacer(); Text(String(describing: data.firstName)) }
            HStack { Text("lastName"); Spacer(); Text(String(describing: data.lastName)) }
            HStack { Text("organization"); Spacer(); Text(String(describing: data.organization)) }
            HStack { Text("jobTitle"); Spacer(); Text(String(describing: data.jobTitle)) }
            HStack { Text("department"); Spacer(); Text(String(describing: data.department)) }
            HStack { Text("note"); Spacer(); Text(String(describing: data.note)) }
            HStack { Text("emails"); Spacer(); Text(String(describing: data.emails)) }
            HStack { Text("phones"); Spacer(); Text(String(describing: data.phones)) }
            HStack { Text("addresses"); Spacer(); Text(String(describing: data.addresses)) }
        }
        .padding()
    }
}

// Snippet view for: read_event  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPReadEventSnippetView: View {
    public let data: MCPReadEventOutput
    public init(data: MCPReadEventOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.attendees.enumerated()), id: \.offset) { _, row in
                Text("(row)")
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: read_note  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPReadNoteSnippetView: View {
    public let data: MCPReadNoteOutput
    public init(data: MCPReadNoteOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("id"); Spacer(); Text(String(describing: data.id)) }
            HStack { Text("name"); Spacer(); Text(String(describing: data.name)) }
            HStack { Text("body"); Spacer(); Text(String(describing: data.body)) }
            HStack { Text("plaintext"); Spacer(); Text(String(describing: data.plaintext)) }
            HStack { Text("creationDate"); Spacer(); Text(String(describing: data.creationDate)) }
            HStack { Text("modificationDate"); Spacer(); Text(String(describing: data.modificationDate)) }
            HStack { Text("folder"); Spacer(); Text(String(describing: data.folder)) }
            HStack { Text("shared"); Spacer(); Text(String(describing: data.shared)) }
            HStack { Text("passwordProtected"); Spacer(); Text(String(describing: data.passwordProtected)) }
        }
        .padding()
    }
}

// Snippet view for: read_reminder  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPReadReminderSnippetView: View {
    public let data: MCPReadReminderOutput
    public init(data: MCPReadReminderOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text("id"); Spacer(); Text(String(describing: data.id)) }
            HStack { Text("name"); Spacer(); Text(String(describing: data.name)) }
            HStack { Text("body"); Spacer(); Text(String(describing: data.body)) }
            HStack { Text("completed"); Spacer(); Text(String(describing: data.completed)) }
            HStack { Text("completionDate"); Spacer(); Text(String(describing: data.completionDate)) }
            HStack { Text("creationDate"); Spacer(); Text(String(describing: data.creationDate)) }
            HStack { Text("modificationDate"); Spacer(); Text(String(describing: data.modificationDate)) }
            HStack { Text("dueDate"); Spacer(); Text(String(describing: data.dueDate)) }
            HStack { Text("priority"); Spacer(); Text(String(describing: data.priority)) }
            HStack { Text("flagged"); Spacer(); Text(String(describing: data.flagged)) }
            HStack { Text("list"); Spacer(); Text(String(describing: data.list)) }
        }
        .padding()
    }
}

// Snippet view for: search_chats  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchChatsSnippetView: View {
    public let data: MCPSearchChatsOutput
    public init(data: MCPSearchChatsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.chats.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_contacts  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchContactsSnippetView: View {
    public let data: MCPSearchContactsOutput
    public init(data: MCPSearchContactsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.contacts.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_events  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchEventsSnippetView: View {
    public let data: MCPSearchEventsOutput
    public init(data: MCPSearchEventsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.events.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_notes  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchNotesSnippetView: View {
    public let data: MCPSearchNotesOutput
    public init(data: MCPSearchNotesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.notes.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_reminders  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchRemindersSnippetView: View {
    public let data: MCPSearchRemindersOutput
    public init(data: MCPSearchRemindersOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.reminders.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_shortcuts  (shape: list-string)
@available(macOS 26, iOS 26, *)
public struct MCPSearchShortcutsSnippetView: View {
    public let data: MCPSearchShortcutsOutput
    public init(data: MCPSearchShortcutsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.shortcuts.enumerated()), id: \.offset) { _, row in
                Text(row)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: suggest_next_tools  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSuggestNextToolsSnippetView: View {
    public let data: MCPSuggestNextToolsOutput
    public init(data: MCPSuggestNextToolsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.suggestions.enumerated()), id: \.offset) { _, row in
                Text(row.tool)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: today_events  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPTodayEventsSnippetView: View {
    public let data: MCPTodayEventsOutput
    public init(data: MCPTodayEventsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.events.enumerated()), id: \.offset) { _, row in
                Text(row.id)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

#endif
