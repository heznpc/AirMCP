// AirMCPKit — Shared types for macOS bridge and iOS app.
// These types define the JSON contract between the Node.js MCP server (or iOS MCP server)
// and the native Swift layer.

import Foundation

// MARK: - Common I/O

public struct AirMCPOutput: Encodable, Sendable {
    public let output: String
    public init(output: String) { self.output = output }
}

public struct AirMCPError: Encodable, Sendable {
    public let error: String
    public init(error: String) { self.error = error }
}

// MARK: - EventKit

public struct RecurrenceInput: Decodable, Sendable {
    public let frequency: String // daily, weekly, monthly, yearly
    public let interval: Int
    public let endDate: String?
    public let count: Int?
    public let daysOfWeek: [Int]? // 1=Sun..7=Sat
}

public struct RecurringEventInput: Decodable, Sendable {
    public let title: String
    public let startDate: String
    public let endDate: String
    public let calendar: String?
    public let location: String?
    public let notes: String?
    public let recurrence: RecurrenceInput
}

public struct RecurringReminderInput: Decodable, Sendable {
    public let title: String
    public let list: String?
    public let notes: String?
    public let dueDate: String?
    public let priority: Int?
    public let recurrence: RecurrenceInput
}

public struct EventOutput: Encodable, Sendable {
    public let id: String
    public let title: String
    public let recurring: Bool
    public init(id: String, title: String, recurring: Bool) {
        self.id = id; self.title = title; self.recurring = recurring
    }
}

public struct ReminderOutput: Encodable, Sendable {
    public let id: String
    public let title: String
    public let recurring: Bool
    public init(id: String, title: String, recurring: Bool) {
        self.id = id; self.title = title; self.recurring = recurring
    }
}

// MARK: - PhotoKit

public struct PhotoQueryInput: Decodable, Sendable {
    public let mediaType: String?
    public let startDate: String?
    public let endDate: String?
    public let favorites: Bool?
    public let limit: Int?
}

public struct PhotoInfo: Encodable, Sendable {
    public let identifier: String
    public let filename: String?
    public let creationDate: String?
    public let mediaType: String
    public let isFavorite: Bool
    public let width: Int
    public let height: Int
    public init(identifier: String, filename: String?, creationDate: String?,
                mediaType: String, isFavorite: Bool, width: Int, height: Int) {
        self.identifier = identifier; self.filename = filename; self.creationDate = creationDate
        self.mediaType = mediaType; self.isFavorite = isFavorite; self.width = width; self.height = height
    }
}

public struct PhotoQueryOutput: Encodable, Sendable {
    public let photos: [PhotoInfo]
    public let total: Int
    public init(photos: [PhotoInfo], total: Int) {
        self.photos = photos; self.total = total
    }
}

public struct ImportPhotoInput: Decodable, Sendable {
    public let filePath: String
    public let albumName: String?
}

public struct DeletePhotosInput: Decodable, Sendable {
    public let identifiers: [String]
}

public struct ListPhotosInput: Decodable, Sendable {
    public let albumName: String?
    public let limit: Int?
    public let offset: Int?
}

public struct ListPhotosOutput: Encodable, Sendable {
    public let total: Int
    public let offset: Int
    public let returned: Int
    public let photos: [PhotoListItem]
    public init(total: Int, offset: Int, returned: Int, photos: [PhotoListItem]) {
        self.total = total; self.offset = offset; self.returned = returned; self.photos = photos
    }
}

public struct PhotoListItem: Encodable, Sendable {
    public let id: String
    public let filename: String?
    public let name: String?
    public let date: String?
    public let width: Int
    public let height: Int
    public let favorite: Bool
    public init(id: String, filename: String?, name: String?, date: String?,
                width: Int, height: Int, favorite: Bool) {
        self.id = id; self.filename = filename; self.name = name; self.date = date
        self.width = width; self.height = height; self.favorite = favorite
    }
}

