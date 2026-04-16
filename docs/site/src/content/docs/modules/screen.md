---
title: Screen
description: Screen capture tools for full screen, window, area screenshots, window listing, and screen recording.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `capture_screen` | Capture a full-screen screenshot as a PNG image. Optionally specify a display number for multi-monitor setups. | ❌ |
| `capture_window` | Capture a screenshot of the frontmost window. Optionally specify an app name to activate first. | ❌ |
| `capture_area` | Capture a screenshot of a specific rectangular region of the screen. Coordinates are in screen pixels. | ❌ |
| `list_windows` | List all visible windows across all running applications with app name, bundle ID, title, position, and size. | ✅ |
| `record_screen` | Record the screen for a specified duration (1-60 seconds). Returns the recording as a .mov file path. | ❌ |

## Quick Examples

```
// Screenshot
"Take a screenshot of my screen"
"Capture the Safari window"
"Capture the area at coordinates (100, 100) with size 800x600"

// Window info
"List all visible windows"

// Recording
"Record my screen for 10 seconds"
```

## Permissions

Requires **Screen Recording** permission for the host terminal or MCP client. Grant access via System Settings > Privacy & Security > Screen Recording. The `list_windows` tool also requires **Accessibility** permissions.
