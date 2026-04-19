# AirMCP Skills Guide

A practical guide for AI agents to effectively use AirMCP's 268 tools across 27 modules to orchestrate the Apple ecosystem via MCP.

## Overview

AirMCP bridges AI agents to native macOS applications through JXA (JavaScript for Automation) and Swift. Each module wraps a single Apple app or system capability, exposing read, write, and search tools. Cross-app prompts combine multiple modules into multi-step workflows.

## Core Principles

1. **Read before write** -- always check existing data before creating duplicates. Use `search_notes`, `search_reminders`, `search_events` first.
2. **Cross-app linking** -- reference related IDs across modules. Mention a note ID in a reminder body; include an event ID in a follow-up note. This creates a traceable graph.
3. **Batch over loops** -- prefer tools that return lists (`list_reminders`, `scan_notes`) over calling single-item tools repeatedly.
4. **Check availability** -- not all modules may be enabled. Use `summarize_context` or check tool listing to confirm before attempting operations.
5. **HITL for mutations** -- human-in-the-loop confirmation is enforced for destructive operations (delete, send, move). Always present a plan before executing writes.
6. **Minimal privilege** -- read-only operations are always safe. Write operations may require user confirmation. Send/delete operations always require confirmation.

## Module Quick Reference

| Module | App | Key Tools | Tool Count |
|--------|-----|-----------|------------|
| **calendar** | Calendar | `list_events`, `create_event`, `search_events`, `today_events`, `get_upcoming_events`, `create_recurring_event` | 10 |
| **contacts** | Contacts | `list_contacts`, `search_contacts`, `read_contact`, `create_contact`, `add_contact_email` | 10 |
| **finder** | Finder | `search_files`, `list_directory`, `get_file_info`, `set_file_tags`, `recent_files`, `create_directory` | 8 |
| **intelligence** | Apple Intelligence | `summarize_text`, `rewrite_text`, `proofread_text`, `generate_text`, `generate_structured`, `tag_content`, `ai_chat`, `ai_status`, `generate_image`, `scan_document`, `generate_plan` | 11 |
| **mail** | Mail | `list_messages`, `read_message`, `search_messages`, `send_mail`, `reply_mail`, `flag_message`, `move_message` | 11 |
| **maps** | Maps | `search_location`, `get_directions`, `drop_pin`, `search_nearby`, `share_location` | 8 |
| **messages** | Messages | `list_chats`, `read_chat`, `send_message`, `send_file`, `search_chats` | 6 |
| **music** | Music | `list_playlists`, `play_track`, `now_playing`, `playback_control`, `create_playlist`, `search_tracks`, `get_rating`, `set_rating`, `set_favorited`, `set_disliked` | 17 |
| **notes** | Notes | `list_notes`, `search_notes`, `read_note`, `create_note`, `update_note`, `scan_notes`, `create_folder` | 12 |
| **photos** | Photos | `list_photos`, `search_photos`, `get_photo_info`, `create_album`, `add_to_album`, `list_favorites` | 9 |
| **podcasts** | Podcasts | `list_podcast_shows`, `list_podcast_episodes`, `podcast_now_playing`, `play_podcast_episode` | 6 |
| **reminders** | Reminders | `list_reminders`, `create_reminder`, `complete_reminder`, `search_reminders`, `create_reminder_list`, `create_recurring_reminder` | 11 |
| **safari** | Safari | `list_tabs`, `read_page_content`, `open_url`, `run_javascript`, `list_bookmarks`, `add_to_reading_list` | 12 |
| **screen** | Screen Capture | `capture_screen`, `capture_window`, `capture_area`, `list_windows`, `record_screen` | 5 |
| **shortcuts** | Shortcuts | `list_shortcuts`, `run_shortcut`, `get_shortcut_detail`, `search_shortcuts`, `export_shortcut` | 11 |
| **system** | System | `get_clipboard`, `set_clipboard`, `show_notification`, `capture_screenshot`, `get_battery_status`, `toggle_dark_mode`, `system_sleep`, `prevent_sleep`, `system_power` | 27 |
| **location** | Location | `get_current_location`, `get_location_status` | 2 |
| **bluetooth** | Bluetooth | `bluetooth_scan`, `bluetooth_connect`, `bluetooth_disconnect`, `bluetooth_list_devices` | 4 |
| **tv** | TV | `tv_list_playlists`, `tv_now_playing`, `tv_playback_control`, `tv_search`, `tv_play` | 6 |
| **ui** | UI Automation | `ui_open_app`, `ui_click`, `ui_type`, `ui_press_key`, `ui_scroll`, `ui_read` | 6 |
| **weather** | Weather | `get_current_weather`, `get_daily_forecast`, `get_hourly_forecast` | 3 |
| **pages** | Pages | `pages_create`, `pages_open`, `pages_export`, `pages_get_content`, `pages_set_content`, `pages_list`, `pages_replace_text` | 7 |
| **numbers** | Numbers | `numbers_create`, `numbers_open`, `numbers_export`, `numbers_get_cells`, `numbers_set_cells`, `numbers_add_row`, `numbers_list_sheets`, `numbers_add_sheet`, `numbers_list` | 9 |
| **keynote** | Keynote | `keynote_create`, `keynote_open`, `keynote_export`, `keynote_list_slides`, `keynote_add_slide`, `keynote_set_slide_text`, `keynote_start_slideshow`, `keynote_stop_slideshow`, `keynote_list` | 9 |
| **semantic** | Semantic Search | `semantic_index`, `semantic_search`, `find_related`, `semantic_status` | 4 |
| **cross** | Cross-App | `summarize_context` | 1 |

