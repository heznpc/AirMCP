// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.2b.2 + A.4.1 — 230 auto-selected read-only
// tools (81 with typed drift-guards + Interactive Snippet
// SwiftUI views) + 9 AppShortcutsProvider entries.
// Run `npm run gen:intents` to refresh after tool metadata changes.
// CI guards against drift via `npm run gen:intents:check`.
//
// Router runtime is live as of PR #103 (A.2a): macOS app-owned HTTP with
// stdio fallback and iOS in-process MCPServer.callToolText. Every generated
// intent's `perform()` hits that router. Typed intents additionally decode
// the router's String result through JSONDecoder.
//
// Snippet views (§3.7) are SwiftUI View structs matching each typed
// output shape and typed intents already return them through
// `.result(value:, view:)` overloads. Kept in a separate #if so iOS 17
// builds stay green.

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
    public struct Verifiedfirstbreak: Codable, Sendable {
        public let file: String
        public let lineIndex: Double
        public let reason: String
    }

    public let since: String
    public let total: Double
    public let errors: Double
    public let errorRate: Double
    public let scannedFiles: Double
    public let topTools: [ToptoolsItem]
    public let verified: Bool
    public let verifiedFirstBreak: Verifiedfirstbreak?
    public let auditDisabled: Bool
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

// Output type for: get_battery_status
public struct MCPGetBatteryStatusOutput: Codable, Sendable {
    public let percentage: Int?
    public let charging: Bool
    public let source: String?
    public let timeRemaining: String?
    public let raw: String
}

// Output type for: get_brightness
public struct MCPGetBrightnessOutput: Codable, Sendable {
    public let brightness: Double?
    public let raw: String
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

// Output type for: get_photo_info
public struct MCPGetPhotoInfoOutput: Codable, Sendable {
    public let id: String
    public let filename: String?
    public let name: String?
    public let description: String?
    public let date: String?
    public let width: Double
    public let height: Double
    public let altitude: Double?
    public let location: [Double]?
    public let favorite: Bool
    public let keywords: [String]?
}

// Output type for: get_rating
public struct MCPGetRatingOutput: Codable, Sendable {
    public let name: String
    public let artist: String
    public let rating: Int
    public let favorited: Bool
    public let disliked: Bool
}

// Output type for: get_screen_info
public struct MCPGetScreenInfoOutput: Codable, Sendable {
    public struct DisplaysItem: Codable, Sendable {
        public let name: String
        public let resolution: String?
        public let pixelWidth: Int?
        public let pixelHeight: Int?
        public let retina: Bool
    }

    public let displays: [DisplaysItem]
}

// Output type for: get_shortcut_detail
public struct MCPGetShortcutDetailOutput: Codable, Sendable {
    public let shortcut: String
    public let detail: String
}

// Output type for: get_track_info
public struct MCPGetTrackInfoOutput: Codable, Sendable {
    public let id: Int
    public let name: String
    public let artist: String
    public let album: String
    public let albumArtist: String
    public let genre: String
    public let year: Int
    public let trackNumber: Int
    public let discNumber: Int
    public let duration: Double
    public let playedCount: Int
    public let rating: Int
    public let favorited: Bool
    public let disliked: Bool
    public let dateAdded: String?
    public let sampleRate: Int
    public let bitRate: Int
    public let size: Double
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

// Output type for: get_wifi_status
public struct MCPGetWifiStatusOutput: Codable, Sendable {
    public let ssid: String?
    public let bssid: String?
    public let signalStrength: Int?
    public let noiseLevel: Int?
    public let channel: String?
    public let connected: Bool
    public let raw: String
}

// Output type for: is_app_running
public struct MCPIsAppRunningOutput: Codable, Sendable {
    public let running: Bool
    public let name: String
    public let bundleIdentifier: String?
    public let pid: Int?
    public let visible: Bool?
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

// Output type for: list_all_windows
public struct MCPListAllWindowsOutput: Codable, Sendable {
    public struct WindowsItem: Codable, Sendable {
        public let app: String
        public let pid: Int
        public let title: String
        public let position: [Double]?
        public let size: [Double]?
        public let minimized: Bool
    }

    public let total: Int
    public let windows: [WindowsItem]
}

// Output type for: list_bluetooth_devices
public struct MCPListBluetoothDevicesOutput: Codable, Sendable {
    public struct DevicesItem: Codable, Sendable {
        public let name: String
        public let connected: Bool
        public let address: String?
        public let type: String?
    }

    public let total: Int
    public let devices: [DevicesItem]
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

// Output type for: list_favorites
public struct MCPListFavoritesOutput: Codable, Sendable {
    public struct PhotosItem: Codable, Sendable {
        public let id: String
        public let filename: String?
        public let name: String?
        public let date: String?
        public let width: Double
        public let height: Double
        public let favorite: Bool
    }

    public let total: Double
    public let returned: Double
    public let photos: [PhotosItem]
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

// Output type for: list_photos
public struct MCPListPhotosOutput: Codable, Sendable {
    public struct PhotosItem: Codable, Sendable {
        public let id: String
        public let filename: String?
        public let name: String?
        public let date: String?
        public let width: Double
        public let height: Double
        public let favorite: Bool
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let photos: [PhotosItem]
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

// Output type for: list_profiles
public struct MCPListProfilesOutput: Codable, Sendable {
    public struct ProfilesItem: Codable, Sendable {
        public let name: String
        public let description: String
        public let modules: [String]
        public let defaultToolExposure: String
    }

    public let profiles: [ProfilesItem]
    public let active: String
    public let toolExposure: String
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

// Output type for: list_running_apps
public struct MCPListRunningAppsOutput: Codable, Sendable {
    public struct AppsItem: Codable, Sendable {
        public let name: String
        public let bundleIdentifier: String
        public let pid: Int
        public let visible: Bool
    }

    public let total: Int
    public let apps: [AppsItem]
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

// Output type for: memory_put
public struct MCPMemoryPutOutput: Codable, Sendable {
    public struct Stored: Codable, Sendable {
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

    public let stored: Stored
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
    public struct Track: Codable, Sendable {
        public let name: String
        public let artist: String
        public let album: String
        public let duration: Double
        public let playerPosition: Double
    }

    public let playerState: String
    public let track: Track?
}

// Output type for: numbers_list_documents
public struct MCPNumbersListDocumentsOutput: Codable, Sendable {
    public struct DocumentsItem: Codable, Sendable {
        public let name: String
        public let path: String?
        public let modified: Bool
    }

    public let documents: [DocumentsItem]
}

// Output type for: numbers_list_sheets
public struct MCPNumbersListSheetsOutput: Codable, Sendable {
    public struct SheetsItem: Codable, Sendable {
        public let name: String
        public let tableCount: Int
    }

    public let sheets: [SheetsItem]
}

// Output type for: numbers_list_tables
public struct MCPNumbersListTablesOutput: Codable, Sendable {
    public struct TablesItem: Codable, Sendable {
        public let name: String
        public let rowCount: Int
        public let columnCount: Int
    }

    public let tables: [TablesItem]
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

// Output type for: profile_status
public struct MCPProfileStatusOutput: Codable, Sendable {
    public let profile: String
    public let toolExposure: String
    public let modulesEnabled: [String]
    public let modulesDisabled: [String]
    public let toolsExposed: Double
    public let toolsRegistered: Double
    public let toolSessionsActive: Double
    public let frontDoorTools: [String]
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

// Output type for: read_message
public struct MCPReadMessageOutput: Codable, Sendable {
    public struct ToItem: Codable, Sendable {
        public let name: String?
        public let address: String?
    }
    public struct CcItem: Codable, Sendable {
        public let name: String?
        public let address: String?
    }

    public let id: String
    public let subject: String
    public let sender: String
    public let to: [ToItem]
    public let cc: [CcItem]
    public let dateReceived: String
    public let dateSent: String?
    public let read: Bool
    public let flagged: Bool
    public let content: String
    public let mailbox: String
    public let account: String
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

// Output type for: read_page_content
public struct MCPReadPageContentOutput: Codable, Sendable {
    public let title: String
    public let url: String
    public let content: String
    public let truncated: Bool
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

// Output type for: recent_files
public struct MCPRecentFilesOutput: Codable, Sendable {
    public struct FilesItem: Codable, Sendable {
        public let path: String
        public let name: String
    }

    public let total: Double
    public let files: [FilesItem]
}

// Output type for: scan_notes
public struct MCPScanNotesOutput: Codable, Sendable {
    public struct NotesItem: Codable, Sendable {
        public let id: String
        public let name: String
        public let folder: String
        public let creationDate: String
        public let modificationDate: String
        public let preview: String
        public let charCount: Double
        public let shared: Bool
    }

    public let total: Double
    public let offset: Double
    public let returned: Double
    public let notes: [NotesItem]
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

// Output type for: search_files
public struct MCPSearchFilesOutput: Codable, Sendable {
    public struct FilesItem: Codable, Sendable {
        public let path: String
        public let name: String
        public let size: Double?
        public let modificationDate: String?
    }

    public let total: Double
    public let files: [FilesItem]
}

// Output type for: search_messages
public struct MCPSearchMessagesOutput: Codable, Sendable {
    public struct MessagesItem: Codable, Sendable {
        public let id: String
        public let subject: String
        public let sender: String
        public let dateReceived: String?
        public let read: Bool
    }

    public let returned: Double
    public let messages: [MessagesItem]
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

// Output type for: search_photos
public struct MCPSearchPhotosOutput: Codable, Sendable {
    public struct PhotosItem: Codable, Sendable {
        public let id: String
        public let filename: String?
        public let name: String?
        public let date: String?
        public let favorite: Bool
        public let description: String?
    }

    public let total: Double
    public let photos: [PhotosItem]
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

// Output type for: search_tabs
public struct MCPSearchTabsOutput: Codable, Sendable {
    public struct TabsItem: Codable, Sendable {
        public let windowIndex: Double
        public let tabIndex: Double
        public let title: String
        public let url: String
    }

    public let returned: Double
    public let tabs: [TabsItem]
}

// Output type for: search_tracks
public struct MCPSearchTracksOutput: Codable, Sendable {
    public struct TracksItem: Codable, Sendable {
        public let id: Int
        public let name: String
        public let artist: String
        public let album: String
        public let duration: Double
    }

    public let total: Int
    public let returned: Int
    public let tracks: [TracksItem]
}

// Output type for: set_clipboard
public struct MCPSetClipboardOutput: Codable, Sendable {
    public let set: Bool
    public let length: Double
}

// Output type for: set_volume
public struct MCPSetVolumeOutput: Codable, Sendable {
    public let outputVolume: Double
    public let outputMuted: Bool
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

// Output type for: toggle_dark_mode
public struct MCPToggleDarkModeOutput: Codable, Sendable {
    public let darkMode: Bool
}

// MARK: - AppEnum types

@available(iOS 16, macOS 13, *)
public enum AuditLogStatusOption: String, AppEnum {
    case ok, error
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Filter by status. Omit to include both."
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .ok: "Ok",
        .error: "Error"
    ]
}

@available(iOS 16, macOS 13, *)
public enum GetDirectionsTransporttypeOption: String, AppEnum {
    case driving, walking, transit
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Mode of transport (default: driving)"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .driving: "Driving",
        .walking: "Walking",
        .transit: "Transit"
    ]
}

@available(iOS 16, macOS 13, *)
public enum GwsGmailReadFormatOption: String, AppEnum {
    case full, metadata, minimal
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Response format"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .full: "Full",
        .metadata: "Metadata",
        .minimal: "Minimal"
    ]
}

@available(iOS 16, macOS 13, *)
public enum MemoryPutKindOption: String, AppEnum {
    case fact, entity, episode
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Entry category: fact | entity | episode"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .fact: "Fact",
        .entity: "Entity",
        .episode: "Episode"
    ]
}

@available(iOS 16, macOS 13, *)
public enum MemoryQueryKindOption: String, AppEnum {
    case fact, entity, episode
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Restrict to one kind"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .fact: "Fact",
        .entity: "Entity",
        .episode: "Episode"
    ]
}

@available(iOS 16, macOS 13, *)
public enum MemoryQueryOrderOption: String, AppEnum {
    case desc, asc
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Sort by updatedAt (default desc)"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .desc: "Desc",
        .asc: "Asc"
    ]
}

@available(iOS 16, macOS 13, *)
public enum PlaybackControlActionOption: String, AppEnum {
    case play, pause, nextTrack, previousTrack
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Playback action"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .play: "Play",
        .pause: "Pause",
        .nextTrack: "Next Track",
        .previousTrack: "Previous Track"
    ]
}

@available(iOS 16, macOS 13, *)
public enum PodcastPlaybackControlActionOption: String, AppEnum {
    case play, pause, nextTrack, previousTrack
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Playback action"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .play: "Play",
        .pause: "Pause",
        .nextTrack: "Next Track",
        .previousTrack: "Previous Track"
    ]
}

@available(iOS 16, macOS 13, *)
public enum QueryPhotosMediatypeOption: String, AppEnum {
    case image, video, audio
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Filter by media type"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .image: "Image",
        .video: "Video",
        .audio: "Audio"
    ]
}

@available(iOS 16, macOS 13, *)
public enum RewriteTextToneOption: String, AppEnum {
    case professional, friendly, concise
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Target tone (default: professional)"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .professional: "Professional",
        .friendly: "Friendly",
        .concise: "Concise"
    ]
}

@available(iOS 16, macOS 13, *)
public enum SetShuffleSongrepeatOption: String, AppEnum {
    case off, one, all
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Repeat mode"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .off: "Off",
        .one: "One",
        .all: "All"
    ]
}

@available(iOS 16, macOS 13, *)
public enum TvPlaybackControlActionOption: String, AppEnum {
    case play, pause, nextTrack, previousTrack
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Playback action"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .play: "Play",
        .pause: "Pause",
        .nextTrack: "Next Track",
        .previousTrack: "Previous Track"
    ]
}

@available(iOS 16, macOS 13, *)
public enum UiScrollDirectionOption: String, AppEnum {
    case up, down, left, right
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scroll direction"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .up: "Up",
        .down: "Down",
        .left: "Left",
        .right: "Right"
    ]
}

// MARK: - AppIntents

// Tool: activate_tab
public struct ActivateTabIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Activate Tab"
    nonisolated(unsafe) public static var description = IntentDescription("Switch to a specific Safari tab. Use list_tabs to find window/tab indices.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Window index (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var windowIndex: Int

    @Parameter(title: "Tab index", inclusiveRange: (0, 9007199254740991))
    public var tabIndex: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "activate_tab",
            args: ["windowIndex": windowIndex, "tabIndex": tabIndex]
        )
        return .result(value: result)
    }
}

// Tool: add_contact_email
@available(iOS 18, macOS 15, *)
public struct AddContactEmailIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add Contact Email"
    nonisolated(unsafe) public static var description = IntentDescription("Add an email address to an existing contact.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Contact ID")
    public var id: AirMCPContactEntity

    @Parameter(title: "Email address to add")
    public var email: String

