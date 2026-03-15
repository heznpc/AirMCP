<p align="center">
  <img src="icons/airmcp-icon-256.png" alt="AirMCP" width="128">
</p>

# AirMCP

[![CI](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/airmcp)](https://www.npmjs.com/package/airmcp)
[![npm downloads](https://img.shields.io/npm/dm/airmcp)](https://www.npmjs.com/package/airmcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org/)

MCP server for the entire Apple ecosystem — Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Apple Intelligence, TV, Screen Capture, Maps, Podcasts, Weather, Pages, Numbers, Keynote, Location, and Bluetooth. Connect any AI to your Mac.

> Available in multiple languages at the [project landing page](https://heznpc.github.io/AirMCP/).

## Features

- **252 tools** (25 modules) — Apple app CRUD + system control + Apple Intelligence + UI Automation + Screen Capture + Maps + Podcasts + Weather + iWork (Pages/Numbers/Keynote) + Google Workspace + dynamic shortcuts
- **30 prompts** — per-app workflows (notes, calendar, reminders, shortcuts) + cross-module + developer workflows + YAML skills
- **11 MCP resources** — Notes, Calendar, Reminders, Music, Mail, System live data URIs
- **JXA + Swift bridge** — JXA for basic automation, EventKit/PhotoKit for advanced features
- **Recurring events/reminders** — EventKit recurrence rules (macOS 26+ Swift bridge)
- **Photo import/delete** — PhotoKit photo management (macOS 26+ Swift bridge)
- **Apple Intelligence** — On-device summarize, rewrite, proofread (macOS 26+)
- **Native menubar app** — SwiftUI companion with onboarding wizard, auto-start, log viewer, update notifications, permission setup
- **One-click setup** — `setup_permissions` tool or menubar app to request all macOS permissions at once
- **Dual transport** — stdio (default, safe local) + HTTP/SSE (`--http`) for remote agents and registries
- **Safety annotations** — readOnly/destructive hints on all tools

## Get Started (2 minutes)

### 1. Install Node.js

If you don't have Node.js, install it first:

```bash
# Using Homebrew (recommended)
brew install node

# Or download from https://nodejs.org (LTS version)
```

### 2. Run the Setup Wizard

```bash
npx airmcp init
```

This will:
- Let you choose which Apple apps to connect (Notes, Calendar, Reminders, etc.)
- Automatically configure your MCP client
- Save your preferences to `~/.config/airmcp/config.json`

### 3. Restart Your MCP Client

That's it! Your AI can now read your notes, manage reminders, check your calendar, and more.

### Troubleshooting

```bash
npx airmcp doctor
```

Checks Node.js version, config files, MCP client setup, macOS permissions, and module status — all in one command.

## Try It — Talk to Your Mac

Once connected, just ask your AI in natural language. Here are some things you can try:

**Everyday**
- "Read my latest notes and summarize them"
- "What's on my calendar today?"
- "Show me overdue reminders and reschedule them to tomorrow"
- "Play some jazz on Apple Music"

**Productivity**
- "Draft a meeting agenda in Notes, then create calendar events for each topic"
- "Find all emails from Alex about the project and create reminders for action items"
- "Search my contacts for everyone at Acme Corp"

**System Control**
- "Turn on dark mode, set volume to 50%, and lower brightness"
- "Take a screenshot and save it to my Desktop"
- "What apps are running right now? Quit anything I'm not using"

**Research & Web**
- "Open the Apple developer docs in Safari and summarize the page"
- "Search my Safari tabs for that article I was reading about Swift"

**Power User**
- "Scan nearby Bluetooth devices"
- "Get my current GPS coordinates and show the weather here"
- "Record my screen for 10 seconds"
- "Run my 'Morning Routine' shortcut"

**Cross-App Workflows**
- "Check today's meetings, find related notes, and create a prep checklist in Reminders"
- "Search my files for the Q1 report, read it, and draft a summary email to the team"

These are just starting points — with 252 tools across 25 Apple apps, the combinations are endless.

---

## Client Setup

Works with any MCP-compatible client. Examples:

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add airmcp -- npx -y airmcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Other MCP Clients

Any client that supports the MCP stdio transport can use AirMCP. Use `npx -y airmcp` as the server command.

### Local Development

```bash
git clone https://github.com/heznpc/AirMCP.git
cd AirMCP
npm install
npm run build
node dist/index.js
```

### Menubar App (Optional)

A native SwiftUI companion app for server status monitoring and permission setup.

```bash
cd app && swift build -c release
# Binary: app/.build/release/AirMCPApp
```

Features: onboarding wizard, auto-start on login, log viewer, update notifications, server status, one-click permission setup, MCP client config clipboard copy.

### HTTP Mode

HTTP server mode for remote agents, registries, and multi-client setups:

```bash
npx airmcp --http --port 3847
```

- Endpoint: `POST/GET/DELETE /mcp`
- Transport: Streamable HTTP + SSE (MCP spec 2024-11-05)
- Session management via `Mcp-Session-Id` header
- Default port: 3847

Useful for running a Mac Mini as an "always-on AI hub."

## Tools

### Notes (12 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_notes` | List all notes with title, folder, dates | read |
| `search_notes` | Search by keyword in title and body | read |
| `read_note` | Read full content by ID | read |
| `create_note` | Create a note with HTML body | write |
| `update_note` | Replace entire body | destructive |
| `delete_note` | Delete (moved to Recently Deleted) | destructive |
| `move_note` | Move to another folder | destructive |
| `list_folders` | List folders with note counts | read |
| `create_folder` | Create a new folder | write |
| `scan_notes` | Bulk scan with metadata and preview | read |
| `compare_notes` | Compare 2-5 notes side by side | read |
| `bulk_move_notes` | Move multiple notes at once | destructive |

### Reminders (11 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_reminder_lists` | List all lists with counts | read |
| `list_reminders` | Filter by list/completed | read |
| `read_reminder` | Full details by ID | read |
| `create_reminder` | Create with due date/priority | write |
| `update_reminder` | Update properties | destructive |
| `complete_reminder` | Mark complete/incomplete | write |
| `delete_reminder` | Delete permanently | destructive |
| `search_reminders` | Search by keyword in name/body | read |
| `create_reminder_list` | Create a new reminder list | write |
| `delete_reminder_list` | Delete a reminder list | destructive |
| `create_recurring_reminder` | Create with recurrence rule (Swift/EventKit) | write |

### Calendar (10 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_calendars` | List calendars with name/color | read |
| `list_events` | Events in date range with pagination | read |
| `read_event` | Full details with attendees | read |
| `create_event` | Create with location/description | write |
| `update_event` | Update properties | destructive |
| `delete_event` | Delete permanently | destructive |
| `search_events` | Keyword search in date range | read |
| `get_upcoming_events` | Next N events from now | read |
| `today_events` | All events for today | read |
| `create_recurring_event` | Create with recurrence rule (Swift/EventKit) | write |

### Contacts (10 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_contacts` | List with email/phone, pagination | read |
| `search_contacts` | Search by name, email, phone, or org | read |
| `read_contact` | Full details (emails, phones, addresses) | read |
| `create_contact` | Create with email/phone/org | write |
| `update_contact` | Update properties | destructive |
| `delete_contact` | Delete permanently | destructive |
| `list_groups` | List contact groups | read |
| `add_contact_email` | Add email to existing contact | write |
| `add_contact_phone` | Add phone to existing contact | write |
| `list_group_members` | List contacts in a group | read |

### Mail (11 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_mailboxes` | List mailboxes with unread counts | read |
| `list_messages` | Recent messages in a mailbox | read |
| `read_message` | Full message content | read |
| `search_messages` | Search by subject/sender | read |
| `mark_message_read` | Mark read/unread | write |
| `flag_message` | Flag/unflag a message | write |
| `get_unread_count` | Total unread across all mailboxes | read |
| `move_message` | Move message to another mailbox | destructive |
| `list_accounts` | List all mail accounts | read |
| `send_mail` | Compose and send an email | write |
| `reply_mail` | Reply to an email message | write |

### Music (17 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_playlists` | List playlists with track counts | read |
| `list_tracks` | Tracks in a playlist | read |
| `now_playing` | Current track and playback state | read |
| `playback_control` | Play, pause, next, previous | write |
| `search_tracks` | Search by name/artist/album | read |
| `play_track` | Play a specific track by name | write |
| `play_playlist` | Start playing a playlist | write |
| `get_track_info` | Detailed track metadata | read |
| `set_shuffle` | Set shuffle and repeat mode | write |
| `create_playlist` | Create a new playlist | write |
| `add_to_playlist` | Add a track to a playlist | write |
| `remove_from_playlist` | Remove a track from a playlist | destructive |
| `delete_playlist` | Delete an existing playlist | destructive |
| `get_rating` | Get rating, favorited, and disliked status | read |
| `set_rating` | Set star rating (0-100) for a track | write |
| `set_favorited` | Mark or unmark a track as favorited | write |
| `set_disliked` | Mark or unmark a track as disliked | write |

### Finder (8 tools)

| Tool | Description | Type |
|------|-------------|------|
| `search_files` | Spotlight file search | read |
| `get_file_info` | File info (size, dates, tags) | read |
| `set_file_tags` | Set Finder tags | destructive |
| `recent_files` | Recently modified files | read |
| `list_directory` | List files in directory | read |
| `move_file` | Move/rename file | destructive |
| `trash_file` | Move to Trash | destructive |
| `create_directory` | Create new directory | write |

### Safari (12 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_tabs` | List tabs across all windows | read |
| `read_page_content` | Read page text content | read |
| `get_current_tab` | Current active tab URL/title | read |
| `open_url` | Open URL in Safari | write |
| `close_tab` | Close a specific tab | destructive |
| `activate_tab` | Switch to a specific tab | write |
| `run_javascript` | Execute JavaScript in tab | write |
| `search_tabs` | Search tabs by title/URL | read |
| `list_bookmarks` | List all bookmarks across folders | read |
| `add_bookmark` | Add a bookmark to Safari | write |
| `list_reading_list` | List Reading List items | read |
| `add_to_reading_list` | Add URL to Reading List | write |

### System (27 tools)

| Tool | Description | Type |
|------|-------------|------|
| `get_clipboard` | Read clipboard content | read |
| `set_clipboard` | Write to clipboard | write |
| `get_volume` | Get system volume | read |
| `set_volume` | Set system volume | write |
| `toggle_dark_mode` | Toggle dark/light mode | write |
| `get_frontmost_app` | Get frontmost application | read |
| `list_running_apps` | List running applications | read |
| `get_screen_info` | Display information | read |
| `show_notification` | Show system notification | write |
| `capture_screenshot` | Capture screenshot (full/window/selection) | write |
| `get_wifi_status` | WiFi connection status and signal | read |
| `toggle_wifi` | Turn WiFi on or off | write |
| `list_bluetooth_devices` | List paired Bluetooth devices | read |
| `get_battery_status` | Battery percentage, charging, time remaining | read |
| `get_brightness` | Get display brightness level | read |
| `set_brightness` | Set display brightness level | write |
| `toggle_focus_mode` | Toggle Do Not Disturb on or off | write |
| `system_sleep` | Put system to sleep | write |
| `prevent_sleep` | Keep system awake for N seconds | write |
| `system_power` | Shutdown or restart the system | destructive |
| `launch_app` | Launch/activate an application | write |
| `quit_app` | Quit a running application | destructive |
| `is_app_running` | Check if an application is running | read |
| `list_all_windows` | List all windows across all apps | read |
| `move_window` | Move a window to specific coordinates | write |
| `resize_window` | Resize a window | write |
| `minimize_window` | Minimize or restore a window | write |

### Photos (9 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_albums` | List albums | read |
| `list_photos` | List photos in album | read |
| `search_photos` | Search photos by keyword | read |
| `get_photo_info` | Photo metadata details | read |
| `list_favorites` | List favorite photos | read |
| `create_album` | Create new album | write |
| `add_to_album` | Add photo to album | write |
| `import_photo` | Import photo from file (Swift/PhotoKit) | write |
| `delete_photos` | Delete photos by ID (Swift/PhotoKit) | destructive |

### Messages (6 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_chats` | Recent conversations with participants | read |
| `read_chat` | Chat details (participants, last update) | read |
| `search_chats` | Search by name/participant/handle | read |
| `send_message` | Send iMessage/SMS text | write |
| `send_file` | Send file via iMessage/SMS | write |
| `list_participants` | List chat participants | read |

### Shortcuts (10 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_shortcuts` | List available shortcuts | read |
| `run_shortcut` | Run shortcut by name | write |
| `search_shortcuts` | Search shortcuts by name | read |
| `get_shortcut_detail` | Shortcut details/actions | read |
| `create_shortcut` | Create a new shortcut via UI automation | write |
| `delete_shortcut` | Delete shortcut by name (macOS 13+) | destructive |
| `export_shortcut` | Export shortcut to .shortcut file | write |
| `import_shortcut` | Import shortcut from .shortcut file | write |
| `edit_shortcut` | Open shortcut in Shortcuts app for editing | write |
| `duplicate_shortcut` | Duplicate an existing shortcut | write |

### UI Automation (10 tools)

| Tool | Description | Type |
|------|-------------|------|
| `ui_open_app` | Open app and read accessibility summary | read |
| `ui_click` | Click element by coordinates or text | write |
| `ui_type` | Type text into focused field | write |
| `ui_press_key` | Send key combinations | write |
| `ui_scroll` | Scroll in direction | write |
| `ui_read` | Read app accessibility tree | read |
| `ui_accessibility_query` | Query UI elements by role/title/value/identifier | read |
| `ui_perform_action` | Find element by locator + perform AX action | write |
| `ui_traverse` | BFS traverse with PID targeting + visible filter | read |
| `ui_diff` | Compare UI state before/after an action | read |

### Apple Intelligence (8 tools)

Requires macOS 26+ with Apple Silicon.

| Tool | Description | Type |
|------|-------------|------|
| `summarize_text` | On-device text summarization | read |
| `rewrite_text` | Rewrite with specified tone | read |
| `proofread_text` | Grammar/spelling correction | read |
| `generate_text` | Generate text with custom instructions via on-device AI | read |
| `generate_structured` | Generate structured JSON output with schema | read |
| `tag_content` | Content classification/tagging with confidence | read |
| `ai_chat` | Named multi-turn on-device AI session | read |
| `ai_status` | Check Foundation Model availability | read |

### TV (6 tools)

| Tool | Description | Type |
|------|-------------|------|
| `tv_list_playlists` | List Apple TV playlists (library) | read |
| `tv_list_tracks` | List movies/episodes in playlist | read |
| `tv_now_playing` | Currently playing content | read |
| `tv_playback_control` | Play/pause/next/previous control | write |
| `tv_search` | Search movies/TV shows | read |
| `tv_play` | Play movie/episode by name | write |

### Screen Capture (5 tools)

| Tool | Description | Type |
|------|-------------|------|
| `capture_screen` | Capture full screen screenshot (returns PNG image) | read |
| `capture_window` | Capture a specific app window | read |
| `capture_area` | Capture a screen region by coordinates | read |
| `list_windows` | List all visible windows with position/size | read |
| `record_screen` | Record screen for 1-60 seconds (.mov) | write |

### Maps (8 tools)

| Tool | Description | Type |
|------|-------------|------|
| `search_location` | Search for a place in Apple Maps | write |
| `get_directions` | Get directions between two locations | write |
| `drop_pin` | Drop a pin at specific coordinates | write |
| `open_address` | Open a specific address in Apple Maps | write |
| `search_nearby` | Search for places near a location | write |
| `share_location` | Generate a shareable Apple Maps link | read |
| `geocode` | Convert place name/address to coordinates | read |
| `reverse_geocode` | Convert coordinates to place name/address | read |

### Podcasts (6 tools)

| Tool | Description | Type |
|------|-------------|------|
| `list_podcast_shows` | List subscribed podcast shows | read |
| `list_podcast_episodes` | List episodes for a show | read |
| `podcast_now_playing` | Currently playing podcast episode | read |
| `podcast_playback_control` | Play, pause, next, previous | write |
| `play_podcast_episode` | Play a specific episode by name | write |
| `search_podcast_episodes` | Search episodes by keyword | read |

### Weather (3 tools)

| Tool | Description | Type |
|------|-------------|------|
| `get_current_weather` | Get current weather by coordinates | read |
| `get_daily_forecast` | Get multi-day forecast by coordinates | read |
| `get_hourly_forecast` | Get hourly forecast by coordinates | read |

### Location (2 tools)

| Tool | Description | Type |
|------|-------------|------|
| `get_current_location` | Get device's current GPS coordinates | read |
| `get_location_permission` | Check Location Services authorization status | read |

### Bluetooth (4 tools)

| Tool | Description | Type |
|------|-------------|------|
| `get_bluetooth_state` | Check Bluetooth power state | read |
| `scan_bluetooth` | Scan for nearby BLE devices | read |
| `connect_bluetooth` | Connect to a BLE device by UUID | write |
| `disconnect_bluetooth` | Disconnect a BLE device | write |

### Google Workspace (16 tools)

Requires: `npm install -g @googleworkspace/cli && gws auth setup`

| Tool | Description | Type |
|------|-------------|------|
| `gws_status` | Check GWS CLI availability | read |
| `gws_gmail_list` | List Gmail messages with query | read |
| `gws_gmail_read` | Read Gmail message by ID | read |
| `gws_gmail_send` | Send email via Gmail | write |
| `gws_drive_list` | List Google Drive files | read |
| `gws_drive_read` | Get Drive file metadata | read |
| `gws_drive_search` | Full-text search across Drive | read |
| `gws_sheets_read` | Read Google Sheet values | read |
| `gws_sheets_write` | Write to Google Sheet | write |
| `gws_calendar_list` | List Google Calendar events | read |
| `gws_calendar_create` | Create Google Calendar event | write |
| `gws_docs_read` | Read Google Doc content | read |
| `gws_tasks_list` | List Google Tasks | read |
| `gws_tasks_create` | Create Google Task | write |
| `gws_people_search` | Search Google Contacts | read |
| `gws_raw` | Execute any GWS CLI command | write |

## Resources

MCP resources provide live data from Apple apps via URI.

| URI | Description |
|-----|-------------|
| `notes://recent` | 10 most recent notes |
| `notes://recent/{count}` | Recent notes (custom count, max 50) |
| `calendar://today` | Today's calendar events |
| `calendar://upcoming` | Next 7 days of calendar events |
| `reminders://due` | Overdue reminders |
| `reminders://today` | Today's due reminders (incomplete only) |
| `music://now-playing` | Currently playing Apple Music track |
| `system://clipboard` | macOS clipboard content |
| `mail://unread` | Unread mail count across all mailboxes |
| `context://snapshot` | Unified context from all active apps |
| `context://snapshot/{depth}` | Configurable depth context (brief/standard/full) |

## Prompts

### Per-App
- **organize-notes** — Classify notes by topic, create folders, move
- **find-duplicates** — Find similar notes, compare, suggest cleanup
- **weekly-review** — Summarize past week's notes
- **organize-reminders** — Scan, identify overdue/completed, cleanup
- **daily-review** — Today's due reminders with priorities
- **schedule-review** — Upcoming events, conflicts, optimizations
- **meeting-prep** — Event details + related notes for meeting prep

### Cross-Module
- **daily-briefing** — Today's events + due reminders + recent notes
- **weekly-digest** — Past N days: events + notes + reminders combined
- **meeting-notes-to-reminders** — Extract action items from meeting notes, create reminders
- **event-follow-up** — Create follow-up note and reminders after a meeting
- **research-with-safari** — Safari research + save results to Notes
- **focus-session** — Calendar + Reminders + Music focus session
- **file-organizer** — Finder file organization + Notes logging

### Developer Workflows
- **dev-session** — Scan project, check specs, research docs, create session notes
- **debug-loop** — Capture errors from Safari/clipboard, locate code, log bugs, create fix tasks
- **screen-capture-flow** — Screenshot → Photos import → annotation notes
- **app-release-prep** — Calendar schedule + Notes changelog + Reminders checklist
- **idea-to-task** — Break idea into tasks → Reminders + Calendar time blocks
- **build-log** — Analyze build output, log errors or celebrate success

### Shortcuts
- **shortcut-automation** — Discover and chain Siri Shortcuts for automation
- **shortcut-discovery** — Find relevant shortcuts for a task
- **shortcut-troubleshooting** — Debug and fix broken shortcuts

## Developer Agent Pipeline

AirMCP's developer prompts connect Apple apps into autonomous agent workflows. Each prompt orchestrates tools across multiple modules — AI reads the actual filesystem, Notes, Calendar, and Reminders for context, then records structured results.

```
┌─────────────────────────────────────────────────────────────────┐
│                     dev-session                                 │
│  Finder (scan) → Notes (specs) → Safari (docs) → Notes (log)   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     debug-loop                                  │
│  Safari (JS errors) → Clipboard → Finder (locate) →            │
│  Notes (bug log) → Reminders (fix tasks)                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     idea-to-task                                 │
│  Notes (idea) → AI (decompose) → Reminders (tasks) →           │
│  Calendar (time blocks)                                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     build-log                                   │
│  Finder (output) → Clipboard (log) →                            │
│  ┌ Fail → Notes (error log) → Reminders (fix tasks)             │
│  └ Pass → Notification → Music (celebrate) → Notes (success)    │
└─────────────────────────────────────────────────────────────────┘
```

Designed for AI coding agents (Claude Code, Cursor, Copilot, etc.) to invoke via MCP prompts, turning your Mac into a context-aware development environment.

## Module Presets

By default, new installations start with 5 core modules (Notes, Reminders, Calendar, Shortcuts, System) to keep things simple. You can enable more anytime:

```bash
# Re-run the setup wizard to change modules
npx airmcp init

# Or enable all modules at once
npx airmcp --full
```

Or edit `~/.config/airmcp/config.json` directly:

```json
{
  "disabledModules": ["messages", "intelligence"]
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx airmcp init` | Interactive setup wizard |
| `npx airmcp doctor` | Diagnose installation issues |
| `npx airmcp` | Start MCP server (stdio, default) |
| `npx airmcp --full` | Start with all 25 modules enabled |
| `npx airmcp --http` | Start as HTTP server (port 3847) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AIRMCP_INCLUDE_SHARED` | `false` | Include shared notes/folders |
| `AIRMCP_ALLOW_SEND_MESSAGES` | `false` | Allow sending iMessages (opt-in) |
| `AIRMCP_ALLOW_SEND_MAIL` | `false` | Allow sending emails (opt-in) |
| `AIRMCP_FULL` | `false` | Enable all modules (ignores preset) |
| `AIRMCP_DISABLE_{MODULE}` | — | Disable a specific module (e.g. `AIRMCP_DISABLE_MUSIC=true`) |
| `GEMINI_API_KEY` | — | Google Gemini API key for cloud embeddings (optional) |
| `AIRMCP_EMBEDDING_MODEL` | `text-embedding-004` | Gemini embedding model name |
| `AIRMCP_EMBEDDING_DIM` | `768` | Embedding dimension (768/1024/2048/3072) |
| `AIRMCP_EMBEDDING_PROVIDER` | auto | Force provider: `gemini`, `swift`, `hybrid`, `none` |

### Config File

`~/.config/airmcp/config.json`:

```json
{
  "disabledModules": ["messages", "intelligence"],
  "includeShared": false,
  "allowSendMessages": false,
  "allowSendMail": false,
  "hitl": {
    "level": "destructive-only",
    "timeout": 30
  }
}
```

### Human-in-the-Loop (HITL)

Require manual approval before destructive operations:

```json
{
  "hitl": {
    "level": "destructive-only",
    "timeout": 30
  }
}
```

Levels: `off`, `destructive-only`, `all-writes`, `all`

### Semantic Search (Optional)

On-device cross-app semantic search powered by Apple's NLContextualEmbedding. Find related notes, events, reminders, and emails by meaning — not just keywords.

```bash
npm run swift-build  # Build the Swift bridge first
```

Then use the tools:
1. `semantic_index` — Index data from enabled Apple apps into a local vector store
2. `semantic_search` — Search by meaning across all indexed data
3. `find_related` — Find items related to a specific note/event/reminder
4. `semantic_status` — Check index status

Supports Korean, English, Japanese, Chinese with automatic language detection. Optionally set `GEMINI_API_KEY` for higher-quality Google Gemini embeddings.

### Swift Bridge (Optional)

For semantic search, recurring events/reminders (EventKit), photo import/delete (PhotoKit), and Apple Intelligence — requires macOS 26+:

```bash
npm run swift-build
```

## Requirements

- macOS
- Node.js >= 18
- Per-app automation permissions (prompted on first run) — use `setup_permissions` tool to request all at once
- Apple Intelligence: macOS 26+ with Apple Silicon

## Limitations

Modules with OS requirements (e.g., Intelligence requires macOS 26+) are automatically disabled at startup on older systems via runtime OS detection.

### Architecture & Security

- **JXA/AppleScript dependency** — Core automation relies on Apple's scripting dictionaries. While these have been stable for 10+ years, macOS updates can theoretically break individual modules. Circuit breaker (3 failures → 60s auto-disable) isolates failures. UI Automation tools (6 tools) are inherently more brittle and separated into their own module.
- **Read data exposure** — Destructive operations require HITL approval, but read operations (mail, messages, contacts) are not rate-limited. When connected to cloud LLMs, sensitive data passes through the LLM provider. Mitigations: PII scrubbing in logs, pagination limits, sensitive modules (mail, messages) require explicit opt-in.
- **IPC overhead** — Multi-process path (Client → Node.js → osascript/Swift CLI → macOS app). Each JXA call adds ~50ms overhead. Pagination prevents bulk data transfers. Swift bridge path bypasses JXA for EventKit/PhotoKit operations.
- **Scope** — 252 tools across 25 modules follow 5 repeating patterns (JXA CRUD, Swift bridge, HTTP API, System Events, CLI wrapper), keeping maintenance proportional to pattern count, not tool count.

### Location & Bluetooth

- Location requires macOS Location Services permission (first use triggers system dialog).
- Bluetooth scanning discovers BLE (Low Energy) devices only. Classic Bluetooth devices are listed via `list_bluetooth_devices` in the System module.
- Bluetooth connect/disconnect operates within the server process lifecycle.

### Notes
- Move copies and deletes (new ID, reset dates, lost attachments). Update replaces entire body — read first to preserve content.
- Password-protected notes cannot be read.

### Reminders / Calendar
- JXA recurrence is read-only — use `create_recurring_event`/`create_recurring_reminder` (Swift/EventKit).
- Calendar attendees are read-only.

### Contacts
- Custom fields not accessible.

### Mail
- Content truncated to 5000 chars by default (`maxLength` parameter adjustable).

### Messages
- Individual message content (chat history) not accessible via JXA.
- Send requires recipient to be a registered buddy in Messages.

### Music
- Smart playlists are read-only.
- Queue manipulation not available.

### Finder
- Tags use Spotlight (mdfind), performance varies with index state.

### Safari
- Reading page content requires "Allow JavaScript from Apple Events" in Safari Developer menu.
- **macOS 26+:** Bookmark and Reading List tools (`list_bookmarks`, `list_reading_list`, `add_bookmark`) use `Bookmarks.plist` instead of JXA (Apple removed bookmark scripting). Requires **Full Disk Access** for your terminal in System Settings > Privacy & Security. `add_bookmark` is not supported on macOS 26+.

### Podcasts
- **macOS 26+:** All Podcasts tools are non-functional. Apple removed the Podcasts scripting dictionary in macOS 26 (Tahoe). The circuit breaker will auto-disable the module after 3 failures.

### Photos
- JXA: album creation and photo addition only, no import/delete.
- Swift bridge (macOS 26+): full import/delete via PhotoKit.

### Pages / Numbers / Keynote
- **macOS 26+:** Apple renamed iWork apps (e.g. "Pages" → "Pages Creator Studio"). AirMCP uses bundle IDs internally so this is handled transparently.
- Requires the corresponding iWork app to be open for document operations.

### Apple Intelligence
- Requires macOS 26 (Tahoe) + Apple Silicon.
- Build bridge binary with `npm run swift-build`.

## Roadmap

### v2.1 (Current)

- **Gemini Embedding upgrade** — Apple Intelligence의 Gemini 채택에 맞춰 `text-embedding-004`로 업그레이드. on-device Swift bridge + cloud Gemini 하이브리드 provider 지원. Apple이 Foundation Models에 Gemini를 도입하면서 AirMCP도 동일 생태계로 확장 — on-device 처리와 클라우드 임베딩을 자동 전환
- **Google Workspace** — Gmail, Drive, Sheets, Calendar, Docs, Tasks, People via `@googleworkspace/cli`
- **Dynamic module loading** — New modules = 1 line in MANIFEST (no import boilerplate)
- **Centralized constants** — All API URLs, timeouts, buffer sizes in `src/shared/constants.ts` with env var overrides

### v2.0

- **CoreLocation** — Native GPS coordinates via Swift/CLLocationManager
- **CoreBluetooth** — BLE device scanning, state, connect/disconnect via Swift/CBCentralManager
- **App Management** — Launch, quit, check app status
- **Window Management** — List, move, resize, minimize windows across all apps
- **Geocoding** — Forward/reverse geocoding via Open-Meteo and Nominatim APIs
- **Security hardening** — Sensitive modules (mail, messages) opt-in by default, architecture limitations documented

### Platform Constraints (macOS 26+)

- **Safari bookmarks/reading list** — Apple removed JXA bookmark scripting classes in macOS 26. The plist fallback (`~/Library/Safari/Bookmarks.plist`) requires Full Disk Access, which TCC blocks for MCP server processes. Investigating Shortcuts-based or WebExtension bridge approaches.
- **Safari `add_bookmark`** — Legacy JXA `make new bookmark` no longer supported in macOS 26. No programmatic alternative available yet.
- **Podcasts** — Apple removed the Podcasts JXA scripting dictionary entirely in macOS 26. All 6 Podcasts tools return errors. Investigating Shortcuts bridge or Media framework alternatives.

### Future

- **OAuth 2.1 + PKCE** — HTTP transport authentication for remote deployments
- **GUI .app distribution** — Code Signing + Notarization, Homebrew Cask
- **Marketplace listings** — mcp.so, Smithery, and other MCP directories
- **iOS / visionOS exploration** (v3.0+)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

First-time contributors: look for issues labeled [`good first issue`](https://github.com/heznpc/AirMCP/labels/good%20first%20issue).

## Community

- [GitHub Discussions](https://github.com/heznpc/AirMCP/discussions) — Questions, ideas, show & tell
- [Issues](https://github.com/heznpc/AirMCP/issues) — Bug reports and feature requests
- [Changelog](CHANGELOG.md) — Release history

## License

MIT
