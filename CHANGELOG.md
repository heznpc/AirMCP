# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Agent rate limit + emergency kill switch** — two-tier token-bucket caps the damage a runaway agent or buggy plan can do without user intervention. Defaults: 60 tool calls/minute (global) and 10 destructive calls/hour, overridable via `AIRMCP_MAX_TOOL_CALLS_PER_MINUTE` / `AIRMCP_MAX_DESTRUCTIVE_PER_HOUR`. Denied calls short-circuit before the handler runs and are logged to audit with `status: error`, so the deny trail stays queryable via `audit_log`. Emergency stop: creating `~/.config/airmcp/emergency-stop` blocks every destructive tool immediately (1-second probe cache, no restart needed) — a one-command panic button for live incidents. Bucket atomicity is preserved: a destructive-bucket denial does not consume a global-bucket token, so retries don't erode unrelated budgets. New `src/shared/rate-limit.ts`, integrated into `tool-registry` pre-handler gate; 7 new unit tests covering capacity, atomicity, kill-switch semantics.
- **`audit_log` / `audit_summary` tools** — consumption path for the on-device audit log. `audit_log` returns paginated JSONL entries filterable by tool name / status / time window (walks current + rotated siblings; tolerates malformed lines). `audit_summary` aggregates call count, error rate, and the busiest tools over a configurable window — useful for weekly reviews and for spotting runaway agents. Args remain PII-scrubbed at write time; both tools are read-only. New `src/audit/` module, 7 new end-to-end tests under `tests/audit-tools.test.js` covering time/tool/status filters, rotated-file walk, and malformed-line tolerance. Module count 27 → 28.
- **RFC 0002 Phase 1 — declarative HTTP `allowNetwork` policy** — network exposure is now expressed as a policy (`loopback-only` / `with-token` / `with-token+origin` / `unauthenticated`) instead of implied by CLI flags. Startup invariant check in `http-transport.ts` refuses to boot a misconfigured server (e.g. `--bind-all` without a token, or `with-token+origin` without an allow-list) so a reverse-proxy footgun can't turn a loopback server public. New `--unsafe-no-auth` flag opts into the `unauthenticated` mode explicitly and flags `.well-known/mcp.json` with `security: insecure`. `AIRMCP_ALLOW_NETWORK` env overrides the inferred policy. `.well-known/mcp.json` now exposes `network_policy` + `allowed_origins` so Managed Agents / discovery clients can reason about exposure before connecting. 12 new unit tests on `resolveAllowNetwork` / `validateNetworkPolicy`.
- **Skill DSL showcase built-ins (5)** — five new built-in skills that exercise the features added in v2.9.0 (`on_error`, `loop`, `parallel`, event triggers): `weekly-digest-note` (parallel fan-out + summarise + compose note), `focus-block-planner` (loop reminders → calendar blocks with per-iteration `on_error: continue`), `clipboard-url-to-reading` (`pasteboard_changed` trigger + defensive URL add), `favorites-digest` (photo metadata loop + terminal note), `sender-to-tasks` (mail search → reminder loop with error tolerance). Each skill is under 30 lines and README-demo-ready. Brings the built-in skill count from 7 to 12 and gives external users a concrete reference for every DSL feature.
- **outputSchema Wave 2** — 14 additional read tools now declare typed `outputSchema` with matching `structuredContent`: `read_note`, `list_folders`, `list_reminder_lists`, `read_reminder`, `list_calendars`, `read_event`, `list_messages`, `list_accounts`, `list_groups`, `list_bookmarks`, `list_reading_list`, `list_directory`, `list_playlists`, `list_tracks`. Brings outputSchema coverage of high-traffic read tools from ~11% to ~30% and makes these tools directly chainable from the skill executor without re-parsing the text block. `tests/output-schema-wave2.test.js` adds strict-parse drift guards for each new schema and `output-schema-structured.test.js` enforces fixture coverage so any future tool that declares `outputSchema` without a matching fixture breaks the build.
- **Dev MCP scripts** — `npm run dev:mcp`, `dev:mcp:watch`, `dev:connect` for wiring the local checkout into Claude Desktop / Claude Code / Cursor without hand-editing config paths. (`scripts/dev-mcp.mjs`, `scripts/dev-connect.mjs`, CONTRIBUTING.md "Wiring up an MCP client" section).
- **release-please workflow (PR-only mode)** — auto-generates `chore(release): v<next>` PRs bumping `package.json` + `CHANGELOG.md` from Conventional Commits, preventing TODO ↔ CHANGELOG drift. Tag creation stays in the existing auto-release + cd.yml chain. (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`).
- **RFC 0001 foundation** — `src/shared/error-categories.ts` with `ERROR_CATEGORIES` enum + `ToolErrorPayload` + `toolErr()` / `errNotFound()` / `errJxa()` / `errDeprecated()` helpers in `result.ts`. Backward compatible with legacy `err()` / `toolError()`. (21 new unit tests.)
- **RFC 0004 foundation** — `src/shared/compatibility.ts` with `resolveModuleCompatibility()` + `summarizeCompatibility()`; `ModuleRegistration.compatibility` field threaded through `MANIFEST`. Annotated `intelligence` (beta + apple-silicon) and `health` (apple-silicon + healthkit). Runtime behaviour unchanged; data is informational only for now. (21 new unit tests.)
- **RFC 0001 Wave 0 — toolError delegation** — the legacy `toolError(action, e)` helper now wraps `toolErr()` and classifies `not_found` / `permission_denied` / `upstream_timeout` / `rate_limited` / `internal_error` from the thrown message. Every existing tool that catches with `toolError()` automatically gains `structuredContent.error`; text wire format is unchanged.
- **RFC 0001 Wave 1 — notes migration** — share-guard blocks in `src/notes/tools.ts` now emit typed `permission_denied` errors via `errPermission()` with a `[permission_denied]` text prefix + `structuredContent.error`.
- **RFC 0004 runtime activation** — `mcp-setup.ts` routes every module through `resolveModuleCompatibility()` instead of checking `minMacosVersion` alone; banner now surfaces `deprecated:` and `broken:` module groups alongside `unavailable:`. `airmcp doctor` gains a `[Compatibility]` section that shows the resolver's decision per module for the current host.
- **`getCompatibilityEnv()` factory** — `src/shared/config.ts` exposes a plain `CompatibilityEnv` snapshot (`osVersion`, `cpu`, `healthkitAvailable`) for the resolver.
- **`print-compat-report` script** — `npm run compat:report` (text or `--json`) renders the manifest × host decisions. `MODULE_MANIFEST` is now exported so doctor / scripts can read compat metadata without loading modules.
- **RFC 0003 Phase 1 — moderate audit advisory** — `scripts/summarize-audit.mjs` summarises moderate+ `npm audit` findings; CI runs it as a non-fatal step right after the hard `npm audit --audit-level=high` gate. `SECURITY.md` gets a new Dependency Advisory SLAs table.
- **outputSchema Wave 1 drift guards** — `tests/output-schema-wave1.test.js` runs `list_notes`, `list_reminders`, `list_events` against mocked runtimes and validates the returned `structuredContent` against each tool's own `outputSchema` via `z.object().strict().safeParse()`.
- **Release checklist & RFC process docs** — `docs/RELEASE_CHECKLIST.md`, `docs/rfc/README.md`, RFCs 0001/0002/0003/0004 (Draft).
- **Quality diagnosis report** — `QUALITY_DIAGNOSIS_2026-04-17.md` with maturity snapshot, risk matrix, KPI proposals.

### Changed
- `TODO.md` re-synced to the v2.7.3 baseline — checked off work completed in v2.7.0–v2.7.3, refreshed coverage numbers (46.9%, gate 46%).
- `BannerInfo` gains optional `modulesDeprecated` / `modulesBroken` fields. Existing fields are unchanged.

## [2.7.3] - 2026-04-16

### Added
- **`--version` / `-v` flag** — prints version and exits
- **Unknown command rejection** — `npx airmcp typo` now exits with error instead of silently starting stdio server
- **`NO_COLOR` support** — respects `NO_COLOR` env var across banner, help, doctor, init ([no-color.org](https://no-color.org/))
- **TTY guard for `init`** — exits with helpful message in non-interactive environments (CI, Docker, pipes)
- **First-time user hint** — banner shows `"First time? Run: npx airmcp init"` when no config exists
- **Config validation warnings** — unknown module names, invalid HITL levels, wrong boolean types now logged

### Fixed
- **Doctor version comparison** — local version ahead of npm no longer falsely shown as "update available"
- **Config parse errors** — actual JSON error now shown (was silently falling back to defaults)
- **Init config write** — caught with try/catch, corrupt JSON warned before overwrite
- **Config double file-read** — eliminated redundant `readFileSync`+`JSON.parse` on startup path

### Changed (Swift app)
- **Node.js not found** — shows error state with install instructions (was: silent failure)
- **Server crash detection** — `terminationHandler` with auto-restart (max 3 within 5 minutes)
- **Graceful shutdown** — polls for server exit up to 5 seconds (was: hardcoded 0.5s)
- **HITL notification denied** — logs warning when permission denied (was: silently ignored)
- **Widget "All day"** — now localized via `NSLocalizedString`

## [2.7.2] - 2026-04-16

### Security
- **Block `javascript:` and `data:` URL schemes in `run_javascript`** — prevents XSS via crafted tab URLs. Extends the existing `file:`/`about:`/`blob:` blocklist added in v2.7.1.
- **`escJxaShell()` control character stripping** — now strips `\x01-\x1f` (except `\t`, `\n`, `\r`) matching `esc()` and `escAS()`. Previously, control characters passed through to shell arguments inside JXA strings.
- **Extract shared `RE_CTRL` regex constant** — the control-character regex was duplicated across `esc()`, `escAS()`, and `escJxaShell()`; now defined once.

### Fixed
- **`resetTriggers()` now resets `listenerInstalled` flag** — previously, calling `eventBus.stop()` followed by a restart would permanently disable skill trigger dispatch because the singleton guard was never cleared.
- **`cross/tools.ts` JSON.parse fallback** — wrapped in try/catch so a malformed snapshot doesn't crash the daily briefing tool; falls back to raw text.

### Testing (880 → 1121 tests, coverage 36.1% → 46.9%)
- **safety-annotations.test.js** — validates all 262 tools have correct `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` annotations
- **executor.ts** — 54% → 99% (conditionals, loops, parallel steps, template resolution, error paths)
- **hitl-guard.ts** — → 100% (elicitation, managed clients, telemetry, env vars)
- **hitl.ts** — → 100% (socket errors, timeouts, buffer overflow, chunked responses, reconnection)
- **swift.ts** — 10% → 95% (NDJSON parsing, prototype pollution defense, single-shot fallback)
- **skills engine** — 0% → 99% (loader, register, triggers, index)
- **tool-registry.ts** — 3% → 80% (SDK integration, search, callTool)
- event-bus, esc, safari-scripts, server-init, http-transport edge cases expanded
- Coverage thresholds raised to statements 46% / branches 40% / functions 42% / lines 46%

## [2.7.1] - 2026-04-11

### Fixed
- **Silent error swallowing in usage tracker** — `loadFromDisk`/`flush`/`flushSync`/timer all surfaced via `console.error` instead of empty `catch`. ENOENT on first run is still silenced; everything else (corrupt JSON, ENOSPC, EACCES) now reaches stderr so disk-full / permission issues no longer hide for weeks.
- **Audit flush timer fire-and-forget** — Added top-level `.catch` logging to cover unforeseen rejections outside the inner retry path (e.g. ESM dynamic import failure during the swap window).

### Changed
- **Hardcoded constants centralized in `shared/constants.ts`**:
  - `API.OLLAMA` (was inline default in `local-llm.ts`) — env override `AIRMCP_OLLAMA_URL`
  - `EXT_APPS.CDN_URL` (was hardcoded `esm.sh` URL in two places in `apps/tools.ts`) — derived `EXT_APPS_ORIGIN` keeps the CSP `resourceDomains` list in sync with the import URL automatically
  - `BUFFER.SWIFT_LINE_MAX` (was magic `1_048_576` literal in `swift.ts`)
  - `PATHS.TEMP_DIR` (was hardcoded `/tmp/` in `screen/scripts.ts` and `shortcuts/scripts.ts`) — uses `os.tmpdir()` by default, env override `AIRMCP_TEMP_DIR`. Sandboxed runtimes can now redirect intermediate captures.
  - `AUDIT.MAX_ARG_LENGTH` / `MAX_ENTRY_SIZE` / `MAX_FILE_SIZE` / `MAX_FLUSH_FAILURES` / `FLUSH_INTERVAL` (was module-local in `audit.ts`)

### Security
- **Test-only helpers refuse to run in production** — `audit._testReset()` and `toolRegistry.reset()` now throw unless `NODE_ENV=test` or `AIRMCP_TEST_MODE=1` is set. Without this guard, any caller importing the production module could wipe in-memory audit entries before flush, or clear every registered MCP tool/prompt at runtime. Verified at runtime in addition to unit tests.

### Documentation
- Restored CHANGELOG entries for v2.7.0 and the four follow-up fixes (#49–#52) that landed on main without being recorded.

## [2.7.0] - 2026-04-09

### Added
- **Claude Managed Agents compatibility** — prefix-match `"claude"` covers all Anthropic clients (Desktop, Code, Cowork, Managed Agents) — no more exact-match maintenance
- **`AIRMCP_MANAGED_CLIENTS` env var** for third-party managed clients in enterprise deployments
- **Server card** — `.well-known/mcp.json` exposes `authorization: { type: "bearer" }` when token is configured, enabling Managed Agents auto-discovery
- **OpenTelemetry instrumentation (optional)** — `@opentelemetry/api` peer dependency, zero overhead when not installed
  - **Tool execution spans**: `tool.{name}` with `mcp.tool.name`, `mcp.tool.arg_count`
  - **HITL approval spans**: `tool.approval` with `mcp.approval.{decision,channel,destructive,managed_client}` — correlates with Enterprise Compliance API for SIEM platforms (Splunk, Cribl)
  - Enable with `AIRMCP_TELEMETRY=true` or `config.json → features.telemetry: true`
- +16 new tests (874 total): managed client prefix match, telemetry no-op path, approval spans, config telemetry flag

### Fixed
- **Skip elicitation for Claude Desktop/Cowork** (`claude-ai` client) — fixes silent timeout causing tool denial in agentic contexts (issue #28)
- **iWork PDF export path guarding** (#52) — mark destructive, validate output path against guard list
- **Audit redaction for location/health tools** (#51) — fully redact args for `get_current_location`, `get_location_permission`, `health_*` instead of relying on key-name patterns
- **`cross/prompts.ts` user input quoting** (#50) — wrap user inputs in `q()` consistently to prevent prompt-injection drift
- **Comprehensive security audit across 35 modules** (#49) — input validation, command injection guards, path traversal protection

## [2.6.4] - 2026-04-03

### Fixed
- **outputSchema/structuredContent consistency** — `okLinkedStructured` now emits `_links` as a separate content block so primary JSON and `structuredContent` both conform to the declared `outputSchema` (#28 follow-up)
- **JXA batch array safety** — Calendar list/search/upcoming/today scripts guard against sparse arrays from batch property access (`Math.min` + null checks)
- **Notes createFolder implicit return** — Rewrote if-else to use explicit variable, eliminating JXA implicit-return ambiguity
- **Mail message ID validation** — Added `regex(/^\d+$/)` to all message ID inputs, preventing `Number(id) = NaN` on non-numeric strings
- **Mail listMessages array guard** — Batch property access now uses `Math.min` safety bound like calendar
- **Finder stat parsing** — `trim().split(/\s+/)` with `isNaN` fallbacks for robustness across macOS versions
- **Error classification** — `toolError` auto-classifies "not found" errors as `[not_found]`; new `errInvalidParams` and `errNotFound` helpers for explicit error typing

### Changed
- **outputSchema test hardening** — Tests now validate `structuredContent` AND primary text JSON against Zod `outputSchema` via `.safeParse()` (52 new assertions); fixed weather fixture missing `weatherDescription` and `units` fields
- Module count synced to 27 across all docs, locales (9 languages), landing page, and legal documents
- TypeScript upgraded to 6.0.2; GitHub Actions dependencies updated (codeql-action 4.35.1, deploy-pages 5)

## [2.6.3] - 2026-04-02

### Added
- **Dev test mode** — `scripts/dev-test.mjs` lightweight in-process developer testing (`npm run dev:test`); MockMcpServer harness calls tool handlers directly without MCP SDK, stdio transport, or child processes — 3x faster and 10x less memory than debug-pipeline
- **Git-aware testing** — `npm run dev:test:changed` detects modified modules via `git diff` and tests only those; `src/shared/` changes trigger full test
- **Watch mode** — `npm run dev:test:watch` rebuilds and re-tests on file changes with ESM cache-busting
- **Single-tool testing** — `npm run dev:test -- --tool list_notes` finds and tests a single tool across all modules with reverse index lookup
- **Memory reporting** — dev-test reports per-module heap delta and total memory usage

### Changed
- Updated CONTRIBUTING.md, docs/testing.md with dev-test workflow documentation
- Module count corrected to 27 in README.md and server.json (was 25)
- Regenerated llms.txt / llms-full.txt

## [2.6.2] - 2026-04-02

### Added
- **Debug pipeline** — `scripts/debug-pipeline.mjs` for module-isolated debugging (`npm run debug -- --module notes`); prevents 262-tool simultaneous load from exhausting memory
- **Debug env vars** — `AIRMCP_DEBUG_MODULES` (whitelist) and `AIRMCP_DEBUG_SEQUENTIAL` (sequential loading) for targeted module debugging
- **Embedding cache memory cap** — 256MB default limit with `AIRMCP_EMBED_CACHE_MAX_MB` override; fast-path size estimation for numeric arrays
- **Audit flush interval config** — `AIRMCP_AUDIT_FLUSH_INTERVAL` env var (default raised from 5s to 30s)
- **ESLint layer boundaries** — `no-restricted-imports` rules enforce Core → Bridge → Services dependency direction in `src/shared/`
- **SDK signature validation** — `tool-registry.ts` validates callback position at runtime; logs warning and falls back gracefully on SDK mismatch
- **57 new tests** — SDK integration tests for tool-registry (12), config parsing (7), audit logging (30), module loading (8); total 773→830

### Fixed
- **Module list sync** — `config.ts` `MODULE_NAMES` was missing `speech` and `health` modules (disable/enable config had no effect on them)
- **Idle battery drain** — audit logger and usage tracker converted from `setInterval` to event-driven `setTimeout`; zero CPU wake-ups when no tools are active
- **Cache eviction efficiency** — `evictIfNeeded()` now re-checks limits after pruning expired entries, avoiding unnecessary key-snapshot allocation

### Changed
- MCP SDK pinned to exact version `1.29.0` (was `^1.29.0`) to prevent silent monkey-patch breakage
- `@modelcontextprotocol/ext-apps` pinned to exact `1.3.1`
- `tool-registry.ts` reclassified from Bridge (Layer 2) to Services (Layer 3) to reflect actual dependencies
- Validation blocks in tool-registry deduplicated via `validateCallback()` helper
- `console.warn` standardized to `console.error` in tool-registry (MCP servers use stderr for logging)
- Audit test helpers consolidated: `_testDrainBuffer` + `_testResetState` → single `_testReset`
- Regenerated `llms-full.txt`

## [2.6.1] - 2026-04-02

### Security
- **Swift bridge single-shot** — replace regex-based prototype pollution check with reviver pattern (matches persistent mode)
- **iWork JXA injection** — add `assertValidAppName()` whitelist to all iWork script generators
- **SSRF prevention** — `open_url` now blocks `file://`, `javascript://`, localhost, and internal network addresses
- **Prompt injection defense** — add `okUntrusted()` to 16 additional tools returning user/external content (GWS Gmail/Drive/Calendar/Tasks, Finder, UI, Maps, Intelligence)
- **Prompt input sanitization** — wrap user inputs in `<user_input>` delimiters in cross-module prompts
- **Skill shadowing prevention** — built-in skill names are now protected; user skills with conflicting names are skipped
- **Drive query injection** — strengthen sanitization by removing all punctuation from search queries
- **HITL socket DoS** — add 1MB buffer size limit on HITL socket data
- **Symlink traversal** — add `resolveAndGuard()` to `move_file` and `trash_file` operations
- **Config validation** — add runtime type checking for `config.json` parsing (reject malformed configs safely)
- **API credential masking** — improve error message redaction for Gemini API key patterns
- **Ollama URL validation** — use proper URL parsing to prevent localhost check bypass

### Fixed
- **Event bus type safety** — add proper type guards for parsed event data
- **Rate limiter memory** — add 10K max bucket limit with LRU eviction to prevent unbounded growth from IP rotation
- **Screenshot cleanup** — delete temp file before throwing on oversized captures (prevents orphaned files)
- **Screen recording timer** — fix potential timer leak when recording promise rejects early
- **Caffeinate tracking** — use `Set<number>` to track all PIDs instead of single variable
- **Cache eviction** — use key snapshot to prevent iterator invalidation during eviction
- **Skills executor DoS** — add `MAX_LOOP_ITERATIONS` (1000) and 1MB tool response size limit
- **YAML skill loading** — add 256KB file size limit
- **Escaping tests** — fix 3 pre-existing `escJxaShell` test expectations to match correct double-escaping behavior

### Changed
- HTTP health endpoint no longer exposes `uptime` field (information leakage prevention)
- HTTP transport adds `X-Request-ID` header for request tracing
- Audit logging added to `run_javascript`, `send_mail`, `reply_mail` operations
- Skills trigger failures now retry once after 2s delay
- Jest coverage thresholds raised: statements 30→35%, branches 20→25%, functions 25→30%, lines 30→35%
- CI: Swift build artifacts cached, checkout optimized to `fetch-depth: 1`
- `esbuild` added as explicit devDependency
- `gws_raw` params/body size-limited (10KB/100KB)

## [2.6.0] - 2026-03-28

### Security
- **`gws_raw` hardening** — service whitelist (11 allowed), destructive method blocking (delete/trash/remove/purge require opt-in)
- JXA injection full audit — all 20 JXA-using modules verified safe (esc/escAS/escJxaShell applied)

### Added
- **Structured Tool Output ×17** — `outputSchema` added to contacts (4), system (6), mail (2), safari (2), music (1), finder (1) tools (total 12→29)
- **73 new tests** — esc.ts (57), automation.ts (5), gws_raw security (6), jxa (1), server-init (2), http-transport (1), modules (1)
- Test coverage 21.6% → 36.1% (exceeds 30% threshold)

### Changed
- `Promise<any>` replaced with typed responses in weather/api.ts and maps/api.ts
- `gws_raw` service description derived from `GWS_ALLOWED_SERVICES` constant (prevents drift)
- Contacts `zContactSummary` Zod schema extracted to shared constant (DRY)

## [2.5.2] - 2026-03-27

### Security
- Path traversal defense — `assertSafePath()` blocks `..` in all Finder script functions
- Embedding cache keys hashed with SHA-256 to prevent PII exposure
- Rate limit bucket cleanup shortened (5min→1min) to mitigate IP rotation
- Audit flush race condition fixed with flushing lock
- `safeInt()` strengthened with `Number.isSafeInteger` (blocks extreme values)
- Health endpoint no longer exposes session count
- Gemini API error messages now redact API key fragments
- `escAS()` now escapes `\u2028`/`\u2029` line separators (parity with `esc()`)

### Fixed
- `envInt()` returns fallback on NaN parse (was returning NaN)
- Inflight promise memory leak — safety timeout cleans up entries that never settle
- `TtlCache.clear()` now also resets inflight promise map
- Session cleanup timer properly `.unref()`'d to prevent process hang

### Changed
- Messages send scripts deduplicated via shared `buildSendScript()` helper
- Embedding cache key construction extracted to `embedCacheKey()` helper
- `compactDescription()` recognizes `!` and `?` as sentence terminators
- Resource cache TTLs tuned for `event_subscribe` invalidation
- Rate bucket prune interval uses `RATE_WINDOW_MS` constant
- Node.js minimum bumped from 18 to 20
- Dependencies: MCP SDK 1.27→1.28, ext-apps 1.2→1.3.1

## [2.5.0] - 2026-03-26

### Added
- **Swift 6.2 upgrade** — all 3 packages (AirMCPKit, AirMCPServer, AirMCPApp) bumped to swift-tools-version 6.2
- **42 unit tests** — XCTest suites for AirMCPKit (Types, ISO8601, EventKit recurrence, errors) and AirMCPServer (JSON-RPC parsing, AnyCodable, MCPServer dispatch)
- **CI Swift pipeline** — `swift build` + `swift test` for both swift/ and ios/ packages in GitHub Actions
- **Shared authorization helper** — extracted `authorize(store:flag:request:errorMessage:)` in EventKitService, eliminating copy-paste between event/reminder auth

### Changed
- **Concurrency safety** — `nonisolated(unsafe) var` authorization flags replaced with `OSAllocatedUnfairLock` for proper thread-safe access
- **ISO 8601 formatters** — migrated from `nonisolated(unsafe)` `ISO8601DateFormatter` globals to cached `Date.ISO8601FormatStyle` (Sendable value type, no per-call allocation)
- **ServicesProvider** — `@unchecked Sendable` replaced with `@MainActor` isolation
- **FoundationModels guard** — `#if canImport(FoundationModels) && compiler(>=6.3)` prevents build failures on toolchains lacking the FoundationModelsMacros plugin
- **iOS minimum version** — unified from iOS 16 to iOS 17, removing legacy `#available` branches for EventKit authorization
- **`persistentMode`** — changed from `nonisolated(unsafe) var` to `let` (computed once from CLI args)
- Safety rationale comments added to all `@unchecked Sendable` types (LocationFetcher, BluetoothManager, AnyCodable, ToolBox)

### Fixed
- SpeechService `sending` error (Swift 6.2 stricter data race checking)
- `health-heart-rate` nil output — replaced `[String: Any?]` Encodable error with proper `HeartRateOutput` struct
- HealthService `var readTypes` → `let` (unused mutation warning)

## [2.3.1] - 2026-03-21

### Fixed
- Deduplicated `runAppleScript`/`runJxaInner` — extracted shared `handleOsascriptError` and `parseOsascriptOutput` helpers
- JXA semaphore now lazy-initialized (created on first use after config parse, not at import time)
- CONCURRENCY lazy getters use `??=` (read env once, not on every access)
- Stale `applescript:` prefix comment removed from messages/scripts
- Simplified unnecessary cast in `evaluateCondition`

### Changed
- Stats synced across all docs, locales (9 languages), landing page, server.json, llms.txt: 253 tools, 32 prompts, 25 modules
- Privacy policy version updated to v2.3.0, bug report placeholder to 2.3.0
- Hero h1 restyled: Air (light) + MCP (bold)
- Removed TODO.md from tracking and git history (contained internal roadmap and security notes)
- Added `coverage/` and `qa-sequential-report-*.md` to .gitignore

## [2.3.0] - 2026-03-19

### Added
- Sequential QA test runner (`npm run qa:seq`) — tests each module in isolation, one at a time, to avoid overloading the machine
- Expanded QA coverage: 207/247 tools (84%) across sequential + CRUD tests
- QA coverage TODO tracking for remaining 40 tools with documented exclusion reasons

### Changed
- Upgraded `zod` from `~3.24.0` to `~3.25.76` — fixes server startup crash caused by `@modelcontextprotocol/sdk@1.27.1` and `ext-apps@1.2.2` requiring `zod ^3.25 || ^4.0`
- JXA→Swift dual-path architecture (`runAutomation`) for reminders, photos, contacts, calendar — Swift preferred when available, JXA fallback preserved
- `index.ts` split into `server/init.ts`, `server/mcp-setup.ts`, `server/http-transport.ts`
- Build system switched to esbuild (resolves tsc OOM crash)
- Module registration via dynamic `MANIFEST` in `shared/modules.ts` (no more manual imports)
- CONTRIBUTING.md updated with sequential test instructions and current module addition guide

### Fixed
- Race conditions, hangs, and double-resume crashes in server lifecycle
- TypeScript typecheck OOM resolved with lightweight `McpServer` interface
- Prompt injection defenses hardened
- Security fixes for input validation and escaping

## [2.2.0] - 2026-03-15

### Added
- `generate_image` — on-device image generation via Apple ImageCreator API (macOS 26+)
- `scan_document` — OCR text extraction via Apple Vision framework
- `generate_plan` — on-device AI planner using Foundation Models tool calling
- `spotlight_sync` / `spotlight_clear` — push/clear data in macOS Spotlight for Siri discovery
- `semantic_clear` — delete all vector store data (GDPR/privacy), also clears Spotlight
- `query_photos` — PhotoKit queries with date/type/favorites filters
- `classify_image` — Vision-based image classification with confidence labels
- `ai_plan` renamed to `generate_plan` (verb_noun convention)
- App Intents for companion app (SearchNotes, DailyBriefing, CheckCalendar, CreateReminder)
- MCP Sampling 3-tier fallback: Sampling → Foundation Models → raw snapshot
- `llms.txt` / `llms-full.txt` for AI discovery
- OpenSSF Scorecard, CodeQL, dependabot, stale bot workflows
- `count-stats.mjs` — auto-count tools/prompts/resources from source (CI-verified)
- `check-i18n.mjs` — verify locale key sync (CI-verified)
- commitlint + husky for conventional commit enforcement
- GitHub Discussions, 6 good-first-issue tickets, GOVERNANCE.md, CODEOWNERS
- README badges (CI, npm, license, downloads, node)

### Changed
- Centralized all hardcoded constants into `constants.ts`
- All subprocess runners (JXA, Swift, GWS) now use shared `Semaphore` class
- Module imports parallelized via `Promise.all` (faster startup)
- Module registration isolated with try-catch (one broken module doesn't crash server)
- HTTP session cleanup now closes McpServer instances (fixes memory leak)
- Privacy policy rewritten with full data flow disclosure (FM, Spotlight, Siri, Gemini)
- Podcasts module rewritten from JXA (never worked) to SQLite + URL scheme
- CI workflows pinned to SHA (OpenSSF Scorecard compliance)
- CI permissions locked to `contents: read` minimum

### Fixed
- `AIRMCP_FULL=true` now properly overrides config file's `disabledModules`
- JXA error codes mapped to human-readable messages (-1743, -1728, -600, etc.)
- `zFilePath` resolves `~/` to `$HOME` (JXA/AppleScript don't expand tilde)
- Path traversal regex tightened (no longer rejects `file..name.txt`)
- Swift bridge `pngData()` nil guard (prevents false success)
- Swift semaphore double-release prevented via `released` flag
- Weather API fetch now has timeout (`AbortSignal.timeout`)
- GWS CLI errors now include timeout/failure-specific messages
- Messages Tahoe compatibility (service type fallback for macOS 26)

### Breaking Changes
- **`allowSendMail` / `allowSendMessages` default changed `true` → `false`**. Users must explicitly enable sending via config or env var.
- **`update_reminder` parameter `name` renamed to `title`** to match `create_reminder`.
- **`add_bookmark` deprecated** — Safari removed bookmark scripting in macOS 26. Returns error with guidance to use `add_to_reading_list`.
- **`gws_raw` now has `destructiveHint: true`** and blocks Gmail send/delete/trash when `allowSendMail` is false.
- **`run_shortcut` and dynamic shortcut tools now have `destructiveHint: true`** (Shortcuts can execute shell commands).
- **Init wizard now sets `allowSendMail: false`** (was `true`).

### Security
- `execSync` → `execFileSync` everywhere (prevents shell injection)
- Gemini API key moved from URL query to `x-goog-api-key` header
- Path validation (`zFilePath`) applied to all 15+ file path parameters
- `gws_gmail_send` gated by `allowSendMail`
- Startup fails fast if `HOME` env var is not set

## [2.1.0] - 2026-03-15

### Added
- `--help` command with usage guide
- Polished CLI UX with spinner animations and shared styles
- `npx airmcp doctor` diagnostic overhaul

## [2.0.0] - 2026-03-14

### Added
- 244 MCP tools across 25 modules
- Full Apple ecosystem integration
- Semantic search with Gemini embeddings + on-device Swift embeddings
- Human-in-the-loop (HITL) approval system with SwiftUI companion app
- Interactive setup wizard (`npx airmcp init`)
- Skill engine with YAML-based workflows
- Cross-module prompts (30 prompts)
- MCP resources (11 resources)
- HTTP/SSE transport mode
- Internationalization (9 languages)
