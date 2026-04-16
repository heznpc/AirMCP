---
title: Shortcuts
description: List, search, run, create, delete, export, import, duplicate, and edit Siri Shortcuts. Plus dynamic per-shortcut tools.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_shortcuts` | List all available Siri Shortcuts on this Mac. | ✅ |
| `run_shortcut` | Run a Siri Shortcut by name. Optionally provide text input. Returns the shortcut's output. | ❌ |
| `search_shortcuts` | Search Siri Shortcuts by name keyword. | ✅ |
| `get_shortcut_detail` | Get details about a Siri Shortcut including its actions. | ✅ |
| `create_shortcut` | Create a new Siri Shortcut by name. Uses UI automation to open the Shortcuts app. | ❌ |
| `delete_shortcut` | Delete a Siri Shortcut by name. Uses the macOS shortcuts CLI (macOS 13+). This action is permanent. | ❌ |
| `export_shortcut` | Export a Siri Shortcut to a .shortcut file. | ❌ |
| `import_shortcut` | Import a .shortcut file into Siri Shortcuts. | ❌ |
| `duplicate_shortcut` | Duplicate an existing Siri Shortcut with a new name. | ❌ |
| `edit_shortcut` | Open a Siri Shortcut in the Shortcuts app for manual editing via UI automation. | ❌ |
| `shortcut_*` (dynamic) | Each user shortcut is also registered as an individual tool (`shortcut_<name>`) for direct invocation. | ❌ |

## Quick Examples

```
// Discover shortcuts
"List all my Siri Shortcuts"

// Run a shortcut
"Run the 'Morning Routine' shortcut"

// Manage
"Export 'Daily Report' shortcut to my Desktop"

// Search
"Search for shortcuts related to 'photos'"
```

## Permissions

Requires **Automation** permission for Shortcuts app and System Events. The `delete_shortcut` tool uses the macOS `shortcuts` CLI (macOS 13+). Dynamic shortcut tools are registered at startup by discovering user shortcuts.