    @Parameter(title: "Email label (default: work)", default: "work")
    public var label: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["id"] = try requireResolvedAirMCPEntityId(id, tool: "add_contact_email")
        args["email"] = email
        args["label"] = label
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add Contact Email with AirMCP? Add an email address to an existing contact.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "add_contact_email",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: add_contact_phone
@available(iOS 18, macOS 15, *)
public struct AddContactPhoneIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add Contact Phone"
    nonisolated(unsafe) public static var description = IntentDescription("Add a phone number to an existing contact.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Contact ID")
    public var id: AirMCPContactEntity

    @Parameter(title: "Phone number to add")
    public var phone: String

    @Parameter(title: "Phone label (default: mobile)", default: "mobile")
    public var label: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["id"] = try requireResolvedAirMCPEntityId(id, tool: "add_contact_phone")
        args["phone"] = phone
        args["label"] = label
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add Contact Phone with AirMCP? Add a phone number to an existing contact.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "add_contact_phone",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: add_to_album
@available(iOS 18, macOS 15, *)
public struct AddToAlbumIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add Photos to Album"
    nonisolated(unsafe) public static var description = IntentDescription("Add photos to an existing album by photo IDs and album name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Array of photo media item IDs (max 500)")
    public var photoIds: [String]

    @Parameter(title: "Target album name")
    public var albumName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add Photos to Album with AirMCP? Add photos to an existing album by photo IDs and album name.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "add_to_album",
            args: ["photoIds": photoIds, "albumName": albumName]
        )
        return .result(value: result)
    }
}

// Tool: add_to_playlist
@available(iOS 18, macOS 15, *)
public struct AddToPlaylistIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add to Playlist"
    nonisolated(unsafe) public static var description = IntentDescription("Add a track to an existing playlist.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playlist name")
    public var playlistName: String

    @Parameter(title: "Track name to add")
    public var trackName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add to Playlist with AirMCP? Add a track to an existing playlist.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "add_to_playlist",
            args: ["playlistName": playlistName, "trackName": trackName]
        )
        return .result(value: result)
    }
}

// Tool: ai_agent
public struct AiAgentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "On-Device AI Agent (read-only)"
    nonisolated(unsafe) public static var description = IntentDescription("Run a prompt through Apple's on-device Foundation Models with read-only access to AirMCP data (today's events, due reminders, contacts search). The on-device LLM autonomously decides which read tool to call. Requires macOS 26+ with Apple Silicon. Write actions (create/update/delete) are intentionally NOT exposed — the agent's tool calls bypass the Node-side toolRegistry (no HITL, rate-limit, or audit), so writes belong to direct MCP tool calls instead.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "What you want the on-device AI to do with your Apple data")
    public var prompt: String

    @Parameter(title: "Optional system instruction for the AI agent")
    public var systemInstruction: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["prompt"] = prompt
        if let v = systemInstruction { args["systemInstruction"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "ai_agent",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ai_chat
public struct AiChatIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "AI Chat"
    nonisolated(unsafe) public static var description = IntentDescription("Send a message to an on-device AI session using Apple Foundation Models. Note: each call creates a fresh session — sessionName is for caller-side tracking only, not server-side persistence. Requires macOS 26+.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name for this chat session (use same name to continue a conversation)")
    public var sessionName: String

    @Parameter(title: "The message to send to the AI")
    public var message: String

    @Parameter(title: "Optional system instruction for this session")
    public var systemInstruction: String?

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Run a sample of planner goals against the on-device Foundation Model and report the aggregate score. Useful after macOS / Apple Intelligence updates to catch planner regressions. Requires macOS 26+ with Apple Silicon. Each case makes one model call, so keep `limit` small for interactive use.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Number of cases to sample from GOLDEN_PLANS (default: 5, max: 50).", default: 5, inclusiveRange: (1, 50))
    public var limit: Int

    @Parameter(title: "Deterministic seed for case selection (default: time-based). Fixing this is usef", inclusiveRange: (-9007199254740991, 9007199254740991))
    public var seed: Int?

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPAiPlanMetricsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPAiPlanMetricsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: ai_status
public struct AiStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "AI Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check availability and status of Apple's on-device Foundation Models. Returns whether the model is available, macOS version, and Apple Silicon status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Query the on-device audit log of tool calls. Reads JSONL rows from ~/.airmcp/audit.jsonl (+ rotated siblings) and returns recent entries newest-first with optional filters by tool / status / time window. Args are already PII-scrubbed at write-time; sensitive-tool entries have `_redacted` args.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Lower-bound ISO 8601 timestamp. Entries older than this are dropped. Defaults to")
    public var since: Date?

    @Parameter(title: "Filter to a single tool name (exact match).")
    public var tool: String?

    @Parameter(title: "Filter by status. Omit to include both.")
    public var status: AuditLogStatusOption?

    @Parameter(title: "Max entries to return (default: 100, max: 1000).", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = since { args["since"] = ISO8601DateFormatter().string(from: v) }
        if let v = tool { args["tool"] = v }
        if let v = status { args["status"] = v.rawValue }
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
    nonisolated(unsafe) public static var description = IntentDescription("Aggregate the audit log over a time window — total call count, error rate, and the busiest tools. Useful for weekly reviews and for spotting runaway agents (a sudden top-of-leaderboard `create_*` tool is a red flag).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Lower-bound ISO 8601 timestamp. Defaults to 7 days ago.")
    public var since: Date?

    @Parameter(title: "Top-N busiest tools (default: 10).", default: 10, inclusiveRange: (1, 50))
    public var topN: Int

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPAuditSummaryOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPAuditSummarySnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
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

// Tool: capture_area
@available(iOS 18, macOS 15, *)
public struct CaptureAreaIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Capture Screen Area"
    nonisolated(unsafe) public static var description = IntentDescription("Capture a screenshot of a specific rectangular region of the screen. Coordinates are in screen pixels with origin at top-left. Requires Screen Recording permission.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "X coordinate of the top-left corner of the capture region")
    public var x: Double

    @Parameter(title: "Y coordinate of the top-left corner of the capture region")
    public var y: Double

    @Parameter(title: "Width of the capture region in pixels")
    public var width: Double

    @Parameter(title: "Height of the capture region in pixels")
    public var height: Double

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Capture Screen Area with AirMCP? Capture a screenshot of a specific rectangular region of the screen. Coordinates are in screen pixels with origin at top-left. Requires Screen Recording permission.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "capture_area",
            args: ["x": x, "y": y, "width": width, "height": height]
        )
        return .result(value: result)
    }
}

// Tool: capture_screen
@available(iOS 18, macOS 15, *)
public struct CaptureScreenIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Capture Screen"
    nonisolated(unsafe) public static var description = IntentDescription("Capture a full-screen screenshot as a PNG image. Optionally specify a display number for multi-monitor setups (1 = main display). Requires Screen Recording permission.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Display number for multi-monitor setups (1 = main display). Omit for default dis", inclusiveRange: (1, 9007199254740991))
    public var display: Int?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = display { args["display"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Capture Screen with AirMCP? Capture a full-screen screenshot as a PNG image. Optionally specify a display number for multi-monitor setups (1 = main display). Requires Screen Recording permission.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "capture_screen",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: capture_window
@available(iOS 18, macOS 15, *)
public struct CaptureWindowIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Capture Window"
    nonisolated(unsafe) public static var description = IntentDescription("Capture a screenshot of the frontmost window. Optionally specify an app name to activate that app first and capture its window. Requires Screen Recording permission.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name to activate before capture (e.g. 'Safari', 'Xcode'). If omitted")
    public var appName: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = appName { args["appName"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Capture Window with AirMCP? Capture a screenshot of the frontmost window. Optionally specify an app name to activate that app first and capture its window. Requires Screen Recording permission.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "capture_window",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: classify_image
public struct ClassifyImageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Classify Image"
    nonisolated(unsafe) public static var description = IntentDescription("Classify an image using Apple Vision framework. Returns labels with confidence scores (e.g. 'dog', 'outdoor', 'food'). Works on any image file. Requires Swift bridge.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the image file")
    public var imagePath: String

    @Parameter(title: "Max labels (default: 10)", default: 10, inclusiveRange: (1, 50))
    public var maxResults: Int

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Check iCloud sync status — see what usage data and config is synced across your Apple devices.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Retrieve full plaintext content of 2-5 notes at once for comparison. Use this after scan_notes to safely compare potentially duplicate or similar notes before deciding what to keep, merge, or delete.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Array of 2-5 note IDs to compare")
    public var ids: [String]

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "compare_notes",
            args: ["ids": ids]
        )
        return .result(value: result)
    }
}

// Tool: complete_reminder
@available(iOS 18, macOS 15, *)
public struct CompleteReminderIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Complete Reminder"
    nonisolated(unsafe) public static var description = IntentDescription("Mark a reminder as completed or un-complete it.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Reminder ID")
    public var id: AirMCPReminderEntity

    @Parameter(title: "Set to true to complete, false to un-complete (default: true)", default: true)
    public var completed: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["id"] = try requireResolvedAirMCPEntityId(id, tool: "complete_reminder")
        args["completed"] = completed
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Complete Reminder with AirMCP? Mark a reminder as completed or un-complete it.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "complete_reminder",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: connect_bluetooth
public struct ConnectBluetoothIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Connect Bluetooth"
    nonisolated(unsafe) public static var description = IntentDescription("Connect to a BLE device by its UUID. The UUID can be obtained from scan_bluetooth results. Note: the connection persists only while the server process is running.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Peripheral UUID from scan results")
    public var identifier: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "connect_bluetooth",
            args: ["identifier": identifier]
        )
        return .result(value: result)
    }
}

// Tool: create_album
@available(iOS 18, macOS 15, *)
public struct CreateAlbumIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Album"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new photo album.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Album name")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Album with AirMCP? Create a new photo album.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_album",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: create_contact
@available(iOS 18, macOS 15, *)
public struct CreateContactIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Contact"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new contact with name and optional email, phone, organization.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "First name")
    public var firstName: String

    @Parameter(title: "Last name")
    public var lastName: String

    @Parameter(title: "Email address")
    public var email: String?

    @Parameter(title: "Phone number")
    public var phone: String?

    @Parameter(title: "Company/organization")
    public var organization: String?

    @Parameter(title: "Job title")
    public var jobTitle: String?

    @Parameter(title: "Notes")
    public var note: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["firstName"] = firstName
        args["lastName"] = lastName
        if let v = email { args["email"] = v }
        if let v = phone { args["phone"] = v }
        if let v = organization { args["organization"] = v }
        if let v = jobTitle { args["jobTitle"] = v }
        if let v = note { args["note"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Contact with AirMCP? Create a new contact with name and optional email, phone, organization.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_contact",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: create_directory
@available(iOS 18, macOS 15, *)
public struct CreateDirectoryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Directory"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new directory (and intermediate directories if needed).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path of the folder to create")
    public var path: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Directory with AirMCP? Create a new directory (and intermediate directories if needed).")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_directory",
            args: ["path": path]
        )
        return .result(value: result)
    }
}

// Tool: create_event
@available(iOS 18, macOS 15, *)
public struct CreateEventIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Event"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new calendar event. Recurring events cannot be created via automation. Attendees cannot be added programmatically.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Event title")
    public var summary: String

    @Parameter(title: "Start date/time (ISO 8601, e.g. '2026-03-15T09:00:00Z')")
    public var startDate: String

    @Parameter(title: "End date/time (ISO 8601, e.g. '2026-03-15T10:00:00Z')")
    public var endDate: String

    @Parameter(title: "Event location")
    public var location: String?

    @Parameter(title: "Event notes/description")
    public var description: String?

    @Parameter(title: "Target calendar name. Defaults to first writable calendar.")
    public var calendar: String?

    @Parameter(title: "Set as all-day event")
    public var allDay: Bool?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["summary"] = summary
        args["startDate"] = startDate
        args["endDate"] = endDate
        if let v = location { args["location"] = v }
        if let v = description { args["description"] = v }
        if let v = calendar { args["calendar"] = v }
        if let v = allDay { args["allDay"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Event with AirMCP? Create a new calendar event. Recurring events cannot be created via automation. Attendees cannot be added programmatically.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_event",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: create_folder
@available(iOS 18, macOS 15, *)
public struct CreateFolderIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Folder"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new folder in Apple Notes — a non-destructive write. Optionally specify which account to create it in.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Folder name")
    public var name: String

    @Parameter(title: "Account name (e.g. 'iCloud'). Defaults to primary account.")
    public var account: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["name"] = name
        if let v = account { args["account"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Folder with AirMCP? Create a new folder in Apple Notes — a non-destructive write. Optionally specify which account to create it in.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_folder",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: create_note
@available(iOS 18, macOS 15, *)
public struct CreateNoteIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Note"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new note with HTML body. The first line of the body becomes the note title automatically. Optionally specify a target folder.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Note content in HTML (e.g. '<h1>Title</h1><p>Body text</p>')")
    public var body: String

    @Parameter(title: "Target folder name")
    public var folder: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["body"] = body
        if let v = folder { args["folder"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Note with AirMCP? Create a new note with HTML body. The first line of the body becomes the note title automatically. Optionally specify a target folder.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_note",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: create_playlist
@available(iOS 18, macOS 15, *)
public struct CreatePlaylistIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Playlist"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new playlist in Music.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name for the new playlist")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Playlist with AirMCP? Create a new playlist in Music.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_playlist",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: create_reminder
@available(iOS 18, macOS 15, *)
public struct CreateReminderIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Reminder"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new reminder. Optionally set notes, due date, priority (0=none, 1-4=high, 5=medium, 6-9=low), and target list. Recurrence rules cannot be set via automation.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Reminder title")
    public var title: String

    @Parameter(title: "Notes/body text")
    public var body: String?

    @Parameter(title: "Due date in ISO 8601 format (e.g. '2026-03-15T10:00:00Z')")
    public var dueDate: String?

    @Parameter(title: "Priority: 0=none, 1-4=high, 5=medium, 6-9=low", inclusiveRange: (0, 9))
    public var priority: Int?

    @Parameter(title: "Target list name. Defaults to the default list.")
    public var list: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["title"] = title
        if let v = body { args["body"] = v }
        if let v = dueDate { args["dueDate"] = v }
        if let v = priority { args["priority"] = v }
        if let v = list { args["list"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Reminder with AirMCP? Create a new reminder. Optionally set notes, due date, priority (0=none, 1-4=high, 5=medium, 6-9=low), and target list. Recurrence rules cannot be set via automation.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_reminder",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: create_reminder_list
@available(iOS 18, macOS 15, *)
public struct CreateReminderListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Reminder List"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new reminder list.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name for the new list")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Reminder List with AirMCP? Create a new reminder list.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_reminder_list",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: create_shortcut
@available(iOS 18, macOS 15, *)
public struct CreateShortcutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Shortcut"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new empty Siri Shortcut by name — drives the Shortcuts app via UI automation (needs Accessibility permission; the app opens and takes focus). The shortcut must be further configured in the Shortcuts app.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name for the new shortcut")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Shortcut with AirMCP? Create a new empty Siri Shortcut by name — drives the Shortcuts app via UI automation (needs Accessibility permission; the app opens and takes focus). The shortcut must be further configur…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "create_shortcut",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: disconnect_bluetooth
public struct DisconnectBluetoothIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Disconnect Bluetooth"
    nonisolated(unsafe) public static var description = IntentDescription("Disconnect a BLE device by its UUID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Peripheral UUID to disconnect")
    public var identifier: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "disconnect_bluetooth",
            args: ["identifier": identifier]
        )
        return .result(value: result)
    }
}

