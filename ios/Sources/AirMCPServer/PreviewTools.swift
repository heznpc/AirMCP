// AirMCPServer — deliberately narrow iOS preview catalog.
//
// The iOS server does not yet share the macOS/Node HITL, rate-limit, and
// HMAC-audit governance path. Until it does, only this exact read-only set is
// registrable or callable. Names intentionally match the generated AppIntent
// router names so an iOS action cannot silently target a different contract.

import AirMCPKit

public enum IOSPreviewContract {
    public static let toolNames: Set<String> = [
        "get_location_permission",
        "list_calendars",
        "list_contacts",
        "list_reminder_lists",
        "list_reminders",
        "search_contacts",
        "search_reminders",
        "today_events",
    ]

    public static func allows(name: String, readOnly: Bool, destructive: Bool) -> Bool {
        readOnly && !destructive && toolNames.contains(name)
    }
}

/// Register the complete iOS preview surface. This is intentionally not a
/// parity registry: adding an action requires adding its exact public MCP name
/// to `IOSPreviewContract.toolNames` and keeping it read-only.
public func registerIOSPreviewTools(on server: MCPServer) async {
    let eventKit = EventKitService()
    await server.registerTool(ListCalendarsTool(service: eventKit))
    await server.registerTool(TodayEventsTool(service: eventKit))
    await server.registerTool(ListReminderListsTool(service: eventKit))
    await server.registerTool(ListRemindersTool(service: eventKit))
    await server.registerTool(SearchRemindersTool(service: eventKit))

    let contacts = ContactsService()
    await server.registerTool(ListContactsTool(service: contacts))
    await server.registerTool(SearchContactsTool(service: contacts))

    await server.registerTool(LocationPermissionTool())
}