## Workflow Patterns

### Communication Management

#### Email Triage Pattern
```
1. get_unread_count             -> gauge inbox load
2. list_messages(unreadOnly)    -> scan subjects and senders
3. read_message(id)             -> read priority emails
4. create_reminder              -> action items from emails
5. flag_message / mark_message_read -> organize
6. reply_mail / send_mail       -> respond (with HITL)
```

#### Message Response Pattern
```
1. list_chats                   -> see active conversations
2. read_chat(id)                -> read recent messages
3. search_contacts(name)        -> look up sender details
4. send_message                 -> reply (with HITL)
```

#### Contact Lookup + Communication Chain
```
1. search_contacts("name")      -> find person
2. read_contact(id)             -> get email, phone, address
3. search_messages(query)       -> find past emails with them
4. search_chats(query)          -> find past messages with them
5. search_events(query)         -> find shared calendar events
```

### Productivity

#### Note-Taking to Action Items
```
1. create_note / update_note    -> capture meeting notes
2. read_note(id)                -> review content
3. Extract action items from text (look for TODO, action, follow-up patterns)
4. create_reminder per item     -> convert to trackable tasks
5. create_event                 -> block time for tasks
```

#### Calendar Blocking + Reminder Sync
```
1. list_reminders(completed: false)  -> get pending tasks
2. get_upcoming_events               -> find free slots
3. create_event per task             -> block focus time
4. update_reminder with due dates    -> align deadlines
```

#### File Organization + Tagging
```
1. list_directory(path)         -> survey contents
2. get_file_info(path)          -> check sizes, dates
3. recent_files(path, days)     -> find active files
4. set_file_tags(path, tags)    -> categorize
5. create_note                  -> document the organization
```

### Research and Learning

#### Safari to Notes to Reminders Pipeline
```
1. list_tabs                    -> find open research tabs
2. read_page_content(tabId)     -> extract content
3. summarize_text (if Intelligence available) -> condense
4. create_note                  -> save organized findings
5. add_to_reading_list          -> queue for later reading
6. create_reminder              -> follow-up tasks
```

#### Multi-Source Research Compilation
```
1. search_notes(topic)          -> existing research
2. list_tabs / read_page_content -> current browser research
3. search_files(topic)          -> local documents
4. search_messages(topic)       -> email threads
5. create_note                  -> unified research document
6. set_file_tags                -> tag related files
```

### Media Management

#### Photo Organization Workflow
```
1. list_photos / search_photos  -> find photos by keyword or date
2. get_photo_info(id)           -> check metadata
3. create_album("name")         -> create themed album
4. add_to_album(photoId, album) -> organize into albums
5. list_favorites               -> review starred photos
```

#### Music Discovery + Playlist Curation
```
1. search_tracks(query)         -> find songs
2. get_track_info(id)           -> check details
3. create_playlist("name")      -> new playlist
4. add_to_playlist(track, list) -> build the playlist
5. play_playlist(name)          -> start listening
6. now_playing                  -> check current track
```

#### Podcast Queue Management
```
1. list_podcast_shows           -> subscribed shows
2. list_podcast_episodes(show)  -> available episodes
3. search_podcast_episodes(q)   -> find specific topics
4. play_podcast_episode(id)     -> start listening
5. podcast_now_playing          -> check status
```

### System Automation

#### Screen Capture to Documentation
```
1. get_frontmost_app            -> identify active app
2. list_windows                 -> see available windows
3. capture_screen / capture_window -> take screenshot
4. create_note                  -> document with context
5. create_album + add_to_album  -> organize in Photos
```

#### App State Inspection
```
1. get_frontmost_app            -> current app
2. list_running_apps            -> all running apps
3. get_screen_info              -> display configuration
4. get_clipboard                -> clipboard contents
5. get_battery_status           -> power state
6. get_wifi_status              -> connectivity
```

