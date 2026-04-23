# Using AirMCP with Siri · Shortcuts · Spotlight (iOS 17+, macOS 14+)

AirMCP's 154 read-only tools are auto-registered as Apple App Intents. Anything that speaks the Intents system — Siri, Shortcuts, Spotlight, the Action Button, Widgets — can call them directly, without opening the app.

This doc is for users wiring AirMCP into those flows. The codegen plumbing lives in [RFC 0007](rfc/0007-app-intent-bridge.md).

## What's registered

At build time, `scripts/gen-swift-intents.mjs` reads `docs/tool-manifest.json` and emits one `AppIntent` struct per eligible read-only MCP tool (154 of the 282-tool manifest in v2.13). Each intent routes through [`MCPIntentRouter`](../swift/Sources/AirMCPKit/MCPIntentRouter.swift) to whichever host is installed — on macOS that's the `airmcp` npm binary via stdio, on iOS it's the in-process `AirMCPServer`.

### AppShortcutsProvider (top-10 slots)

Apple caps `AppShortcutsProvider` at 10 entries per app. The curated top-10 (see `APP_SHORTCUTS_TOP` in the codegen) surfaces as Siri default phrases and Spotlight-first suggestions:

1. **Ask AirMCP** (iOS 26+/macOS 26+ only; natural-language agent via Foundation Models)
2. Today's Events
3. List Calendars
4. Search Notes
5. Search Contacts
6. List Reminder Lists
7. List Shortcuts
8. List Bookmarks
9. Get Current Weather
10. Summarize Context

The other 144 intents are still discoverable inside the Shortcuts app — just not pinned as Siri-first phrases.

## Siri phrases (out of the box)

Each shortcut ships with two phrases using `\(.applicationName)`. Examples:

```
"Hey Siri, Today's Events in AirMCP"
"Hey Siri, today events with AirMCP"
"Hey Siri, Search Notes in AirMCP"    → asks for the query
"Hey Siri, Ask AirMCP about my day"   → iOS 26+ only
```

No setup: phrases register the first time the app launches.

## Shortcuts app

1. Open **Shortcuts** (iOS 17+ / macOS Sonoma+).
2. Tap **+** → search "AirMCP".
3. Every AirMCP tool appears as an action. Each accepts the same parameters the MCP inputSchema declares (`startDate: Date`, `query: String`, etc.).

### Example: daily briefing shortcut

Chain multiple AirMCP actions inside one Shortcut:

```
[AirMCP ▸ Today's Events]      → Text  (list of events)
[AirMCP ▸ List Reminder Lists] → Text  (lists with counts)
[Combine Text]                 → combined briefing
[Show Result]
```

All three steps run locally. No cloud round-trip.

### Example: reminders review

```
[AirMCP ▸ Search Reminders]    (query: "past due", completed: false)
[AirMCP ▸ Show Reminder]       (for each)
```

Uses `@Parameter` inputs declared by the generated intent — each action in Shortcuts prompts for them automatically.

## Spotlight

Spotlight indexes every registered AppIntent. Typing any of these surfaces AirMCP:

- tool title (e.g. "Today's Events")
- tool name with underscores → spaces (e.g. "today events")
- the **Ask AirMCP** intent's two phrases on iOS 26+

Tap the Spotlight result to run the action inline.

## The iOS 26 "Use Model" action

iOS 26 Shortcuts added a `Use Model` action that routes natural-language prompts to Apple Intelligence or ChatGPT. AirMCP's 154 AppIntents become tools that `Use Model` can pick autonomously — no extra wiring needed.

Example: a Shortcut that answers "what's the weather tomorrow?" → `Use Model` picks up `AirMCP ▸ Get Daily Forecast` from the system-wide intent registry.

## iOS 26 Interactive Snippets (preview)

Tools with typed output (50 of the 154) additionally emit a SwiftUI snippet view (`MCP<ToolName>SnippetView`) — the Shortcuts / Siri / Spotlight display will render results as structured views instead of a text block on iOS 26+. See [RFC 0007 §3.7](rfc/0007-app-intent-bridge.md#37-interactive-snippets-renderer-confirmed-ios-26-api). Wiring lands in axis 4.2.

## Deep link: `airmcp://`

On macOS the menubar app registers the `airmcp://` URL scheme. Useful for driving AirMCP from a Shortcut's `Open URL` action when a Shortcuts-side parameter binding is inconvenient:

```
airmcp://briefing          → opens Calendar.app (macOS only)
airmcp://…                 → see app/Sources/AirMCPApp/AirMCPApp.swift for the full handler
```

## When the agent asks for a destructive tool

All destructive tools (`create_*`, `delete_*`, `update_*`) stay out of the auto-generated AppShortcutsProvider until RFC 0007 §A.3 lands `requestConfirmation(actionName:snippetIntent:)` (iOS 26 API). Until then, destructive actions stay on the HTTP/stdio surface where AirMCP's HITL prompt handles approval.

## Troubleshooting

### "Siri doesn't recognize the phrase"

1. Open Settings → Siri → AirMCP → **Phrases** and confirm the generated shortcut list is populated.
2. On a fresh install, the first phrase you try may time out (Spotlight's search index is still populating). Retry after a minute.
3. If Siri still doesn't match, add a custom phrase from Settings → Siri → My Shortcuts.

### "Action doesn't show in Shortcuts"

Codegen dropped the tool because its `inputSchema` contains a composite (array-of-object or record-like) argument that AppIntent can't represent as a single `@Parameter`. See `appIntentEligible: false` rows in `docs/tool-manifest.json`.

### "Action runs, result is empty / generic"

The tool's Router path is likely hitting a permission error. Check:

- **macOS**: `npx airmcp doctor` — surfaces the TCC / EventKit / HealthKit status per module.
- **iOS**: open the AirMCPiOS app once; it surfaces permission prompts.

## Related

- [RFC 0007 — MCP Tool ↔ App Intent auto-bridge](rfc/0007-app-intent-bridge.md)
- [ios-architecture.md §15 2026-Q2 ecosystem update](ios-architecture.md)
- [Apple Developer — App Intents](https://developer.apple.com/documentation/appintents)
- [Apple Developer — AppShortcutsProvider](https://developer.apple.com/documentation/appintents/appshortcutsprovider)