public struct SearchPhotosInput: Decodable, Sendable {
    public let query: String
    public let limit: Int?
}

public struct SearchPhotosOutput: Encodable, Sendable {
    public let total: Int
    public let photos: [SearchPhotoItem]
    public init(total: Int, photos: [SearchPhotoItem]) {
        self.total = total; self.photos = photos
    }
}

public struct SearchPhotoItem: Encodable, Sendable {
    public let id: String
    public let filename: String?
    public let name: String?
    public let date: String?
    public let favorite: Bool
    public let description: String?
    public init(id: String, filename: String?, name: String?, date: String?,
                favorite: Bool, description: String?) {
        self.id = id; self.filename = filename; self.name = name; self.date = date
        self.favorite = favorite; self.description = description
    }
}

public struct GetPhotoInfoInput: Decodable, Sendable {
    public let id: String
}

public struct PhotoDetailOutput: Encodable, Sendable {
    public let id: String
    public let filename: String?
    public let name: String?
    public let description: String?
    public let date: String?
    public let width: Int
    public let height: Int
    public let altitude: Double?
    public let location: [Double]?
    public let favorite: Bool
    public let keywords: [String]?
    public init(id: String, filename: String?, name: String?, description: String?,
                date: String?, width: Int, height: Int, altitude: Double?,
                location: [Double]?, favorite: Bool, keywords: [String]?) {
        self.id = id; self.filename = filename; self.name = name; self.description = description
        self.date = date; self.width = width; self.height = height; self.altitude = altitude
        self.location = location; self.favorite = favorite; self.keywords = keywords
    }
}

public struct ListFavoritesInput: Decodable, Sendable {
    public let limit: Int?
    public let offset: Int?
    public init(limit: Int? = nil, offset: Int? = nil) { self.limit = limit; self.offset = offset }
}

public struct ListFavoritesOutput: Encodable, Sendable {
    public let total: Int
    public let returned: Int
    public let photos: [PhotoListItem]
    public init(total: Int, returned: Int, photos: [PhotoListItem]) {
        self.total = total; self.returned = returned; self.photos = photos
    }
}

public struct AlbumInfo: Encodable, Sendable {
    public let id: String
    public let name: String
    public let count: Int
    public init(id: String, name: String, count: Int) {
        self.id = id; self.name = name; self.count = count
    }
}

public struct CreateAlbumInput: Decodable, Sendable {
    public let name: String
}

public struct CreateAlbumOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id; self.name = name
    }
}

public struct AddToAlbumInput: Decodable, Sendable {
    public let photoIds: [String]
    public let albumName: String
}

public struct AddToAlbumOutput: Encodable, Sendable {
    public let added: Int
    public let album: String
    public init(added: Int, album: String) {
        self.added = added; self.album = album
    }
}

// MARK: - CoreLocation

public struct LocationOutput: Encodable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let altitude: Double
    public let horizontalAccuracy: Double
    public let verticalAccuracy: Double
    public let timestamp: String
    public init(latitude: Double, longitude: Double, altitude: Double,
                horizontalAccuracy: Double, verticalAccuracy: Double, timestamp: String) {
        self.latitude = latitude; self.longitude = longitude; self.altitude = altitude
        self.horizontalAccuracy = horizontalAccuracy; self.verticalAccuracy = verticalAccuracy
        self.timestamp = timestamp
    }
}

// MARK: - Vision

public struct ClassifyImageInput: Decodable, Sendable {
    public let imagePath: String
    public let maxResults: Int?
}

public struct ImageLabel: Encodable, Sendable {
    public let identifier: String
    public let confidence: Double
    public init(identifier: String, confidence: Double) {
        self.identifier = identifier; self.confidence = confidence
    }
}

// MARK: - Embedding

public struct EmbedTextInput: Decodable, Sendable {
    public let text: String
    public let language: String?
}

public struct EmbedBatchInput: Decodable, Sendable {
    public let texts: [String]
    public let language: String?
}