// Tool: discover_tools
public struct DiscoverToolsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Discover Tools"
    nonisolated(unsafe) public static var description = IntentDescription("Search available tools by keyword. Returns matching tools with descriptions. Use this instead of scanning all 250+ tools — describe what you need and get relevant tools.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search query — e.g. 'calendar', 'send email', 'music playback'")
    public var query: String

    @Parameter(title: "Max results (default 20)", inclusiveRange: (1, 50))
    public var limit: Double?

    @Parameter(title: "Optional task-scoped tool session id; limits matches to the session allowlist")
    public var sessionId: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["query"] = query
        if let v = limit { args["limit"] = v }
        if let v = sessionId { args["sessionId"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "discover_tools",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "discover_tools", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPDiscoverToolsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPDiscoverToolsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: drop_pin
public struct DropPinIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Drop Pin"
    nonisolated(unsafe) public static var description = IntentDescription("Drop a pin at specific coordinates in Apple Maps.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate (degrees, -90 to 90)", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate (degrees, -180 to 180)", inclusiveRange: (-180, 180))
    public var longitude: Double

    @Parameter(title: "Optional label for the pin")
    public var label: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["latitude"] = latitude
        args["longitude"] = longitude
        if let v = label { args["label"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "drop_pin",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: duplicate_shortcut
@available(iOS 18, macOS 15, *)
public struct DuplicateShortcutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Duplicate Shortcut"
    nonisolated(unsafe) public static var description = IntentDescription("Duplicate an existing Siri Shortcut. Exports the shortcut to a temporary file and re-imports it with a new name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Name of the shortcut to duplicate (exact match)")
    public var name: String

    @Parameter(title: "Name for the duplicated shortcut")
    public var newName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Duplicate Shortcut with AirMCP? Duplicate an existing Siri Shortcut. Exports the shortcut to a temporary file and re-imports it with a new name.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "duplicate_shortcut",
            args: ["name": name, "newName": newName]
        )
        return .result(value: result)
    }
}

// Tool: edit_shortcut
@available(iOS 18, macOS 15, *)
public struct EditShortcutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Edit Shortcut"
    nonisolated(unsafe) public static var description = IntentDescription("Open a Siri Shortcut in the Shortcuts app for manual editing. Uses UI automation (System Events) to activate the app, search for the shortcut, and open it. The user can then edit the shortcut in the Shortcuts app UI.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Shortcut name to edit (exact match)")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Edit Shortcut with AirMCP? Open a Siri Shortcut in the Shortcuts app for manual editing. Uses UI automation (System Events) to activate the app, search for the shortcut, and open it. The user can then edit the shortcu…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "edit_shortcut",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: event_status
public struct EventStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Event Monitor Status"
    nonisolated(unsafe) public static var description = IntentDescription("Check if real-time event monitoring is active.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Start real-time monitoring of Apple data changes: calendar, reminders, clipboard, mail unread count, focus mode, now-playing track, and watched file paths. Native observers (calendar/reminders/clipboard/focus/files) are pushed from the Swift bridge; mail and now-playing are polled. Requires the Swift bridge in persistent mode for the native observers.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "event_subscribe",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: export_shortcut
@available(iOS 18, macOS 15, *)
public struct ExportShortcutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Export Shortcut"
    nonisolated(unsafe) public static var description = IntentDescription("Export a Siri Shortcut to a .shortcut file. Uses the macOS shortcuts CLI to save the shortcut to the specified output path.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Shortcut name to export (exact match)")
    public var name: String

    @Parameter(title: "File path to export the .shortcut file to (e.g. ~/Desktop/MyShortcut.shortcut)")
    public var outputPath: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Export Shortcut with AirMCP? Export a Siri Shortcut to a .shortcut file. Uses the macOS shortcuts CLI to save the shortcut to the specified output path.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "export_shortcut",
            args: ["name": name, "outputPath": outputPath]
        )
        return .result(value: result)
    }
}

// Tool: find_related
public struct FindRelatedIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Find Related Items"
    nonisolated(unsafe) public static var description = IntentDescription("Find items semantically related to a note, event, reminder, or email ID across indexed Apple apps — read-only; requires semantic_index to be built first. Discovers cross-app connections (e.g., a calendar event related to notes and reminders about the same topic).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Item ID (as stored in the vector index)")
    public var id: String

    @Parameter(title: "Max results (default 10)", inclusiveRange: (1, 50))
    public var limit: Int?

    @Parameter(title: "Minimum similarity (default 0.6)", inclusiveRange: (0, 1))
    public var threshold: Double?

    @MainActor
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

// Tool: flag_message
@available(iOS 18, macOS 15, *)
public struct FlagMessageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Flag Message"
    nonisolated(unsafe) public static var description = IntentDescription("Flag or unflag an email message.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Message ID")
    public var id: String

    @Parameter(title: "true=flag, false=unflag (default: true)", default: true)
    public var flagged: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Flag Message with AirMCP? Flag or unflag an email message.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "flag_message",
            args: ["id": id, "flagged": flagged]
        )
        return .result(value: result)
    }
}

// Tool: generate_plan
public struct GeneratePlanIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Generate Plan"
    nonisolated(unsafe) public static var description = IntentDescription("Use Apple's on-device Foundation Model to analyze a goal and generate a suggested plan of AirMCP tool calls. Returns a JSON array of planned actions for the CALLER to review and execute — this tool does NOT execute anything itself. Requires macOS 26+. Works completely offline with no API keys.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "What you want to accomplish (e.g. 'organize my day', 'prepare for meeting')")
    public var goal: String

    @Parameter(title: "Additional context (max 10K chars, e.g. snapshot text, recent events)")
    public var context: String?

    @Parameter(title: "List of available tool names to plan with. Defaults to common tools.")
    public var availableTools: [String]?

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Generate text using Apple's on-device Foundation Model with custom system instructions. Runs entirely on-device via Apple Silicon. Requires macOS 26+.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The user prompt / instruction for text generation")
    public var prompt: String

    @Parameter(title: "Optional system instruction to guide the model's behavior")
    public var systemInstruction: String?

    @Parameter(title: "Sampling temperature (0-2). Lower = more deterministic", inclusiveRange: (0, 2))
    public var temperature: Double?

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Convert a place name or address to geographic coordinates. Returns up to 5 matching locations with latitude, longitude, country, and timezone.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Place name or address (e.g. 'Seoul', 'Tokyo Tower', '1600 Pennsylvania Ave')")
    public var query: String

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Get battery percentage, charging state, power source, and estimated time remaining.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_battery_status",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_battery_status", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetBatteryStatusOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetBatteryStatusSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_bluetooth_state
public struct GetBluetoothStateIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Bluetooth State"
    nonisolated(unsafe) public static var description = IntentDescription("Check whether Bluetooth is powered on, off, or unauthorized.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_brightness",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_brightness", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetBrightnessOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetBrightnessSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_clipboard
@available(iOS 18, macOS 15, *)
public struct GetClipboardIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Clipboard"
    nonisolated(unsafe) public static var description = IntentDescription("Read the current text content of the system clipboard.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Get Clipboard with AirMCP? Read the current text content of the system clipboard.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_clipboard",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_clipboard", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetClipboardOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetClipboardSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_current_location
@available(iOS 18, macOS 15, *)
public struct GetCurrentLocationIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Current Location"
    nonisolated(unsafe) public static var description = IntentDescription("Get the device's current geographic location (latitude, longitude, altitude). Requires Location Services permission. First use triggers a macOS permission dialog.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Get Current Location with AirMCP? Get the device's current geographic location (latitude, longitude, altitude). Requires Location Services permission. First use triggers a macOS permission dialog.")
        )
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_current_tab",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_current_tab", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetCurrentTabOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetCurrentTabSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_current_weather",
            args: ["latitude": latitude, "longitude": longitude]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_current_weather", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetCurrentWeatherOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetCurrentWeatherSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_daily_forecast",
            args: ["latitude": latitude, "longitude": longitude, "days": days]
        )
        return .result(value: result)
    }
}

// Tool: get_directions
public struct GetDirectionsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Directions"
    nonisolated(unsafe) public static var description = IntentDescription("Get directions between two locations in Apple Maps.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Starting location or address")
    public var from: String

    @Parameter(title: "Destination location or address")
    public var to: String

    @Parameter(title: "Mode of transport (default: driving)", default: .driving)
    public var transportType: GetDirectionsTransporttypeOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_directions",
            args: ["from": from, "to": to, "transportType": transportType.rawValue]
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_file_info",
            args: ["path": path]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_file_info", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetFileInfoOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetFileInfoSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_frontmost_app
public struct GetFrontmostAppIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Frontmost App"
    nonisolated(unsafe) public static var description = IntentDescription("Get the name, bundle identifier, and PID of the currently active (frontmost) application.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_frontmost_app",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_frontmost_app", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetFrontmostAppOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetFrontmostAppSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_hourly_forecast
public struct GetHourlyForecastIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Hourly Forecast"
    nonisolated(unsafe) public static var description = IntentDescription("Get the hour-by-hour weather forecast (temperature, precipitation, wind) for a latitude/longitude via the Open-Meteo API — read-only, no API key needed.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Latitude coordinate", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate", inclusiveRange: (-180, 180))
    public var longitude: Double

    @Parameter(title: "Number of forecast hours (default: 24)", default: 24, inclusiveRange: (1, 168))
    public var hours: Int

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Check the current Location Services authorization status. Returns the permission state (not_determined, authorized_always, denied, restricted).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_location_permission",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: get_photo_info
@available(iOS 18, macOS 15, *)
public struct GetPhotoInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Photo Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed metadata for a specific photo by ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Photo media item ID")
    public var id: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Get Photo Info with AirMCP? Get detailed metadata for a specific photo by ID.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_photo_info",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_photo_info", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetPhotoInfoOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetPhotoInfoSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_rating",
            args: ["trackName": trackName]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_rating", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetRatingOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetRatingSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_screen_info
public struct GetScreenInfoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Screen Info"
    nonisolated(unsafe) public static var description = IntentDescription("Get display information including resolution, pixel dimensions, and Retina status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_screen_info",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_screen_info", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetScreenInfoOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetScreenInfoSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_shortcut_detail",
            args: ["name": name]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_shortcut_detail", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetShortcutDetailOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetShortcutDetailSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_track_info",
            args: ["trackName": trackName]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_track_info", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetTrackInfoOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetTrackInfoSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_unread_count
public struct GetUnreadCountIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Unread Count"
    nonisolated(unsafe) public static var description = IntentDescription("Get unread message count across all mailboxes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_unread_count",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_unread_count", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetUnreadCountOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetUnreadCountSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_upcoming_events
public struct GetUpcomingEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Upcoming Events"
    nonisolated(unsafe) public static var description = IntentDescription("Get the next N upcoming events from now (searches up to 30 days ahead). A convenience wrapper that doesn't require date range parameters.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max events to return (default: 10)", default: 10, inclusiveRange: (1, 500))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_upcoming_events",
            args: ["limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_upcoming_events", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetUpcomingEventsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetUpcomingEventsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_volume
public struct GetVolumeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Volume"
    nonisolated(unsafe) public static var description = IntentDescription("Get the current system output volume level and mute state.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_volume",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_volume", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetVolumeOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetVolumeSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: get_wifi_status
public struct GetWifiStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get WiFi Status"
    nonisolated(unsafe) public static var description = IntentDescription("Get the current WiFi status including connected network name, signal strength, and channel.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "get_wifi_status",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "get_wifi_status", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPGetWifiStatusOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPGetWifiStatusSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("List files in Google Drive. Supports query filters.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Drive search query (e.g. \"name contains 'report'\" or \"mimeType = 'application/pd")
    public var query: String?

    @Parameter(title: "Max files to return", default: 20, inclusiveRange: (1, 100))
    public var pageSize: Int

    @Parameter(title: "Sort order (e.g. 'modifiedTime desc', 'name')")
    public var orderBy: String?

    @MainActor
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

    @MainActor
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("List recent Gmail messages. Supports query filters (e.g. 'from:alice is:unread').")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Gmail search query (e.g. 'is:unread', 'from:bob subject:report')")
    public var query: String?

    @Parameter(title: "Max messages to return", default: 20, inclusiveRange: (1, 100))
    public var maxResults: Int

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Read a Gmail message by ID. Returns subject, from, to, date, and body.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Gmail message ID")
    public var messageId: String

    @Parameter(title: "Response format", default: .full)
    public var format: GwsGmailReadFormatOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_gmail_read",
            args: ["messageId": messageId, "format": format.rawValue]
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

    @MainActor
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

    @MainActor
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

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "gws_tasks_list",
            args: ["maxResults": maxResults, "showCompleted": showCompleted]
        )
        return .result(value: result)
    }
}

// Tool: import_photo
@available(iOS 18, macOS 15, *)
public struct ImportPhotoIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Import Photo"
    nonisolated(unsafe) public static var description = IntentDescription("Import a photo from a file path into Photos library. Optionally add to an existing album. Requires macOS 26+ Swift bridge.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute file path to the image file to import")
    public var filePath: String

    @Parameter(title: "Album to add the imported photo to (must already exist)")
    public var albumName: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["filePath"] = filePath
        if let v = albumName { args["albumName"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Import Photo with AirMCP? Import a photo from a file path into Photos library. Optionally add to an existing album. Requires macOS 26+ Swift bridge.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "import_photo",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: import_shortcut
@available(iOS 18, macOS 15, *)
public struct ImportShortcutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Import Shortcut"
    nonisolated(unsafe) public static var description = IntentDescription("Import a .shortcut file into Siri Shortcuts. Uses the macOS shortcuts CLI to import the shortcut from the specified file path.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Path to the .shortcut file to import")
    public var filePath: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Import Shortcut with AirMCP? Import a .shortcut file into Siri Shortcuts. Uses the macOS shortcuts CLI to import the shortcut from the specified file path.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "import_shortcut",
            args: ["filePath": filePath]
        )
        return .result(value: result)
    }
}

// Tool: is_app_running
public struct IsAppRunningIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Is App Running"
    nonisolated(unsafe) public static var description = IntentDescription("Check whether an application is currently running. Returns process details if found.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name to check (e.g. 'Safari')")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "is_app_running",
            args: ["name": name]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "is_app_running", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPIsAppRunningOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPIsAppRunningSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: keynote_add_slide
@available(iOS 18, macOS 15, *)
public struct KeynoteAddSlideIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add Keynote Slide"
    nonisolated(unsafe) public static var description = IntentDescription("Add a new slide to a Keynote presentation.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add Keynote Slide with AirMCP? Add a new slide to a Keynote presentation.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_add_slide",
            args: ["document": document]
        )
        return .result(value: result)
    }
}

// Tool: keynote_create_document
@available(iOS 18, macOS 15, *)
public struct KeynoteCreateDocumentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Keynote Presentation"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new blank Keynote presentation.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Keynote Presentation with AirMCP? Create a new blank Keynote presentation.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_create_document",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: keynote_get_slide
public struct KeynoteGetSlideIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Keynote Slide"
    nonisolated(unsafe) public static var description = IntentDescription("Get detailed content of a specific slide including all text items and presenter notes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Slide number (1-based)", inclusiveRange: (1, 9007199254740991))
    public var slideNumber: Int

    @MainActor
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("List all slides in a Keynote presentation with title, body preview, and presenter notes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_list_slides",
            args: ["document": document]
        )
        return .result(value: result)
    }
}

