# AGENTS.md

> Context for AI coding assistants (Claude Code, Cursor, Copilot, Cline, etc.)

## Project Structure

```
src/
├── index.ts              # Server entry — registers all modules
├── notes/                # Apple Notes (12 tools, 3 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── reminders/            # Apple Reminders (7 tools, 2 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── calendar/             # Apple Calendar (7 tools, 2 prompts)
│   ├── tools.ts, scripts.ts, prompts.ts
├── contacts/             # Apple Contacts (7 tools)
│   ├── tools.ts, scripts.ts
├── mail/                 # Apple Mail (5 tools)
│   ├── tools.ts, scripts.ts
├── music/                # Apple Music (17 tools)
│   ├── tools.ts, scripts.ts
├── finder/               # Finder (4 tools)
│   ├── tools.ts, scripts.ts
├── safari/               # Safari (5 tools)
│   ├── tools.ts, scripts.ts
├── messages/             # Messages (3 tools)
│   ├── tools.ts, scripts.ts
├── system/               # System (23 tools)
│   ├── tools.ts, scripts.ts
├── photos/               # Photos (3 tools, macOS 26+ Swift)
│   └── tools.ts
├── shortcuts/            # Shortcuts (4 tools, 1 prompt)
│   ├── tools.ts, scripts.ts, prompts.ts
├── intelligence/         # Apple Intelligence (8 tools, macOS 26+)
│   └── tools.ts
├── tv/                   # Apple TV (7 tools)
│   ├── tools.ts, scripts.ts
├── screen/               # Screen Capture (3 tools)
│   └── tools.ts
├── maps/                 # Maps (5 tools)
│   ├── tools.ts, scripts.ts
├── podcasts/             # Podcasts (6 tools, broken on macOS 26)
│   ├── tools.ts, scripts.ts
├── weather/              # Weather (3 tools)
│   └── tools.ts
├── pages/                # Pages (6 tools)
│   ├── tools.ts, scripts.ts
├── numbers/              # Numbers (7 tools)
│   ├── tools.ts, scripts.ts
├── keynote/              # Keynote (8 tools)
│   ├── tools.ts, scripts.ts
├── location/             # Location (2 tools, Swift)
│   └── tools.ts
├── bluetooth/            # Bluetooth (2 tools, Swift)
│   └── tools.ts
├── cross/                # Cross-module prompts (19 prompts)
│   └── prompts.ts
├── skills/               # YAML skill engine (3 built-in skills)
│   ├── engine.ts, loader.ts
│   └── builtins/
└── shared/
    ├── jxa.ts            # JXA execution (osascript wrapper, circuit breaker, retry)
    ├── swift.ts          # Swift bridge (Foundation Models, EventKit, PhotoKit)
    ├── esc.ts            # String escaping for JXA injection prevention
    ├── result.ts         # ok()/err() MCP response helpers
    ├── config.ts         # Environment variable parsing, OS version detection
    ├── iwork.ts          # Shared iWork helpers (bundle ID mapping)
    ├── modules.ts        # MODULE_REGISTRY (24 modules)
    └── resources.ts      # MCP resource registration (12 resources)
swift/                    # Swift package for Apple Intelligence + EventKit + PhotoKit
scripts/                  # QA test runner (qa-test.mjs)
tests/                    # Script generator tests
```

## Stats

- **226 tools** across 24 modules
- **31 prompts** (per-module + cross-module + YAML skills)
- **12 MCP resources** (Notes, Calendar, Reminders, Music, Mail, System, Context Snapshot)

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

## Do NOT Modify

- `.github/workflows/` CI/CD pipeline structure
- `tsconfig.json` module settings (`Node16`)
- `esc()` function in `shared/esc.ts` without security review

## Known Limitations (macOS 26)

- **Podcasts**: JXA scripting dictionary removed — all 6 tools broken
- **Safari bookmarks**: JXA bookmark classes removed, plist fallback needs Full Disk Access
- **iWork display names**: Apps renamed (e.g., "Pages Creator Studio") — use bundle IDs
