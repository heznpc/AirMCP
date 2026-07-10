# AirMCP App Intent actions on macOS and App Shortcuts on iOS

AirMCP generates Apple `AppIntent` action types from the MCP tool manifest. The platform surfaces are not identical:

- **macOS:** App Intent actions are available inside the Shortcuts action library. Apple's [platform guidance](https://developer.apple.com/design/human-interface-guidelines/app-shortcuts#Platform-considerations) says App Shortcuts are not supported in macOS, so AirMCP does not register an `AppShortcutsProvider` or suggested “Hey Siri” phrases for the Mac app. The API symbol's macOS SDK availability does not widen that product support boundary.
- **iOS preview:** the generated actions can additionally participate in an iOS-only `AppShortcutsProvider`, Siri phrases, Spotlight, and other supported system surfaces. The iOS runtime remains a deliberately small read-only preview, not parity with the macOS server.

This doc is for users wiring AirMCP into those flows. The codegen plumbing lives in [RFC 0007](rfc/0007-app-intent-bridge.md).

## What's registered

At build time, `scripts/gen-swift-intents.mjs` reads `docs/tool-manifest.json` and emits one `AppIntent` struct per AppIntent-eligible MCP tool. Ineligible tools are recorded in the manifest with a reason, usually because a composite-object input does not map cleanly to `@Parameter` types. Each intent routes through [`MCPIntentRouter`](../swift/Sources/AirMCPKit/MCPIntentRouter.swift): the signed macOS app prefers its embedded, token-gated Node runtime; iOS uses its narrowed in-process preview server.

Generated type count and executable runtime count are different contracts. The
macOS app can route its generated actions to the governed Node runtime. The iOS
preview server currently registers and dispatches exactly these eight actions:

| App Intent action | iOS framework surface | Contract |
| --- | --- | --- |
| `get_location_permission` | Core Location permission status | read-only |
| `list_calendars` | EventKit calendars | read-only |
| `list_contacts` | Contacts | read-only |
| `list_reminder_lists` | EventKit reminder lists | read-only |
| `list_reminders` | EventKit reminders | read-only |
| `search_contacts` | Contacts | read-only |
| `search_reminders` | EventKit reminders | read-only |
| `today_events` | EventKit calendar events | read-only |

`IOSPreviewContract` enforces that allowlist both when a tool is registered and
when a generated intent calls the in-process router. A generated iOS action
outside the list fails closed; generated source presence is not evidence that
the action is an iOS preview capability.

### iOS-only AppShortcutsProvider release boundary

Apple caps `AppShortcutsProvider` at 10 entries per app. AirMCP's iOS provider
uses eight entries, and `APP_SHORTCUTS_TOP` matches the runtime allowlist above
exactly. The codegen guard fails when a listed name is missing or ineligible;
the iOS server separately fails closed at registration and dispatch.

This exactness does not make the broader iOS app App Store-ready. Store copy,
review notes, privacy answers, and screenshots must still be reconciled with
the eight-tool contract, and shared governance is required before any write is
added.

`AskAirMCPIntent` remains an opt-in Foundation Models experiment in source for
supported macOS/iOS builds. It has no App Shortcut provider entry, is not one
of the eight executable iOS preview tools, and must not be presented as a
current iOS release capability.

On macOS, generated App Intent actions remain discoverable in the Shortcuts
action library without an `AppShortcutsProvider` or suggested Siri phrases.

## Siri phrases (iOS only)

An iOS `AppShortcutsProvider` may register phrases using
`\(.applicationName)`. For example, release-ready phrases can be built around
allowlisted actions such as:

```
"Hey Siri, Today's Events in AirMCP"
"Hey Siri, list reminders with AirMCP"
"Hey Siri, search contacts with AirMCP"  → asks for the query
```

The phrases register only from the iOS provider. They are not registered by the
macOS app. They remain an engineering preview rather than an App Store promise
until the separate submission gates pass.

The macOS menubar app's **Workflows** menu instead offers MCP-client prompts, core tool lists, and safety notes.

## Shortcuts app

1. Open **Shortcuts** (iOS 17+ or macOS Sonoma+).
2. Tap **+** → search "AirMCP".
3. Search for an AirMCP action. Each available action accepts the parameters generated from the MCP input schema (`query: String`, `completed: Bool`, etc.). On iOS, only the eight read-only preview actions above execute until shared governance is available.

### Example: daily briefing shortcut

Chain multiple AirMCP actions inside one Shortcut:

```
[AirMCP ▸ Today's Events]      → Text  (list of events)
[AirMCP ▸ List Reminder Lists] → Text  (lists with counts)
[AirMCP ▸ List Reminders]      → Text  (reminders)
[Combine Text]                 → combined briefing
[Show Result]
```

All three steps run locally. No cloud round-trip.

### Example: reminders review

```
[AirMCP ▸ Search Reminders]    (query: "past due", completed: false)
[Show Result]
```

Uses `@Parameter` inputs declared by the generated intent — each action in Shortcuts prompts for them automatically.

## Spotlight (iOS preview)

Eligible iOS App Intent entities and shortcuts can surface in Spotlight when the system indexes them. AirMCP does not claim that every generated action is automatically indexed on macOS.

- tool title (e.g. "Today's Events")
- tool name with underscores → spaces (e.g. "today events")

Tap the Spotlight result to run the action inline.

## The iOS 26 "Use Model" action

iOS 26 Shortcuts added a `Use Model` action that can compose with App Intent
actions. It does not widen AirMCP's runtime permissions: only the eight
allowlisted iOS preview actions can complete.

Example: a Shortcut can feed `AirMCP ▸ Today's Events` into `Use Model` to
summarize the returned event text. Weather, Notes, HealthKit, and write actions
are outside the current iOS preview contract.

## iOS 26 Interactive Snippets (preview)

Tools with typed output additionally emit a SwiftUI snippet view (`MCP<ToolName>SnippetView`) for supported iOS 26 system surfaces. See [RFC 0007 §3.7](rfc/0007-app-intent-bridge.md#37-interactive-snippets-renderer-confirmed-ios-26-api).

## Deep link: `airmcp://`

On macOS the menubar app registers the `airmcp://` URL scheme. Useful for driving AirMCP from a Shortcut's `Open URL` action when a Shortcuts-side parameter binding is inconvenient:

```
airmcp://briefing          → opens Calendar.app (macOS only)
airmcp://…                 → see app/Sources/AirMCPApp/AirMCPApp.swift for the full handler
```

## When the agent asks for a destructive tool

The iOS preview never registers a write-capable or destructive tool. Setting
`AIRMCP_APPINTENTS_DESTRUCTIVE=true` may affect generated source, but it does not
expand `IOSPreviewContract`; iOS registration and direct dispatch still reject
the call. On the macOS HTTP/stdio and app-runtime surfaces, AirMCP's per-call
HITL guard remains the approval path.

## Troubleshooting

### "Siri doesn't recognize the phrase" (iOS)

1. Open Settings → Siri → AirMCP → **Phrases** and confirm the generated shortcut list is populated.
2. On a fresh install, the first phrase you try may time out (Spotlight's search index is still populating). Retry after a minute.
3. On macOS, use the Shortcuts action library instead; there is no AirMCP App Shortcut phrase to repair.

### "Action doesn't show in Shortcuts"

First check the platform boundary. macOS has generated actions but no AirMCP App
Shortcut phrases. On iOS, source generation alone is insufficient: the tool
must also be one of the eight names in `IOSPreviewContract`. Codegen can
separately drop a tool whose composite input cannot map to `@Parameter`; see
`appIntentEligible: false` rows in `docs/tool-manifest.json`.

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