// Tool: keynote_set_presenter_notes
@available(iOS 18, macOS 15, *)
public struct KeynoteSetPresenterNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Keynote Presenter Notes"
    nonisolated(unsafe) public static var description = IntentDescription("Set presenter notes on a specific slide.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Slide number (1-based)", inclusiveRange: (1, 9007199254740991))
    public var slideNumber: Int

    @Parameter(title: "Presenter notes text")
    public var notes: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Keynote Presenter Notes with AirMCP? Set presenter notes on a specific slide.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_set_presenter_notes",
            args: ["document": document, "slideNumber": slideNumber, "notes": notes]
        )
        return .result(value: result)
    }
}

// Tool: keynote_start_slideshow
public struct KeynoteStartSlideshowIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Start Keynote Slideshow"
    nonisolated(unsafe) public static var description = IntentDescription("Start playing a Keynote slideshow from a specific slide.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Start from slide number (default: 1)", default: 1, inclusiveRange: (1, 9007199254740991))
    public var fromSlide: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "keynote_start_slideshow",
            args: ["document": document, "fromSlide": fromSlide]
        )
        return .result(value: result)
    }
}

// Tool: launch_app
public struct LaunchAppIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Launch App"
    nonisolated(unsafe) public static var description = IntentDescription("Launch an application by name. Lightweight — just activates the app without reading its accessibility tree.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name (e.g. 'Safari', 'Xcode') or bundle ID")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "launch_app",
            args: ["name": name]
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_accounts",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_accounts", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListAccountsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListAccountsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_albums
public struct ListAlbumsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Photo Albums"
    nonisolated(unsafe) public static var description = IntentDescription("List all photo albums with name and item count.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_albums",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_all_windows
@available(iOS 18, macOS 15, *)
public struct ListAllWindowsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List All Windows"
    nonisolated(unsafe) public static var description = IntentDescription("List windows across all running applications with title, size, position, app name, and PID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List All Windows with AirMCP? List windows across all running applications with title, size, position, app name, and PID.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_all_windows",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_all_windows", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListAllWindowsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListAllWindowsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_bluetooth_devices
public struct ListBluetoothDevicesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Bluetooth Devices"
    nonisolated(unsafe) public static var description = IntentDescription("List paired Bluetooth devices with their connection status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_bluetooth_devices",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_bluetooth_devices", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListBluetoothDevicesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListBluetoothDevicesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_bookmarks
public struct ListBookmarksIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Bookmarks"
    nonisolated(unsafe) public static var description = IntentDescription("List all Safari bookmarks across all folders, including subfolder paths.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_bookmarks",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_bookmarks", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListBookmarksOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListBookmarksSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_calendars
public struct ListCalendarsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Calendars"
    nonisolated(unsafe) public static var description = IntentDescription("List all calendars with name, color, and writable status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_calendars",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_calendars", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListCalendarsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListCalendarsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_chats
@available(iOS 18, macOS 15, *)
public struct ListChatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Chats"
    nonisolated(unsafe) public static var description = IntentDescription("List recent chats in Messages with participants and last update time.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max chats to return (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Chats with AirMCP? List recent chats in Messages with participants and last update time.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_chats",
            args: ["limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_chats", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListChatsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListChatsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_contacts
public struct ListContactsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Contacts"
    nonisolated(unsafe) public static var description = IntentDescription("List contacts with name, primary email, and phone. Supports pagination.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max contacts (default: 100)", default: 100, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Skip N contacts (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_contacts",
            args: ["limit": limit, "offset": offset]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_contacts", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListContactsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListContactsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_directory
public struct ListDirectoryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Directory"
    nonisolated(unsafe) public static var description = IntentDescription("List files and folders in a directory with metadata (kind, size, modification date).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute directory path")
    public var path: String

    @Parameter(title: "Max items to return (default: 100)", default: 100, inclusiveRange: (1, 500))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_directory",
            args: ["path": path, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_directory", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListDirectoryOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListDirectorySnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_events
public struct ListEventsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Events"
    nonisolated(unsafe) public static var description = IntentDescription("List events within a date range. Requires startDate and endDate (ISO 8601). Optionally filter by calendar name. Supports limit/offset pagination.")
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

    @Parameter(title: "Number of events to skip (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPListEventsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListEventsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_favorites
@available(iOS 18, macOS 15, *)
public struct ListFavoritesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Favorite Photos"
    nonisolated(unsafe) public static var description = IntentDescription("List photos marked as favorites.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Max photos (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Favorite Photos with AirMCP? List photos marked as favorites.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_favorites",
            args: ["limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_favorites", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListFavoritesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListFavoritesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_folders
public struct ListFoldersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Folders"
    nonisolated(unsafe) public static var description = IntentDescription("List all folders across all accounts with note counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_folders",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_folders", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListFoldersOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListFoldersSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_group_members",
            args: ["groupName": groupName, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_group_members", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListGroupMembersOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListGroupMembersSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_groups
public struct ListGroupsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Contact Groups"
    nonisolated(unsafe) public static var description = IntentDescription("List all contact groups.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_groups",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_groups", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListGroupsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListGroupsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_mailboxes
public struct ListMailboxesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Mailboxes"
    nonisolated(unsafe) public static var description = IntentDescription("List all mailboxes across accounts with unread counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_mailboxes",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_mailboxes", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListMailboxesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListMailboxesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_messages
@available(iOS 18, macOS 15, *)
public struct ListMessagesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Messages"
    nonisolated(unsafe) public static var description = IntentDescription("List recent messages in a mailbox (e.g. 'INBOX'). Returns subject, sender, date, read status.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Mailbox name (e.g. 'INBOX', 'Sent Messages')")
    public var mailbox: String

    @Parameter(title: "Account name. Defaults to first account.")
    public var account: String?

    @Parameter(title: "Max messages (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    @Parameter(title: "Pagination offset (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["mailbox"] = mailbox
        if let v = account { args["account"] = v }
        args["limit"] = limit
        args["offset"] = offset
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Messages with AirMCP? List recent messages in a mailbox (e.g. 'INBOX'). Returns subject, sender, date, read status.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_messages",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_messages", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListMessagesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListMessagesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_notes
public struct ListNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Notes"
    nonisolated(unsafe) public static var description = IntentDescription("List all notes with title, folder, and dates. Optionally filter by folder name. Supports pagination via limit/offset.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by folder name")
    public var folder: String?

    @Parameter(title: "Max number of notes to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Number of notes to skip for pagination (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPListNotesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListNotesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_participants
@available(iOS 18, macOS 15, *)
public struct ListParticipantsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Chat Participants"
    nonisolated(unsafe) public static var description = IntentDescription("List all participants in a specific chat.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Chat ID")
    public var chatId: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Chat Participants with AirMCP? List all participants in a specific chat.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_participants",
            args: ["chatId": chatId]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_participants", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListParticipantsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListParticipantsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_photos
@available(iOS 18, macOS 15, *)
public struct ListPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Photos"
    nonisolated(unsafe) public static var description = IntentDescription("List photos in an album with metadata. Use list_albums to find album names first.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Album name")
    public var album: String

    @Parameter(title: "Max photos (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Offset for pagination (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Photos with AirMCP? List photos in an album with metadata. Use list_albums to find album names first.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_photos",
            args: ["album": album, "limit": limit, "offset": offset]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_photos", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListPhotosOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListPhotosSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_playlists
public struct ListPlaylistsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Playlists"
    nonisolated(unsafe) public static var description = IntentDescription("List all Music playlists with track counts and duration.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_playlists",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_playlists", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListPlaylistsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListPlaylistsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_podcast_shows",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_profiles
public struct ListProfilesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Profiles"
    nonisolated(unsafe) public static var description = IntentDescription("List AirMCP runtime profiles. Profiles choose which modules load; toolExposure chooses how much of that surface appears in tools/list.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_profiles",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_profiles", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListProfilesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListProfilesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_reading_list
public struct ListReadingListIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reading List"
    nonisolated(unsafe) public static var description = IntentDescription("List all items in Safari's Reading List.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_reading_list",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_reading_list", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListReadingListOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListReadingListSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_reminder_lists
public struct ListReminderListsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reminder Lists"
    nonisolated(unsafe) public static var description = IntentDescription("List all reminder lists with reminder counts.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_reminder_lists",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_reminder_lists", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListReminderListsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListReminderListsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_reminders
public struct ListRemindersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Reminders"
    nonisolated(unsafe) public static var description = IntentDescription("List reminders. Optionally filter by list name and/or completion status. Supports pagination via limit/offset.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by list name")
    public var list: String?

    @Parameter(title: "Filter by completed status (true/false). Omit to list all.")
    public var completed: Bool?

    @Parameter(title: "Max number of reminders to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var limit: Int

    @Parameter(title: "Number of reminders to skip for pagination (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPListRemindersOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListRemindersSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_running_apps
public struct ListRunningAppsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Running Apps"
    nonisolated(unsafe) public static var description = IntentDescription("List all running applications with name, bundle identifier, PID, and visibility.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_running_apps",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_running_apps", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListRunningAppsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListRunningAppsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_shortcuts
public struct ListShortcutsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Shortcuts"
    nonisolated(unsafe) public static var description = IntentDescription("List all available Siri Shortcuts on this Mac.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_shortcuts",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_shortcuts", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListShortcutsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListShortcutsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_tabs
public struct ListTabsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Safari Tabs"
    nonisolated(unsafe) public static var description = IntentDescription("List all open tabs across all Safari windows with title and URL.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_tabs",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_tabs", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListTabsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListTabsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_tracks",
            args: ["playlist": playlist, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "list_tracks", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPListTracksOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPListTracksSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: list_triggers
public struct ListTriggersIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Event Triggers"
    nonisolated(unsafe) public static var description = IntentDescription("Show all skills with event triggers (calendar_changed, reminders_changed, pasteboard_changed, mail_unread_changed, focus_mode_changed, now_playing_changed, file_modified, screen_locked, screen_unlocked) and their debounce settings.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_triggers",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: list_windows
@available(iOS 18, macOS 15, *)
public struct ListWindowsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Windows"
    nonisolated(unsafe) public static var description = IntentDescription("List all visible windows across all running applications. Returns JSON with each window's app name, bundle ID, title, position, and size. Requires Accessibility permissions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("List Windows with AirMCP? List all visible windows across all running applications. Returns JSON with each window's app name, bundle ID, title, position, and size. Requires Accessibility permissions.")
        )
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
    nonisolated(unsafe) public static var description = IntentDescription("Generate text using a local Ollama model. Runs entirely on your machine — no data sent to any cloud. Requires Ollama running at localhost:11434. Useful for summarization, extraction, and analysis.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The prompt to send to the local LLM")
    public var prompt: String

    @Parameter(title: "Ollama model name (default: llama3.2)")
    public var model: String?

    @Parameter(title: "System instruction for the model")
    public var system: String?

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "local_llm_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: mark_message_read
@available(iOS 18, macOS 15, *)
public struct MarkMessageReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Mark Message Read/Unread"
    nonisolated(unsafe) public static var description = IntentDescription("Mark an email message as read or unread.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Message ID")
    public var id: String

    @Parameter(title: "true=read, false=unread (default: true)", default: true)
    public var read: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Mark Message Read/Unread with AirMCP? Mark an email message as read or unread.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "mark_message_read",
            args: ["id": id, "read": read]
        )
        return .result(value: result)
    }
}

// Tool: memory_put
@available(iOS 18, macOS 15, *)
public struct MemoryPutIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Remember a Fact, Entity, or Episode"
    nonisolated(unsafe) public static var description = IntentDescription("Insert or update a context-memory entry. Use `fact` for durable key→value notes, `entity` for named people/places/projects, and `episode` for time-anchored records. If you omit `id`, the key is used as the stable id (so a second call with the same key upserts). `ttl_ms` makes the entry self-expiring.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Entry category: fact | entity | episode")
    public var kind: MemoryPutKindOption

    @Parameter(title: "Stable label (e.g. 'favorite_editor', 'person:Ada')")
    public var key: String

    @Parameter(title: "Payload. JSON-stringify structured data upstream.")
    public var value: String

    @Parameter(title: "Override the default `${kind}:${key}` id")
    public var id: String?

    @Parameter(title: "Optional tags for later filtering")
    public var tags: [String]?

    @Parameter(title: "Originator — tool name, skill id, 'user' …")
    public var source: String?

    @Parameter(title: "Self-expire after N milliseconds")
    public var ttl_ms: Int?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["kind"] = kind.rawValue
        args["key"] = key
        args["value"] = value
        if let v = id { args["id"] = v }
        if let v = tags { args["tags"] = v }
        if let v = source { args["source"] = v }
        if let v = ttl_ms { args["ttl_ms"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Remember a Fact, Entity, or Episode with AirMCP? Insert or update a context-memory entry. Use `fact` for durable key→value notes, `entity` for named people/places/projects, and `episode` for time-anchored records. If…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "memory_put",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "memory_put", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPMemoryPutOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPMemoryPutSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: memory_query
@available(iOS 18, macOS 15, *)
public struct MemoryQueryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query Context Memory"
    nonisolated(unsafe) public static var description = IntentDescription("List non-expired memory entries. All filters are AND-combined. Returns entries sorted by `updatedAt` descending by default. Safe read-only — use before composing LLM prompts so recent user-supplied context is recalled.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Restrict to one kind")
    public var kind: MemoryQueryKindOption?

    @Parameter(title: "Case-insensitive substring in key or value")
    public var contains: String?

    @Parameter(title: "Match entries carrying ALL given tags")
    public var tags: [String]?

    @Parameter(title: "Max rows (default 50, cap 500)", inclusiveRange: (1, 500))
    public var limit: Int?

    @Parameter(title: "Sort by updatedAt (default desc)")
    public var order: MemoryQueryOrderOption?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = kind { args["kind"] = v.rawValue }
        if let v = contains { args["contains"] = v }
        if let v = tags { args["tags"] = v }
        if let v = limit { args["limit"] = v }
        if let v = order { args["order"] = v.rawValue }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Query Context Memory with AirMCP? List non-expired memory entries. All filters are AND-combined. Returns entries sorted by `updatedAt` descending by default. Safe read-only — use before composing LLM prompts so recent…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "memory_query",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "memory_query", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPMemoryQueryOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPMemoryQuerySnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: memory_stats
public struct MemoryStatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Context Memory Stats"
    nonisolated(unsafe) public static var description = IntentDescription("Summarize the context-memory store: counts by kind, oldest/newest timestamps, and on-disk path. Also sweeps any expired entries as a side-effect.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "memory_stats",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "memory_stats", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPMemoryStatsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPMemoryStatsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: minimize_window
public struct MinimizeWindowIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Minimize Window"
    nonisolated(unsafe) public static var description = IntentDescription("Minimize or restore a window.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name (e.g. 'Safari')")
    public var appName: String

    @Parameter(title: "Set true to restore (un-minimize) instead of minimizing", default: false)
    public var restore: Bool

    @Parameter(title: "Specific window title. If omitted, targets the first window.")
    public var windowTitle: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["appName"] = appName
        args["restore"] = restore
        if let v = windowTitle { args["windowTitle"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "minimize_window",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: move_window
public struct MoveWindowIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Move Window"
    nonisolated(unsafe) public static var description = IntentDescription("Move a window to a specific position on screen.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name (e.g. 'Safari')")
    public var appName: String

    @Parameter(title: "X coordinate for top-left corner", inclusiveRange: (-9007199254740991, 9007199254740991))
    public var x: Int

    @Parameter(title: "Y coordinate for top-left corner", inclusiveRange: (-9007199254740991, 9007199254740991))
    public var y: Int

    @Parameter(title: "Specific window title. If omitted, targets the first window.")
    public var windowTitle: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["appName"] = appName
        args["x"] = x
        args["y"] = y
        if let v = windowTitle { args["windowTitle"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "move_window",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: music_player
public struct MusicPlayerIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Music Player"
    nonisolated(unsafe) public static var description = IntentDescription("Display an interactive music player showing the currently playing track.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "now_playing",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "now_playing", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPNowPlayingOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPNowPlayingSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: numbers_add_sheet
@available(iOS 18, macOS 15, *)
public struct NumbersAddSheetIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Add Numbers Sheet"
    nonisolated(unsafe) public static var description = IntentDescription("Add a new sheet to a Numbers spreadsheet.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Name for the new sheet")
    public var sheetName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Add Numbers Sheet with AirMCP? Add a new sheet to a Numbers spreadsheet.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_add_sheet",
            args: ["document": document, "sheetName": sheetName]
        )
        return .result(value: result)
    }
}

// Tool: numbers_create_document
@available(iOS 18, macOS 15, *)
public struct NumbersCreateDocumentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Numbers Document"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new blank Numbers spreadsheet.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Numbers Document with AirMCP? Create a new blank Numbers spreadsheet.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_create_document",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: numbers_get_cell
public struct NumbersGetCellIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Numbers Cell"
    nonisolated(unsafe) public static var description = IntentDescription("Read a single cell value by address (e.g. 'A1').")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Cell address (e.g. 'A1', 'B3')")
    public var cell: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_get_cell",
            args: ["document": document, "sheet": sheet, "cell": cell]
        )
        return .result(value: result)
    }
}

// Tool: numbers_get_formula
public struct NumbersGetFormulaIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Get Numbers Cell Formula"
    nonisolated(unsafe) public static var description = IntentDescription("Read the literal formula behind a cell (e.g. '=SUM(A1:A10)') instead of its evaluated value. Returns null formula for cells that hold a constant.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Cell address (e.g. 'A1')")
    public var cell: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_get_formula",
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_list_documents",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "numbers_list_documents", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPNumbersListDocumentsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPNumbersListDocumentsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_list_sheets",
            args: ["document": document]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "numbers_list_sheets", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPNumbersListSheetsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPNumbersListSheetsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: numbers_list_tables
public struct NumbersListTablesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "List Numbers Tables"
    nonisolated(unsafe) public static var description = IntentDescription("List every table in a Numbers sheet with its name + dimensions. A sheet can hold multiple tables (totals + breakdown + chart-source); the older tools assume the first table is canonical, this lets a caller pick by name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_list_tables",
            args: ["document": document, "sheet": sheet]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "numbers_list_tables", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPNumbersListTablesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPNumbersListTablesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: numbers_read_cells
public struct NumbersReadCellsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Numbers Cell Range"
    nonisolated(unsafe) public static var description = IntentDescription("Read a range of cells from a sheet. Uses 0-based row/column indices.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Start row index (0-based)", inclusiveRange: (0, 9007199254740991))
    public var startRow: Int

    @Parameter(title: "Start column index (0-based)", inclusiveRange: (0, 9007199254740991))
    public var startCol: Int

    @Parameter(title: "End row index (inclusive)", inclusiveRange: (0, 9007199254740991))
    public var endRow: Int

    @Parameter(title: "End column index (inclusive)", inclusiveRange: (0, 9007199254740991))
    public var endCol: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_read_cells",
            args: ["document": document, "sheet": sheet, "startRow": startRow, "startCol": startCol, "endRow": endRow, "endCol": endCol]
        )
        return .result(value: result)
    }
}

// Tool: numbers_rename_sheet
@available(iOS 18, macOS 15, *)
public struct NumbersRenameSheetIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Rename Numbers Sheet"
    nonisolated(unsafe) public static var description = IntentDescription("Rename a sheet in place. Numbers does NOT allow duplicate sheet names; the call fails with errJxa when the new name is taken.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Current sheet name")
    public var sheet: String

    @Parameter(title: "New sheet name")
    public var newName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Rename Numbers Sheet with AirMCP? Rename a sheet in place. Numbers does NOT allow duplicate sheet names; the call fails with errJxa when the new name is taken.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_rename_sheet",
            args: ["document": document, "sheet": sheet, "newName": newName]
        )
        return .result(value: result)
    }
}

// Tool: numbers_set_cell
@available(iOS 18, macOS 15, *)
public struct NumbersSetCellIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Numbers Cell"
    nonisolated(unsafe) public static var description = IntentDescription("Write a value to a single cell. Numbers and booleans land as native cell types (not text), so they sort and feed formulas correctly; strings are written verbatim and Numbers interprets a leading '=' as a formula.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Document name")
    public var document: String

    @Parameter(title: "Sheet name")
    public var sheet: String

    @Parameter(title: "Cell address (e.g. 'A1')")
    public var cell: String

    @Parameter(title: "Value to write (number, boolean, or text)")
    public var value: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Numbers Cell with AirMCP? Write a value to a single cell. Numbers and booleans land as native cell types (not text), so they sort and feed formulas correctly; strings are written verbatim and Numbers interprets a…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "numbers_set_cell",
            args: ["document": document, "sheet": sheet, "cell": cell, "value": value]
        )
        return .result(value: result)
    }
}

// Tool: open_address
public struct OpenAddressIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Open Address"
    nonisolated(unsafe) public static var description = IntentDescription("Open a specific address in Apple Maps.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Address to open in Maps")
    public var address: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "open_address",
            args: ["address": address]
        )
        return .result(value: result)
    }
}

// Tool: pages_create_document
@available(iOS 18, macOS 15, *)
public struct PagesCreateDocumentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Create Pages Document"
    nonisolated(unsafe) public static var description = IntentDescription("Create a new blank Pages document.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Create Pages Document with AirMCP? Create a new blank Pages document.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "pages_create_document",
            args: [String: any Sendable]()
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

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "pages_list_documents",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: pages_open_document
public struct PagesOpenDocumentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Open Pages Document"
    nonisolated(unsafe) public static var description = IntentDescription("Open a Pages document from a file path.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute file path to the .pages document")
    public var path: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "pages_open_document",
            args: ["path": path]
        )
        return .result(value: result)
    }
}

// Tool: play_playlist
public struct PlayPlaylistIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Play Playlist"
    nonisolated(unsafe) public static var description = IntentDescription("Start playing a playlist by name, with optional shuffle control.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playlist name")
    public var name: String

    @Parameter(title: "Enable or disable shuffle")
    public var shuffle: Bool?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["name"] = name
        if let v = shuffle { args["shuffle"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "play_playlist",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: play_podcast_episode
public struct PlayPodcastEpisodeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Play Podcast Episode"
    nonisolated(unsafe) public static var description = IntentDescription("Play a specific podcast episode by name, optionally from a specific show.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Episode name to play")
    public var episodeName: String

    @Parameter(title: "Show to search in (searches all shows if omitted)")
    public var showName: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["episodeName"] = episodeName
        if let v = showName { args["showName"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "play_podcast_episode",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: play_track
public struct PlayTrackIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Play Track"
    nonisolated(unsafe) public static var description = IntentDescription("Play a specific track by name, optionally from a specific playlist.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name to play")
    public var trackName: String

    @Parameter(title: "Playlist to search in (default: Library)")
    public var playlist: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["trackName"] = trackName
        if let v = playlist { args["playlist"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "play_track",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: playback_control
public struct PlaybackControlIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Playback Control"
    nonisolated(unsafe) public static var description = IntentDescription("Control Music playback: play, pause, nextTrack, previousTrack.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playback action")
    public var action: PlaybackControlActionOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "playback_control",
            args: ["action": action.rawValue]
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "podcast_now_playing",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: podcast_playback_control
public struct PodcastPlaybackControlIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Podcast Playback Control"
    nonisolated(unsafe) public static var description = IntentDescription("Control Podcasts playback: play, pause, next, previous.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playback action")
    public var action: PodcastPlaybackControlActionOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "podcast_playback_control",
            args: ["action": action.rawValue]
        )
        return .result(value: result)
    }
}

// Tool: prevent_sleep
public struct PreventSleepIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Prevent Sleep"
    nonisolated(unsafe) public static var description = IntentDescription("Prevent the Mac from sleeping for a specified duration using caffeinate. The assertion is transient — it auto-releases when the timer elapses; no manual stop is required.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Duration in seconds (default: 3600 = 1 hour, max: 86400 = 24 hours)", default: 3600, inclusiveRange: (1, 86400))
    public var seconds: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "prevent_sleep",
            args: ["seconds": seconds]
        )
        return .result(value: result)
    }
}

// Tool: proactive_context
public struct ProactiveContextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Proactive Context"
    nonisolated(unsafe) public static var description = IntentDescription("Get contextually relevant tool and workflow suggestions based on time of day, day of week, and your usage patterns. Like Siri Suggestions but for MCP — tells you what you probably want to do right now.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "proactive_context",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "proactive_context", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPProactiveContextOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPProactiveContextSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: profile_status
public struct ProfileStatusIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Profile Status"
    nonisolated(unsafe) public static var description = IntentDescription("Show the active AirMCP profile, module set, tool exposure mode, exposed tool count, and total registered tool count.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "profile_status",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "profile_status", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPProfileStatusOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPProfileStatusSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: proofread_text
public struct ProofreadTextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Proofread Text"
    nonisolated(unsafe) public static var description = IntentDescription("Proofread and correct grammar/spelling using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to proofread")
    public var text: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "proofread_text",
            args: ["text": text]
        )
        return .result(value: result)
    }
}

// Tool: query_photos
@available(iOS 18, macOS 15, *)
public struct QueryPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query Photos"
    nonisolated(unsafe) public static var description = IntentDescription("Query the Photos library with filters: media type, date range, favorites. Returns photo metadata (identifier, filename, date, dimensions). Requires Swift bridge.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by media type")
    public var mediaType: QueryPhotosMediatypeOption?

    @Parameter(title: "Start date (ISO 8601)")
    public var startDate: String?

    @Parameter(title: "End date (ISO 8601)")
    public var endDate: String?

    @Parameter(title: "Only favorites")
    public var favorites: Bool?

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = mediaType { args["mediaType"] = v.rawValue }
        if let v = startDate { args["startDate"] = v }
        if let v = endDate { args["endDate"] = v }
        if let v = favorites { args["favorites"] = v }
        args["limit"] = limit
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Query Photos with AirMCP? Query the Photos library with filters: media type, date range, favorites. Returns photo metadata (identifier, filename, date, dimensions). Requires Swift bridge.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "query_photos",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: read_chat
@available(iOS 18, macOS 15, *)
public struct ReadChatIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Chat"
    nonisolated(unsafe) public static var description = IntentDescription("Read chat details including participants and last update time by chat ID.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Chat ID")
    public var chatId: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Read Chat with AirMCP? Read chat details including participants and last update time by chat ID.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_chat",
            args: ["chatId": chatId]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_chat", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadChatOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadChatSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: read_contact
public struct ReadContactIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Contact"
    nonisolated(unsafe) public static var description = IntentDescription("Read full details of a contact by ID including all emails, phones, and addresses.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Contact ID")
    public var id: AirMCPContactEntity

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_contact",
            args: ["id": id.id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_contact", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadContactOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadContactSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: read_event
public struct ReadEventIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Event"
    nonisolated(unsafe) public static var description = IntentDescription("Read full details of a calendar event by ID. Includes attendees (read-only), location, description, and recurrence info.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Event UID")
    public var id: AirMCPCalendarEventEntity

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_event",
            args: ["id": id.id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_event", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadEventOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadEventSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: read_message
@available(iOS 18, macOS 15, *)
public struct ReadMessageIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Message"
    nonisolated(unsafe) public static var description = IntentDescription("Read full content of an email message by ID. Content length is configurable (default: 5000 chars, max: 100000).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Message ID")
    public var id: String

    @Parameter(title: "Max content length (default: 5000)", default: 5000, inclusiveRange: (100, 100000))
    public var maxLength: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Read Message with AirMCP? Read full content of an email message by ID. Content length is configurable (default: 5000 chars, max: 100000).")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_message",
            args: ["id": id, "maxLength": maxLength]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_message", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadMessageOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadMessageSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: read_note
public struct ReadNoteIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Note"
    nonisolated(unsafe) public static var description = IntentDescription("Read the full content of a specific note by its ID. Returns HTML body and plaintext.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Note ID (x-coredata:// format)")
    public var id: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_note",
            args: ["id": id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_note", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadNoteOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadNoteSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: read_page_content
public struct ReadPageContentIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Page Content"
    nonisolated(unsafe) public static var description = IntentDescription("Read the HTML source of a Safari tab. Specify window and tab index from list_tabs.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Window index (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var windowIndex: Int

    @Parameter(title: "Tab index (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var tabIndex: Int

    @Parameter(title: "Max content length (default: 10000)", default: 10000, inclusiveRange: (100, 50000))
    public var maxLength: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_page_content",
            args: ["windowIndex": windowIndex, "tabIndex": tabIndex, "maxLength": maxLength]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_page_content", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadPageContentOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadPageContentSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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
    public var id: AirMCPReminderEntity

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "read_reminder",
            args: ["id": id.id]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "read_reminder", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPReadReminderOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPReadReminderSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: recent_files
public struct RecentFilesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Recent Files"
    nonisolated(unsafe) public static var description = IntentDescription("Find recently modified files in a folder using Spotlight.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Folder to search (default: home)")
    public var folder: String?

    @Parameter(title: "Modified within N days (default: 7)", default: 7, inclusiveRange: (1, 365))
    public var days: Int

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = folder { args["folder"] = v }
        args["days"] = days
        args["limit"] = limit
        let result = try await MCPIntentRouter.shared.call(
            tool: "recent_files",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "recent_files", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPRecentFilesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPRecentFilesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: resize_window
public struct ResizeWindowIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Resize Window"
    nonisolated(unsafe) public static var description = IntentDescription("Resize a window to specific dimensions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name (e.g. 'Safari')")
    public var appName: String

    @Parameter(title: "Window width in pixels", inclusiveRange: (1, 9007199254740991))
    public var width: Int

    @Parameter(title: "Window height in pixels", inclusiveRange: (1, 9007199254740991))
    public var height: Int

    @Parameter(title: "Specific window title. If omitted, targets the first window.")
    public var windowTitle: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["appName"] = appName
        args["width"] = width
        args["height"] = height
        if let v = windowTitle { args["windowTitle"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "resize_window",
            args: args
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Rewrite text in a specified tone using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to rewrite")
    public var text: String

    @Parameter(title: "Target tone (default: professional)", default: .professional)
    public var tone: RewriteTextToneOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "rewrite_text",
            args: ["text": text, "tone": tone.rawValue]
        )
        return .result(value: result)
    }
}

// Tool: scan_bluetooth
public struct ScanBluetoothIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Scan Bluetooth"
    nonisolated(unsafe) public static var description = IntentDescription("Scan for nearby BLE (Bluetooth Low Energy) devices. Returns device names, UUIDs, and signal strength (RSSI). Default scan duration is 5 seconds.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Scan duration in seconds (1-30, default: 5)", default: 5, inclusiveRange: (1, 30))
    public var duration: Double

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Extract text and structure from an image file using Apple Vision framework OCR. Returns recognized text elements with confidence scores. Works with photos of documents, receipts, whiteboards, etc.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the image file to scan")
    public var imagePath: String

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Bulk scan notes returning metadata and a text preview for each. Supports pagination via offset. Optionally filter by folder. Use this to get an overview before organizing.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Filter by folder name. Omit to scan all notes.")
    public var folder: String?

    @Parameter(title: "Max number of notes to return (default: 100)", default: 100, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Number of notes to skip for pagination (default: 0)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @Parameter(title: "Preview text length in characters (default: 300)", default: 300, inclusiveRange: (1, 5000))
    public var previewLength: Int

    @MainActor
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
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "scan_notes", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPScanNotesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPScanNotesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: search_chats
@available(iOS 18, macOS 15, *)
public struct SearchChatsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Chats"
    nonisolated(unsafe) public static var description = IntentDescription("Search chats by participant name, handle, or chat name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword (matches chat name, participant name, or handle)")
    public var query: String

    @Parameter(title: "Max results (default: 20)", default: 20, inclusiveRange: (1, 100))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Search Chats with AirMCP? Search chats by participant name, handle, or chat name.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_chats",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_chats", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchChatsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchChatsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_contacts",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_contacts", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchContactsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchContactsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_events",
            args: ["query": query, "startDate": startDate, "endDate": endDate, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_events", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchEventsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchEventsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: search_files
public struct SearchFilesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Files"
    nonisolated(unsafe) public static var description = IntentDescription("Search files using Spotlight (mdfind). Searches file names and content.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search query (Spotlight syntax)")
    public var query: String

    @Parameter(title: "Folder to search in (default: home)")
    public var folder: String?

    @Parameter(title: "Max results (default: 50)", default: 50, inclusiveRange: (1, 200))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["query"] = query
        if let v = folder { args["folder"] = v }
        args["limit"] = limit
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_files",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_files", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchFilesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchFilesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: search_location
public struct SearchLocationIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Location"
    nonisolated(unsafe) public static var description = IntentDescription("Search for a place or location in Apple Maps.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Location or place to search for")
    public var query: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_location",
            args: ["query": query]
        )
        return .result(value: result)
    }
}

// Tool: search_messages
@available(iOS 18, macOS 15, *)
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Search Messages with AirMCP? Search messages by keyword in subject or sender within a mailbox.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_messages",
            args: ["query": query, "mailbox": mailbox, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_messages", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchMessagesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchMessagesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: search_nearby
public struct SearchNearbyIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Nearby"
    nonisolated(unsafe) public static var description = IntentDescription("Search for places near a location in Apple Maps. If no coordinates are given, searches near the current location.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "What to search for (e.g. 'coffee shops', 'gas stations')")
    public var query: String

    @Parameter(title: "Latitude of the center point (degrees, -90 to 90)", inclusiveRange: (-90, 90))
    public var latitude: Double?

    @Parameter(title: "Longitude of the center point (degrees, -180 to 180)", inclusiveRange: (-180, 180))
    public var longitude: Double?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["query"] = query
        if let v = latitude { args["latitude"] = v }
        if let v = longitude { args["longitude"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_nearby",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: search_notes
public struct SearchNotesIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Notes"
    nonisolated(unsafe) public static var description = IntentDescription("Search notes by keyword in title and body. Returns matching notes with a 200-char preview.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results to return (default: 50)", default: 50, inclusiveRange: (1, 500))
    public var limit: Int

    @Parameter(title: "Number of matching results to skip (for pagination)", default: 0, inclusiveRange: (0, 9007199254740991))
    public var offset: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_notes",
            args: ["query": query, "limit": limit, "offset": offset]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_notes", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchNotesOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchNotesSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: search_photos
@available(iOS 18, macOS 15, *)
public struct SearchPhotosIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Search Photos"
    nonisolated(unsafe) public static var description = IntentDescription("Search photos by filename, name, or description keyword.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword")
    public var query: String

    @Parameter(title: "Max results (default: 30)", default: 30, inclusiveRange: (1, 200))
    public var limit: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Search Photos with AirMCP? Search photos by filename, name, or description keyword.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_photos",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_photos", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchPhotosOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchPhotosSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_reminders",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_reminders", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchRemindersOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchRemindersSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_shortcuts",
            args: ["query": query]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_shortcuts", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchShortcutsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchShortcutsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_tabs",
            args: ["query": query]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_tabs", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchTabsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchTabsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "search_tracks",
            args: ["query": query, "limit": limit]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "search_tracks", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSearchTracksOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSearchTracksSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: semantic_search
public struct SemanticSearchIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Semantic Search"
    nonisolated(unsafe) public static var description = IntentDescription("Search across Apple app data by meaning, not just keywords. Finds related notes, events, reminders, and emails even if they use different words. Auto-indexes on first use and refreshes every 30 minutes.")
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Show the current state of the semantic vector index -- total entries, breakdown by source.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "semantic_status",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: set_brightness
public struct SetBrightnessIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Brightness"
    nonisolated(unsafe) public static var description = IntentDescription("Set the display brightness level. Requires the 'brightness' CLI tool (brew install brightness).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Brightness level from 0.0 (darkest) to 1.0 (brightest)", inclusiveRange: (0, 1))
    public var level: Double

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_brightness",
            args: ["level": level]
        )
        return .result(value: result)
    }
}

// Tool: set_clipboard
@available(iOS 18, macOS 15, *)
public struct SetClipboardIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Clipboard"
    nonisolated(unsafe) public static var description = IntentDescription("Write text to the system clipboard, replacing its current content.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to copy to the clipboard")
    public var text: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Clipboard with AirMCP? Write text to the system clipboard, replacing its current content.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_clipboard",
            args: ["text": text]
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "set_clipboard", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSetClipboardOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSetClipboardSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: set_disliked
@available(iOS 18, macOS 15, *)
public struct SetDislikedIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Disliked"
    nonisolated(unsafe) public static var description = IntentDescription("Mark or unmark a track as disliked.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name")
    public var trackName: String

    @Parameter(title: "Whether to mark as disliked")
    public var disliked: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Disliked with AirMCP? Mark or unmark a track as disliked.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_disliked",
            args: ["trackName": trackName, "disliked": disliked]
        )
        return .result(value: result)
    }
}

// Tool: set_favorited
@available(iOS 18, macOS 15, *)
public struct SetFavoritedIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Favorited"
    nonisolated(unsafe) public static var description = IntentDescription("Mark or unmark a track as favorited (loved).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name")
    public var trackName: String

    @Parameter(title: "Whether to mark as favorited")
    public var favorited: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Favorited with AirMCP? Mark or unmark a track as favorited (loved).")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_favorited",
            args: ["trackName": trackName, "favorited": favorited]
        )
        return .result(value: result)
    }
}

// Tool: set_file_tags
@available(iOS 18, macOS 15, *)
public struct SetFileTagsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set File Tags"
    nonisolated(unsafe) public static var description = IntentDescription("Set Finder tags on a file. Replaces all existing tags.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute file path")
    public var path: String

    @Parameter(title: "Array of tag names to set")
    public var tags: [String]

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set File Tags with AirMCP? Set Finder tags on a file. Replaces all existing tags.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_file_tags",
            args: ["path": path, "tags": tags]
        )
        return .result(value: result)
    }
}

// Tool: set_rating
@available(iOS 18, macOS 15, *)
public struct SetRatingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Rating"
    nonisolated(unsafe) public static var description = IntentDescription("Set the star rating (0-100) for a track. Use multiples of 20 for full stars (0, 20, 40, 60, 80, 100).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Track name")
    public var trackName: String

    @Parameter(title: "Rating value (0-100)", inclusiveRange: (0, 100))
    public var rating: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Set Rating with AirMCP? Set the star rating (0-100) for a track. Use multiples of 20 for full stars (0, 20, 40, 60, 80, 100).")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_rating",
            args: ["trackName": trackName, "rating": rating]
        )
        return .result(value: result)
    }
}

// Tool: set_shuffle
public struct SetShuffleIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Shuffle & Repeat"
    nonisolated(unsafe) public static var description = IntentDescription("Enable/disable shuffle and set repeat mode (off, one, all).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Enable or disable shuffle")
    public var shuffle: Bool?

    @Parameter(title: "Repeat mode")
    public var songRepeat: SetShuffleSongrepeatOption?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = shuffle { args["shuffle"] = v }
        if let v = songRepeat { args["songRepeat"] = v.rawValue }
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_shuffle",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: set_volume
public struct SetVolumeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Set Volume"
    nonisolated(unsafe) public static var description = IntentDescription("Set the system output volume (0-100) and/or mute state.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Output volume level (0-100)", inclusiveRange: (0, 100))
    public var volume: Double?

    @Parameter(title: "Whether to mute output audio")
    public var muted: Bool?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = volume { args["volume"] = v }
        if let v = muted { args["muted"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "set_volume",
            args: args
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "set_volume", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPSetVolumeOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSetVolumeSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: setup_permissions
public struct SetupPermissionsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Setup Permissions"
    nonisolated(unsafe) public static var description = IntentDescription("Trigger macOS permission prompts for all Apple apps used by AirMCP. Run this once after installation to grant all permissions at once. Each app will show a one-time macOS permission dialog.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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

    @Parameter(title: "Latitude coordinate (degrees, -90 to 90)", inclusiveRange: (-90, 90))
    public var latitude: Double

    @Parameter(title: "Longitude coordinate (degrees, -180 to 180)", inclusiveRange: (-180, 180))
    public var longitude: Double

    @Parameter(title: "Optional label for the location")
    public var label: String?

    @MainActor
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

// Tool: show_notification
public struct ShowNotificationIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Show Notification"
    nonisolated(unsafe) public static var description = IntentDescription("Display a macOS system notification with optional title, subtitle, and sound.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Notification body text")
    public var message: String

    @Parameter(title: "Notification title")
    public var title: String?

    @Parameter(title: "Notification subtitle")
    public var subtitle: String?

    @Parameter(title: "Sound name to play (e.g. 'Frog', 'Glass', 'Hero')")
    public var sound: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["message"] = message
        if let v = title { args["title"] = v }
        if let v = subtitle { args["subtitle"] = v }
        if let v = sound { args["sound"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "show_notification",
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Watch the clipboard and add any copied URL to Safari's Reading List — writes to Reading List; non-URL clipboard content is ignored. Combines the `pasteboard_changed` event trigger with `on_error: continue` so Safari's validator rejects non-URLs and the skill quietly moves on.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_clipboard-url-to-reading",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_daily-briefing
public struct SkillDailyBriefingIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Daily Briefing"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Read today's calendar, open reminders, unread mail count, and recent notes for a safe morning overview. This skill performs no writes.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_daily-briefing",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: skill_daily-journal
public struct SkillDailyJournalIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Daily Journal → Memory"
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Summarise today's events and open reminders on-device and save the result as a context-memory `episode` tagged `journal` — writes one memory entry. Nothing is written to Apple apps. Demonstrates inputs + parallel + retry + `memory_put` so ai_agent can later recall \"what did I do last Tuesday?\" via `memory_query`.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Optional free-form note to prepend to the auto-generated summary.", default: "")
    public var note: String

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Fires when the screen is locked — drafts a short day-in-review note covering today's events + open reminders so the next unlock (or tomorrow morning) has a fresh snapshot waiting. Showcases the `screen_locked` event trigger combined with `parallel` reads and `retry` on the on-device summariser.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Create a calendar time-block event for each of today's open reminders — writes calendar events (each creation HITL-gated); reminders are only read. Uses `loop` with `on_error: continue` so a single failed event creation (conflicting calendar, missing permission) doesn't abort the rest of the plan — the skill result reports which reminders got blocked and which didn't.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Snapshot today's events and open reminders whenever macOS Focus mode changes (Do Not Disturb, Personal, etc.) — read-only, nothing is written. Gives the AI fresh context right after a mode switch; showcases the `focus_mode_changed` event trigger plus parallel data gathering.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Semantic-search indexed Apple data for a topic and expand each hit with related items — a read-only cross-app digest; needs semantic_index first. Demonstrates the Skills DSL's loop construct and conditional execution.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("[Skill] Scan Mail for a keyword or sender and create one reminder per matching message — writes reminders (each creation HITL-gated); mail is only read. Accepts runtime inputs so the same skill handles newsletter triage, a specific sender, or any ad-hoc query without editing YAML. Loop + `on_error: continue` means the rest of the batch still gets queued even if one reminder-create fails (HITL denial, Reminders permission, etc.).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Search keyword in subject/sender (e.g. 'newsletter', 'invoice', 'team@acme.com')", default: "newsletter")
    public var query: String

    @Parameter(title: "Mailbox to search.", default: "INBOX")
    public var mailbox: String

    @Parameter(title: "Max messages to process per run.", default: 10)
    public var limit: Double

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "skill_sender-to-tasks",
            args: ["query": query, "mailbox": mailbox, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: smart_clipboard
@available(iOS 18, macOS 15, *)
public struct SmartClipboardIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Smart Clipboard"
    nonisolated(unsafe) public static var description = IntentDescription("Get clipboard content with automatic type detection (text, URL, email, phone, date, file path, image). More structured than raw clipboard access.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Smart Clipboard with AirMCP? Get clipboard content with automatic type detection (text, URL, email, phone, date, file path, image). More structured than raw clipboard access.")
        )
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
    nonisolated(unsafe) public static var description = IntentDescription("Report whether this device supports on-device speech recognition. A true result is DEVICE capability only — NOT proof the caller is authorized: macOS gates transcription by Speech Recognition permission on the responsible process (the signed AirMCP app), so only a successful transcribe_audio confirms authorization.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "speech_availability",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: spotlight_sync
@available(iOS 18, macOS 15, *)
public struct SpotlightSyncIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Sync to Spotlight"
    nonisolated(unsafe) public static var description = IntentDescription("Push semantically indexed data to macOS Core Spotlight, making it discoverable via Spotlight search and Siri. Run after semantic_index to expose your notes, events, reminders, and emails to system-wide search. Requires Swift bridge (npm run swift-build).")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Sync to Spotlight with AirMCP? Push semantically indexed data to macOS Core Spotlight, making it discoverable via Spotlight search and Siri. Run after semantic_index to expose your notes, events, reminders, and emails…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "spotlight_sync",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: suggest_next_tools
public struct SuggestNextToolsIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Suggest Next Tools"
    nonisolated(unsafe) public static var description = IntentDescription("Based on your usage patterns, suggest which tools typically follow a given tool. Learns from how you use AirMCP over time. Returns frequently-used tool sequences.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Tool name to get suggestions for — e.g. 'today_events'")
    public var after: String

    @Parameter(title: "Max suggestions (default 5)", inclusiveRange: (1, 20))
    public var limit: Double?

    @MainActor
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
        let decoded = try JSONDecoder().decode(MCPSuggestNextToolsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPSuggestNextToolsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: summarize_context
public struct SummarizeContextIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Summarize Context"
    nonisolated(unsafe) public static var description = IntentDescription("Gather recent context from enabled Apple apps and produce a concise briefing via MCP sampling — read-only; the connected client must support sampling. Works with whatever LLM the client is using; no API keys required.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Optional focus area (e.g. 'meetings', 'overdue tasks', 'project X')")
    public var focus: String?

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Summarize text using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Text to summarize")
    public var text: String

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Classify and tag content using Apple's on-device Foundation Model. Returns confidence scores for each provided tag/category. Requires macOS 26+.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "The text content to classify")
    public var text: String

    @Parameter(title: "List of tag/category names to classify the content against")
    public var tags: [String]

    @MainActor
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
    nonisolated(unsafe) public static var description = IntentDescription("Display today's events and due reminders on a single day-axis timeline. Fuses Calendar + Reminders; items without a start/due time fall into an 'Unscheduled' rail.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "today_events",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "today_events", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPTodayEventsOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPTodayEventsSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: toggle_dark_mode
public struct ToggleDarkModeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Toggle Dark Mode"
    nonisolated(unsafe) public static var description = IntentDescription("Toggle macOS appearance between dark mode and light mode.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "toggle_dark_mode",
            args: [String: any Sendable]()
        )
        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "toggle_dark_mode", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(MCPToggleDarkModeOutput.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: MCPToggleDarkModeSnippetView(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)
    }
}

// Tool: toggle_focus_mode
public struct ToggleFocusModeIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Toggle Focus Mode"
    nonisolated(unsafe) public static var description = IntentDescription("Toggle Do Not Disturb (Focus mode) on or off.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "True to enable Do Not Disturb, false to disable")
    public var enable: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "toggle_focus_mode",
            args: ["enable": enable]
        )
        return .result(value: result)
    }
}

// Tool: transcribe_audio
public struct TranscribeAudioIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Transcribe Audio"
    nonisolated(unsafe) public static var description = IntentDescription("Transcribe an audio file to text using Apple's on-device speech recognition. Supports most audio formats (m4a, mp3, wav, caf). Requires the responsible process to hold macOS Speech Recognition permission (the signed AirMCP app surface); from an unentitled CLI caller it aborts with a permission error.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Absolute path to the audio file")
    public var path: String

    @Parameter(title: "Language code (e.g. 'en-US', 'ko-KR', 'ja-JP'). Defaults to system language.")
    public var language: String?

    @MainActor
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

    @MainActor
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

    @MainActor
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_now_playing",
            args: [String: any Sendable]()
        )
        return .result(value: result)
    }
}

// Tool: tv_play
public struct TvPlayIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Play TV Content"
    nonisolated(unsafe) public static var description = IntentDescription("Play a movie or episode by name.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Movie or episode name")
    public var name: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_play",
            args: ["name": name]
        )
        return .result(value: result)
    }
}

// Tool: tv_playback_control
public struct TvPlaybackControlIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "TV Playback Control"
    nonisolated(unsafe) public static var description = IntentDescription("Control Apple TV playback: play, pause, next, previous.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Playback action")
    public var action: TvPlaybackControlActionOption

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_playback_control",
            args: ["action": action.rawValue]
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

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "tv_search",
            args: ["query": query, "limit": limit]
        )
        return .result(value: result)
    }
}

// Tool: ui_accessibility_query
@available(iOS 18, macOS 15, *)
public struct UiAccessibilityQueryIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Query UI Elements"
    nonisolated(unsafe) public static var description = IntentDescription("Search for UI elements by accessibility attributes (role, title, value, description, identifier). More precise than ui_read — returns only matching elements with full attribute data. Works on any app, including those without AppleScript support. Requires Accessibility permissions.")
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

    @MainActor
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
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Query UI Elements with AirMCP? Search for UI elements by accessibility attributes (role, title, value, description, identifier). More precise than ui_read — returns only matching elements with full attribute data. Wor…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_accessibility_query",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_diff
@available(iOS 18, macOS 15, *)
public struct UiDiffIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Compare UI State"
    nonisolated(unsafe) public static var description = IntentDescription("Compare the current UI state against a previous snapshot to detect changes. Pass the 'elements' array from a previous ui_traverse result as beforeSnapshot. Returns added, removed, and changed elements. Useful for verifying action results.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "JSON string of previous UI tree snapshot (elements array from ui_traverse)")
    public var beforeSnapshot: String

    @Parameter(title: "App name to compare against")
    public var app: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["beforeSnapshot"] = beforeSnapshot
        if let v = app { args["app"] = v }
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Compare UI State with AirMCP? Compare the current UI state against a previous snapshot to detect changes. Pass the 'elements' array from a previous ui_traverse result as beforeSnapshot. Returns added, removed, and cha…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_diff",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_open_app
@available(iOS 18, macOS 15, *)
public struct UiOpenAppIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Open App (UI Automation)"
    nonisolated(unsafe) public static var description = IntentDescription("Open an application by name or bundle ID and return an accessibility tree summary of its windows and top-level UI elements. Requires Accessibility permissions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Application name (e.g. 'Safari', 'Xcode') or bundle ID (e.g. 'com.apple.Safari')")
    public var appName: String

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Open App (UI Automation) with AirMCP? Open an application by name or bundle ID and return an accessibility tree summary of its windows and top-level UI elements. Requires Accessibility permissions.")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_open_app",
            args: ["appName": appName]
        )
        return .result(value: result)
    }
}

// Tool: ui_read
@available(iOS 18, macOS 15, *)
public struct UiReadIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Read Accessibility Tree"
    nonisolated(unsafe) public static var description = IntentDescription("Read the accessibility tree of the frontmost app (or specified app). Returns structured data about all visible UI elements including their roles, names, values, positions, and hierarchy. Use this to understand what UI elements are available before interacting with them. Requires Accessibility permissions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "App name to read. If omitted, reads the frontmost app.")
    public var appName: String?

    @Parameter(title: "Maximum depth of the UI tree to traverse (default: 3)", default: 3, inclusiveRange: (1, 10))
    public var maxDepth: Int

    @Parameter(title: "Maximum number of UI elements to return (default: 200)", default: 200, inclusiveRange: (1, 1000))
    public var maxElements: Int

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = appName { args["appName"] = v }
        args["maxDepth"] = maxDepth
        args["maxElements"] = maxElements
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("Read Accessibility Tree with AirMCP? Read the accessibility tree of the frontmost app (or specified app). Returns structured data about all visible UI elements including their roles, names, values, positions, and hier…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_read",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_scroll
public struct UiScrollIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Scroll"
    nonisolated(unsafe) public static var description = IntentDescription("Scroll in the specified direction within the frontmost window. Uses arrow key simulation for cross-app compatibility. Requires Accessibility permissions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "Scroll direction")
    public var direction: UiScrollDirectionOption

    @Parameter(title: "Number of scroll steps (default: 3)", default: 3, inclusiveRange: (1, 100))
    public var amount: Int

    @Parameter(title: "App name to activate before scrolling. If omitted, scrolls in the frontmost app.")
    public var appName: String?

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        args["direction"] = direction.rawValue
        args["amount"] = amount
        if let v = appName { args["appName"] = v }
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_scroll",
            args: args
        )
        return .result(value: result)
    }
}

// Tool: ui_traverse
@available(iOS 18, macOS 15, *)
public struct UiTraverseIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "BFS Traverse UI Tree"
    nonisolated(unsafe) public static var description = IntentDescription("Breadth-first traversal of the accessibility tree. Returns a flat list of all UI elements with parent-child relationships, positions, sizes, and states. Supports PID targeting and visible-only filtering. More thorough than ui_read. Requires Accessibility permissions.")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(title: "App name to traverse. If omitted, uses frontmost app.")
    public var app: String?

    @Parameter(title: "Process ID for precise targeting (overrides app name lookup)", inclusiveRange: (-9007199254740991, 9007199254740991))
    public var pid: Int?

    @Parameter(title: "Max traversal depth (default: 5)", default: 5, inclusiveRange: (1, 15))
    public var maxDepth: Int

    @Parameter(title: "Max elements to collect (default: 500)", default: 500, inclusiveRange: (1, 2000))
    public var maxElements: Int

    @Parameter(title: "Only include elements with visible position/size", default: false)
    public var onlyVisible: Bool

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        var args: [String: any Sendable] = [:]
        if let v = app { args["app"] = v }
        if let v = pid { args["pid"] = v }
        args["maxDepth"] = maxDepth
        args["maxElements"] = maxElements
        args["onlyVisible"] = onlyVisible
        try await requestConfirmation(
            actionName: .go,
            dialog: IntentDialog("BFS Traverse UI Tree with AirMCP? Breadth-first traversal of the accessibility tree. Returns a flat list of all UI elements with parent-child relationships, positions, sizes, and states. Supports PID targeting and vis…")
        )
        let result = try await MCPIntentRouter.shared.call(
            tool: "ui_traverse",
            args: args
        )
        return .result(value: result)
    }
}

// MARK: - AppShortcutsProvider

#if AIRMCP_ENABLE_FOUNDATION_MODELS && canImport(FoundationModels) && compiler(>=6.3)
@available(macOS 26, iOS 26, *)
public struct AirMCPAskShortcut: AppShortcutsProvider {
    @AppShortcutsBuilder public static var appShortcuts: [AppShortcut] {
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
}
#endif

public struct AirMCPGeneratedShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SummarizeContextIntent(),
            phrases: [
                "Daily Briefing in \(.applicationName)",
                "brief my day with \(.applicationName)",
            ],
            shortTitle: "Daily Briefing",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: TimelineTodayIntent(),
            phrases: [
                "Today Timeline in \(.applicationName)",
                "show my day with \(.applicationName)",
            ],
            shortTitle: "Today Timeline",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: SkillInboxTriageIntent(),
            phrases: [
                "Inbox Triage in \(.applicationName)",
                "triage my inbox with \(.applicationName)",
            ],
            shortTitle: "Inbox Triage",
            systemImageName: "tray.full"
        )
        AppShortcut(
            intent: SkillProjectDigestIntent(),
            phrases: [
                "Project Digest in \(.applicationName)",
                "summarize my project with \(.applicationName)",
            ],
            shortTitle: "Project Digest",
            systemImageName: "folder"
        )
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
            intent: SearchNotesIntent(),
            phrases: [
                "Search Notes in \(.applicationName)",
                "search notes with \(.applicationName)",
            ],
            shortTitle: "Search Notes",
            systemImageName: "note.text"
        )
        AppShortcut(
            intent: ListRemindersIntent(),
            phrases: [
                "List Reminders in \(.applicationName)",
                "list reminders with \(.applicationName)",
            ],
            shortTitle: "List Reminders",
            systemImageName: "checklist"
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
            intent: GetCurrentWeatherIntent(),
            phrases: [
                "Get Current Weather in \(.applicationName)",
                "get current weather with \(.applicationName)",
            ],
            shortTitle: "Get Current Weather",
            systemImageName: "cloud.sun"
        )
    }
}