public struct EmbedTextOutput: Encodable, Sendable {
    public let vector: [Double]
    public let dimension: Int
    public init(vector: [Double], dimension: Int) {
        self.vector = vector; self.dimension = dimension
    }
}

// MARK: - Apple Intelligence

public struct GenerateTextInput: Decodable, Sendable {
    public let prompt: String
    public let systemInstruction: String?
    public let temperature: Double?
}

public struct AiStatusOutput: Encodable, Sendable {
    public let available: Bool
    public let message: String
    public let macOSVersion: String
    public let hasAppleSilicon: Bool
    public let foundationModelsSupported: Bool
    public init(available: Bool, message: String, macOSVersion: String,
                hasAppleSilicon: Bool, foundationModelsSupported: Bool) {
        self.available = available; self.message = message; self.macOSVersion = macOSVersion
        self.hasAppleSilicon = hasAppleSilicon; self.foundationModelsSupported = foundationModelsSupported
    }
}

// MARK: - EventKit (Calendar CRUD)

public struct ListCalendarsInput: Decodable, Sendable {}

public struct CalendarInfo: Encodable, Sendable {
    public let id: String
    public let name: String
    public let color: String?
    public let writable: Bool
    public init(id: String, name: String, color: String?, writable: Bool) {
        self.id = id; self.name = name; self.color = color; self.writable = writable
    }
}

public struct ListEventsInput: Decodable, Sendable {
    public let startDate: String
    public let endDate: String
    public let calendar: String?
    public let limit: Int?
    public let offset: Int?
}

public struct EventListItem: Encodable, Sendable {
    public let id: String
    public let summary: String
    public let startDate: String
    public let endDate: String
    public let allDay: Bool
    public let calendar: String
    public init(id: String, summary: String, startDate: String, endDate: String, allDay: Bool, calendar: String) {
        self.id = id; self.summary = summary; self.startDate = startDate; self.endDate = endDate
        self.allDay = allDay; self.calendar = calendar
    }
}

public struct EventListOutput: Encodable, Sendable {
    public let total: Int
    public let offset: Int
    public let returned: Int
    public let events: [EventListItem]
    public init(total: Int, offset: Int, returned: Int, events: [EventListItem]) {
        self.total = total; self.offset = offset; self.returned = returned; self.events = events
    }
}

public struct ReadEventInput: Decodable, Sendable {
    public let id: String
}

public struct AttendeeInfo: Encodable, Sendable {
    public let name: String
    public let email: String
    public let status: String
    public init(name: String, email: String, status: String) {
        self.name = name; self.email = email; self.status = status
    }
}

public struct EventDetail: Encodable, Sendable {
    public let id: String
    public let summary: String
    public let description: String
    public let location: String
    public let startDate: String
    public let endDate: String
    public let allDay: Bool
    public let recurrence: String
    public let url: String
    public let calendar: String
    public let attendees: [AttendeeInfo]
    public init(id: String, summary: String, description: String, location: String,
                startDate: String, endDate: String, allDay: Bool, recurrence: String,
                url: String, calendar: String, attendees: [AttendeeInfo]) {
        self.id = id; self.summary = summary; self.description = description; self.location = location
        self.startDate = startDate; self.endDate = endDate; self.allDay = allDay
        self.recurrence = recurrence; self.url = url; self.calendar = calendar; self.attendees = attendees
    }
}

public struct CreateEventInput: Decodable, Sendable {
    public let title: String
    public let startDate: String
    public let endDate: String
    public let location: String?
    public let notes: String?
    public let calendar: String?
    public let allDay: Bool?
}

public struct MutationOutput: Encodable, Sendable {
    public let id: String
    public let summary: String
    public init(id: String, summary: String) {
        self.id = id; self.summary = summary
    }
}

public struct UpdateEventInput: Decodable, Sendable {
    public let id: String
    public let title: String?
    public let startDate: String?
    public let endDate: String?
    public let location: String?
    public let notes: String?
}