#### Shortcut Chaining for Complex Workflows
```
1. search_shortcuts(keyword)    -> find relevant shortcuts
2. get_shortcut_detail(name)    -> inspect actions and inputs
3. run_shortcut(name, input)    -> execute step 1
4. Use output as input for next run_shortcut -> chain steps
5. show_notification            -> report completion
```

### Cross-App Patterns

#### The "Morning Routine" Pattern
Use the `morning-brief` prompt, or manually:
```
1. today_events                 -> calendar overview
2. list_reminders(completed: false) -> pending tasks + overdue
3. get_unread_count + list_messages  -> email snapshot
4. scan_notes                   -> recent notes activity
5. get_battery_status           -> system health
6. now_playing / play_playlist  -> set the mood
```

#### The "Inbox Zero" Pattern
Use the `inbox-zero` prompt, or manually:
```
1. list_messages(unreadOnly: true) -> all unread
2. read_message for each        -> categorize: urgent/action/FYI/spam
3. create_reminder              -> track action items
4. today_events                 -> check meeting-related emails
5. flag_message / mark_message_read -> triage
6. move_message                 -> archive processed emails
```

#### The "Project Setup" Pattern
Use the `project-kickoff` prompt, or manually:
```
1. create_directory             -> project folder in Finder
2. create_folder                -> Notes folder
3. create_note (x3)             -> overview, meetings, decisions
4. create_reminder_list         -> task tracking list
5. create_reminder (xN)         -> initial tasks
6. create_recurring_event       -> standups, reviews
7. add_bookmark                 -> project resources
8. set_file_tags                -> tag project root
```

#### The "Weekly Review" Pattern
Use the `weekly-review` prompt, or manually:
```
1. list_reminders(completed: true)  -> achievements
2. list_reminders(completed: false) -> carryover items
3. list_events(past 7 days)         -> meetings attended
4. scan_notes                       -> notes activity
5. get_unread_count                 -> email backlog
6. list_photos                      -> photos taken
7. create_note                      -> review summary
```

#### The "Travel Planner" Pattern
Use the `travel-planner` prompt, or manually:
```
1. list_events(travel dates)    -> schedule conflicts
2. search_location(destination) -> Maps lookup
3. search_nearby(hotels, food)  -> local options
4. create_reminder_list         -> packing/booking checklist
5. create_folder + create_note  -> trip documents
6. create_event (all-day)       -> block travel dates
```

## Available Prompts

Prompts are pre-built multi-step workflows invoked via `get_workflow` or the MCP prompts API.

| Prompt | Description | Parameters |
|--------|-------------|------------|
| `daily-briefing` | Today's events, due reminders, recent notes | none |
| `morning-brief` | Full morning overview with email, music, system status | none |
| `inbox-zero` | Email triage and organization workflow | none |
| `weekly-digest` | Past N days summary across apps | `days` (1-30) |
| `weekly-review` | Comprehensive retrospective with stats | `days` (1-14) |
| `meeting-notes-to-reminders` | Extract action items from meeting notes | `eventId` |
| `event-follow-up` | Post-meeting note and task creation | `eventId` |
| `research-with-safari` | Safari tab research compiled into notes | `topic` |
| `content-curator` | Multi-source content gathering and organization | `topic` |
| `focus-session` | Set up distraction-free work block | `duration` (hours) |
| `file-organizer` | Scan, tag, and document a directory | `directory` |
| `dev-session` | Developer context loading for a project | `projectPath` |
| `debug-loop` | Error capture, analysis, and bug logging | `errorMessage`, `projectPath` |
| `screen-capture-flow` | Screenshot, organize in Photos, document in Notes | `description` |
| `app-release-prep` | Release checklist, changelog, build trigger | `appName`, `version` |
| `idea-to-task` | Break down an idea into reminders and calendar blocks | `idea` |
| `build-log` | Analyze build output, log errors or celebrate success | `projectPath` |
| `travel-planner` | Full trip planning across calendar, maps, reminders, notes | `destination`, `startDate`, `endDate` |
| `project-kickoff` | Set up new project across all apps | `projectName`, `description` |
| **Notes** | | |
| `organize-notes` | Scan notes, classify by topic, create folders, move | `folder` (optional) |
| `find-duplicates` | Find duplicate/similar notes and suggest cleanup | `folder` (optional) |
| `notes-weekly-review` | Summarize notes from past week, suggest organization | none |
| **Calendar** | | |
| `schedule-review` | Review upcoming events, identify conflicts | `days` (1-90) |
| `meeting-prep` | Read event details, find related notes, prepare context | `eventId` |
| **Reminders** | | |
| `organize-reminders` | Scan reminders, identify overdue/completed, suggest cleanup | `list` (optional) |
| `daily-review` | Review today's due reminders and suggest priorities | none |
| **Shortcuts** | | |
| `shortcut-automation` | Guide for creating complex automation workflows | `goal`, `input` (optional) |
| `shortcut-discovery` | Find shortcuts matching a use case | `useCase` |
| `shortcut-troubleshooting` | Debug a failing shortcut | `shortcutName`, `errorMessage` (optional) |