#endif

// MARK: - Interactive Snippet views (RFC 0007 §3.7, A.4.1 + A.4.3)

#if canImport(SwiftUI) && canImport(AppIntents) && compiler(>=6.3)
import SwiftUI

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadEventIntent_id(id: String) -> ReadEventIntent {
    let intent = ReadEventIntent()
    intent.id = AirMCPStringEntityQuery<AirMCPCalendarEventEntity>.syntheticEntity(id: id)
    return intent
}

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadNoteIntent_id(id: String) -> ReadNoteIntent {
    let intent = ReadNoteIntent()
    intent.id = id
    return intent
}

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadReminderIntent_id(id: String) -> ReadReminderIntent {
    let intent = ReadReminderIntent()
    intent.id = AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticEntity(id: id)
    return intent
}

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadContactIntent_id(id: String) -> ReadContactIntent {
    let intent = ReadContactIntent()
    intent.id = AirMCPStringEntityQuery<AirMCPContactEntity>.syntheticEntity(id: id)
    return intent
}

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadMessageIntent_id(id: String) -> ReadMessageIntent {
    let intent = ReadMessageIntent()
    intent.id = id
    return intent
}

@available(macOS 26, iOS 26, *)
fileprivate func _mkReadChatIntent_chatId(chatId: String) -> ReadChatIntent {
    let intent = ReadChatIntent()
    intent.chatId = chatId
    return intent
}

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