public struct DeleteEventInput: Decodable, Sendable {
    public let id: String
}

public struct DeleteEventOutput: Encodable, Sendable {
    public let deleted: Bool
    public let summary: String
    public init(deleted: Bool, summary: String) {
        self.deleted = deleted; self.summary = summary
    }
}

public struct SearchEventsInput: Decodable, Sendable {
    public let query: String
    public let startDate: String
    public let endDate: String
    public let limit: Int?
}

public struct SearchEventsOutput: Encodable, Sendable {
    public let total: Int
    public let returned: Int
    public let events: [EventListItem]
    public init(total: Int, returned: Int, events: [EventListItem]) {
        self.total = total; self.returned = returned; self.events = events
    }
}

public struct UpcomingEventsInput: Decodable, Sendable {
    public let limit: Int?
    public init(limit: Int? = nil) { self.limit = limit }
}

public struct UpcomingEventsOutput: Encodable, Sendable {
    public let total: Int
    public let returned: Int
    public let events: [UpcomingEventItem]
    public init(total: Int, returned: Int, events: [UpcomingEventItem]) {
        self.total = total; self.returned = returned; self.events = events
    }
}

public struct UpcomingEventItem: Encodable, Sendable {
    public let id: String
    public let summary: String
    public let startDate: String
    public let endDate: String
    public let allDay: Bool
    public let location: String
    public let calendar: String
    public init(id: String, summary: String, startDate: String, endDate: String,
                allDay: Bool, location: String, calendar: String) {
        self.id = id; self.summary = summary; self.startDate = startDate; self.endDate = endDate
        self.allDay = allDay; self.location = location; self.calendar = calendar
    }
}

public struct TodayEventsInput: Decodable, Sendable {}

public struct TodayEventsOutput: Encodable, Sendable {
    public let total: Int
    public let returned: Int
    public let events: [UpcomingEventItem]
    public init(total: Int, returned: Int, events: [UpcomingEventItem]) {
        self.total = total; self.returned = returned; self.events = events
    }
}

// MARK: - EventKit (Reminder CRUD)

public struct ListReminderListsInput: Decodable, Sendable {}

public struct ReminderListInfo: Encodable, Sendable {
    public let id: String
    public let name: String
    public let reminderCount: Int
    public init(id: String, name: String, reminderCount: Int) {
        self.id = id; self.name = name; self.reminderCount = reminderCount
    }
}

public struct ListRemindersInput: Decodable, Sendable {
    public let list: String?
    public let completed: Bool?
    public let limit: Int?
    public let offset: Int?
}

public struct ReminderListItem: Encodable, Sendable {
    public let id: String
    public let name: String
    public let completed: Bool
    public let dueDate: String?
    public let priority: Int
    public let flagged: Bool
    public let list: String
    public init(id: String, name: String, completed: Bool, dueDate: String?,
                priority: Int, flagged: Bool, list: String) {
        self.id = id; self.name = name; self.completed = completed; self.dueDate = dueDate
        self.priority = priority; self.flagged = flagged; self.list = list
    }
}

public struct ReminderListOutput: Encodable, Sendable {
    public let total: Int
    public let offset: Int
    public let returned: Int
    public let reminders: [ReminderListItem]
    public init(total: Int, offset: Int, returned: Int, reminders: [ReminderListItem]) {
        self.total = total; self.offset = offset; self.returned = returned; self.reminders = reminders
    }
}

public struct ReadReminderInput: Decodable, Sendable {
    public let id: String
}

public struct ReminderDetail: Encodable, Sendable {
    public let id: String
    public let name: String
    public let body: String
    public let completed: Bool
    public let completionDate: String?
    public let creationDate: String
    public let modificationDate: String
    public let dueDate: String?
    public let priority: Int
    public let flagged: Bool
    public let list: String
    public init(id: String, name: String, body: String, completed: Bool,
                completionDate: String?, creationDate: String, modificationDate: String,
                dueDate: String?, priority: Int, flagged: Bool, list: String) {
        self.id = id; self.name = name; self.body = body; self.completed = completed
        self.completionDate = completionDate; self.creationDate = creationDate
        self.modificationDate = modificationDate; self.dueDate = dueDate
        self.priority = priority; self.flagged = flagged; self.list = list
    }
}

