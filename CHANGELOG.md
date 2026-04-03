# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