// Snippet view for: get_battery_status  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetBatteryStatusSnippetView: View {
    public let data: MCPGetBatteryStatusOutput
    public init(data: MCPGetBatteryStatusOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Percentage")
                Spacer()
                Text((data.percentage?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Charging")
                Spacer()
                Text((data.charging ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Source")
                Spacer()
                Text((data.source ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Time Remaining")
                Spacer()
                Text((data.timeRemaining ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Raw")
                Spacer()
                Text(data.raw)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_brightness  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetBrightnessSnippetView: View {
    public let data: MCPGetBrightnessOutput
    public init(data: MCPGetBrightnessOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Brightness")
                Spacer()
                Text((data.brightness?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Raw")
                Spacer()
                Text(data.raw)
                    .lineLimit(1)
                    .truncationMode(.tail)
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
            HStack {
                Text("Content")
                Spacer()
                Text(data.content)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Length")
                Spacer()
                Text(data.length.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Truncated")
                Spacer()
                Text((data.truncated ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Title")
                Spacer()
                Text(data.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Url")
                Spacer()
                Text(data.url)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Temperature")
                Spacer()
                Text(data.temperature.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Feels Like")
                Spacer()
                Text(data.feelsLike.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Humidity")
                Spacer()
                Text(data.humidity.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Weather Code")
                Spacer()
                Text(data.weatherCode.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Weather Description")
                Spacer()
                Text(data.weatherDescription)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Wind Speed")
                Spacer()
                Text(data.windSpeed.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Wind Direction")
                Spacer()
                Text(data.windDirection.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Precipitation")
                Spacer()
                Text(data.precipitation.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Cloud Cover")
                Spacer()
                Text(data.cloudCover.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Units")
                Spacer()
                Text(String(describing: data.units))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Bundle Identifier")
                Spacer()
                Text(data.bundleIdentifier)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Pid")
                Spacer()
                Text(data.pid.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_photo_info  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetPhotoInfoSnippetView: View {
    public let data: MCPGetPhotoInfoOutput
    public init(data: MCPGetPhotoInfoOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Id")
                Spacer()
                Text(data.id)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Filename")
                Spacer()
                Text((data.filename ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text((data.name ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Description")
                Spacer()
                Text((data.description ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Date")
                Spacer()
                Text((data.date ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Width")
                Spacer()
                Text(data.width.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Height")
                Spacer()
                Text(data.height.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Altitude")
                Spacer()
                Text((data.altitude?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Location")
                Spacer()
                Text(String(describing: data.location))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Favorite")
                Spacer()
                Text((data.favorite ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Keywords")
                Spacer()
                Text(String(describing: data.keywords))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_rating  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetRatingSnippetView: View {
    public let data: MCPGetRatingOutput
    public init(data: MCPGetRatingOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Artist")
                Spacer()
                Text(data.artist)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Rating")
                Spacer()
                Text(data.rating.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Favorited")
                Spacer()
                Text((data.favorited ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Disliked")
                Spacer()
                Text((data.disliked ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_screen_info  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPGetScreenInfoSnippetView: View {
    public let data: MCPGetScreenInfoOutput
    public init(data: MCPGetScreenInfoOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.displays.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
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
            HStack {
                Text("Shortcut")
                Spacer()
                Text(data.shortcut)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Detail")
                Spacer()
                Text(data.detail)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_track_info  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetTrackInfoSnippetView: View {
    public let data: MCPGetTrackInfoOutput
    public init(data: MCPGetTrackInfoOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Id")
                Spacer()
                Text(data.id.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Artist")
                Spacer()
                Text(data.artist)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Album")
                Spacer()
                Text(data.album)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Album Artist")
                Spacer()
                Text(data.albumArtist)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Genre")
                Spacer()
                Text(data.genre)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Year")
                Spacer()
                Text(data.year.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Track Number")
                Spacer()
                Text(data.trackNumber.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Disc Number")
                Spacer()
                Text(data.discNumber.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Duration")
                Spacer()
                Text(data.duration.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Played Count")
                Spacer()
                Text(data.playedCount.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Rating")
                Spacer()
                Text(data.rating.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Favorited")
                Spacer()
                Text((data.favorited ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Disliked")
                Spacer()
                Text((data.disliked ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Date Added")
                Spacer()
                Text((data.dateAdded ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Sample Rate")
                Spacer()
                Text(data.sampleRate.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Bit Rate")
                Spacer()
                Text(data.bitRate.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Size")
                Spacer()
                Text(data.size.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            ForEach(data.events, id: \.id) { row in
                Button(intent: _mkReadEventIntent_id(id: row.id)) {
                    Text(row.summary)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            HStack {
                Text("Output Volume")
                Spacer()
                Text(data.outputVolume.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Input Volume")
                Spacer()
                Text(data.inputVolume.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Output Muted")
                Spacer()
                Text((data.outputMuted ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: get_wifi_status  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPGetWifiStatusSnippetView: View {
    public let data: MCPGetWifiStatusOutput
    public init(data: MCPGetWifiStatusOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Ssid")
                Spacer()
                Text((data.ssid ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Bssid")
                Spacer()
                Text((data.bssid ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Signal Strength")
                Spacer()
                Text((data.signalStrength?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Noise Level")
                Spacer()
                Text((data.noiseLevel?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Channel")
                Spacer()
                Text((data.channel ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Connected")
                Spacer()
                Text((data.connected ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Raw")
                Spacer()
                Text(data.raw)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: is_app_running  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPIsAppRunningSnippetView: View {
    public let data: MCPIsAppRunningOutput
    public init(data: MCPIsAppRunningOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Running")
                Spacer()
                Text((data.running ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Bundle Identifier")
                Spacer()
                Text((data.bundleIdentifier ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Pid")
                Spacer()
                Text((data.pid?.formatted() ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Visible")
                Spacer()
                Text((data.visible.map { $0 ? "Yes" : "No" } ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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

// Snippet view for: list_all_windows  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListAllWindowsSnippetView: View {
    public let data: MCPListAllWindowsOutput
    public init(data: MCPListAllWindowsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.windows.enumerated()), id: \.offset) { _, row in
                Text(row.app)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_bluetooth_devices  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListBluetoothDevicesSnippetView: View {
    public let data: MCPListBluetoothDevicesOutput
    public init(data: MCPListBluetoothDevicesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.devices.enumerated()), id: \.offset) { _, row in
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
                Text(row.name)
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
            ForEach(data.chats, id: \.id) { row in
                Button(intent: _mkReadChatIntent_chatId(chatId: row.id)) {
                    Text(row.id)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            ForEach(data.contacts, id: \.id) { row in
                Button(intent: _mkReadContactIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            ForEach(data.events, id: \.id) { row in
                Button(intent: _mkReadEventIntent_id(id: row.id)) {
                    Text(row.summary)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
    }
}

// Snippet view for: list_favorites  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListFavoritesSnippetView: View {
    public let data: MCPListFavoritesOutput
    public init(data: MCPListFavoritesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.photos.enumerated()), id: \.offset) { _, row in
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
                Text(row.name)
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
                Text(row.name)
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
                Text(row.name)
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
            ForEach(data.messages, id: \.id) { row in
                Button(intent: _mkReadMessageIntent_id(id: row.id)) {
                    Text(row.subject)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            ForEach(data.notes, id: \.id) { row in
                Button(intent: _mkReadNoteIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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

// Snippet view for: list_photos  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListPhotosSnippetView: View {
    public let data: MCPListPhotosOutput
    public init(data: MCPListPhotosOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.photos.enumerated()), id: \.offset) { _, row in
                Text(row.id)
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
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: list_profiles  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListProfilesSnippetView: View {
    public let data: MCPListProfilesOutput
    public init(data: MCPListProfilesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.profiles.enumerated()), id: \.offset) { _, row in
                Text(row.name)
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
                Text(row.name)
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
            ForEach(data.reminders, id: \.id) { row in
                Button(intent: _mkReadReminderIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
    }
}

// Snippet view for: list_running_apps  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPListRunningAppsSnippetView: View {
    public let data: MCPListRunningAppsOutput
    public init(data: MCPListRunningAppsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.apps.enumerated()), id: \.offset) { _, row in
                Text(row.name)
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
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: memory_put  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPMemoryPutSnippetView: View {
    public let data: MCPMemoryPutOutput
    public init(data: MCPMemoryPutOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Stored")
                Spacer()
                Text(String(describing: data.stored))
                    .lineLimit(1)
                    .truncationMode(.tail)
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
                Text(row.kind)
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
            HStack {
                Text("Total")
                Spacer()
                Text(data.total.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("By Kind")
                Spacer()
                Text(String(describing: data.byKind))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Oldest")
                Spacer()
                Text((data.oldest ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Newest")
                Spacer()
                Text((data.newest ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Expired Swept")
                Spacer()
                Text(data.expiredSwept.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Path")
                Spacer()
                Text(data.path)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Player State")
                Spacer()
                Text(data.playerState)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Track")
                Spacer()
                Text(String(describing: data.track))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: numbers_list_documents  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPNumbersListDocumentsSnippetView: View {
    public let data: MCPNumbersListDocumentsOutput
    public init(data: MCPNumbersListDocumentsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.documents.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: numbers_list_sheets  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPNumbersListSheetsSnippetView: View {
    public let data: MCPNumbersListSheetsOutput
    public init(data: MCPNumbersListSheetsOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.sheets.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: numbers_list_tables  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPNumbersListTablesSnippetView: View {
    public let data: MCPNumbersListTablesOutput
    public init(data: MCPNumbersListTablesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.tables.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
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
            HStack {
                Text("Time Context")
                Spacer()
                Text(String(describing: data.timeContext))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Suggested Tools")
                Spacer()
                Text(String(describing: data.suggestedTools))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Suggested Workflows")
                Spacer()
                Text(String(describing: data.suggestedWorkflows))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: profile_status  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPProfileStatusSnippetView: View {
    public let data: MCPProfileStatusOutput
    public init(data: MCPProfileStatusOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Profile")
                Spacer()
                Text(data.profile)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Tool Exposure")
                Spacer()
                Text(data.toolExposure)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Modules Enabled")
                Spacer()
                Text(String(describing: data.modulesEnabled))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Modules Disabled")
                Spacer()
                Text(String(describing: data.modulesDisabled))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Tools Exposed")
                Spacer()
                Text(data.toolsExposed.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Tools Registered")
                Spacer()
                Text(data.toolsRegistered.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Tool Sessions Active")
                Spacer()
                Text(data.toolSessionsActive.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Front Door Tools")
                Spacer()
                Text(String(describing: data.frontDoorTools))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Id")
                Spacer()
                Text(data.id)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("First Name")
                Spacer()
                Text(data.firstName)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Last Name")
                Spacer()
                Text(data.lastName)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Organization")
                Spacer()
                Text((data.organization ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Job Title")
                Spacer()
                Text((data.jobTitle ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Department")
                Spacer()
                Text((data.department ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Note")
                Spacer()
                Text((data.note ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Emails")
                Spacer()
                Text(String(describing: data.emails))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Phones")
                Spacer()
                Text(String(describing: data.phones))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Addresses")
                Spacer()
                Text(String(describing: data.addresses))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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

// Snippet view for: read_message  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPReadMessageSnippetView: View {
    public let data: MCPReadMessageOutput
    public init(data: MCPReadMessageOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Id")
                Spacer()
                Text(data.id)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Subject")
                Spacer()
                Text(data.subject)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Sender")
                Spacer()
                Text(data.sender)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("To")
                Spacer()
                Text(String(describing: data.to))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Cc")
                Spacer()
                Text(String(describing: data.cc))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Date Received")
                Spacer()
                Text(data.dateReceived)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Date Sent")
                Spacer()
                Text((data.dateSent ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Read")
                Spacer()
                Text((data.read ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Flagged")
                Spacer()
                Text((data.flagged ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Content")
                Spacer()
                Text(data.content)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Mailbox")
                Spacer()
                Text(data.mailbox)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Account")
                Spacer()
                Text(data.account)
                    .lineLimit(1)
                    .truncationMode(.tail)
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
            HStack {
                Text("Id")
                Spacer()
                Text(data.id)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Body")
                Spacer()
                Text(data.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Plaintext")
                Spacer()
                Text(data.plaintext)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Creation Date")
                Spacer()
                Text(data.creationDate)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Modification Date")
                Spacer()
                Text(data.modificationDate)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Folder")
                Spacer()
                Text(data.folder)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Shared")
                Spacer()
                Text((data.shared ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Password Protected")
                Spacer()
                Text((data.passwordProtected ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: read_page_content  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPReadPageContentSnippetView: View {
    public let data: MCPReadPageContentOutput
    public init(data: MCPReadPageContentOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Title")
                Spacer()
                Text(data.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Url")
                Spacer()
                Text(data.url)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Content")
                Spacer()
                Text(data.content)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Truncated")
                Spacer()
                Text((data.truncated ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
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
            HStack {
                Text("Id")
                Spacer()
                Text(data.id)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Name")
                Spacer()
                Text(data.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Body")
                Spacer()
                Text(data.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Completed")
                Spacer()
                Text((data.completed ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Completion Date")
                Spacer()
                Text((data.completionDate ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Creation Date")
                Spacer()
                Text(data.creationDate)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Modification Date")
                Spacer()
                Text(data.modificationDate)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Due Date")
                Spacer()
                Text((data.dueDate ?? "—"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Priority")
                Spacer()
                Text(data.priority.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Flagged")
                Spacer()
                Text((data.flagged ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("List")
                Spacer()
                Text(data.list)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: recent_files  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPRecentFilesSnippetView: View {
    public let data: MCPRecentFilesOutput
    public init(data: MCPRecentFilesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.files.enumerated()), id: \.offset) { _, row in
                Text(row.path)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: scan_notes  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPScanNotesSnippetView: View {
    public let data: MCPScanNotesOutput
    public init(data: MCPScanNotesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.notes.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
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
            ForEach(data.chats, id: \.id) { row in
                Button(intent: _mkReadChatIntent_chatId(chatId: row.id)) {
                    Text(row.id)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            ForEach(data.contacts, id: \.id) { row in
                Button(intent: _mkReadContactIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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
            ForEach(data.events, id: \.id) { row in
                Button(intent: _mkReadEventIntent_id(id: row.id)) {
                    Text(row.summary)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
    }
}

// Snippet view for: search_files  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchFilesSnippetView: View {
    public let data: MCPSearchFilesOutput
    public init(data: MCPSearchFilesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.files.enumerated()), id: \.offset) { _, row in
                Text(row.path)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: search_messages  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchMessagesSnippetView: View {
    public let data: MCPSearchMessagesOutput
    public init(data: MCPSearchMessagesOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.messages.enumerated()), id: \.offset) { _, row in
                Text(row.subject)
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
            ForEach(data.notes, id: \.id) { row in
                Button(intent: _mkReadNoteIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
    }
}

// Snippet view for: search_photos  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchPhotosSnippetView: View {
    public let data: MCPSearchPhotosOutput
    public init(data: MCPSearchPhotosOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.photos.enumerated()), id: \.offset) { _, row in
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
            ForEach(data.reminders, id: \.id) { row in
                Button(intent: _mkReadReminderIntent_id(id: row.id)) {
                    Text(row.name)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
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

// Snippet view for: search_tabs  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchTabsSnippetView: View {
    public let data: MCPSearchTabsOutput
    public init(data: MCPSearchTabsOutput) { self.data = data }
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

// Snippet view for: search_tracks  (shape: list-object)
@available(macOS 26, iOS 26, *)
public struct MCPSearchTracksSnippetView: View {
    public let data: MCPSearchTracksOutput
    public init(data: MCPSearchTracksOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.tracks.enumerated()), id: \.offset) { _, row in
                Text(row.name)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()
    }
}

// Snippet view for: set_clipboard  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPSetClipboardSnippetView: View {
    public let data: MCPSetClipboardOutput
    public init(data: MCPSetClipboardOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Set")
                Spacer()
                Text((data.set ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Length")
                Spacer()
                Text(data.length.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

// Snippet view for: set_volume  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPSetVolumeSnippetView: View {
    public let data: MCPSetVolumeOutput
    public init(data: MCPSetVolumeOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Output Volume")
                Spacer()
                Text(data.outputVolume.formatted())
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            HStack {
                Text("Output Muted")
                Spacer()
                Text((data.outputMuted ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
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
            ForEach(data.events, id: \.id) { row in
                Button(intent: _mkReadEventIntent_id(id: row.id)) {
                    Text(row.summary)
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
    }
}

// Snippet view for: toggle_dark_mode  (shape: scalar)
@available(macOS 26, iOS 26, *)
public struct MCPToggleDarkModeSnippetView: View {
    public let data: MCPToggleDarkModeOutput
    public init(data: MCPToggleDarkModeOutput) { self.data = data }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Dark Mode")
                Spacer()
                Text((data.darkMode ? "Yes" : "No"))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding()
    }
}

#endif