public struct CreateReminderInput: Decodable, Sendable {
    public let title: String
    public let body: String?
    public let dueDate: String?
    public let priority: Int?
    public let list: String?
}

public struct ReminderMutationOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id; self.name = name
    }
}

public struct UpdateReminderInput: Decodable, Sendable {
    public let id: String
    public let title: String?
    public let body: String?
    public let dueDate: String?
    public let priority: Int?
    public let flagged: Bool?
    public let clearDueDate: Bool?
}

public struct CompleteReminderInput: Decodable, Sendable {
    public let id: String
    public let completed: Bool
}

public struct CompleteReminderOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public let completed: Bool
    public init(id: String, name: String, completed: Bool) {
        self.id = id; self.name = name; self.completed = completed
    }
}

public struct DeleteReminderInput: Decodable, Sendable {
    public let id: String
}

public struct DeleteReminderOutput: Encodable, Sendable {
    public let deleted: Bool
    public let name: String
    public init(deleted: Bool, name: String) {
        self.deleted = deleted; self.name = name
    }
}

public struct SearchRemindersInput: Decodable, Sendable {
    public let query: String
    public let limit: Int?
}

public struct SearchRemindersOutput: Encodable, Sendable {
    public let returned: Int
    public let reminders: [ReminderListItem]
    public init(returned: Int, reminders: [ReminderListItem]) {
        self.returned = returned; self.reminders = reminders
    }
}

public struct CreateReminderListInput: Decodable, Sendable {
    public let name: String
}

public struct ReminderListMutationOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id; self.name = name
    }
}

public struct DeleteReminderListInput: Decodable, Sendable {
    public let name: String
}

// MARK: - Contacts

public struct ListContactsInput: Decodable, Sendable {
    public let limit: Int?
    public let offset: Int?
    public init(limit: Int? = nil, offset: Int? = nil) { self.limit = limit; self.offset = offset }
}

public struct ContactSummary: Encodable, Sendable {
    public let id: String
    public let name: String
    public let email: String?
    public let phone: String?
    public init(id: String, name: String, email: String?, phone: String?) {
        self.id = id; self.name = name; self.email = email; self.phone = phone
    }
}

public struct ContactListOutput: Encodable, Sendable {
    public let total: Int
    public let offset: Int
    public let returned: Int
    public let contacts: [ContactSummary]
    public init(total: Int, offset: Int, returned: Int, contacts: [ContactSummary]) {
        self.total = total; self.offset = offset; self.returned = returned; self.contacts = contacts
    }
}

public struct SearchContactsInput: Decodable, Sendable {
    public let query: String
    public let limit: Int?
}

public struct ContactSearchItem: Encodable, Sendable {
    public let id: String
    public let name: String
    public let organization: String?
    public let email: String?
    public let phone: String?
    public let matchedField: String
    public init(id: String, name: String, organization: String?, email: String?, phone: String?, matchedField: String) {
        self.id = id; self.name = name; self.organization = organization
        self.email = email; self.phone = phone; self.matchedField = matchedField
    }
}

public struct ContactSearchOutput: Encodable, Sendable {
    public let total: Int
    public let returned: Int
    public let contacts: [ContactSearchItem]
    public init(total: Int, returned: Int, contacts: [ContactSearchItem]) {
        self.total = total; self.returned = returned; self.contacts = contacts
    }
}

public struct ReadContactInput: Decodable, Sendable {
    public let id: String
}

public struct ContactLabeledValue: Encodable, Sendable {
    public let value: String
    public let label: String
    public init(value: String, label: String) {
        self.value = value; self.label = label
    }
}

