---
title: System
description: Clipboard, volume, brightness, dark mode, Wi-Fi, Bluetooth, battery, running apps, windows, notifications, sleep, and power management.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `get_clipboard` | Read the current text content of the system clipboard. | ✅ |
| `set_clipboard` | Write text to the system clipboard, replacing its current content. | ❌ |
| `get_volume` | Get the current system output volume level and mute state. | ✅ |
| `set_volume` | Set the system output volume (0-100) and/or mute state. | ❌ |
| `toggle_dark_mode` | Toggle macOS appearance between dark mode and light mode. | ❌ |
| `get_frontmost_app` | Get the name, bundle identifier, and PID of the currently active application. | ✅ |
| `list_running_apps` | List all running applications with name, bundle identifier, PID, and visibility. | ✅ |
| `get_screen_info` | Get display information including resolution, pixel dimensions, and Retina status. | ✅ |
| `show_notification` | Display a macOS system notification with optional title, subtitle, and sound. | ❌ |
| `capture_screenshot` | Take a screenshot and save to a specified path. Supports full screen, window, or selection capture. | ❌ |
| `get_wifi_status` | Get the current WiFi status including connected network name, signal strength, and channel. | ✅ |
| `toggle_wifi` | Turn WiFi on or off. | ❌ |
| `list_bluetooth_devices` | List paired Bluetooth devices with their connection status. | ✅ |
| `get_battery_status` | Get battery percentage, charging state, power source, and estimated time remaining. | ✅ |
| `get_brightness` | Get the current display brightness level. | ✅ |
| `set_brightness` | Set the display brightness level. Requires the 'brightness' CLI tool (brew install brightness). | ❌ |
| `toggle_focus_mode` | Toggle Do Not Disturb (Focus mode) on or off. | ❌ |
| `system_sleep` | Put the Mac to sleep. | ❌ |
| `prevent_sleep` | Prevent the Mac from sleeping for a specified duration using caffeinate. | ❌ |
| `system_power` | Shutdown or restart the Mac. Use with caution. | ❌ |
| `launch_app` | Launch an application by name. Lightweight -- just activates the app. | ❌ |
| `quit_app` | Quit a running application by name. May cause unsaved work to be lost. | ❌ |
| `is_app_running` | Check whether an application is currently running. Returns process details if found. | ✅ |
| `list_all_windows` | List windows across all running applications with title, size, position, app name, and PID. | ✅ |
| `move_window` | Move a window to a specific position on screen. | ❌ |
| `resize_window` | Resize a window to specific dimensions. | ❌ |
| `minimize_window` | Minimize or restore a window. | ❌ |

## Quick Examples

```
// System status
"What's my battery level?" / "Am I connected to WiFi?"

// Appearance
"Toggle dark mode" / "Set brightness to 50%"

// App management
"Launch Xcode" / "Which apps are running?"

// Window management
"List all open windows" / "Move Safari to the left side of the screen"

// Clipboard
"What's on my clipboard?"
```

## Permissions

Requires **Automation** permission for System Events. Some tools (`set_brightness`) require additional CLI tools installed via Homebrew. The `system_power` tool (shutdown/restart) is destructive and should be used with caution.
