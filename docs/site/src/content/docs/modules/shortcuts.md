---
title: Shortcuts
description: List, search and run Siri Shortcuts; create and edit via UI automation. Plus dynamic per-shortcut tools.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_shortcuts` | List all available Siri Shortcuts on this Mac. | ✅ |
| `run_shortcut` | Run a Siri Shortcut by name. Optionally provide text input. Returns the shortcut's output. | ❌ |
| `search_shortcuts` | Search Siri Shortcuts by name keyword. | ✅ |
| `create_shortcut` | Create a new Siri Shortcut by name. Uses UI automation to open the Shortcuts app. | ❌ |
| `edit_shortcut` | Open a Siri Shortcut in the Shortcuts app for manual editing via UI automation. | ❌ |
| `shortcut_*` (dynamic) | Each user shortcut is also registered as an individual tool (`shortcut_<name>`) for direct invocation. | ❌ |

## Quick Examples

```
// Discover shortcuts
"List all my Siri Shortcuts"

// Run a shortcut
"Run the 'Morning Routine' shortcut"

// Open for manual editing (takes focus)
"Open 'Daily Report' in the Shortcuts editor"

// Search
"Search for shortcuts related to 'photos'"
```

## Permissions


The macOS `shortcuts` CLI supports listing and running shortcuts, but does not expose action details or delete/export/import/duplicate commands. Use the Shortcuts app for those operations. `create_shortcut` and `edit_shortcut` use UI automation and require Accessibility permission; they open the app and take focus. Dynamic shortcut tools are registered at startup.
