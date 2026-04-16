---
title: Calendar
description: Full CRUD for Apple Calendar events with today view, upcoming events, search, and recurring events.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_calendars` | List all calendars with name, color, and writable status. | ✅ |
| `list_events` | List events within a date range. Requires startDate and endDate (ISO 8601). Optionally filter by calendar name. Supports limit/offset pagination. | ✅ |
| `read_event` | Read full details of a calendar event by ID. Includes attendees (read-only), location, description, and recurrence info. | ✅ |
| `create_event` | Create a new calendar event. Recurring events and attendees cannot be added via this tool. | ❌ |
| `update_event` | Update event properties. Only specified fields are changed. Attendees and recurrence rules cannot be modified. | ❌ |
| `delete_event` | Delete a calendar event by ID. This action is permanent. | ❌ |
| `search_events` | Search events by keyword in title or description within a date range. | ✅ |
| `get_upcoming_events` | Get the next N upcoming events from now (searches up to 30 days ahead). | ✅ |
| `today_events` | Get all calendar events for today. | ✅ |
| `create_recurring_event` | Create a recurring calendar event via EventKit. Supports daily, weekly, monthly, and yearly recurrence. Requires macOS 26+ Swift bridge. | ❌ |

## Quick Examples

```
// Daily briefing
"What's on my calendar today?"

// Find events
"Search for meetings about 'budget review' in March"

// Create an event
"Schedule a team standup tomorrow at 9am for 30 minutes"

// Recurring events
"Create a weekly team meeting every Monday at 10am"
```

## Permissions

Requires **Automation** permission for Apple Calendar (JXA path) or **Calendar** permission (Swift/EventKit path). The `create_recurring_event` tool requires the macOS 26+ Swift bridge.
