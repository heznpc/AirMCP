---
title: UI
description: UI automation via Accessibility APIs -- read UI trees, click elements, type text, inspect menus, query elements, and diff UI state.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `ui_open_app` | Open an application by name or bundle ID and return an accessibility tree summary. | ❌ |
| `ui_click` | Click a UI element by exact screen coordinates or by searching for text. Optionally filter by accessibility role. | ❌ |
| `ui_type` | Type text into the currently focused field using simulated keystrokes via System Events. | ❌ |
| `ui_press_key` | Send a key or key combination (e.g. Return, Cmd+S, Ctrl+C). Supports modifier and special keys. | ❌ |
| `ui_scroll` | Scroll in the specified direction within the frontmost window. | ❌ |
| `ui_read` | Read the accessibility tree of the frontmost app (or specified app). Returns structured UI element data. | ✅ |
| `ui_accessibility_query` | Search for UI elements by accessibility attributes (role, title, value, description, identifier). More precise than ui_read. | ✅ |
| `ui_perform_action` | Find a UI element by locator and perform an accessibility action (press, pick, confirm, setValue, raise, showMenu). | ❌ |
| `ui_traverse` | Breadth-first traversal of the accessibility tree. Returns a flat list of all UI elements with relationships. | ✅ |
| `ui_diff` | Compare the current UI state against a previous snapshot to detect changes (added, removed, changed elements). | ✅ |

## Quick Examples

```
// Read UI state
"Read the accessibility tree of Safari"

// Interact with UI
"Click the 'Submit' button in the frontmost app"
"Type 'Hello World' into the current text field"

// Keyboard shortcuts
"Press Cmd+S to save"

// Advanced queries
"Find all AXButton elements with title containing 'OK' in Finder"
```

## Permissions

Requires **Accessibility** permission for the host terminal or MCP client. Grant access via System Settings > Privacy & Security > Accessibility. Works on any app, including those without AppleScript support.
