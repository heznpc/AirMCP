---
title: Reminders
description: Full CRUD for Apple Reminders with lists, search, completion, and recurring reminders.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_reminder_lists` | List all reminder lists with reminder counts. | ✅ |
| `list_reminders` | List reminders. Optionally filter by list name and/or completion status. Supports pagination via limit/offset. | ✅ |
| `read_reminder` | Read the full details of a specific reminder by ID. | ✅ |
| `create_reminder` | Create a new reminder. Optionally set notes, due date, priority (0=none, 1-4=high, 5=medium, 6-9=low), and target list. | ❌ |
| `update_reminder` | Update reminder properties. Only specified fields are changed. Set dueDate to null to clear it. | ❌ |
| `complete_reminder` | Mark a reminder as completed or un-complete it. | ❌ |
| `delete_reminder` | Delete a reminder by ID. This action is permanent. | ❌ |
| `search_reminders` | Search reminders by keyword in name or body across all lists (case-insensitive). | ✅ |
| `create_reminder_list` | Create a new reminder list. | ❌ |
| `delete_reminder_list` | Delete a reminder list by name. This action is permanent and removes all reminders in the list. | ❌ |
| `create_recurring_reminder` | Create a recurring reminder via EventKit. Supports daily, weekly, monthly, and yearly recurrence. Requires macOS 26+ Swift bridge. | ❌ |

## Quick Examples

```
// View upcoming tasks
"Show my incomplete reminders due this week"

// Create a task
"Add a reminder to call the dentist tomorrow at 10am with high priority"

// Recurring tasks
"Create a weekly recurring reminder to submit timesheets every Friday"
```

## Permissions

Requires **Automation** permission for Apple Reminders (JXA path) or **Reminders** permission (Swift/EventKit path). The `create_recurring_reminder` tool requires the macOS 26+ Swift bridge.
