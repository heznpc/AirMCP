# Privacy Policy

**AirMCP** — MCP Server for the Apple Ecosystem on macOS
Last updated: 2026-03-15

## Overview

AirMCP is an open-source MCP (Model Context Protocol) server that bridges AI assistants and macOS applications. It runs locally on your Mac and provides tools for interacting with Apple apps through JXA (JavaScript for Automation) and a native Swift bridge.

This privacy policy explains how AirMCP handles your data, including what data leaves your machine.

## Data Collection

AirMCP does not collect analytics, telemetry, usage tracking, or crash reports. There is no advertising or marketing data collection.

## How Your Data Is Handled

### Local Processing

Most AirMCP operations run entirely on your Mac:

- **Apple app data** (Notes, Calendar, Reminders, Contacts, Mail, Messages, Music, Finder, Safari, Photos, etc.) is read from and written to local apps via macOS automation APIs.
- **MCP tool results** (note contents, email text, calendar events, etc.) are returned to the connected MCP client (e.g., Claude Desktop, Cursor). The MCP client's own privacy policy governs how it handles this data.

### Data That Leaves Your Mac

AirMCP connects to external services in the following cases:

| Feature | Service | Data Sent | When |
|---------|---------|-----------|------|
| **Semantic search (Gemini)** | Google Gemini API (`generativelanguage.googleapis.com`) | Text excerpts from notes (300 chars), email subjects/excerpts (200 chars), calendar event titles, reminder names | Only when `GEMINI_API_KEY` is configured and semantic indexing runs |
| **Weather** | Open-Meteo API (`api.open-meteo.com`) | Latitude/longitude coordinates | When weather tools are called |
| **Geocoding** | Open-Meteo Geocoding (`geocoding-api.open-meteo.com`) | Place names/addresses | When maps tools search for locations |
| **Reverse geocoding** | OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) | GPS coordinates | When maps tools resolve coordinates to addresses |
| **Google Workspace** | Google APIs (via `gws` CLI) | Gmail, Drive, Sheets, Calendar, Docs data | When Google Workspace tools are used (requires separate Google auth) |

**If you do not configure `GEMINI_API_KEY` and do not use weather, maps, or Google Workspace tools, no data leaves your Mac.**

### Local Data Storage

AirMCP stores the following data on disk:

| File | Content | Purpose |
|------|---------|---------|
| `~/.config/airmcp/config.json` | Module preferences, HITL settings | User configuration |
| `~/.airmcp/vectors.json` | Text excerpts + embedding vectors from notes, email, calendar, reminders | Semantic search index |
| macOS Spotlight Index | Note titles, email subjects, reminder names, calendar event titles | System-wide Spotlight/Siri discoverability (opt-in via `spotlight_sync` tool) |

The vector store (`vectors.json`) contains text previews of your personal data. It is not encrypted. You can delete it at any time:

```bash
rm -rf ~/.airmcp
```

To also clear Spotlight entries, run the `semantic_clear` tool (which clears both) or `spotlight_clear` (Spotlight only).

## Apple Intelligence / Foundation Models

AirMCP's intelligence tools (`summarize_text`, `rewrite_text`, `proofread_text`, `generate_text`, `generate_structured`, `tag_content`, `ai_chat`, `generate_plan`, `generate_image`) process user-provided text through Apple's on-device Foundation Model (~3B parameters, running on Apple Silicon Neural Engine).

- **On-device by default**: All Foundation Model processing runs locally on your Mac.
- **Private Cloud Compute**: Apple may route complex requests to its Private Cloud Compute servers. AirMCP does not explicitly opt out of PCC. Apple states that PCC data is not retained or accessible to Apple.
- **`summarize_context` fallback**: When MCP Sampling is unavailable, this tool sends a context snapshot (calendar events, reminders, note previews, clipboard contents, mail metadata) to the on-device model.
- **`generate_image`**: Prompts are processed by Apple's on-device Image Playground model.
- **`scan_document`**: Images are processed locally via Apple Vision OCR. No network involvement.

## Siri / App Intents

AirMCP's companion app registers App Intents (Search Notes, Daily Briefing, Check Calendar, Create Reminder) accessible via Siri and Shortcuts.

- Results from Siri invocations may flow through Apple's Siri infrastructure depending on system configuration.
- Apple's own privacy policy governs how Siri processes this data.
- Spotlight-synced data becomes visible in macOS Spotlight search UI.

## Sensitive Data in MCP Tool Results

All data returned by AirMCP tools is sent to the connected MCP client (AI model). This includes:

- **Safari**: `read_page_content` returns full HTML from open tabs (up to 50KB), which may include authenticated web content (banking, email, medical portals). `run_javascript` executes arbitrary JavaScript in browser tabs and returns the result — it can access any DOM data, cookies, or session information from open pages.
- **Screen capture**: `capture_screen`, `capture_window`, and `capture_area` return full screenshots as images. Anything visible on screen (passwords, financial data, private conversations) will be sent to the AI model.
- **Notes, Mail, Messages, Contacts, Calendar, Photos**: Tool results include the full content of these items. Notes may contain passwords or sensitive records. Emails may contain financial or medical information. Photos metadata may include GPS coordinates.

**You are responsible for reviewing what data your AI model can access.** Disable modules you don't want exposed via `npx airmcp init` or the config file.

## Safety Controls

- **Sending email/messages** is disabled by default (`allowSendMail: false`, `allowSendMessages: false`). You must explicitly enable these in config or via environment variables.
- **Human-in-the-loop (HITL)** approval can be enabled to require confirmation before destructive operations (delete, send, move).
- **Destructive tools** are annotated with `destructiveHint: true` so MCP clients can warn before execution.

## Transport Modes

- **stdio (default):** Communication between the MCP client and AirMCP happens via standard input/output on your local machine. No network traffic.
- **HTTP/SSE (`--http`):** AirMCP listens on a local network port. **This mode has no built-in authentication.** You are responsible for securing access. Do not expose to the public internet.

## macOS Permissions

AirMCP requires macOS Automation permissions to interact with Apple apps. These are managed by macOS and granted through system prompts. AirMCP uses these permissions solely to execute actions you request through the MCP client.

## Open Source

AirMCP is open-source software under the MIT License. You can inspect the full source code at [github.com/heznpc/AirMCP](https://github.com/heznpc/AirMCP).

## Changes to This Policy

Updates will be reflected in this file. The "Last updated" date at the top will be revised accordingly.

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/heznpc/AirMCP).
