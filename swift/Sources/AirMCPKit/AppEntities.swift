// AirMCPKit - AppEntity scaffold for typed App Intents parameters.
//
// These entities intentionally avoid schema-annotated AppEntity macros for now. Apple's
// public AppIntents SDK exposes schema macros only for official
// AssistantSchemas constants; the Calendar / Reminders / Contacts domains
// AirMCP needs first do not have public schema constants in the local SDK.

#if canImport(AppIntents)
import AppIntents
import Foundation

public protocol AirMCPStringBackedEntity: AppEntity, Codable, Hashable, Sendable where ID == String {
    var id: String { get }
    var title: String { get }
    var subtitle: String? { get }

    init(id: String, title: String, subtitle: String?)
}

public extension AirMCPStringBackedEntity {
    var displayRepresentation: DisplayRepresentation {
        if let subtitle, !subtitle.isEmpty {
            return DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
        }
        return DisplayRepresentation(title: "\(title)")
    }
}

public struct AirMCPStringEntityQuery<Entity: AirMCPStringBackedEntity>: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [Entity.ID]) async throws -> [Entity] {
        identifiers.map { Self.syntheticEntity(id: $0) }
    }

    public func entities(matching string: String) async throws -> [Entity] {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        return [Self.syntheticEntity(id: trimmed)]
    }

    public func suggestedEntities() async throws -> [Entity] {
        []
    }

    public static func syntheticEntity(id: String) -> Entity {
        Entity(id: id, title: id, subtitle: "AirMCP ID")
    }
}

public struct AirMCPCalendarEventEntity: AirMCPStringBackedEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Calendar Event")
    public static let defaultQuery = AirMCPCalendarEventQuery()

    public let id: String
    public let title: String
    public let subtitle: String?

    public init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

public struct AirMCPReminderEntity: AirMCPStringBackedEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Reminder")
    public static let defaultQuery = AirMCPReminderQuery()

    public let id: String
    public let title: String
    public let subtitle: String?

    public init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

public struct AirMCPContactEntity: AirMCPStringBackedEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Contact")
    public static let defaultQuery = AirMCPContactQuery()

    public let id: String
    public let title: String
    public let subtitle: String?

    public init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}

public struct AirMCPCalendarEventQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [AirMCPCalendarEventEntity.ID]) async throws -> [AirMCPCalendarEventEntity] {
        let service = EventKitService()
        var entities: [AirMCPCalendarEventEntity] = []
        for id in identifiers {
            if let detail = try? await service.readEvent(ReadEventInput(id: id)) {
                entities.append(AirMCPCalendarEventEntity(
                    id: detail.id,
                    title: titleOrId(detail.summary, id: id),
                    subtitle: joinedSubtitle([detail.startDate, detail.calendar])
                ))
            } else {
                entities.append(AirMCPStringEntityQuery<AirMCPCalendarEventEntity>.syntheticEntity(id: id))
            }
        }
        return entities
    }

    public func entities(matching string: String) async throws -> [AirMCPCalendarEventEntity] {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try await suggestedEntities() }

        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -30, to: now) ?? now
        let end = Calendar.current.date(byAdding: .month, value: 6, to: now) ?? now
        if let output = try? await EventKitService().searchEvents(SearchEventsInput(
            query: trimmed,
            startDate: formatISO8601(start),
            endDate: formatISO8601(end),
            limit: 10
        )), !output.events.isEmpty {
            return output.events.map(eventEntity)
        }
        return [AirMCPStringEntityQuery<AirMCPCalendarEventEntity>.syntheticEntity(id: trimmed)]
    }

    public func suggestedEntities() async throws -> [AirMCPCalendarEventEntity] {
        guard let output = try? await EventKitService().getUpcomingEvents(UpcomingEventsInput(limit: 10)) else {
            return []
        }
        return output.events.map { event in
            AirMCPCalendarEventEntity(
                id: event.id,
                title: titleOrId(event.summary, id: event.id),
                subtitle: joinedSubtitle([event.startDate, event.calendar])
            )
        }
    }
}

