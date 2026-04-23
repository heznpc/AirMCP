# RFC 0007 — MCP Tool ↔ App Intent Auto-Bridge (2-phase)

- **Status**: Phase A Accepted (shipped in v2.10-v2.11 across PRs #101-#137). Phase B (stateful multi-step / Apple-API-dependent intents) deferred.
- **Author**: heznpc + Claude
- **Created**: 2026-04-23
- **Target**: v2.13.0 (Phase A — shipped ahead of target) · Apple-API-dependent (Phase B)
- **Amendment history**:
  - 2026-04-23 — §R2 updated with confirmed `requestConfirmation(actionName:snippetIntent:)` API; §3.7 Interactive Snippets renderer added; rollout split into A.2a/A.2b/A.3 to match landed PRs #101-#103 and Interactive Snippets availability.
  - 2026-04-23 (afternoon) — Axis 6 `AskAirMCPIntent` lands ahead of schedule: natural-language FoundationModels agent pinned as the first `AirMCPGeneratedShortcuts` entry on iOS 26+/macOS 26+ (gated by `#if canImport(FoundationModels) && compiler(>=6.3)`). Rollout row "Ax.6" added.
  - 2026-04-24 — Phase A closed. Final tally: 229 auto-generated AppIntents, 50 Interactive Snippet views, 17 AppEnum pickers, destructive HITL via `requestConfirmation`, follow-up taps for list tools, codegen helpers extracted to `scripts/lib/codegen-helpers.mjs` with 134 unit tests + golden-sample regression check.
- **Related**: [docs/ios-architecture.md §15.1](../ios-architecture.md), `app/Sources/AirMCPApp/AppIntents.swift`, `swift/Sources/AirMCPKit/`, `ios/Sources/AirMCPServer/`, RFC 0001 (error categories), RFC 0006 (Swift schema dump)

---

## 1. Motivation

Three independent signals make this the highest-leverage iOS axis for 2026:

1. **Apple is building MCP into App Intents in iOS 26.1 beta** ([9to5Mac](https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/), [AppleInsider](https://appleinsider.com/articles/25/09/22/ios-26-could-get-a-major-ai-boost-with-the-model-context-protocol)). No new MCP-specific framework is planned; the path is "declare an `AppIntent` and the system exposes it as an MCP tool."
2. **The reference competitor ([supermemoryai/apple-mcp](https://github.com/supermemoryai/apple-mcp)) was archived on 2026-01-01** with 3.1k stars and macOS-only coverage. The "Apple-native MCP" reference slot is open.
3. **AirMCP has 270+ tools registered in Node / TypeScript** but only 4 hand-written App Intents ([app/Sources/AirMCPApp/AppIntents.swift](../../app/Sources/AirMCPApp/AppIntents.swift)). Hand-porting is not an option — we need a build-time adapter that turns tool metadata into Swift `@AppIntent` declarations automatically.

### Why now, not later

Waiting for Apple's official MCP API would be wrong because:

- The only developer-visible contract today **is** `AppIntent`. Apple's "MCP exposure" is a property of an AppIntent-declaring app, not a separate API surface. Anything we build on AppIntents is forward-compatible with the system MCP GA.
- The one observed opt-in (`NSAppIntentsMCPExposure` Info.plist key, per [xugj520 analysis](https://www.xugj520.cn/en/archives/apple-mcp-ios-26-developer-guide.html)) is parameterizable — we treat it as a plist toggle, not a code change.
- Shortcuts iOS 26's new "Use Model" action already routes to AppIntents. So even before system MCP GA, Phase A gives AirMCP tools in Shortcuts + Spotlight + Siri.

## 2. Goal

`MCP tool in Node` → automatically registered `AppIntent` in Swift on iOS/macOS, without hand-porting. One metadata source, two call surfaces (HTTP/stdio + App Intents). No runtime translation cost at call time.

### Non-goals

- Auto-implementing tool **bodies** in Swift. The tool body still executes in Node (macOS) or via AirMCPKit Swift services (iOS Phase 3, tracked separately).
- Replacing the Hummingbird HTTP server. Dual transport stays until Apple publishes the wire protocol.
- Solving HITL or elicitation in AppIntents (deferred — see §5).

## 3. Proposed Design — Phase A (buildable today)

### 3.1 Metadata SSOT

Tool metadata already lives in Node via `server.registerTool(name, opts, handler)` calls. We add a build step:

```
tools.ts  →  scripts/dump-tool-manifest.mjs  →  tool-manifest.json  →  swift codegen  →  Generated/MCPIntents.swift
```

`scripts/dump-tool-manifest.mjs` spins the server in in-memory mode (no stdio/HTTP), walks the registered tool registry, and emits a JSON file with one entry per tool:

```json
{
  "list_events": {
    "title": "List Events",
    "description": "List calendar events in a date range.",
    "inputSchema": {
      "startDate": { "type": "string", "format": "date-time", "description": "..." },
      "endDate": { "type": "string", "format": "date-time", "description": "..." },
      "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 50 }
    },
    "outputSchema": { "total": "number", "events": "array<...>" },
    "annotations": { "readOnlyHint": true, "destructiveHint": false },
    "platforms": ["darwin"],
    "transport": { "kind": "jxa" }
  }
}
```

Intentionally a _subset_ of the full zod schema — only the fields codegen needs. Full zod stays the runtime source of truth and is unaffected.

### 3.2 Swift codegen step

`scripts/gen-swift-intents.mjs` reads `tool-manifest.json` and writes `swift/Sources/AirMCPKit/Generated/MCPIntents.swift`. For each tool it emits a struct:

```swift
// GENERATED — do not edit. Source: tool-manifest.json. Run `npm run gen:intents`.
struct ListEventsIntent: AppIntent {
    static var title: LocalizedStringResource = "List Events"
    static var description: IntentDescription? = "List calendar events in a date range."
    static var isDiscoverable = true
    // readOnlyHint: true → no confirmation prompt
    static var openAppWhenRun = false

    @Parameter(title: "Start Date") var startDate: Date
    @Parameter(title: "End Date") var endDate: Date
    @Parameter(title: "Limit", default: 50, inclusiveRange: (1, 200)) var limit: Int

    func perform() async throws -> some IntentResult & ReturnsValue<ListEventsOutput> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "list_events",
            args: ["startDate": startDate.iso8601, "endDate": endDate.iso8601, "limit": limit],
        )
        return .result(value: try ListEventsOutput(decoding: result.structuredContent))
    }
}
```

The `ListEventsOutput` struct is also codegen'd from the tool's `outputSchema` (or imported from the existing hand-maintained interfaces landed in RFC 0006-adjacent PR #98, e.g. `MessagesListChatsOutput`). When the tool's outputSchema gains a field, next `gen:intents` pass refreshes the struct.

### 3.3 Zod → `@Parameter` type mapping

| zod                      | AppIntent `@Parameter`                      | Notes                                         |
| ------------------------ | ------------------------------------------- | --------------------------------------------- |
| `z.string()`             | `String`                                    | —                                             |
| `z.string().datetime()`  | `Date`                                      | ISO 8601 round-trip                           |
| `z.number().int()`       | `Int`                                       | `inclusiveRange` from `.min/.max`             |
| `z.number()`             | `Double`                                    | —                                             |
| `z.boolean()`            | `Bool`                                      | —                                             |
| `z.enum([...])`          | `enum AppEnum`                              | codegen a matching Swift enum                 |
| `z.array(z.string())`    | `[String]`                                  | AppIntents supports array params since iOS 17 |
| `z.array(z.object(...))` | **skip** (mark "AppIntent-ineligible")      | composite inputs don't fit `@Parameter` today |
| `z.optional()`           | `@Parameter(default: nil)` or `Optional<T>` | —                                             |

Tools using `z.array(z.object(...))` or `z.record()` in input are **marked `appIntentEligible: false`** in the manifest and skipped by codegen. Today's inventory (checked against PR #98 Wave 3 tools) has ~240/270 eligible.

### 3.4 Router — one Swift entry point for all generated intents

`MCPIntentRouter.shared.call(tool:args:)` resolves per platform:

- **macOS (embedded Node)**: execFile `airmcp` (the npm binary) with a one-shot stdio JSON-RPC `tools/call`, parses response
- **iOS (AirMCPKit)**: in-process call into `AirMCPServer` (already built in `ios/Sources/AirMCPServer/`) via direct `MCPServer.callTool()` — no IPC
- **macOS (future Swift-native)**: same as iOS when AirMCPKit eventually implements the tool server-side

`MCPIntentRouter` lives in `swift/Sources/AirMCPKit/IntentBridge/Router.swift`. A single 150-line file. Platform selection is compile-time (`#if os(iOS)` / `#if os(macOS)`).

### 3.5 App Shortcuts registration

`AppShortcutsProvider` (Apple API) auto-registers every generated `AppIntent` into Shortcuts / Siri / Spotlight. Codegen emits:

```swift
struct AirMCPShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ListEventsIntent(), phrases: ["List events with \(.applicationName)"], shortTitle: "List Events", systemImageName: "calendar")
        AppShortcut(intent: ReadNoteIntent(), phrases: ["Read note with \(.applicationName)"], shortTitle: "Read Note", systemImageName: "note.text")
        // ... N entries
    }
}
```

Apple caps `AppShortcutsProvider` at **10 entries** per app historically. We pick the top-10 by usage (piggyback on the existing `usageTracker.getNextTools` data) and regenerate per release. The other ~230 stay as `AppIntent`s (discoverable in Shortcuts but not shown as first-class suggestions).

### 3.6 Existing hand-written intents

The 4 intents in [app/Sources/AirMCPApp/AppIntents.swift](../../app/Sources/AirMCPApp/AppIntents.swift) (macOS menubar app) are kept as **golden samples** — they serve as the adapter's reference output. Codegen compares its output against them in CI to catch regressions.

### 3.7 Interactive Snippets renderer (confirmed iOS 26 API)

`structuredContent` + `outputSchema` from a tool call becomes an **Interactive Snippet** on iOS — a SwiftUI view Siri / Shortcuts / Spotlight render inline, with tap-able affordances that re-enter AppIntents without the user leaving the host surface. API confirmed 2026-04-23 research:

- A tool's `perform()` returns `.result(value: payload, view: SnippetView(payload: payload))` — the View is a normal SwiftUI view whose interactive elements must use the `Button(intent:label:)` initializer ([Apple Docs](https://developer.apple.com/documentation/AppIntents/displaying-static-and-interactive-snippets)); any other `Button` initializer renders as a passive label.
- Follow-up intents declared inline: tapping a list item dispatches a second AppIntent so chains like `list_events` → tap one → `read_event` work without opening the app.

**Codegen mapping**:

| outputSchema shape             | Snippet View template                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `{ items: [...] }` (list-like) | `ForEach` + `Button(intent: ReadFooIntent(id: item.id))` per row              |
| scalar object                  | `VStack` of key-value rows; primary CTA button for the natural follow-up tool |
| unit (no typed output)         | no snippet; text-only result (A.1 default)                                    |

Lands in **axis 4** after A.2b (which gives us `ReturnsValue<T>` + Codable structs to render against). Gated on `canImport(AppIntents) && #available(iOS 26, *)`.

## 4. Proposed Design — Phase B (Apple-API-dependent)

Once Apple publishes the actual MCP-exposure key (whether `NSAppIntentsMCPExposure` or something else) in a shipping iOS release note:

1. Inject the key into `ios/Resources/Info.plist` (driven by an `AIRMCP_EXPOSE_AS_MCP` build flag, default off until the key is stable)
2. If Apple adds a compile-time attribute (e.g. `@MCPExposedIntent`), codegen picks it up automatically — one edit in `scripts/gen-swift-intents.mjs`
3. No tool-level change. The 240+ generated intents inherit the exposure

Phase B is a line of Xcode config, not a refactor.

## 5. Risks / Open Questions

### R1. AppIntent input type expressiveness (§3.3)

- **Risk**: ~10% of tools accept composite inputs (`z.array(z.object(...))`, `z.record()`) that AppIntent cannot represent
- **Mitigation**: Mark ineligible, surface via `doctor`. Revisit if Apple lifts the constraint (WWDC 2026 candidate — AppIntent-accepting `struct Codable` params has been asked for).

### R2. HITL / elicitation in AppIntents

- **Risk**: AirMCP's HITL layer (RFC 0001, v2.7) assumes a socket-based consent UI. `AppIntent.perform()` can show `IntentDialog` but not arbitrary consent UIs.
- **Mitigation**: Phase A.1/A.2 scope is **read-only or idempotent tools only**. Tools with `destructiveHint: true` are marked `appIntentEligible: false` until Phase A.3.
- **Phase A.3 concrete API (confirmed 2026-04-23)**: iOS 26 ships [`requestConfirmation(actionName:snippetIntent:)`](https://developer.apple.com/documentation/AppIntents/displaying-static-and-interactive-snippets) on `AppIntent` — an async call inside `perform()` that blocks until the user completes a confirmation action rendered as an Interactive Snippet. This replaces the bespoke IntentDialog design we'd have had to invent: codegen for destructive tools emits a `requestConfirmation` call that echoes the tool's intent + summarized args via a confirmation snippet; approval resumes the call into `MCPIntentRouter`. Socket-HITL remains the source of truth for CLI / non-AppIntent paths.

### R3. Router fragility on macOS

- **Risk**: `execFile airmcp` for every AppIntent invocation has ~200–500ms cold-start cost
- **Mitigation**: keep a supervisor process warm (same pattern as existing menubar app in [app/Sources/AirMCPApp/ServerManager.swift](../../app/Sources/AirMCPApp/ServerManager.swift)). Reuse existing server socket when available. Measure before optimizing.

### R4. Codegen drift

- **Risk**: `tool-manifest.json` and generated `.swift` drift from actual tools
- **Mitigation**: A CI step runs `npm run gen:intents` and fails if the generated file differs from checked-in. Same pattern as `count-stats --check`. Same-PR self-healing regen is built in.

### R5. Apple changes the approach mid-flight

- **Risk**: Apple publishes a new `@MCPExposedIntent` macro or a separate MCP framework, obsoleting parts of §3
- **Mitigation**: Phase A gives us Shortcuts/Siri/Spotlight value **independently** of the MCP exposure layer. Even if Apple pivots, the generated intents still work. Phase B absorbs the actual exposure mechanism.

### R6. Output schemas that are Swift-unfriendly

- **Risk**: Zod `.union()` / `.discriminatedUnion()` / recursive schemas don't map cleanly to Swift `Codable`
- **Mitigation**: Fall back to `String` (raw JSON) return value for those tools. Annotate the intent with a disclaimer. ~5% of tools affected.

### R7. 10-tool cap on `AppShortcutsProvider` selection

- **Open**: Do we pick top-N by usage, or let the user configure via AirMCP app UI?
- **Proposed default**: Top-10 by usage, overridable via `AIRMCP_APP_SHORTCUTS` env / config. Revisit post-launch.

## 6. Rollout

| Phase   | Content                                                                                                                                                                                                                                                                             | Target              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| A.0     | `scripts/dump-tool-manifest.mjs` + `scripts/gen-swift-intents.mjs` + `tool-manifest.json` codegen + CI drift check. **No Swift build change yet.**                                                                                                                                  | v2.13.0             |
| A.1     | `MCPIntentRouter` + macOS route (execFile). **10 hand-picked read-only tools** (notes/calendar/reminders/contacts list+read). App builds + `swift test` passes.                                                                                                                     | v2.13.0             |
| A.2a    | `MCPIntentRouter` handler-injection + macOS execFile handler + iOS in-process `MCPServer.callToolText` handler. Same 10 tools as A.1.                                                                                                                                               | v2.13.0             |
| A.2b.1  | Broaden to all read-only eligible tools (~154 of 282). Auto-filter + AppShortcutsProvider top-10.                                                                                                                                                                                   | v2.13.0 (PR #105)   |
| A.2b.2  | Codable output structs as drift guards. `ReturnsValue<T>` deferred (AppIntent requires `_IntentValue`; AppEntity wrapper separate phase).                                                                                                                                           | v2.13.0 (PR #106)   |
| Ax.6    | `AskAirMCPIntent` natural-language agent via `FoundationModelsBridge`. Pinned first in `AirMCPGeneratedShortcuts` on iOS 26+/macOS 26+.                                                                                                                                             | v2.13.0             |
| A.3     | Destructive-tool support via iOS 26 `requestConfirmation(actionName:snippetIntent:)`. Codegen emits a confirmation-snippet branch for `destructiveHint: true` tools. **Write tools with `destructiveHint: false`** (~60) land in the same phase since they don't need confirmation. | v2.14.0             |
| A.4     | **Write tools with `destructiveHint: true`** gated behind explicit config opt-in.                                                                                                                                                                                                   | v2.15.0             |
| **B.1** | Inject `NSAppIntentsMCPExposure` (or whatever Apple ships) via `AIRMCP_EXPOSE_AS_MCP` build flag. **Triggered by Apple release note.**                                                                                                                                              | Apple-API-dependent |
| **B.2** | If Apple publishes a compile-time attribute (e.g. `@MCPExposedIntent`), codegen picks it up.                                                                                                                                                                                        | Apple-API-dependent |

## 7. Success Metrics

- After A.1: `AppIntent`-conformant Swift code compiles on `swift build` for both `ios/` and `app/`. The 4 hand-written intents match the generated output byte-for-byte.
- After A.2: "Hey Siri, list events with AirMCP" surfaces `list_events` on iOS 17+ devices. `AirMCP_list_events` appears in Shortcuts app. Spotlight query "list events" surfaces the intent.
- After B.1: iOS 26.1+ devices list AirMCP tools in the system MCP clients list (Claude/ChatGPT host apps, once they consume the system channel).
- **Zero hand-written per-tool AppIntent code** post A.1, except the 4 golden samples kept for regression testing.
- `npm run smoke` from PR #98 extended: spawns `airmcp` + asserts `AppIntent` registry listing (Node-side dump) matches codegen output.

## 8. Alternatives Considered

- **Hand-port each tool as a bespoke AppIntent**: rejected. 270+ tools, non-linear maintenance cost, zero alignment with AirMCP's "metadata is source of truth" stance (RFC 0001).
- **Swift runtime reflection to synthesize AppIntents at launch**: rejected. AppIntent schema is resolved at compile time for Shortcuts / Spotlight / Siri indexing. Runtime registration is not sufficient.
- **Skip AppIntents entirely, stay HTTP-only**: rejected. Forfeits Shortcuts / Siri / Spotlight / future system MCP, i.e. forfeits the entire iOS distribution story. Would also concede the "Apple-native MCP reference" slot opened by supermemoryai/apple-mcp's archival.
- **Wait for Apple's official MCP API**: rejected. The official API's surface is already AppIntent itself (per §1). Waiting adds latency without de-risking anything.

## 9. References

- [9to5Mac — MCP in iOS 26.1 beta (2025-09-22)](https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/)
- [AppleInsider — iOS 26 MCP AI boost](https://appleinsider.com/articles/25/09/22/ios-26-could-get-a-major-ai-boost-with-the-model-context-protocol)
- [fatbobman's Swift Weekly #104 — system-level MCP](https://fatbobman.com/en/weekly/issue-104/)
- [xugj520 — iOS 26 MCP Developer Guide](https://www.xugj520.cn/en/archives/apple-mcp-ios-26-developer-guide.html) (sole source for `NSAppIntentsMCPExposure`; treat as unverified until Apple confirms)
- [Apple App Intents framework](https://developer.apple.com/documentation/appintents)
- [Apple Developer — Displaying static and interactive snippets](https://developer.apple.com/documentation/AppIntents/displaying-static-and-interactive-snippets) — source for §3.7 renderer + §R2 `requestConfirmation` mitigation
- [Nutrient blog — WWDC25 interactive snippet intents](https://www.nutrient.io/blog/wwdc25-snippet-intents/)
- [supermemoryai/apple-mcp (archived 2026-01-01)](https://github.com/supermemoryai/apple-mcp)
- [MacRumors — iOS 26.4.2 (2026-04-22)](https://www.macrumors.com/2026/04/22/apple-releases-ios-26-4-2/) — confirmed no Apple-side MCP / AppIntents public API change through 26.4.2
- AirMCP PR #99 — [docs/ios-architecture.md](../ios-architecture.md) §15 2026-Q2 positioning
- AirMCP PR #98 — script ↔ outputSchema contract tests (template for codegen drift guard)
- AirMCP PR #101–#103 — A.0 manifest, A.1 codegen, A.2a router runtime (merged)
