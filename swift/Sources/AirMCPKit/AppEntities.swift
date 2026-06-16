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
        identifiers.map { Entity(id: $0, title: $0, subtitle: nil) }
    }

    public func entities(matching string: String) async throws -> [Entity] {
        []
    }

    public func suggestedEntities() async throws -> [Entity] {
        []
    }
}

public struct AirMCPCalendarEventEntity: AirMCPStringBackedEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Calendar Event")
    public static let defaultQuery = AirMCPStringEntityQuery<AirMCPCalendarEventEntity>()

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
    public static let defaultQuery = AirMCPStringEntityQuery<AirMCPReminderEntity>()

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
    public static let defaultQuery = AirMCPStringEntityQuery<AirMCPContactEntity>()

    public let id: String
    public let title: String
    public let subtitle: String?

    public init(id: String, title: String, subtitle: String? = nil) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
    }
}
#endif