public struct ContactAddress: Encodable, Sendable {
    public let street: String
    public let city: String
    public let state: String
    public let zip: String
    public let country: String
    public let label: String
    public init(street: String, city: String, state: String, zip: String, country: String, label: String) {
        self.street = street; self.city = city; self.state = state
        self.zip = zip; self.country = country; self.label = label
    }
}

public struct ContactDetail: Encodable, Sendable {
    public let id: String
    public let name: String
    public let firstName: String
    public let lastName: String
    public let organization: String?
    public let jobTitle: String?
    public let department: String?
    public let note: String?
    public let emails: [ContactLabeledValue]
    public let phones: [ContactLabeledValue]
    public let addresses: [ContactAddress]
    public init(id: String, name: String, firstName: String, lastName: String,
                organization: String?, jobTitle: String?, department: String?, note: String?,
                emails: [ContactLabeledValue], phones: [ContactLabeledValue], addresses: [ContactAddress]) {
        self.id = id; self.name = name; self.firstName = firstName; self.lastName = lastName
        self.organization = organization; self.jobTitle = jobTitle; self.department = department; self.note = note
        self.emails = emails; self.phones = phones; self.addresses = addresses
    }
}

public struct CreateContactInput: Decodable, Sendable {
    public let firstName: String
    public let lastName: String
    public let email: String?
    public let phone: String?
    public let organization: String?
    public let jobTitle: String?
    public let note: String?
}

public struct ContactMutationOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id; self.name = name
    }
}

public struct UpdateContactInput: Decodable, Sendable {
    public let id: String
    public let firstName: String?
    public let lastName: String?
    public let organization: String?
    public let jobTitle: String?
    public let note: String?
}

public struct DeleteContactInput: Decodable, Sendable {
    public let id: String
}

public struct ContactDeleteOutput: Encodable, Sendable {
    public let deleted: Bool
    public let name: String
    public init(deleted: Bool, name: String) {
        self.deleted = deleted; self.name = name
    }
}

public struct ContactGroupInfo: Encodable, Sendable {
    public let id: String
    public let name: String
    public init(id: String, name: String) {
        self.id = id; self.name = name
    }
}

public struct AddContactEmailInput: Decodable, Sendable {
    public let id: String
    public let email: String
    public let label: String?
}

public struct ContactEmailAddedOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public let addedEmail: String
    public init(id: String, name: String, addedEmail: String) {
        self.id = id; self.name = name; self.addedEmail = addedEmail
    }
}

public struct AddContactPhoneInput: Decodable, Sendable {
    public let id: String
    public let phone: String
    public let label: String?
}

public struct ContactPhoneAddedOutput: Encodable, Sendable {
    public let id: String
    public let name: String
    public let addedPhone: String
    public init(id: String, name: String, addedPhone: String) {
        self.id = id; self.name = name; self.addedPhone = addedPhone
    }
}

public struct ListGroupMembersInput: Decodable, Sendable {
    public let groupName: String
    public let limit: Int?
    public let offset: Int?
}

public struct ContactGroupMembersOutput: Encodable, Sendable {
    public let group: String
    public let total: Int
    public let returned: Int
    public let contacts: [ContactSummary]
    public init(group: String, total: Int, returned: Int, contacts: [ContactSummary]) {
        self.group = group; self.total = total; self.returned = returned; self.contacts = contacts
    }
}

// MARK: - Helpers

/// Thread-safe shared formatters — ISO8601DateFormatter is safe to use from multiple threads.
nonisolated(unsafe) private let iso8601Formatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

nonisolated(unsafe) private let iso8601FractionalFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

public func formatISO8601(_ date: Date) -> String {
    iso8601Formatter.string(from: date)
}

public func parseISO8601(_ string: String) -> Date? {
    if let date = iso8601FractionalFormatter.date(from: string) { return date }
    return iso8601Formatter.date(from: string)
}