## Error Handling

### Common Error Patterns

| Error | Cause | Solution |
|-------|-------|----------|
| `JXA execution failed` | App not running or not responding | The app will auto-launch; retry once. If persistent, check if app is frozen. |
| `Shortcut not found` | Name mismatch (case-sensitive) | Use `search_shortcuts` to find exact name. |
| `Permission denied` | Missing Automation/Accessibility permission | Guide user to System Settings > Privacy & Security. |
| `Timeout` | Long-running JXA or shortcut | Break into smaller operations. Shortcuts with UI prompts will hang in CLI mode. |
| `No results` | Empty dataset or wrong filter | Broaden search terms; check date ranges; verify the correct mailbox/list/folder. |
| `Module not available` | Module disabled in config or app not installed | Check config; some modules require specific macOS versions (Intelligence requires macOS 26+). |

### Fallback Strategies

1. **If a tool fails, try the search variant first**: `list_notes` failing? Try `search_notes` or `scan_notes`.
2. **If Intelligence is unavailable**: fall back to manual summarization or skip AI-enhanced steps.
3. **If a specific mailbox/list/folder is not found**: use the list variant (`list_mailboxes`, `list_reminder_lists`, `list_folders`) to discover available names.
4. **If a shortcut hangs**: it likely has interactive UI prompts. Use `get_shortcut_detail` to inspect before running.
5. **If calendar events fail to create**: verify the target calendar exists with `list_calendars` and is writable.

### Permission Requirements by Module

| Module | Required Permission |
|--------|-------------------|
| calendar, contacts, reminders, notes, mail, photos, messages | Automation (per-app) |
| finder, system | Automation + Full Disk Access (for some paths) |
| safari | Automation + "Allow JavaScript from Apple Events" in Safari Develop menu |
| screen, ui | Screen Recording + Accessibility |
| shortcuts | Automation |
| intelligence | macOS 26+ with Apple Intelligence enabled |
| music, tv, podcasts | Automation |
| maps | Automation |

## Best Practices

### Data Freshness
- **Re-read, do not cache**: Apple app data changes constantly (new emails, reminder completions, calendar updates). Always call the tool to get current state rather than relying on data from earlier in the conversation.
- **Use scan for snapshots**: `scan_notes` is optimized for quick overviews. Use `read_note` only when you need the full content of a specific note.
- **Date filtering**: When listing events or reminders, always provide tight date ranges to reduce response size.

### Performance
- **Avoid rapid-fire JXA calls**: Each tool call invokes a JXA or Swift subprocess. Batch where possible (e.g., `list_reminders` returns all at once rather than calling `read_reminder` in a loop).
- **Use search tools**: `search_notes`, `search_reminders`, `search_events`, `search_messages` are faster than listing everything and filtering client-side.
- **Limit result sizes**: Many list tools accept a `limit` parameter. Use it to avoid overwhelming the context window with hundreds of results.

### Privacy and Safety
- **HITL for writes**: AirMCP enforces human-in-the-loop confirmation for destructive or sensitive operations. Never assume a write will succeed silently.
- **Never expose raw email content**: Summarize rather than quoting full email bodies, especially when they may contain signatures with personal information.
- **Confirm before sending**: `send_mail`, `send_message`, `reply_mail` all require user confirmation. Always show the draft before triggering.
- **Export before delete**: Back up shortcuts (`export_shortcut`) before deleting. Back up notes content before deleting.
- **Sensitive files**: Be cautious with `get_clipboard`, `read_page_content`, and `read_message` -- they may contain passwords, tokens, or private information. Do not log or repeat sensitive content.

### Semantic Search
- **Index first**: Call `semantic_index` or `semantic_status` to ensure the index is current before using `semantic_search`.
- **Auto-indexing**: The system automatically re-indexes every 30 minutes on semantic search calls, so explicit indexing is rarely needed.
- **Use for discovery**: `semantic_search` and `find_related` are best for discovering connections across notes, reminders, events, and mail that keyword search would miss.

### Cross-App Best Practices
- **Create reference links**: When creating a reminder from an email, include the message subject in the reminder body. When creating a follow-up note from a meeting, include the event ID.
- **Use consistent naming**: Prefix related items with the same tag (e.g., `[Project X]` in note titles, reminder titles, and event summaries) to make cross-app searches effective.
- **Leverage prompts**: For complex multi-step workflows, use the built-in prompts (`morning-brief`, `inbox-zero`, `project-kickoff`, etc.) rather than building from scratch. They encode best practices and proper tool sequencing.
