---
title: Module Overview
description: All 25 AirMCP modules with tool counts and capabilities.
---

AirMCP ships 29 modules that cover the Apple ecosystem. Each module registers a set of MCP tools that AI assistants can call. The total tool count varies slightly depending on dynamic shortcut registration, but the base set contains approximately 262 tools.

## Module Table

| Module | Tools | Description |
|--------|------:|-------------|
| **Notes** | 12 | Full CRUD for Apple Notes. List, search, scan, create, update, delete notes and folders. |
| **Reminders** | 11 | Full CRUD for Reminders. Create, complete, delete reminders and lists. Priority and due-date support. |
| **Calendar** | 10 | Full CRUD for Calendar events. Today view, upcoming events, search, create, update, delete. |
| **Contacts** | 10 | Full CRUD for Contacts. Search, create, update, delete contacts and groups. |
| **Mail** | 11 | Read mailboxes, search messages, get unread count. Send and reply (when `allowSendMail` is enabled). |
| **Messages** | 6 | List chats, read messages. Send iMessages (when `allowSendMessages` is enabled). |
| **Music** | 17 | Full Apple Music control. Playlists, playback, search, queue management. |
| **Finder** | 8 | File system operations. Search, list directories, recent files, create directories, trash files. |
| **Safari** | 12 | Tab management, bookmarks, reading list. Open/close tabs, get page content, execute JavaScript. |
| **System** | 27 | Clipboard, volume, brightness, dark mode, Wi-Fi, Bluetooth, battery, running apps, windows, notifications. |
| **Photos** | 11 | Albums, search, favorites, photo info. Create albums, export photos. |
| **Shortcuts** | 10 | List, search, run, create, delete, export, import, duplicate Siri Shortcuts. Plus dynamic per-shortcut tools. |
| **Intelligence** | 11 | Apple Intelligence features (macOS 26+ only). Writing tools, image generation, summarization. |
| **TV** | 6 | Apple TV app control. Playlists, playback, search. |
| **UI** | 10 | UI automation via Accessibility APIs. Read UI trees, click elements, type text, inspect menus. |
| **Screen** | 5 | Screen capture. List windows, capture screen/window/area. |
| **Maps** | 8 | Geocoding, reverse geocoding, directions, share location, search places, drop pins. |
| **Podcasts** | 6 | Podcast shows, episodes, playback control. |
| **Weather** | 3 | Current weather, daily forecast, hourly forecast via Open-Meteo API. |
| **Pages** | 7 | Apple Pages automation. List, create, read/write body text, close documents. |
| **Numbers** | 9 | Apple Numbers automation. Spreadsheets, sheets, cell read/write. |
| **Keynote** | 9 | Apple Keynote automation. Slides, presenter notes, add/delete slides. |
| **Location** | 2 | Location permission status, current location (via CoreLocation). |
| **Bluetooth** | 4 | Bluetooth state, device discovery, connect/disconnect. |
| **Google** | 16 | Google Workspace integration. Gmail, Google Calendar, Drive, Contacts, Tasks via GWS CLI. |

## Additional Tools

Beyond the module tools, AirMCP registers several cross-cutting tools:

| Category | Tools | Description |
|----------|------:|-------------|
| **Cross-module** | 1 | `summarize_context` -- collects context from all enabled apps and produces a briefing via MCP Sampling. |
| **Semantic** | 7 | Vector-based semantic search. Build, search, and manage on-device embedding indexes for notes and reminders. |
| **Setup** | 1 | `airmcp_doctor` -- runtime diagnostics tool that checks permissions, modules, and system state. |
| **Workflow** | 1 | `get_workflow` -- retrieve prompt handlers as text for autonomous agent environments. |
| **Skills** | - | Personal Skills Engine -- user-defined YAML-based workflows (not counted as tools). |

## Prompts

Modules marked with prompts support also register MCP prompt templates. These are pre-built workflows that AI assistants can invoke:

| Module | Prompts |
|--------|---------|
| Notes | Note-taking workflows, research prompts |
| Reminders | Task planning, GTD workflows |
| Calendar | Daily briefing, scheduling prompts |
| Shortcuts | Automation discovery, shortcut chaining |
| Cross | `daily-briefing`, `dev-session`, multi-module orchestration |

## Module Dependencies

- **Intelligence** requires macOS 26 (Tahoe) or later.
- **Google** requires the GWS CLI tool to be installed separately.
- **Semantic search** requires either `GEMINI_API_KEY` for cloud embeddings or the Swift bridge for on-device embeddings.
- **UI automation** requires Accessibility permissions for the host terminal/MCP client.
- **Location** requires Location Services permission.
- All JXA-based modules (Notes, Reminders, Calendar, Contacts, Mail, Messages, Music, Safari, Photos, etc.) require Automation permissions.
