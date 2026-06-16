# Using AirMCP with Siri · Shortcuts · Spotlight (iOS 17+, macOS 14+)

AirMCP's AppIntent-eligible tools and workflow skills are auto-registered as Apple App Intents (read-only + non-destructive writes; destructive ones gate behind `AIRMCP_APPINTENTS_DESTRUCTIVE=true` at codegen time per RFC 0007 §6). Anything that speaks the Intents system — Siri, Shortcuts, Spotlight, the Action Button, Widgets — can call them directly, without opening the app.

This doc is for users wiring AirMCP into those flows. The codegen plumbing lives in [RFC 0007](rfc/0007-app-intent-bridge.md).

## What's registered

At build time, `scripts/gen-swift-intents.mjs` reads `docs/tool-manifest.json` and emits one `AppIntent` struct per AppIntent-eligible MCP tool. Ineligible tools are recorded in the manifest with a reason, usually because a composite-object input does not map cleanly to `@Parameter` types. Each intent routes through [`MCPIntentRouter`](../swift/Sources/AirMCPKit/MCPIntentRouter.swift) to whichever host is installed — on macOS that's the `airmcp` npm binary via stdio, on iOS it's the in-process `AirMCPServer`.

### AppShortcutsProvider slots

Apple caps `AppShortcutsProvider` at 10 entries per app. The default generated provider uses nine workflow-first slots (see `APP_SHORTCUTS_TOP` in the codegen) rather than a random sample of low-level tools:

1. Daily Briefing
2. Today Timeline
3. Inbox Triage
4. Project Digest
5. Today's Events
6. Search Notes
7. List Reminders
8. Search Contacts
9. Get Current Weather

`Ask AirMCP` is a separate FoundationModels preview shortcut. It is compiled only in opt-in builds that define `AIRMCP_ENABLE_FOUNDATION_MODELS` with an iOS 26+/macOS 26+ SDK.

The rest of the eligible intents are still discoverable inside the Shortcuts app — just not pinned as Siri-first phrases.

## Siri phrases (out of the box)

Each shortcut ships with two phrases using `\(.applicationName)`. Examples:

```
"Hey Siri, Daily Briefing in AirMCP"
"Hey Siri, triage my inbox with AirMCP"
"Hey Siri, Search Notes in AirMCP"    → asks for the query
"Hey Siri, Ask AirMCP about my day"   → FoundationModels opt-in build only
```

No setup: phrases register the first time the app launches.

The macOS menubar app also includes a **Workflows** menu with the same curated prompts, Siri phrases, core tools, and safety notes.

## Shortcuts app

1. Open **Shortcuts** (iOS 17+ / macOS Sonoma+).
2. Tap **+** → search "AirMCP".
3. Every generated AirMCP intent appears as an action. Each accepts the same parameters the MCP inputSchema declares (`startDate: Date`, `query: String`, etc.).

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
- the **Ask AirMCP** intent's two phrases in FoundationModels opt-in builds

Tap the Spotlight result to run the action inline.

## The iOS 26 "Use Model" action

iOS 26 Shortcuts added a `Use Model` action that routes natural-language prompts to Apple Intelligence or ChatGPT. AirMCP's generated AppIntents become tools that `Use Model` can pick autonomously — no extra wiring needed.

Example: a Shortcut that answers "what's the weather tomorrow?" → `Use Model` picks up `AirMCP ▸ Get Daily Forecast` from the system-wide intent registry.

## iOS 26 Interactive Snippets (preview)

Tools with typed output additionally emit a SwiftUI snippet view (`MCP<ToolName>SnippetView`) — the Shortcuts / Siri / Spotlight display will render results as structured views instead of a text block on iOS 26+. See [RFC 0007 §3.7](rfc/0007-app-intent-bridge.md#37-interactive-snippets-renderer-confirmed-ios-26-api).

## Deep link: `airmcp://`

On macOS the menubar app registers the `airmcp://` URL scheme. Useful for driving AirMCP from a Shortcut's `Open URL` action when a Shortcuts-side parameter binding is inconvenient:

```
airmcp://briefing          → opens Calendar.app (macOS only)
airmcp://…                 → see app/Sources/AirMCPApp/AirMCPApp.swift for the full handler
```

## When the agent asks for a destructive tool

Destructive tools stay out of generated AppIntents by default. If you explicitly build with `AIRMCP_APPINTENTS_DESTRUCTIVE=true`, generated destructive intents include an AppIntent confirmation dialog before they call AirMCP. On the HTTP/stdio MCP surface, AirMCP's HITL guard remains the approval path.

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
- [AirMCP Workflow Guide](workflows.md)
- [ios-architecture.md §15 2026-Q2 ecosystem update](ios-architecture.md)
- [Apple Developer — App Intents](https://developer.apple.com/documentation/appintents)
- [Apple Developer — AppShortcutsProvider](https://developer.apple.com/documentation/appintents/appshortcutsprovider)
