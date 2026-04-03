# AGENTS.md

> Context for AI coding assistants (Claude Code, Cursor, Copilot, Cline, etc.)

## Project Structure

```
src/
├── index.ts              # Server entry — registers all modules
├── notes/                # Apple Notes (12 tools, 3 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── reminders/            # Apple Reminders (11 tools, 2 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── calendar/             # Apple Calendar (10 tools, 2 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── contacts/             # Apple Contacts (10 tools)
│   ├── tools.ts, scripts.ts
├── mail/                 # Apple Mail (11 tools)
│   ├── tools.ts, scripts.ts
├── music/                # Apple Music (17 tools)
│   ├── tools.ts, scripts.ts
├── finder/               # Finder (8 tools)
│   ├── tools.ts, scripts.ts
├── safari/               # Safari (12 tools)
│   ├── tools.ts, scripts.ts
├── messages/             # Messages (6 tools)
│   ├── tools.ts, scripts.ts
├── system/               # System (27 tools)
│   ├── tools.ts, scripts.ts
├── photos/               # Photos (9 tools, macOS 26+ Swift)
│   └── tools.ts
├── shortcuts/            # Shortcuts (11 tools, 3 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── intelligence/         # Apple Intelligence (10 tools, macOS 26+)
│   └── tools.ts
├── tv/                   # Apple TV (6 tools)
│   ├── tools.ts, scripts.ts
├── ui/                   # UI Automation (10 tools)
│   ├── tools.ts, scripts.ts, ax-query.ts
├── screen/               # Screen Capture (5 tools)
│   ├── tools.ts, scripts.ts
├── maps/                 # Maps (8 tools)
│   ├── tools.ts, scripts.ts, api.ts
├── podcasts/             # Podcasts (6 tools, broken on macOS 26)
│   ├── tools.ts, scripts.ts
├── weather/              # Weather (3 tools)
│   ├── tools.ts, api.ts
├── pages/                # Pages (7 tools)
│   ├── tools.ts, scripts.ts
├── numbers/              # Numbers (9 tools)
│   ├── tools.ts, scripts.ts
├── keynote/              # Keynote (9 tools)
│   ├── tools.ts, scripts.ts
├── location/             # Location (2 tools, Swift)
│   └── tools.ts
├── bluetooth/            # Bluetooth (4 tools, Swift)
│   └── tools.ts
├── google/               # Google Workspace (16 tools)
│   ├── tools.ts, gws.ts
├── semantic/             # Semantic search (4 tools)
│   ├── tools.ts, service.ts, embeddings.ts, store.ts
├── apps/                 # App management (calendar-week, music-player UIs)
│   └── tools.ts
├── cross/                # Cross-module prompts (19 prompts)
│   ├── prompts.ts, tools.ts
├── skills/               # YAML skill engine (3 built-in skills)
│   ├── executor.ts, loader.ts, register.ts
│   └── builtins/
└── shared/
    ├── constants.ts      # All magic numbers, API URLs, timeouts, buffer sizes
    ├── jxa.ts            # JXA execution (osascript wrapper, circuit breaker, retry)
    ├── swift.ts          # Swift bridge (Foundation Models, EventKit, PhotoKit)
    ├── esc.ts            # String escaping for JXA injection prevention
    ├── result.ts         # ok()/err() MCP response helpers
    ├── config.ts         # Config parsing, module registry, MCP client paths
    ├── iwork.ts          # Shared iWork helpers (bundle ID mapping)
    ├── modules.ts        # MODULE_REGISTRY (27 modules)
    └── resources.ts      # MCP resource registration (8 resources)
swift/                    # Swift package for Apple Intelligence + EventKit + PhotoKit
scripts/                  # QA test runner + stats counter
tests/                    # Script generator tests
```

## Stats

- **262 tools** across 27 modules (+ dynamic shortcut tools at runtime)
- **32 prompts** (per-module + cross-module + YAML skills)
- **8 MCP resources** (Notes, Calendar, Reminders, Music, Mail, System, Context Snapshot)

## Module Pattern

Each module follows: `scripts.ts` (JXA generators) + `tools.ts` (MCP registration) + optional `prompts.ts`.

- `scripts.ts`: import `esc` from `../shared/esc.js`, return JXA strings
- `tools.ts`: import `ok, err` from `../shared/result.js`, register via `server.registerTool()`
- All tools must have `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- Tools return `ok(data)` or `err(message)`, never throw

## Key Patterns

- **JXA scripts**: `esc()` for injection prevention, `JSON.stringify` output
- **Swift bridge**: `runSwift(command, input)` — spawns binary, JSON via stdin/stdout
- **iWork apps**: Use bundle IDs (`com.apple.Pages`, etc.) not display names (macOS 26 renamed them)
- **stdio only**: `console.log()` breaks MCP — use `console.error()` for debug
- **Circuit breaker**: 3 failures → 60s auto-disable per app (in `jxa.ts`)
- **Clipboard**: Content truncated to 5MB to stay within osascript maxBuffer
- **Centralized constants**: All timeouts, buffer sizes, limits in `shared/constants.ts`

## Do NOT Modify

- `.github/workflows/` CI/CD pipeline structure
- `tsconfig.json` module settings (`Node16`)
- `esc()` function in `shared/esc.ts` without security review

## Known Limitations (macOS 26)

- **Podcasts**: JXA scripting dictionary removed — all 6 tools broken
- **Safari bookmarks**: JXA bookmark classes removed, plist fallback needs Full Disk Access
- **iWork display names**: Apps renamed (e.g., "Pages Creator Studio") — use bundle IDs
