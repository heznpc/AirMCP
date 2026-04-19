# Privacy Policy

**AirMCP v2.8.1** — MCP Server for the Apple Ecosystem on macOS
Last updated: 2026-03-28

## Overview

AirMCP is an open-source MCP (Model Context Protocol) server that bridges AI assistants and macOS applications. It runs locally on your Mac and provides tools for interacting with Apple apps through JXA (JavaScript for Automation) and a native Swift bridge.

This privacy policy explains how AirMCP handles your data, including what data leaves your machine.

## Data Controller

AirMCP is an open-source project maintained by **heznpc** under the MIT License. As a locally-run tool, the project maintainer does not process your personal data on any server. However, for the purposes of GDPR Article 13/14 transparency, the data controller contact point is:

- **Contact:** GitHub Issues at [https://github.com/heznpc/AirMCP/issues](https://github.com/heznpc/AirMCP/issues)

When you use third-party APIs (Gemini, Nominatim, Open-Meteo, Google Workspace), the respective API provider acts as an independent data controller for the data you send to them.

## Data Collection

AirMCP does not collect analytics, telemetry, usage tracking, or crash reports. There is no advertising or marketing data collection.

## Legal Basis for Processing

Under GDPR Article 6, AirMCP relies on the following legal bases:

- **Legitimate interest (Art. 6(1)(f)):** Local automation operations (reading/writing Apple app data, on-device AI processing, local file operations) are performed based on the user's legitimate interest in automating their own macOS workflows. All such processing occurs entirely on the user's machine.
- **Consent (Art. 6(1)(a)):** External API calls to Google Gemini, OpenStreetMap Nominatim, and Open-Meteo are only made when the user explicitly configures the relevant API keys or invokes the corresponding tools. Users may withdraw consent at any time by removing API keys from the configuration or by not using the relevant tools.

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

## Data Retention

AirMCP does not operate any server-side data storage. All retention is local to your machine:

| Data | Retention | How to Delete |
|------|-----------|---------------|
| `~/.airmcp/vectors.json` (semantic index) | Retained until the user deletes it | Use the `semantic_clear` tool or manually run `rm -rf ~/.airmcp` |
| `~/.config/airmcp/config.json` (configuration) | Retained until the user removes or edits the file | Delete or edit the file manually |
| macOS Spotlight entries | Retained until the user clears them | Use the `spotlight_clear` or `semantic_clear` tool |

For data sent to external APIs (Gemini, Nominatim, Open-Meteo, Google Workspace), AirMCP does not control the retention period. Refer to each provider's privacy policy for their data retention practices.

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

## Data Subject Rights (GDPR Articles 15-22)

Under the GDPR, you have the following rights regarding your personal data:

- **Right to access (Art. 15):** You may request information about what personal data is processed.
- **Right to rectification (Art. 16):** You may correct inaccurate personal data.
- **Right to erasure (Art. 17):** You may request deletion of your personal data.
- **Right to restriction of processing (Art. 18):** You may request that processing be restricted.
- **Right to data portability (Art. 20):** You may request your data in a portable format.
- **Right to object (Art. 21):** You may object to processing based on legitimate interest.

**For locally-stored data:** Because AirMCP runs entirely on your machine, you have full filesystem access to all data it stores. You can inspect, modify, export, or delete `vectors.json`, `config.json`, and Spotlight entries at any time without needing to contact anyone.

**For data sent to external APIs:** If you have exercised Gemini, Nominatim, Open-Meteo, or Google Workspace tools, refer to the respective provider's privacy policy to exercise your data subject rights with them:

- Google Gemini: [Google Privacy Policy](https://policies.google.com/privacy)
- OpenStreetMap Nominatim: [OSMF Privacy Policy](https://wiki.osmfoundation.org/wiki/Privacy_Policy)
- Open-Meteo: [Open-Meteo Terms](https://open-meteo.com/en/terms)

## International Data Transfers

AirMCP processes data locally on your Mac by default. When external APIs are used, international transfers may occur:

- **Google Gemini API:** Data may be transferred to Google servers in the United States. Google provides safeguards under its data processing terms.
- **OpenStreetMap Nominatim:** Requests are sent to OSM servers based in the European Union.
- **Open-Meteo:** Servers are based in the European Union.
- **Google Workspace (via `gws` CLI):** Data is transferred to Google servers. Refer to Google's data processing terms.

No international transfers occur if you do not use these external services.

## Data Protection Officer

A Data Protection Officer (DPO) is not required for AirMCP, as it involves small-scale processing by an individual open-source developer and does not engage in systematic monitoring or large-scale processing of sensitive data.

For privacy-related questions or concerns, contact the project maintainer via GitHub Issues: [https://github.com/heznpc/AirMCP/issues](https://github.com/heznpc/AirMCP/issues)

## Right to Lodge a Complaint

If you believe your data protection rights have been violated, you have the right to lodge a complaint with your local data protection supervisory authority. A list of EU/EEA supervisory authorities is available at [https://edpb.europa.eu/about-edpb/about-edpb/members_en](https://edpb.europa.eu/about-edpb/about-edpb/members_en).

## Open Source

AirMCP is open-source software under the MIT License. You can inspect the full source code at [github.com/heznpc/AirMCP](https://github.com/heznpc/AirMCP).

## Third-party Attribution

- Reverse geocoding powered by [Nominatim](https://nominatim.org/) / [OpenStreetMap](https://www.openstreetmap.org/) (© OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/)).
- Weather data by [Open-Meteo](https://open-meteo.com/).

## Changes to This Policy

Updates will be reflected in this file. The "Last updated" date at the top will be revised accordingly.

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/heznpc/AirMCP).
