---
title: Google
description: Google Workspace integration -- Gmail, Google Calendar, Drive, Sheets, Docs, Tasks, Contacts via GWS CLI.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `gws_status` | Check if Google Workspace CLI (gws) is installed and authenticated. | ✅ |
| `gws_gmail_list` | List recent Gmail messages. Supports query filters (e.g. 'from:alice is:unread'). | ✅ |
| `gws_gmail_read` | Read a Gmail message by ID. Returns subject, from, to, date, and body. | ✅ |
| `gws_gmail_send` | Send an email via Gmail. Requires `allowSendMail` config. | ❌ |
| `gws_drive_list` | List files in Google Drive. Supports query filters. | ✅ |
| `gws_drive_read` | Get metadata for a Google Drive file by ID. | ✅ |
| `gws_drive_search` | Full-text search across Google Drive files by content or name. | ✅ |
| `gws_sheets_read` | Read cell values from a Google Sheets spreadsheet. | ✅ |
| `gws_sheets_write` | Write values to a Google Sheets range. | ❌ |
| `gws_calendar_list` | List upcoming events from Google Calendar. | ✅ |
| `gws_calendar_create` | Create an event in Google Calendar. | ❌ |
| `gws_docs_read` | Read the content of a Google Doc by document ID. | ✅ |
| `gws_tasks_list` | List tasks from Google Tasks (default task list). | ✅ |
| `gws_tasks_create` | Create a task in Google Tasks. | ❌ |
| `gws_people_search` | Search contacts in Google People/Contacts. | ✅ |
| `gws_raw` | Execute any Google Workspace CLI command. For advanced use when specific tools don't cover your need. | ❌ |

## Quick Examples

```
// Gmail
"List my unread Gmail messages"
"Read Gmail message with ID abc123"

// Drive
"Search Google Drive for files about 'quarterly report'"

// Sheets
"Read cells A1:D10 from spreadsheet abc123"

// Calendar
"List my upcoming Google Calendar events"

// Tasks
"Create a Google Task: 'Review PR #42' due tomorrow"
```

## Permissions

Requires the **Google Workspace CLI** (`@googleworkspace/cli`) installed separately. Install with: `npm install -g @googleworkspace/cli && gws auth setup`. The `gws_gmail_send` tool and destructive `gws_raw` operations require `allowSendMail: true` in config or `AIRMCP_ALLOW_SEND_MAIL=true`.
