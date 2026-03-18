# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