public struct AirMCPReminderQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [AirMCPReminderEntity.ID]) async throws -> [AirMCPReminderEntity] {
        let service = EventKitService()
        var entities: [AirMCPReminderEntity] = []
        for id in identifiers {
            if let detail = try? await service.readReminder(ReadReminderInput(id: id)) {
                entities.append(AirMCPReminderEntity(
                    id: detail.id,
                    title: titleOrId(detail.name, id: id),
                    subtitle: joinedSubtitle([detail.dueDate, detail.list])
                ))
            } else {
                entities.append(AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticEntity(id: id))
            }
        }
        return entities
    }

    public func entities(matching string: String) async throws -> [AirMCPReminderEntity] {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try await suggestedEntities() }

        if let output = try? await EventKitService().searchReminders(SearchRemindersInput(
            query: trimmed,
            limit: 10
        )), !output.reminders.isEmpty {
            return output.reminders.map(reminderEntity)
        }
        return [AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticEntity(id: trimmed)]
    }

    public func suggestedEntities() async throws -> [AirMCPReminderEntity] {
        guard let output = try? await EventKitService().listReminders(ListRemindersInput(
            list: nil,
            completed: false,
            limit: 10,
            offset: 0
        )) else {
            return []
        }
        return output.reminders.map(reminderEntity)
    }
}

public struct AirMCPContactQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [AirMCPContactEntity.ID]) async throws -> [AirMCPContactEntity] {
        let service = ContactsService()
        var entities: [AirMCPContactEntity] = []
        for id in identifiers {
            if let detail = try? await service.readContact(ReadContactInput(id: id)) {
                entities.append(AirMCPContactEntity(
                    id: detail.id,
                    title: titleOrId(detail.name, id: id),
                    subtitle: joinedSubtitle([detail.organization, detail.emails.first?.value])
                ))
            } else {
                entities.append(AirMCPStringEntityQuery<AirMCPContactEntity>.syntheticEntity(id: id))
            }
        }
        return entities
    }

    public func entities(matching string: String) async throws -> [AirMCPContactEntity] {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try await suggestedEntities() }

        if let output = try? await ContactsService().searchContacts(SearchContactsInput(
            query: trimmed,
            limit: 10
        )), !output.contacts.isEmpty {
            return output.contacts.map(contactEntity)
        }
        return [AirMCPStringEntityQuery<AirMCPContactEntity>.syntheticEntity(id: trimmed)]
    }

    public func suggestedEntities() async throws -> [AirMCPContactEntity] {
        guard let output = try? await ContactsService().listContacts(ListContactsInput(
            limit: 10,
            offset: 0
        )) else {
            return []
        }
        return output.contacts.map { contact in
            AirMCPContactEntity(
                id: contact.id,
                title: titleOrId(contact.name, id: contact.id),
                subtitle: joinedSubtitle([contact.email, contact.phone])
            )
        }
    }
}

private func eventEntity(_ event: EventListItem) -> AirMCPCalendarEventEntity {
    AirMCPCalendarEventEntity(
        id: event.id,
        title: titleOrId(event.summary, id: event.id),
        subtitle: joinedSubtitle([event.startDate, event.calendar])
    )
}

private func reminderEntity(_ reminder: ReminderListItem) -> AirMCPReminderEntity {
    AirMCPReminderEntity(
        id: reminder.id,
        title: titleOrId(reminder.name, id: reminder.id),
        subtitle: joinedSubtitle([reminder.dueDate, reminder.list])
    )
}

private func contactEntity(_ contact: ContactSearchItem) -> AirMCPContactEntity {
    AirMCPContactEntity(
        id: contact.id,
        title: titleOrId(contact.name, id: contact.id),
        subtitle: joinedSubtitle([contact.organization, contact.email, contact.phone])
    )
}

private func titleOrId(_ title: String, id: String) -> String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? id : trimmed
}

private func joinedSubtitle(_ parts: [String?]) -> String? {
    let nonEmpty = parts.compactMap { value -> String? in
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
    return nonEmpty.isEmpty ? nil : nonEmpty.joined(separator: " - ")
}
#endif
