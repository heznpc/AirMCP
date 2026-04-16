---
title: Notes
description: Full CRUD for Apple Notes with folder management, bulk operations, and note comparison.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_notes` | List all notes with title, folder, and dates. Optionally filter by folder name. Supports pagination via limit/offset. | ✅ |
| `search_notes` | Search notes by keyword in title and body. Returns matching notes with a 200-char preview. | ✅ |
| `read_note` | Read the full content of a specific note by its ID. Returns HTML body and plaintext. | ✅ |
| `create_note` | Create a new note with HTML body. The first line of the body becomes the note title automatically. Optionally specify a target folder. | ❌ |
| `update_note` | Replace the entire body of an existing note. WARNING: This overwrites all content. Read the note first if you need to preserve parts of it. Attachments may be lost. | ❌ |
| `delete_note` | Delete a note by ID. The note is moved to Recently Deleted and permanently removed after 30 days. | ❌ |
| `list_folders` | List all folders across all accounts with note counts. | ✅ |
| `create_folder` | Create a new folder. Optionally specify which account to create it in. | ❌ |
| `move_note` | Move a note to a different folder. Copies the note body to the target folder and deletes the original. The note will get a new ID and creation date. Attachments will be lost. | ❌ |
| `scan_notes` | Bulk scan notes returning metadata and a text preview for each. Supports pagination via offset. Optionally filter by folder. | ✅ |
| `compare_notes` | Retrieve full plaintext content of 2-5 notes at once for comparison. | ✅ |
| `bulk_move_notes` | Move multiple notes to a target folder at once. Returns per-note success/failure results. | ❌ |

## Quick Examples

```
// List all notes
"List my notes"

// Search for specific content
"Search notes containing 'project plan'"

// Create a note
"Create a note titled 'Meeting Notes' in the Work folder"

// Organize notes
"Scan all notes and move duplicates to an Archive folder"
```

## Permissions

Requires **Automation** permission for Apple Notes. The host terminal or MCP client must be granted access to control Notes via System Settings > Privacy & Security > Automation.
