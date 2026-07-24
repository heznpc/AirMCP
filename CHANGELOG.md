# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### macOS app
- **Consent-first setup, exact scope activation, and client connection** — opening Setup or Trust Center is observational: it does not create the app-runtime token, start the runtime, or register AirMCP with Codex. First-run Finish with no runtime is save-only; when an app-owned runtime already exists and the selection changed, Finish may serialize stop → verified config write → restart so the persisted selection, authenticated runtime fingerprint, and client receipt are the same generation. Runtime start and each client configuration remain explicit actions; a new automatic-start opt-in is committed only after an authenticated ready receipt, while token, manual-runtime, activation, and scope-change failures restore the previous preference. Client writes revalidate the runtime receipt immediately before mutation. Codex changes are transactional, preserve advanced settings, fail closed when an existing entry cannot be inspected, restore the original bytes and mode on failure, and keep token-bearing files owner-only. Incomplete Setup resumes its draft, completed Setup reopens with the current module selection, save failure keeps the window open, and the complete Setup and Trust Center surfaces ship in nine locales (the rest of the app retains its existing English/Korean coverage and English fallback).
- **Single-instance, runtime ownership, and stale-port diagnostics** — LaunchServices plus a deterministic in-process fallback prevent duplicate app copies from racing to own port 3847. One lifecycle generation serializes probe, start, stop, and delayed crash restart; lifecycle authority requires the authenticated runtime PID plus an app-only generation fingerprint, so a manual same-token runtime is never adopted or killed; authenticated readiness requires the pinned AirMCP version and effective scope; and HTTP, TLS, timeout, or otherwise unrecognized listeners produce a visible port-owner diagnostic instead of an EADDRINUSE restart loop.
- **Governed Trust Center evidence** — activity, safeguards, permissions, emergency stop, live HITL decisions, HMAC verdicts, and owner-only redacted exports share one localized view. Audit history is never read automatically or in the background: only an explicit Load or Refresh opens a 150-second task-scoped allowlist—covering the app's 120-second maximum approval window with bounded dispatch headroom—and delegates hidden `audit_log` through `run_tool`, preserving progressive exposure, rate limits, per-call HITL, emergency stop, and HMAC audit without widening `tools/list`. The session is explicitly ended after the read, and its bounded TTL contains a lost cleanup response. Live pending approvals remain visible regardless of history search and status filters.
- **Codex CLI config-root parity** — The `npx airmcp codex` status, enable, disable, replacement, and rollback paths now resolve the same user config as their child Codex CLI: `AIRMCP_CODEX_CONFIG_PATH`, then `CODEX_HOME/config.toml`, then `~/.codex/config.toml`. Relative inputs are fixed against the invoking working directory, the resolved override must be named `config.toml`, project-local overrides remain read-only, and unrelated user entries remain byte-preserved. The macOS Setup connector retains its separate consent-first `~/.codex/config.toml` contract.

### Security and protocol
- **Audit chain fail-closed hardening** — audit append/rotation/checkpoint work is serialized in-process and protected by a recoverable cross-process writer lock. Listed-but-unreadable history, partial or ambiguous appends, stale reaper locks, checkpoint gaps, rotation collisions, fsync failures, and a bounded-spool overflow revoke audit authority for the process; graceful signal and stdio shutdown paths drain accepted outcome rows before exit. Checkpoint replacement is atomic and directory-synced, the first signed upgrade write moves unsigned legacy rows behind an owner-only untrusted quarantine boundary, and trusted summaries never include that prefix. Verification authenticates the exact emitted JSON body bytes and per-call random `approvalId`. The trust contract states the remaining boundary explicitly: after restart, a complete older log/checkpoint pair or deletion of both cannot be distinguished from an intentional restore/fresh state without an external monotonic anchor.
- **Browser OAuth and local-origin contract completed** — allowed browser origins receive canonical CORS responses and unauthenticated preflight across MCP discovery and transport without bypassing bearer authentication. Loopback binding no longer treats arbitrary browser origins as trusted: browser callers must be explicitly allow-listed while native no-Origin clients remain compatible by default. JWT verification discovers and validates issuer metadata/JWKS over HTTPS, requires finite `exp` and non-empty `sub`, keeps explicit JWKS overrides, canonicalizes Chrome extension origins, and publishes only operator-declared RFC 8414 token-endpoint authentication methods.
- **Governance invariants closed** — every OAuth `resources/*` request now requires cumulative `mcp:read`; registered live resources traverse rate limiting and HMAC outcome audit, and built-in Apple-data resources require per-call HITL with the exact durable `approvalId` before content is fetched. Emergency stop remains enforced when normal rate limiting is disabled, and autonomous skill triggers dispatch through the originating server's tool registry so audit/HITL policy cannot drift to another server instance.

### Verification
- **Governed workflow and artifact identity are release gates** — app release preflight completes the real governed approval/audit workflow before archive checks, alongside bundle, localization, runtime, and protocol validation. The npm lane is restricted to an exact `main` SHA; an occupied root or add-on version is resumed only when the clean local tarball SRI and registry `gitHead` match that SHA, and post-publish verification binds npm, the Git tag, and GitHub Release target to it. The signed lane is explicit-dispatch only, checks out the immutable Release tag, requires main ancestry plus tag/package/app/widget agreement and a complete Widget extension, and fails before secret use unless GitHub's API reports a required reviewer, disabled admin bypass, and a matching tag-only deployment policy. That external `release` environment configuration and Apple secret enrollment remain a deliberate HOLD rather than a claim of completed signing. The final signed-artifact probe uses an isolated token and app-only owner fingerprint to verify the exact runtime PID without broad process killing, and public logs suppress certificate/account/notary identifiers. Scoped add-on verification also activates the opt-in spatial, webhook, and Power Automate packages and proves representative tools register from their clean-installed `external-only` artifacts.

### Cross-OS bridge (opt-in)
- **Inbound webhooks + Power Automate** — two new opt-in modules (`webhooks`, `powerautomate`) ported from the standalone `newtria` bridge (same author) and relicensed MIT. `webhooks` adds a `webhook_received` event source: `webhook_listen_start` opens a loopback HTTP listener (HMAC-SHA256 over `x-airmcp-signature`, 1 MiB body cap → 413, non-loopback bind requires a ≥32-char secret) that turns each verified `POST` into a `webhook_received` event any skill can bind to — AirMCP's first *inbound* event source alongside its nine local observers. `powerautomate` adds `cloudflow_trigger` (POST to a Cloud Flow HTTP trigger URL via SAS or OAuth Bearer, hard 120 s timeout, streamed response-size cap). Both stay off in every profile — including `full` — until `AIRMCP_ENABLE_WEBHOOKS=true` / `AIRMCP_ENABLE_POWERAUTOMATE=true`, and both are governed by the existing HITL / audit / rate-limit / network-policy layers. `count-stats` now counts the full `MODULE_MANIFEST` (matching the `tool-count-drift` guard) so the opt-in modules are reflected in the module count without being added to the standard profile surface.

### Distribution
- **Apple ecosystem positioning** — README, landing metadata, documentation, package/plugin manifests, registry pitches, and all localized landing copy now describe AirMCP as a governed MCP runtime for the Apple ecosystem instead of a product permanently named “for macOS.” Public surfaces distinguish macOS as available, iOS/iPadOS as preview, and visionOS/watchOS as roadmap targets with platform-specific roles.
- **Universal npm + MCPB artifacts restored** — the root npm tarball and `.mcpb` now retain every standard JavaScript module entrypoint instead of stripping non-core packs during packaging. Logical profiles and progressive exposure still keep the default context small, while shipped-artifact gates now clean-install and boot both the default surface and `full/full` across representative module packs.
- **Scoped add-ons retained as compatibility artifacts** — optional physical packages keep their existing `@heznpc/airmcp-<pack>` names. The default import mode is now `bundled`, preventing stale installed add-ons from overriding a newer universal root; operators can explicitly choose `prefer-installed` or `external-only` for compatibility deployments.

## [2.15.0] - 2026-07-01

### Distribution
- **Add-on package staging + lazy harness split** — `npm run addons:build` stages tarball-ready physical add-on packages for every non-core module pack, and `npm run addons:check` is wired into CI/release preflight. Runtime module loading prefers installed add-on packages (`AIRMCP_ADDON_PACKAGE_MODE=prefer-installed`) before bundled fallback, with `external-only` available as a strict package-boundary probe. Tool discovery returns compact descriptions by default and exposes `describe_tool` for full per-tool detail on demand. Task-session policy moved behind harness adapters (`compatible`, `strict`, `app-runtime`, `agent`) so client-specific behavior is no longer hard-coded inside server setup.
- **Module runtime hardening** — `npx airmcp modules` lists, enables, disables, and doctors DLC-like module add-ons using the same `modulePacks` config consumed by the runtime. `npm run tokens:check` adds a CI budget for tool-description token drift, `profiles:check` includes restricted-pack wire cases plus discovery golden queries, and generated app/CLI configs set `requireToolSession: true`.
- **DLC-like module pack contract** — `src/shared/module-packs.ts` defines runtime packs and their future scoped add-on package names. `AIRMCP_MODULE_PACKS` and `config.json -> modulePacks` restrict the available pack set while always keeping `core`; `list_module_packs` and `profile_status` expose the resulting availability contract.
- **Strict task-session harness mode** — `AIRMCP_REQUIRE_TOOL_SESSION=true` makes `run_tool` refuse hidden-tool dispatch unless the caller passes a valid `sessionId`. Directly exposed tools keep the compatible no-session path, `profile_status` reports the effective setting, and `profiles:check` now boots a real MCP case that discovers hidden `create_note`, verifies the no-session rejection, then proves a scoped session reaches the target tool's own validation.
- **Task-scoped tool sessions** — new front-door MCP tools (`start_tool_session`, `tool_session_status`, `end_tool_session`) let clients create short-lived allowlists. `discover_tools({ sessionId })` searches only that allowlist, and `run_tool({ sessionId })` refuses out-of-session calls while preserving the existing no-session behavior for compatible clients. `profiles:check` now exercises the allow/deny path over the real MCP wire and prints init/tools-list timings.
- **Release automation hardening** — `release:verify` checks the public npm version, npm `latest`, fresh `npx`, and GitHub Release `.mcpb` asset after publish. `cd.yml` now logs the npm auth mode before publish and runs the verifier after creating the release. `release-app.yml` skips cleanly on tag push when Apple Developer ID secrets are absent, while manual dispatch can set `require_signing=true` to fail hard.
- **Modular install RFC** — `docs/rfc/0015-modular-install-and-task-harness.md` records the boundary between the implemented task harness and a future module-pack split so AirMCP does not grow package complexity before size/startup evidence justifies it.

## [2.14.0] - 2026-06-30

### Distribution
- **Profile-first runtime default** — AirMCP now boots the `starter` profile with `progressive` tool exposure by default instead of advertising the entire catalog in `tools/list`. New first-class profiles are `starter`, `communications-safe`, `productivity`, and `full`; `discover_tools` + `run_tool` remain the front door for hidden-but-registered tools. `npx airmcp init --profile <name> --yes`, MCPB user config, the menubar app config model, smoke/package checks, and README/site/registry metadata are aligned to this contract.
- **Progressive dispatch hardening** — `run_tool` now validates arguments against each target tool's captured `inputSchema`, and the singleton tool registry prunes registrations from older server generations after the active profile finishes booting. This keeps hidden progressive tools callable without widening validation or leaking a previous wider HTTP session's tool registry into a narrower profile.
- **Profile exposure release gate** — new `npm run profiles:check` boots four real MCP wire cases (`starter` progressive, `communications-safe` progressive, `productivity` profile, `full` full) and asserts exposed vs registered tool counts. CI now runs this matrix, and `release:preflight` includes it before package/MCPB verification.
- **Version and discovery drift cleanup** — `scripts/sync-version.mjs` now checks `docs/index.html` structured-data `softwareVersion`; `.well-known/mcp.json` advertises the active exposed tool surface instead of hidden full inventory; registry submission notes no longer claim notarized app distribution before Developer ID notarization ships.
- **Plugin submission readiness** — `claude plugin validate .` passes (the one warning is the gitignored local `CLAUDE.md`, which is absent from the published repo, so it does not appear in the marketplace review). `.claude-plugin/plugin.json` gains `displayName: "AirMCP"` and `author.url`; the published `airmcp@<version>` npm package boots clean (verified end-to-end via the MCP Inspector). Remaining step before listing is the operator-side submission at `clau.de/plugin-directory-submission`.
- **README hero** — lead line is now "Open action runtime for Apple-native agents" (was "Apple-native agent runtime for any MCP client"), and the client list adds Xcode 27 agents (Xcode has spoken MCP since 26.3) to reflect the post-WWDC two-layer reality (see `docs/rfc/0011-post-wwdc-2026.md`).
- **Claude Code plugin package** at repo root (`.claude-plugin/plugin.json` + `.mcp.json`) ready for submission to `anthropics/claude-plugins-community`. The npm version that `.mcp.json` invokes is pinned to the same value as the plugin manifest, so the marketplace SHA approval and the runtime users actually run can never diverge.
- **`npm run mcp:validate`** + new CI step `MCP Inspector validate` (timeout-minutes 2). Wraps a pinned `@modelcontextprotocol/inspector --cli` against `dist/index.js`, captures both stdout and stderr, and exits non-zero on non-zero child exit, embedded `"error"` / `"isError":true` envelopes, zero-tool responses, or unparseable JSON. Wire-shape gate, not a substitute for the HMAC / HITL / audit test suites.
- **`scripts/sync-version.mjs` extended** to cover `mcp.json`, `.claude-plugin/plugin.json`, and `.mcp.json`'s `airmcp@<version>` pin. Closes the gap where `npm run version:patch` silently left those three files at the old version.
- **`scripts/count-stats.mjs` extended** to cover `.claude-plugin/plugin.json` description for the `(N) tools across (M) modules` drift check.
- **`src/shared/banner.ts` skips the ANSI logo + typewriter delays when `process.stderr.isTTY` is false** (plugin host pipe, log collector, non-interactive CI). Pipe consumers now see a single plain identity line instead of raw ANSI control bytes and seconds of artificial startup latency.

### Security / Privacy — closes 12 findings from the 2026-05-13 code audit

Each entry below corresponds to a finding in the audit report. Severity classes:
- **BLOCKER** — feature shipped that didn't actually work end-to-end
- **HIGH** — data loss, scope bypass, or exfiltration risk
- **MEDIUM** — defense-in-depth and drift cleanup

#### Skills event triggers were silently broken (BLOCKER)

- **`__event__` stdout lines now reach the event bus** (`src/shared/swift.ts`) — the persistent Swift bridge writes RPC responses AND native observer events on the same stdout stream, with events tagged `id: "__event__"`. The read loop did `pending.get(msg.id)` then `if (!entry) continue;` — every event was silently dropped. Six of nine documented triggers (`calendar_changed`, `reminders_changed`, `pasteboard_changed`, `focus_mode_changed`, `file_modified`, `screen_locked/unlocked`) and four built-in skills (`calendar-alert`, `evening-winddown`, `focus-guardian`, `clipboard-url-to-reading`) were demo-only despite being shipped. Now routes the raw `__event__` line (not the BridgeResponse projection, which strips `event`/`data`/`timestamp`) to `eventBus.processLine` so triggers fire. New test: `tests/swift-event-routing.test.js` drives a synthetic `child_process.spawn`, pushes a `calendar_changed` line, and asserts the bus actually receives the typed event within 2s — pre-fix this hung forever.

#### Memory + vector store integrity (HIGH)

- **`MemoryStore` consolidated to a process-wide singleton** (new `src/memory/instance.ts`) — `src/memory/tools.ts` and `src/shared/resources.ts` each held `new MemoryStore()`. Each instance owned an independent in-memory cache layered over the same on-disk JSON file, so `memory_put` against the tools instance never appeared in `memory://recent` (resources instance) within the same process lifetime. Both call sites now route through `getMemoryStore()`. The store handles its own load dedupe + atomic write + TTL sweep — none of that requires multiple instances. New test: `tests/memory-singleton.test.js` asserts identity stability + put-then-query observability through the same instance.
- **`VectorStore.save` is now atomic** (`src/semantic/store.ts`) — in-place `writeFile` would leave a half-written JSON on SIGKILL / power loss / OOM-kill. `load()` silently fell back to `{ version: 1, entries: {} }`, wiping the embedding index with no warning. Switched to temp+rename (single inode swap on APFS/ext4) with `mode: 0o600` and best-effort temp cleanup on failure. New test: `tests/semantic-store-atomic.test.js` injects `writeFile` failure and asserts the on-disk file remains intact (3 entries) plus no `.tmp` debris.

#### Autonomous-actor visibility + symlink hardening (HIGH)

- **`actor` field stamped on every audit line emitted from a daemon skill** (`src/shared/request-context.ts`, `src/skills/triggers.ts`, `src/shared/tool-registry.ts`) — autonomous skill executions opened no AsyncLocalStorage context, so tool-registry's audit hook stamped `actor: undefined`. Every autonomous tool call was indistinguishable from a human-initiated one during audit review. The trigger path now wraps `executeSkill` in `runWithRequestContext({ actor: "daemon-skill:<name>", correlationId })`, and the 4 audit emit sites in `tool-registry.ts` propagate the value via `getActor()`. Retried executions inherit the same correlationId via AsyncLocalStorage propagation through `setTimeout`. New test: `tests/skills-triggers-actor.test.js` mocks `executeSkill` to capture the ctx at exactly the moment the registry would read it and asserts both `actor` and `correlationId` are set.
- **Symlink traversal guards on 4 file-touching tools** (`src/messages/tools.ts`, `src/intelligence/tools.ts`, `src/shortcuts/tools.ts`) — `zFilePath` only rejected literal `..` segments. A symlink inside HOME pointing at `/etc/secrets` slipped past. `send_file` could exfiltrate arbitrary files via iMessage attachment; `generate_image` could overwrite system caches with a tilde-rooted but symlink-redirected outputPath; `export_shortcut` / `import_shortcut` had the same exposure. Each now calls `resolveAndGuard()` to require the realpath resolution stays inside HOME. `generate_image` keeps the guard conditional on `outputPath` being provided (default goes to Swift's `/tmp`). New test: `tests/symlink-guard-traversal.test.js` creates a real symlink in HOME pointing at `/etc` and asserts the mocked bridges are never invoked for any of the 4 tools.

#### Audit chain integrity end-to-end (MEDIUM × 2)

- **Cross-rotation chain resume** (`src/shared/audit.ts`) — `resumeChainHead` previously read only `audit.jsonl`. A process exit inside the "rotation just happened, no new flush yet" window would land with `audit.jsonl` missing → `lastHmac` stayed at `HMAC_GENESIS` → the next flush sealed entries with `_prev = HMAC_GENESIS`, and `verifyAuditChain` reported `verified: false` at the seam. One false-positive corrodes the strongest trust signal in the codebase. Resume now falls back to the most recent rotated file (lex-sorted descending by 13-digit `Date.now()` filename, chronological for the next 200+ years). New test: `tests/audit-rotation-resume.test.js` covers happy path / `audit.jsonl` missing / both missing (cold start → genesis).
- **First chained line now verified against `HMAC_GENESIS`** — `verifyAuditChain` accepted the first chained line's `_prev` regardless of value because `chainStarted` was false on entry. An attacker with the HMAC key could replace the entire file with a chain that internally verifies, rooted at any arbitrary `_prev`, and the verifier reported `verified: true`. The genesis check now folds into the existing `prev_mismatch` path: `expectedPrev = chainStarted ? prev : HMAC_GENESIS`. New test: `tests/audit-genesis-check.test.js` covers genuine genesis chain + attacker-rooted chain at `'f'*64` + attacker-rooted at arbitrary hex.
- **HMAC chain tamper detection test suite** (new `tests/audit-tamper-detection.test.js`) — the codebase shipped `summarizeAuditEntries().verified` as one of the strongest trust signals but nothing asserted it actually fired under tampering. 5 mutation shapes covered: clean chain (verified) / body mutation (`hmac_mismatch`) / `_prev` mutation with recomputed `_hmac` (`prev_mismatch`, isolated from body-tamper) / malformed `_hmac` value (`malformed`) / attacker-appended unauthorized entry (`verified: false`).

#### Embedding privacy contract (MEDIUM)

- **`AIRMCP_LOCAL_ONLY=true` hard switch for embeddings** (`src/semantic/embeddings.ts`, `docs/environment.md`) — `detectProvider()` will not return `gemini` or `hybrid` while local-only is set; an explicit `AIRMCP_EMBEDDING_PROVIDER=gemini`/`hybrid` is overridden with a stderr warning. The `hybrid` Swift→Gemini fallback refuses to run and re-throws the original Swift error so note titles + previews never silently cross the network. Without local-only, every fallback now writes an `__embedding_fallback` audit line (`{ from: "swift", to: "gemini", reason }`) so the cloud crossing is visible through `audit_summary`. `getEmbeddingConfig()` reports `localOnly: boolean` so `doctor` surfaces the effective privacy posture. New test: `tests/embeddings-local-only.test.js` covers 6 detect cases + 2 fallback cases (with/without LOCAL_ONLY) + 2 config-surface cases.

#### Maps coordinate validation (MEDIUM)

- **`drop_pin` / `share_location` / `search_nearby` lat/lng now bounded** (`src/maps/tools.ts`) — bare `z.number()` accepted `±Infinity`, JXA received the literal `Infinity` keyword, parsed cleanly but produced garbage map state. Now bounded `[-90, 90]` / `[-180, 180]` to match the lone-already-correct `reverse_geocode`. New test: `tests/maps-coordinate-bounds.test.js` covers in/out-of-range + Infinity rejection + a regression pin on `reverse_geocode`.

### Developer experience + drift

- **Test infrastructure: ignore stale `.claude/` worktrees** (`jest.config.js`) — `testPathIgnorePatterns` + `modulePathIgnorePatterns` skip `/\\.claude/`. Pre-fix, jest-haste-map threw on duplicate module names and discovery ran pre-rebase versions of every suite when multiple worktrees existed.
- **JXA / AppleScript AST validator** (new `tests/jxa-scripts-ast.test.js`) — every `*/scripts.ts` builder output is parsed through Node's `vm.Script`. JXA scripts wrap in `(function(){...})` to mirror the implicit `run()` handler that osascript provides (top-level `return` is legal there but rejected by Script-mode parse). AppleScript fixtures fall back to a pattern match (`tell application` / `^--` / `^on ` / `^script `). Catches structural breakage (unbalanced braces, missing semicolons after template literals, broken interpolation, stray backticks) BEFORE the script ever reaches osascript — addresses the broader "mock toContain tautology" class of test misses flagged in the audit.
- **README / mcpb manifest / shortcuts.md drift fixed** — `229 Shortcuts / Siri AppIntents` → 232 (auto-counted from `MCPIntents.swift`), `34 prompts` → 32 (auto-counted from `server.prompt(` registrations), `270+ tools across 29 modules` long-description aligned to canonical counts. `scripts/count-stats.mjs --check` now enforces both patterns so future drift can't reach a release build. Affected files: `README.md`, `mcpb/manifest.template.json`, `docs/REGISTRY_SUBMISSIONS.md`, `docs/shortcuts.md`.
- **`AIRMCP_VECTOR_STORE_DIR` env opt-in** (`src/shared/constants.ts`) — primarily for tests that need a tmpdir-rooted audit + vector store. Without it the suite would write to the developer's real `~/.airmcp/`.

## [2.12.0] - 2026-05-09

Headline shifts: every tool error now carries a typed category and a `Trace: <id>` line so a single failed call threads end-to-end through audit log + telemetry; **RFC 0008 (Elicitation) Phase 1** lands the capability gate + env opt-out; **RFC 0009 (iWork depth) Phase 1** ships the first three Numbers tools (tool surface 269 → 272); `npx airmcp doctor --deep` walks live audit-chain integrity + Swift bridge ping + module boot smoke for user-reported troubleshooting; the OAuth `/.well-known/oauth-protected-resource` document picks up SEP-985 alignment with DPoP advertisement + RFC 9728 optional fields. **RFC 0001 typed-error adoption reached 29/32 modules** with three intentional skips justified inline. Issue [#145](https://github.com/heznpc/AirMCP/issues/145) (`list_calendars` empty after a fresh permission grant on macOS 15.7.5) closed via a one-line `EKEventStore.reset()` in the shared authorize helper. Two future-direction drafts (RFC 0010 progressive disclosure / RFC 0011 post-WWDC) staked out.

> **Reading guide**: entries are grouped by RFC track and audience.
> - **For users** — features visible in the AI's tool surface, error messages, or `npx airmcp doctor` output.
> - **For developers** — internal helpers, test infra, RFC 0001 helpers, error envelope shape.
> - **For operators** — env var changes, audit / OAuth / rate-limit / network policy adjustments. See [docs/environment.md](docs/environment.md) for the full env knob index.

### RFC 0001 typed errors — adoption complete (29/32 modules)

The `toolError(action, e)` fallback classifier in `result.ts` got companion `errJxaFor` / `errSwiftFor` / `errUpstreamFor` catch helpers (PR #173) that auto-attach `cause.origin` and the `"Failed to <action>: <message>"` prefix. Across PRs #166, #168, #169, #170, #171, #172, #173, #185, #186, #187, #188 every module that wraps `runJxa` / `runSwift` / `runAutomation` / HTTP fetches migrated their catch blocks from the fallback to the typed helpers. Adoption is now **29/32 `tools.ts` files**.

The remaining three modules intentionally keep `toolError` because the fallback's `internal_error` classification is the right answer for them:

- **`audit/tools.ts`** — fs reads of the on-disk JSONL audit log. ENOENT / EACCES are already handled inside the audit reader, and zod surfaces `invalid_input` automatically for the `since` ISO-8601 parameter. No category gain from migrating.
- **`memory/tools.ts`** — fs + JSON parse of `~/.cache/airmcp/memory.json`. Same shape as `audit`: storage failures are `internal_error`, input validation already runs through zod + `errInvalidInput`. PR #154 already hardened the write path (atomic temp+rename + serialized op queue + JSON-reviver prototype-pollution guard); the catch-block category isn't where the action is.
- **`podcasts/tools.ts`** — module is fully broken on macOS 26+ (Apple removed the Podcasts JXA scripting dictionary, see RFC 0004 / `compatibility.brokenOn: [26]` block). Migrating the dead-on-arrival catches isn't worth the noise; the deprecation is already advertised through `airmcp doctor` and `print-compat-report`.

`toolError` itself stays exported for these three modules and as the safety net for any future tool that hasn't yet picked up a typed origin.

### Added — for users

- **RFC 0008 Phase 1 — Elicitation capability gate + env opt-out** (PR #196) — on review the elicitation path was already wired in `installHitlGuard` (`tryElicitApproval` calls `inner.elicitInput` when the inner Server exposes it). RFC 0008 §3.2 + §3.3 named two gaps that hadn't landed yet: (1) `AIRMCP_ELICITATION_DISABLE=true` env opt-out for end-to-end scripted destructive pipelines that don't want any user prompt — falls through to the socket HITL channel exactly like a client that doesn't advertise elicitation; (2) explicit `getClientCapabilities()` check before issuing the elicit request, avoiding a doomed call when the client declared no elicitation support. The existing try/catch stays as belt-and-suspenders for clients that lie about their capabilities. RFC 0008 status: Draft → **Phase 1 Implemented**.
- **RFC 0009 Phase 1 first batch — 3 Numbers depth tools** (PR #197) — `numbers_list_tables` returns `{ name, rowCount, columnCount }` per table; multi-table sheets are common (totals + breakdown + chart-source) but existing tools always read `tables[0]`, so this lets a caller pick by name. `numbers_get_formula` returns the literal expression behind a cell (`=SUM(A1:A10)`) instead of the evaluated value; returns `null` when the cell holds a constant — pairs with the existing `numbers_get_cell`. `numbers_rename_sheet` renames in place; Numbers does NOT allow duplicate sheet names so the JXA call throws and surfaces as `errJxa`. Same-pass cleanup: migrated existing 9 numbers catches from `toolError` to `errJxaFor` (RFC 0001 §3.1 cleanup that was missed in the earlier wave). Brings tool surface 269 → **272** across all auto-synced artifacts (manifest / llms / README / 232 AppIntents). 14 more Numbers tools queued in RFC 0009 §4.1; followups can lift this PR's pattern verbatim.
- **`npx airmcp doctor --deep`** (PR #198, polish in PR #200) — default `doctor` stays fast. `--deep` opts into slower live probes for user-reported troubleshooting: HMAC chain verification across all on-disk audit JSONL files (surfaces single-line tampering with the exact file + line number via `summarizeAuditEntries.verifiedFirstBreak`); Swift bridge live ping (distinguishes "not built" from "built but unresponsive"); module registry boot smoke (actually imports every `tools.ts` + `prompts.ts` to surface typos / missing transitive deps that ride the eager-import path at startup). Footer of default `doctor` prints the hint pointing at `--deep`. PR #200 widened the audit-chain bad message with actionable follow-up: "Inspect the surrounding lines, then call `audit_summary` to see the full break window."
- **`init` walkthrough closes with example prompts (i18n across 9 locales)** (PR #199, polish in PR #200) — `npx airmcp init` finishes with a *"Try asking your AI:"* block of three representative prompts so the user has a concrete path from "setup complete" to first interaction (`doctor --deep` hint added in passing). Three new i18n keys (`prompt_calendar_today`, `prompt_summarize_notes`, `prompt_overdue_reminders`) translated across all 9 locales the wizard already supports — PR #200 caught the original implementation hardcoded the strings in English even when the wizard ran in another locale.
- **`permission_denied` auto-hint pointing at System Settings** (PR #199, polish in PR #200) — `errPermission` now adds a default hint pointing at System Settings → Privacy & Security when the caller didn't supply one. macOS-only — non-darwin (CI runners, etc.) fall through to no hint. Caller-supplied hints win verbatim. Closes the recurring "permission denied — but where?" UX gap. PR #200 hoisted the platform check to a module-level `DEFAULT_PERMISSION_HINT` const (resolved once at load instead of every error).
- **outputSchema Wave 5 — 4 photos read tools** (`list_photos`, `search_photos`, `get_photo_info`, `list_favorites`) — extends Wave 4's pattern to the photos module. `list_photos` / `search_photos` / `list_favorites` route through `okUntrustedLinkedStructured` (photo metadata is user content); `get_photo_info` uses `okUntrustedStructured`. `list_albums` deferred — bare `AlbumItem[]` return shape, same array-vs-object breaking-change risk as `compare_notes`. Weather forecast tools (`get_daily_forecast` / `get_hourly_forecast`) also deferred for the same reason. 7 new drift guards in `tests/output-schema-wave5.test.js` covering full / null-EXIF / empty-list shapes; `tests/output-schema-structured.test.js` exhaustive coverage check picks up 4 fixtures so any future tool that adds outputSchema without a fixture breaks the build.
- **iOS Bearer token Keychain persistence** ([`ios/Sources/AirMCPServer/KeychainTokenStore.swift`](ios/Sources/AirMCPServer/KeychainTokenStore.swift)) — closes the (C) "Apple-native deeper, two devices" promise's pairing gap. Previously `MCPHTTPServer.init(token: nil)` generated a fresh random token on every process start, so any client paired with the previous boot's token (Windows Claude Desktop, a Mac MCP client over the same Wi-Fi, etc.) silently broke. The new `MCPHTTPServer.make(...)` async factory routes through a `KeychainTokenStore` actor which reads the persisted token (or generates + persists a fresh one on first boot). Stored as `kSecClassGenericPassword` with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — survives reboot but does NOT iCloud-sync (matches RFC 0002's loopback-by-default network policy: pairing is per-device on purpose). `kSecAttrService` namespaces by build flavour (`com.airmcp.ios.token`, override via `AIRMCP_KEYCHAIN_SERVICE` env for fork installs that share a device). Failure modes (Keychain unavailable in unentitled CLI runs, simulator quirks) fall back to a per-process random token with a stderr warning so the server still functions; that token doesn't persist and the operator sees the regression in logs. New `clear()` API for "rotate token" / "unpair all clients" UI flows. The synchronous `MCPHTTPServer.init(token: String)` is retained as a non-nullable explicit-pairing entry point for tests + flows where the caller already has a token in hand. `App.swift` updated to call `MCPHTTPServer.make(...)`. The legacy `private static func generateToken()` on `MCPHTTPServer` removed — token generation lives on the persistence layer that owns the bytes.

### Added — for operators

- **Per-tenant rate-limit buckets keyed on OAuth subject** (PR #159) — multi-tenant deployments behind OAuth get isolated rate-limit budgets per `sub` claim. Stdio / single-tenant flows fall through to the shared global bucket. Closes the noisy-neighbor gap on shared HTTP transports.
- **`/.well-known/oauth-protected-resource` aligned with SEP-985 / RFC 9728** (PR #193) — MCP [SEP-985](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/985) (active 2026-05) standardizes the OAuth protected resource metadata document beyond the MCP 2025-11-25 spec minimum. Three additions, all backwards-compatible: (1) DPoP advertisement (honest, not enforced) — `dpop_signing_alg_values_supported: ["ES256", "RS256"]` + `dpop_bound_access_tokens_required: false`. AirMCP doesn't bind tokens to a DPoP proof yet; declaring the flag honestly lets a future token-binding SEP flip it without renegotiating discovery. Symmetric (HS*) and `none` stay excluded — same key-confusion defense as the `resource_signing_alg` list. (2) [RFC 9728](https://datatracker.ietf.org/doc/rfc9728/) §2 optional fields via env: `AIRMCP_OAUTH_RESOURCE_DOCS` → `resource_documentation`, `AIRMCP_OAUTH_RESOURCE_POLICY` → `resource_policy_uri`, `AIRMCP_OAUTH_RESOURCE_TOS` → `resource_tos_uri`. Fields are omitted when unset so crawlers don't render dead links. (3) +4 test cases covering full SEP-985 baseline shape, DPoP honesty, env knobs surface when set, optional fields omitted when unset.
- **`docs/environment.md` — full env knob index (77 vars)** (PR #199) — Quickstart table for the five most-asked operator setups (token auth, OAuth, debug a flaky module, expand description budget, audit cross-host integrity). Categorized tables (Network/Auth, Rate limit, Audit, HITL, Module control, Embedding/AI, Telemetry, Timeouts/Buffers, Triggers, Tooling, Internal/test) with default + use case for each var. Source pointers at the bottom for deeper reading. README's Safety bullet now links to the page so operators can find the index without grepping the source.
- **OAuth 2.1 browser PKCE setup guide** ([`docs/oauth-browser-pkce.md`](docs/oauth-browser-pkce.md)) — RFC 0005 Step 3. Full walkthrough for browser-resident MCP clients (Claude in Chrome, Managed Agents, custom extensions) negotiating the Authorization Code + PKCE flow against AirMCP's `with-oauth*` endpoints. Covers: 9-step happy-path sequence diagram with every HTTP hop spelled out including the RFC 8707 `resource` parameter on both authorize + token requests; server env var checklist (`AIRMCP_OAUTH_ISSUER`, `AIRMCP_OAUTH_AUDIENCE`, `AIRMCP_ALLOWED_ORIGINS`); Claude in Chrome wiring (Anthropic's public redirect URI + AS client configuration); custom-client integration notes with vetted library picks (`@openid/appauth`, `golang.org/x/oauth2`, `authlib`) + a reviewer-friendly client-side hardening checklist (cryptorandom verifier, `S256` challenge method, state param CSRF guard, token storage rules); scope → tool mapping table cross-referencing `src/shared/oauth-scope.ts`; `npm run dev:oauth` fast-loop recipe; 8-row troubleshooting table covering the `wrong_audience` / `wrong_issuer` / `unsupported_alg` / `jwks_unreachable` / scope-gate forbidden / CORS-preflight-403 / startup-refused / `invalid_grant` cases with specific remediation. README Features row now cross-links the new guide; RFC 0005 status entry points at the doc instead of "in progress".

### Added — for developers

- **Correlation-id threading across request-context, tool-registry, audit** (PR #190) — async tool calls were untraceable across log lines: an audit entry, a telemetry trace, and a thrown error from the same call had no shared identifier so debugging required reconstructing wall-clock timing. `RequestContext` gains an optional `correlationId` field; the tool-registry wrapper opens a `runWithRequestContext` scope on first entry and stamps a `randomUUID()` correlation ID. If the call already arrived inside a context with a correlationId set (e.g. an HTTP middleware seeded one for distributed tracing), the existing ID is honored. `auditLog` auto-attaches the active correlationId to every entry; explicit caller-supplied IDs win. Audit log entries already in production keep working — `correlationId` is optional in the JSON shape. HTTP transport middleware can seed an inbound `Request-Id` header into the context for distributed tracing systems. +5 test cases covering absence / verbatim / await-boundary persistence / concurrent isolation (Promise.all branches see only their own ID) / OAuth-claim coexistence.
- **Correlation-id `Trace: <id>` line in error envelope** (PR #198) — `toolErr()` now auto-attaches the active context's correlation id to `structuredContent.error.correlationId` (machine-readable) and a trailing `Trace: <id>` line in the human-readable text. PR #190 already added the id to every audit row; this closes the loop on the user side so a failed tool call carries the id needed for `grep <id> ~/.airmcp/audit.jsonl`. `ToolErrorOptions` gains an explicit `correlationId` override for tests.
- **`npm run tokens` — measure compactDescription savings** (PR #165) — total bytes / token estimate before vs after compaction. Made the v2.12 RFC 0010 stub possible by quantifying the description budget at ~3.8K tokens after compaction (~50% reduction over the raw 7.5K).
- **`npm run llms:check` — drift guard for `llms.txt`** ([`scripts/gen-llms-txt.mjs`](scripts/gen-llms-txt.mjs)) — regenerates llms.txt in-memory and diffs against the checked-in copy; CI now runs this so any tool/prompt/module addition without `npm run llms` fails the build instead of silently shipping a stale catalog (the long-standing "258 tools / 30 modules" drift bug that survived multiple releases). `llms-full.txt` is `.gitignore`d and intentionally skipped from the check (oversize for review diffs); only the public-facing summary is pinned. New CI step in `.github/workflows/ci.yml` between `count-stats --check` and `sync-version --check`.
- **`docs/ROADMAP.md` — public 4-week + quarterly priorities** — externally-readable roadmap separated from the gitignored internal `TODO.md` scratch file. P0 / P1 / P2 / P3 buckets, each item linked to the relevant src file or RFC.
- **`docs/REGISTRY_SUBMISSIONS.md` extended to 19 directories** — added cursor.directory, MCP.so, mcphub.io, Modelo MCP Hub, mcpservers.org, awesome-mcp-servers (GitHub), LobeHub MCP, MCP Index, Composio MCP, HyperMCP, MCP Discover (12 new entries on top of the existing 7). Each row carries submission URL, audience pitch, and the v2.11 differentiator angle. First-wave priority list pinned at the top.
- **CHANGELOG reader guide** (PR #199) — one-block "For users / For developers / For operators" guide at the top of `[Unreleased]` so a release reader can skim the audience that applies to them. The full structure (`### Added — for users / operators / developers` headers) lands in this v2.12 release cut.

### Fixed

- **`list_calendars` returns empty after fresh permission grant** ([`swift/Sources/AirMCPKit/EventKitService.swift`](swift/Sources/AirMCPKit/EventKitService.swift)) — closes [#145](https://github.com/heznpc/AirMCP/issues/145) on macOS 15.7.5 (PR #201). Reproduces via the Swift bridge: `list_calendars` returns an empty array even though Calendar.app shows the user's calendars and the Calendar permission has been granted. **Root cause**: a freshly-granted `EKEventStore` keeps the snapshot it had from *before* authorization. `calendars(for: .event)` reads that stale snapshot rather than the now-readable backing data, so it surfaces an empty list. **Fix**: in the shared `authorize()` helper (used by both events and reminders paths in `EventKitService`), call `store.reset()` between the granted check and flagging the store as authorized. Idempotent across subsequent calls because the flag short-circuits — `reset()` only fires the first time through after a grant. Consolidating the reset in the helper covers both events + reminders in one place. JXA path is unaffected — Calendar.app scripting reads through Calendar's own data store, not EventKit.
- **`AskAirMCPIntent` rejects empty / whitespace-only prompts** ([`swift/Sources/AirMCPKit/AskAirMCPIntent.swift`](swift/Sources/AirMCPKit/AskAirMCPIntent.swift)) — Siri "Ask AirMCP" with no follow-up text used to hit `LanguageModelSession.respond(to: "")` → opaque framework error → generic Shortcuts failure. Now trim and return a recoverable user-facing message ("Please ask a question — I need something to look up.").
- **`gen-llms-txt.mjs` count drift fully closed** ([`scripts/gen-llms-txt.mjs`](scripts/gen-llms-txt.mjs)) — was reporting `265 tools / 32 modules` while `count-stats.mjs` (canonical) said `269 / 29`. Two roots: strict `extractTools` regex missed 4 tools whose registration spans the regex boundary; `walkDir` overcounted cross / semantic / skills / server / shared as separate modules. Fix: broad-regex pass for totals (matches `count-stats`), canonical module count parsed from `MODULE_NAMES`. Per-module list keeps strict regex for rich rendering. Headline now `269 / 29` everywhere (and `272 / 29` after PR #197's RFC 0009 batch).
- **`safari` and `podcasts` modules carry `compatibility.deprecation` for macOS 26** ([`src/shared/modules.ts`](src/shared/modules.ts)) — RFC 0004 G-5. Apple removed Safari `make new bookmark` JXA verb (just the one tool, replaced by `add_to_reading_list`) and the entire Podcasts JXA dictionary in macOS 26. Both now declare `compatibility.brokenOn: [26]` + `deprecation` blocks (`since`, `removeAt`, `replacement`, `reason`) so RFC 0004's `print-compat-report` and `airmcp doctor` surface the regression with the exact replacement (Safari) or upstream-removal note (Podcasts).
- **Event listener leak on HTTP session cleanup** ([`src/server/mcp-setup.ts:505`](src/server/mcp-setup.ts)) — `cleanupEventListeners` only removed 3 of the 9 listeners that `event_subscribe` registers. v2.10 added 6 new event types (mail_unread / focus_mode / now_playing / file_modified / screen_locked / screen_unlocked) but the cleanup wasn't extended in lockstep. HTTP servers that idle-timed-out sessions accumulated 6 listeners per session and eventually hit Node's `MaxListenersExceededWarning`; the unremoved closures also kept references to stale `McpServer` instances alive, causing silent failures when later `.sendResourceListChanged()` calls fired against closed transports. All 9 listeners now mirror the registration list.
- **Banner displayed wrong skill count** ([`src/server/mcp-setup.ts:494`](src/server/mcp-setup.ts)) — hardcoded `skillsBuiltin: 7` while the actual count had grown to 14 YAML files in `dist/skills/builtins/`. `registerSkillEngine` now returns `{ builtinCount, userCount }` and `bannerInfo` reads from that, so the count auto-updates as built-ins are added or pruned.
- **Duplicate `AppShortcutsProvider` in app target** ([`app/Sources/AirMCPApp/AppIntents.swift:133`](app/Sources/AirMCPApp/AppIntents.swift)) — `AirMCPShortcuts` (hand-written, 7 entries, predates RFC 0007 codegen) and `AirMCPGeneratedShortcuts` (auto-generated, 10 entries, in `swift/Sources/AirMCPKit/Generated/MCPIntents.swift:6850`) both conformed to `AppShortcutsProvider` in the same app bundle. Apple constrains an app target to a single conformer; having both produced ambiguity at build time and a Siri suggestion tie that Apple resolves arbitrarily. The hand-written provider is removed; the unique intent types it referenced (`DailyBriefingIntent`, `HealthSummaryIntent`) remain defined and stay invocable via the Shortcuts app, Spotlight, and Action Button — they just aren't pinned as Siri-first phrases. A future codegen `APP_SHORTCUTS_TOP` entry can re-pin them once the corresponding `daily_briefing` / `health_summary` tools graduate to first-party manifest entries. `swift build` confirms the conflict is gone (app target compiles clean).
- **Tool count drift in user-facing docs** — `llms.txt` said `258 tools across 30 modules` (regenerated to current via `npm run llms`); `docs/shortcuts.md` said `154 read-only tools` / `144 intents` (now correctly 229 tools / 219 non-pinned intents reflecting RFC 0007 Phase A's full write-capable surface). The deeper discrepancy between `count-stats.mjs` (29 modules / 269 tools — canonical from `MODULE_NAMES`) and `gen-llms-txt.mjs` (32 modules / 265 tools — walks `src/` for any dir with `registerTool`) was tracked for follow-up and fully closed in PR #157.

### Reliability

- **`MemoryStore` atomic write + serialized op queue + prototype-pollution guard** ([`src/memory/store.ts`](src/memory/store.ts)) — three audit-flagged risks closed in one pass. (1) `save()` now stages JSON in a sibling tempfile (`<path>.<random>.tmp`) and `rename()`s it over the canonical path, so a SIGKILL / power loss mid-write leaves either the old or new content — never a half-flushed JSON file (which would have silently restored to an empty store on next `load()` and lost every fact / entity / episode). (2) `put()` / `forget()` / `stats()` route through a new private `enqueue()` op queue so concurrent invocations (an agent loop dispatching `memory_put` in parallel with a `memory_query` that triggers a sweep, or two skill steps writing different keys) chain instead of trampling the on-disk file's last writer. The chain swallows queue-level errors so a single failure doesn't poison the next op. (3) `JSON.parse` now uses a reviver that drops `__proto__` / `constructor` / `prototype` keys so a hand-edited or attacker-supplied store file can't pollute Object.prototype when loaded back.
- **AppIntent handler injection race window shrunk** ([`app/Sources/AirMCPApp/AppIntents.swift:162`](app/Sources/AirMCPApp/AppIntents.swift)) — `installMCPIntentRouterForMacOS()` now uses `Task { @MainActor in … }` at default priority instead of `Task.detached(priority: .utility)`. The actor hop into `MCPIntentRouter.shared.setHandler` is unavoidable (router is an actor), but raising the priority + dropping `.detached` shrinks the cold-launch race window from "seconds" (utility queue can sit behind other low-priority work) to "milliseconds before the first runloop tick" — far before any Siri / Shortcuts cold-launch first-invocation can reach the router. The existing `MCPIntentError.handlerNotInstalled` error path is preserved as a safety net with the requested tool name embedded.
- **`bulk_move_notes` — dryRun + stopOnError + meta visibility** ([`src/notes/scripts.ts:377`](src/notes/scripts.ts), [`src/notes/tools.ts:522`](src/notes/tools.ts)) — `dryRun: true` (default false) returns the list of notes that would move, the original folder, and an explicit `metaPreservation` block stating which fields would be lost (creationDate / modificationDate / attachments — Notes JXA cannot set those on the new note copy). `stopOnError: true` (default true) halts on the first failure so the source/target stays at a recoverable mid-state instead of running through 50 more failures and producing 50 more orphaned partial moves; pass `false` for best-effort partial completion. The script also detects same-folder no-ops (`originalFolder === targetFolder`) and reports them as `unchanged: true` instead of doing the body-copy → delete dance and silently nuking the metadata. Per-note successful-move results carry the original `metaLost: { creationDate, modificationDate }` so the caller has a record of what was discarded.

### Security

- **`audit_log` HMAC chain — single-line tampering detection** ([`src/shared/audit.ts`](src/shared/audit.ts)) — every flushed audit line now carries `_prev` + `_hmac` (HMAC-SHA256). The chain spans process restarts: on first flush after boot the module reads the disk tail, picks up the latest `_hmac`, and continues — no per-process forks. `summarizeAuditEntries` walks every chained line and reports `verified: boolean` + `verifiedFirstBreak: { file, lineIndex, reason }` so a single deletion / mutation surfaces with the exact location. Legacy un-chained lines (written before this version) are tolerated and skipped — but inserting a legacy-shaped line in the middle still breaks `_prev` on the next chained line, so verification cannot be laundered. Key source: `AIRMCP_AUDIT_HMAC_KEY` env var (preferred — operator-provided, enables cross-machine integrity check) or a host-derived fallback (`airmcp-audit::<hostname>::<platform>` — tamper-detection grade only). `audit_summary` tool gains `verified`, `verifiedFirstBreak`, and `auditDisabled` fields.
- **`auditDisabled` no longer permanent** ([`src/shared/audit.ts`](src/shared/audit.ts)) — previously one transient disk-full incident latched audit logging off until the process restarted. Now after `MAX_FLUSH_FAILURES` consecutive failures the module enters a 5-minute backoff, then the next `auditLog()` call triggers `maybeAttemptRecovery()` which clears the disabled flag and retries flushing. The auditDisabled state is also surfaced through `summarizeAuditEntries` so a doctor / health check can flag the situation in real time.
- **`SENSITIVE_TOOL_PATTERNS` broadened** (PR #192) — `oauth_*` / `password` / `credential` / `token` substring patterns added. Catches RFC 0005 OAuth tools (`oauth_authorize`, `oauth_refresh`, …) plus any future credential-bearing tool name without per-tool opt-in. Defense-in-depth on top of the args-side sanitizer for tools that pack credentials into nested args the per-key sanitizer can miss.
- **`resumeChainHead` malformed-line counter** (PR #192) — was silently skipping garbage lines while scanning the disk tail for HMAC chain resumption. Now logs a one-shot stderr warning with the malformed count + recovery point so an operator notices tampering or corruption before it gets buried under fresh entries. Behavior unchanged; the message is the only delta. Six new test cases close the audit / correlationId / sanitize-redaction gap (explicit `correlationId` preserved verbatim, omitted `correlationId` stays undefined outside an active context, `oauth_authorize` args replaced with `_redacted` marker, tool names containing `credential` or `token` redacted, non-sensitive tool flows through `sanitizeArgs` unchanged).
- **`ai_agent` write-tool bypass closed** ([`swift/Sources/AirMCPKit/FoundationModelsBridge.swift:134-152`](swift/Sources/AirMCPKit/FoundationModelsBridge.swift)) — verification of a multi-session audit finding (P0-2) confirmed the concern: `FoundationModelsBridge.run()` registered 5 tools (`TodayEventsTool`, `DueRemindersTool`, `SearchContactsTool`, **`CreateReminderTool`**, **`CreateNoteTool`**) on the `LanguageModelSession`, and the model autonomously called them in a tool-calling loop. The two write tools invoked `EventKitService.createReminder()` directly in Swift, bypassing the Node-side `toolRegistry` pre-handler — meaning HITL approval, rate-limit, and audit-log enforcement were all skipped on the agentic path. `ai_agent`'s `destructiveHint: false` was technically truthful but the absence of read-only-only signaling made the bypass surface invisible to clients. Fix: `allTools()` now exposes only the 3 read-only tools; the `Create*Tool` classes remain defined as future-use API but are no longer registered with the session. `ai_agent` description rewritten to spell out the read-only constraint and explain the bypass concern; `readOnlyHint: true` corrected. Restoring write capability to the agent surface requires a Swift→Node loop-back transport so calls re-enter the toolRegistry — designed in TODO/ROADMAP for v2.12+. Earlier the [#150](https://github.com/heznpc/AirMCP/pull/150) PR body had marked this finding as "MISCLASSIFIED" based on a partial main.swift read; the audit was correct, this PR is the proper retraction + fix.

### Changed

- **RFC 0001 Wave 2+ — error shape migration across 13 modules** (PR #144) — every `return err(...)` site in tool-handler code now routes through a typed error helper (`errPermission` / `errInvalidInput` / `errNotFound` / `errUpstream` / `errSwift` / `errDeprecated`) so clients can branch on `structuredContent.error.category` instead of string-matching the text content. Converts 59 sites across: mail (2× `errPermission` for send-disabled), messages (2× `errPermission`), google (15× `errUpstream` for upstream Gmail/Drive/Sheets/Calendar/Docs/Tasks/People failures + 3× `errPermission` for send/destructive gates + 2× `errInvalidInput` for service-name / sanitization validation), health (5× `errSwift` for bridge-required), intelligence (2× `errSwift`), speech (3× `errSwift`), mcp-setup (2× `errSwift` + 1× `errNotFound` for unknown-prompt + 1× `errUpstream` for workflow-fetch-failed), semantic (3× `errSwift` + 1× `errNotFound` + 1× `errUpstream`), cross (1× `errInvalidInput` + 2× `errUpstream` + 1× `toolErr` for build-snapshot failure), skills register (2× `errUpstream` for skill step/execution failure), hitl-guard (2× `errPermission` for denial paths), ui (4× `errInvalidInput` for click/query criterion validation), memory (1× `errInvalidInput` for exactly-one-of), safari (6× `errInvalidInput` for URL validation + 1× `errPermission` for JavaScript-disabled + 1× `errDeprecated` for macOS 26 `add_bookmark` stub). Wire format per RFC 0001: text content becomes `[<category>] <message>` (was bare message); `structuredContent.error = { category, message, retryable }` now populated. Existing clients that read `isError: true` or substring-match the message keep working; clients that want structured recovery branches gain a stable category contract. No behavioral change — same conditions trigger the same errors; only the wire shape gains structure. `tests/skills-register.test.js` updated to assert `errUpstream` instead of `err` on the three skill-failure paths (mock list also extended for the new export so the ESM binding doesn't fail on load).
- **Docs sync for v2.11.0** — public-facing docs catch up to the shipped v2.11 surface. `README.md` Features block bumps tool count 270+ → 269, pins 229 AppIntents line, adds OAuth 2.1 + Resource Indicators row, adds `.well-known` sessionless discovery row, notes notarized menubar app; "Why AirMCP?" comparison table, security section, and architecture section all align on 269 tools / 29 modules (was a mix of 262 / 270+ / 262 across five locations); "Future" section drops OAuth 2.1 + GUI .app distribution (both shipped) in favour of Step 3 PKCE guide, stateless streamable HTTP, iOS/visionOS exploration. `docs/index.html` JSON-LD `softwareVersion` corrected `2.7.3` → `2.11.0` (3 majors stale, SEO-visible), meta/Twitter descriptions + Schema.org description + glass-stats card + `why_1_title` all bumped from 27 modules / 262 tools to 29 / 269. `docs/REGISTRY_SUBMISSIONS.md` status table refreshed to v2.11 baseline with `.mcpb` + OAuth as new differentiators; new row for Claude Desktop Extensions directory submission opportunity. RFC status transitions: 0001 Draft → Accepted (Waves 0+1 shipped, Wave 2+ in progress), 0004 Draft → Accepted (runtime activation shipped in v2.10), 0005 Draft → Accepted (Steps 1+2 shipped in v2.11, Step 3 in progress), 0007 Draft → Phase A Accepted (PRs #101-#137 closed Phase A). `CONTRIBUTING.md` adds drift-guard commands (`stats:check`, `gen:manifest:check`, `gen:intents:check`) and a new OAuth local-development section pointing at `npm run dev:oauth`. No code change.
- **Docs sync for v2.12.0** (this release) — `README.md` (5 sites: hero, comparison table, Safety bullet, well-known crawler example, Architecture scope bullet) and `docs/index.html` (5 sites: meta description, Twitter description, JSON-LD description, glass-stat, `why_1_title`) bumped 269 → **272** to reflect PR #197's RFC 0009 first batch. `docs/index.html` `softwareVersion` corrected `2.11.0` → `2.12.0`. Internal-mention drift in `docs/environment.md`, `docs/skills.md`, `docs/REGISTRY_SUBMISSIONS.md`, `docs/ROADMAP.md`, `docs/rfc/0010-progressive-disclosure.md` deferred to a v2.12.1 docs cleanup PR — those each carry context-specific number references that need individual review (e.g. ROADMAP "2026-04-30 기준" snapshot, REGISTRY "v2.10 baseline").
- **README — Safety & Operations bullet now mentions correlation-id + HMAC chain** (PR #194) — PR #190 added per-call correlation IDs to every audit entry, and PR #152 added HMAC chain integrity. The README's bullet hadn't caught up. One-sentence expansion so users + integrators see the feature without reading the CHANGELOG.

### Refactored

- **Simplify pass over PRs #198 / #199** (PR #200) — three findings: (1) `result.ts` `errPermission` collapsed dead-code hint composition (`opts?.hint ?? ''` could only ever produce `''`); hoisted platform check to module-level `DEFAULT_PERMISSION_HINT` const (resolved once at load instead of every error). (2) `doctor.ts` `deepFlag` variable — pulled `process.argv.includes('--deep')` into a single local const reused for both the deep-checks block and the trailing footer hint; widened the audit-chain bad message to include actionable follow-up. (3) `init.ts` example prompts — i18n via the existing `t()` helper (4 new keys translated across 9 locales). Three skipped findings documented as false positives.

### RFC drafts (no implementation in this release)

- **RFC 0008 — MCP Elicitation for destructive tools** (PR #191; **Phase 1 implemented in PR #196**) — `@modelcontextprotocol/sdk` 1.29.0 already exposes `server.elicitInput()`. Phase 1: confirmation-only elicit wrapper for `destructiveHint=true` tools, capability-gated (only when client advertises `elicitation`), env-opt-out (`AIRMCP_ELICITATION_DISABLE=true`), threads `correlationId` (PR #190) for the audit trail. Phase 2 deferred: form-mode parameter capture, URL-mode consent flows, capability-driven "this tool will prompt" hint in `tools/list`. Backwards-compatibility matrix: Elicitation client → new prompt; App Intents → existing `requestConfirmation` (RFC 0007 §A.3); Plain HTTP/stdio without elicit → today's behavior (rate-limit + scope gate).
- **RFC 0009 — iWork (Pages / Numbers / Keynote) coverage depth** (PR #191; **Phase 1 first batch in PR #197**) — pre-implementation gap audit vs `iwork_mcp` (113-tool reference). Phase 1 (~40 new tools): Numbers cell/range/formula CRUD, Pages section/style ops, Keynote master/layout/transitions. Phase 2 deferred: NL→formula codegen via Foundation Models, master propagation, chart manipulation. Risks captured: JXA dictionary inconsistency, large-spreadsheet performance, context-budget bloat (re-run `npm run tokens` after Phase 1).
- **RFC 0010 — Progressive tool disclosure (SEP-1888 alignment)** (PR #195) — AirMCP advertises 269 tools eagerly; `npm run tokens` (PR #165) measured the description budget at ~3.8K tokens after `compactDescription` — already a 50% reduction over the raw 7.5K, but a meaningful chunk of every model context still goes to "things you might call." [SEP-1888](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888) (active May 2026) replaces "register N narrow tools" with library tool + `searchTools` progressive disclosure; the Anthropic Skills-over-MCP charter calls out the same direction. **Stub-only because**: the SEP shape isn't ratified yet — premature migration would rename the public surface twice. AirMCP's existing `discover_tools` already handles the search backend; the gap is the discoverability *contract*, not the implementation.
- **RFC 0011 — Post-WWDC 2026 positioning placeholder** (PR #195) — WWDC 2026 keynote June 8–12 has credible leaks for: Siri 2.0 with third-party AI extensions, possible Apple-blessed system MCP API, "Snow Leopard year" refinement focus. Any individually has a measurable AirMCP impact; together they could redraw the competitive map. **Placeholder is intentionally light** — pre-keynote prohibition on pivots, just a guaranteed landing spot for the post-WWDC sprint with action items for the day-of and following 48h.

## [2.11.0] - 2026-04-24

Headline shifts: AirMCP becomes installable with one click (`.mcpb` Desktop Extension for Claude Desktop), discoverable without a session (`.well-known/mcp.json` + `.well-known/oauth-protected-resource`), deployable with real OAuth 2.1 (JWT verification + RFC 8707 Resource Indicators + scope-gated tool calls), and packageable as a self-contained macOS app with Developer ID signing/notarization automation prepared. This does not claim that a notarized distribution was completed; the signed lane still requires protected release-environment review and Apple credentials. The Swift AppIntent codegen stream reached Phase A closure — 229 auto-generated intents, 50 Interactive Snippet views, 17 AppEnum pickers — with the pure helpers extracted into `scripts/lib/codegen-helpers.mjs` (134 unit tests) so regressions localize to a one-line diff instead of a golden-file firestorm. Four outputSchema waves established matching runtime `structuredContent` contracts for 34 high-traffic read tools.

### Added
- **outputSchema Wave 4** — 7 additional high-traffic read tools now declare typed `outputSchema` with matching `structuredContent`: `read_message`, `search_messages` (mail), `search_files`, `recent_files` (finder), `read_page_content`, `search_tabs` (safari), `scan_notes` (notes). This raises the exact four-wave runtime-contract set from 27 to 34 tools. Mail tools route through `okUntrustedLinkedStructured` so the primary text block is still wrapped with the external-content marker (prompt-injection guard preserved); finder read tools use `okStructured` / `okLinkedStructured` (system metadata isn't user content); safari read tools use `okUntrustedLinkedStructured` (page source + tab URLs are external). `read_message.id` + `search_messages.id` scripts now `String(m.id())` the Mail.app-returned numeric id so the wire contract matches Wave 2's `list_messages.id: z.string()` declaration — silent Wave-2 runtime/schema mismatch fixed in passing. `search_files` per-file size/modificationDate declared optional to tolerate the script's stat-failure fallback (`{path, name}`-only rows on permission errors). 13 new drift guards in `tests/output-schema-wave4.test.js` across normal/null/empty/truncated cases, and `tests/output-schema-structured.test.js` picks up 7 fixtures so the exhaustive contract check stays green. Wave 4 notably skips `compare_notes` — the script returns a bare array and wrapping it in an object would break clients that `JSON.parse` the text content; tracked as a separate follow-up. `gen:intents:check` byte-identical (229 intents) confirms the new typed outputs slot into the existing Swift codegen without drift.
- **`.mcpb` Desktop Extensions bundle for Claude Desktop one-click install** — `npm run build:mcpb` produces `build/mcpb/airmcp-<version>.mcpb` (5.25 MB, self-contained: `server/dist/` + production `node_modules/` + manifest + icon, all zipped per MCPB v0.3). Claude Desktop picks it up from "Browse extensions" → users fill a two-field form (Gemini API key optional + sensitive; "Load all 29 modules" toggle default off) and AirMCP is live. No `npm`, no `claude_desktop_config.json` editing, no shell. CI runs `build:mcpb:check` on every push; 16 new manifest-shape tests pin MCPB v0.3 contract (required fields, `${__dirname}`-anchored args, `${user_config.KEY}` substitution drift guard, Node-engine canary vs `package.json`). Install guide lives at `docs/mcpb.md`. Codesign + notarization + Swift-bridge pre-build land as follow-ups.
- **`.well-known/mcp.json` tool + module inventory for registry crawlers** — existing discovery card (v2.10: `network_policy` + `allowed_origins`) extended with the fields registry crawlers actually want. `tools: { count, names }` — the full tool inventory read from `toolRegistry` at request time so a `listChanged` doesn't leave the card stale. `modules: [...]` — the live enabled-module list (reflects OS gates + user config, not just `MODULE_NAMES`). `license`, `homepage` from `package.json`. `schema_version: "2025-11-25"` pins the MCP spec revision. `buildServerCard` extracted to `src/server/well-known-card.ts` as a pure function with 18 unit tests; the Express handler stays a 3-line `res.json` wrapper. Anthropic MCP Registry / Smithery / PulseMCP / Glama crawlers can now surface "AirMCP: 270+ tools across calendar, notes, mail, …" without opening a session.
- **Codegen helper extraction to scripts/lib/codegen-helpers.mjs — 134 unit tests** — every pure function in `scripts/gen-swift-intents.mjs` (the 1200-LOC codegen that produces all 229 Swift AppIntent structs + 17 AppEnum types + 50 snippet views) now lives in a shared lib: `toPascalCase`, `swiftIdent`, `swiftLit`, `humanizeKey`, `enumCaseName`/`enumCaseDisplayLabel`/`enumTypeName`, `intentStructName`, `intentActionNameFor`, `swiftTypeFor`, `swiftDefaultLiteral`, `enumDefaultLiteral`, `wireExpr`, `isNullableUnion`/`nonNullType`, `outputTypeNameFor`/`snippetViewNameFor`, `detectSnippetShape`, `systemImageFor` + `SYSTEM_IMAGE_BY_PREFIX`, `collectEnums`, `renderAppEnum`, `swiftParamDecl`, `buildArgsBlock`, `resolveFollowUpMap` + `deriveFollowUpFactorySpecs`, `isCodableSafe`, `swiftOutputType`, `renderStruct`, `hasTypedOutput`. `gen-swift-intents.mjs` shrinks from 1219 → 752 LOC; the generator becomes thin orchestration (manifest load, CLI wrappers for throwing lib fns, `generateIntent` + snippet-view render composing pure helpers, source assembly, write/check). Every refactor step verified byte-stable via `gen:intents:check` against the 229-intent checked-in output. Catches helper-level regressions with a specific error message instead of a multi-thousand-line diff on the codegen golden.
- **Tool manifest structural contract check** — `scripts/verify-tool-manifest.mjs` fails CI on shape regressions (missing `annotations` fields, new ineligibility reason codes, per-tool cross-check against histogram counts) — a silent schema regression upstream of the drift check now surfaces with a specific error. Intentionally independent from `scripts/lib/codegen-helpers.mjs` so a codegen widening can't sneak through.
- **RFC 0007 Phase A completion — 229 auto-generated AppIntents** — the bridge grows from A.1's 154 read-only intents to a full write-capable surface. Non-destructive writes (75 tools like `create_reminder`, `update_event`, `update_note`) land directly; the 48 destructive tools (`delete_*`, `send_*`, `trash_*`, `quit_app`, etc.) stay off by default and require `AIRMCP_APPINTENTS_DESTRUCTIVE=true` at codegen time. When enabled, each destructive intent runs `requestConfirmation(actionName:dialog:)` before the router call (iOS 18+/macOS 15+ gate on the struct so older OS simply doesn't see the destructive surface). Action verb derives from the tool name: `.send` for `send_*`/`reply_*`/`post_*`, `.go` elsewhere — `ConfirmationActionName` only exposes those two members as of iOS 26 (verified with `swiftc -typecheck`). Destructive semantic is carried by the dialog text, not the button label.
- **AppEnum codegen for 17 enum parameters** — tool inputs with `z.enum([...])` now render as Swift `AppEnum` types instead of plain `String` carrying an "Allowed: a, b, c" description. Shortcuts / Siri users get a native dropdown picker with readable labels (`nextTrack` → "Next Track"). 17 enums across 16 tools including `playback_control.action`, `memory_*.kind`, `capture_screenshot.region`, `get_directions.transportType`. Per-tool enum type names (`<Tool><Param>Option`) avoid cross-tool collision; `nonisolated(unsafe) static var` mirrors the pattern on intent static props.
- **Interactive Snippet tap-through follow-ups** — 13 list tools wrap their row rendering in `Button(intent: …)` so tapping an item dispatches a follow-up AppIntent without leaving the host surface. Coverage: events/notes/reminders/contacts (list + search variants) → corresponding read tool; `list_messages` → `read_message`; `list_chats` / `search_chats` → `read_chat` (list output `id` → target param `chatId`, via the new itemField/targetParam split in `FOLLOW_UP_MAP`). `ForEach(id: \.id)` key replaces the old `\.offset` so SwiftUI diffs correctly across re-enters.
- **Snippet views wired into `perform()` — typed result + view** — 50 typed AppIntents now return `.result(value:, view: MCP…SnippetView(data: decoded))` on iOS 26+/macOS 26+, rendering the codegen'd Interactive Snippet view inline. Older OS paths keep the plain `.result(value:)` and still run the JSON decode as a drift guard. Scalar snippet views (`get_current_weather`, `get_battery_status`, `get_clipboard`, etc. — 31 tools) now render with humanized labels (`stepsToday` → "Steps Today"), type-aware value formatting (Yes/No booleans, `.formatted()` numbers, abbreviated dates from ISO strings), and `?? "—"` for nil optional fields. `.lineLimit(1)` + `.truncationMode(.tail)` prevents long strings from blowing out the card.
- **Tool manifest describes *why* tools drop out** — `isAppIntentEligible` replaced with `appIntentEligibility` returning `{ appIntentEligible, ineligibleReason }`. Manifest top-level carries `ineligibleCount` + `ineligibleByReason` histograms; per-tool entries record their specific reason (`record-input` for `additionalProperties: true`, `object-param:<key>` / `array-of-object:<key>` for composite schemas). The dump script's one-line summary prints the histogram inline.
- **Golden-sample CI regression check** — `scripts/verify-golden-intents.mjs` fulfills the RFC 0007 §3.6 promise. Extracts every `runAirMCPTool("<name>", …)` call site from `app/Sources/AirMCPApp/AppIntents.swift` and asserts each tool exists in the manifest (or is registered in src but hardware-gated like `health_summary`) AND has a matching `public struct <PascalName>Intent` in the generated Swift. Tolerance-based, not byte-compare — codegen refinements don't break CI; the check's floor is "did codegen drop a tool the macOS app depends on?".
- **MCPIntentRouter unit tests** — 5 XCTest cases covering happy-path roundtrip, empty-args zero-parameter tools, `handlerNotInstalled` error when no handler is set, handler-throw propagation, and "last `setHandler` wins" semantics. The router was previously zero-test — a Swift 6 concurrency regression or handler-wiring bug would only surface on a real device.
- **Description source fix for Shortcuts UI** — `AIRMCP_COMPACT_TOOLS` (default on, `src/shared/tool-filter.ts`) truncates tool descriptions to ~80 chars with `…` to save tokens in `tools/list` for LLM consumers. Right tradeoff for MCP clients, wrong tradeoff for Swift codegen whose output is rendered as user-facing text in Shortcuts / Siri / Spotlight — truncations like `"… Foundation Model and repo…"` leaked into the UI. `scripts/dump-tool-manifest.mjs` now sets `AIRMCP_COMPACT_TOOLS=false` so the manifest feeding codegen has full descriptions.
- **CI trigger on every PR** — `pull_request: branches: [main]` dropped so stacked PRs (PR → PR → main chains, common with multi-axis RFC work) get full CI feedback before the chain merges sequentially. Previously only the bottom PR of a stack reported checks.
- **outputSchema Wave 3** — 10 additional read tools now declare typed `outputSchema` with matching `structuredContent`: `list_chats`, `read_chat`, `search_chats`, `list_participants` (messages), `health_today_steps`, `health_heart_rate`, `health_sleep` (health), `list_shortcuts`, `search_shortcuts`, `get_shortcut_detail` (shortcuts). This raises the exact three-wave runtime-contract set from 17 to 27 tools. Messages tools keep the `okUntrusted*` wrappers so external-content markers still guard against prompt injection, now layered with `structuredContent`. Health tools graduate from `okLinked` to `okLinkedStructured` so the primary text block, `_links`, and the typed payload all round-trip cleanly. `tests/output-schema-wave3.test.js` adds strict-parse drift guards for each new schema, and `output-schema-structured.test.js` picks up the 10 fixtures so the exhaustive contract check stays green.
- **RFC 0005 draft — OAuth 2.1 + Resource Indicators** — new RFC targeting v2.11.0 that lays out the migration from the legacy `AIRMCP_HTTP_TOKEN` Bearer path to the MCP 2025-06-18 OAuth 2.1 + RFC 8707 Resource Indicators flow. Covers `with-oauth` / `with-oauth+origin` network policies, `.well-known/oauth-protected-resource` discovery, scope design (`mcp:read`/`mcp:write`/`mcp:destructive`/`mcp:admin`), and a 5-step rollout that keeps the existing Bearer path working until v3.0.

### Changed
- **`safari.add_bookmark` gated on macOS 26+** — Safari removed bookmark scripting in macOS 26; the tool now skips registration on macOS 26+ instead of registering and returning an error at call time. Agents no longer see a "tool exists but always fails" entry in their plans on Tahoe hosts. Legacy hosts (macOS ≤ 25) keep the tool with the existing deprecation message. Test expectation updated from 12 → 11 registered Safari tools in the non-Darwin test env (`add_bookmark` gated off, other 11 always present).
- **Prettier run across 9 drifted files** — `src/safari/scripts.ts`, `src/shared/esc.ts`, and the 7 skill built-in YAMLs (`daily-journal`, `favorites-digest`, `focus-block-planner`, `project-digest`, `sender-to-tasks`, `weekly-digest-note`, `weekly-review`). No behaviour change.

### Security
- **Hono / @hono/node-server overrides** — `package.json` `overrides` forces `hono@^4.12.13` + `@hono/node-server@^1.19.13` to address [CVE-2026-29045](https://advisories.gitlab.com/pkg/npm/hono/CVE-2026-29045/), [CVE-2026-39407](https://advisories.gitlab.com/pkg/npm/hono/CVE-2026-39407/), [CVE-2026-29087](https://advisories.gitlab.com/pkg/npm/@hono/node-server/CVE-2026-29087/), and [CVE-2026-39406](https://advisories.gitlab.com/pkg/npm/@hono/node-server/CVE-2026-39406/) (middleware bypass via repeated slashes + authorization bypass via encoded slashes in `serveStatic`). AirMCP does not use Hono directly — both are transitive via `@modelcontextprotocol/sdk` — but `npm audit --omit=dev` now reports 0 findings instead of 2 moderate.

## [2.10.0] - 2026-04-20

### Added
- **Swift menubar onboarding — module coverage + v2.10 surface** — `OnboardingView` module picker grew from 15 to 25 items, reorganised into four readable clusters (Everyday · Media · System + automation · Intelligence + introspection · Context sensors · Integrations) instead of a flat list. The v2.10 introspection modules — **Context Memory** and **Audit** — get dedicated entries so first-run users see them alongside Notes/Calendar instead of having to discover them in config later. Localisable.strings gains `module.memory.*` and `module.audit.*` keys in both English and Korean. Swift build green; no Node-side changes.
- **Registry submissions tracker + `server.json` refresh** — new `docs/REGISTRY_SUBMISSIONS.md` tracks status across Anthropic MCP Registry, Smithery, Glama, MCP Market, Cline Marketplace, and PulseMCP, with a resubmission checklist that requires `stats:sync` green before any registry UI is touched. `server.json` (Anthropic schema `static.modelcontextprotocol.io/schemas/2025-12-11`) gets a v2.10-era description ("269 tools across 29 modules with YAML skills, context memory, queryable audit log, and declarative HTTP network policy") and joins the `npm run stats:sync` fleet so its counts stay truthful automatically.
- **Browser-MCP guide (Claude in Chrome et al.)** — README's Client Setup and the docs site's Configuration page now cover the HTTP-transport path that extension-based MCP clients need. Concrete steps: generate a token, set `AIRMCP_ALLOWED_ORIGINS=https://claude.ai`, switch policy to `with-token+origin`, bind with `--bind-all`, paste URL + Bearer token into the extension. Includes a `/.well-known/mcp.json` verification curl and a short "security gotchas" list (proxy headers, Origin allow-list, emergency-stop path). The `AIRMCP_ALLOW_NETWORK` + `AIRMCP_ALLOWED_ORIGINS` env vars are documented alongside the existing HTTP settings.
- **Landing page: "Beyond Siri" section** — five concrete cards on `docs/index.html` pitching what AirMCP does that Siri / Shortcuts cannot: newsletter-inbox-to-tasks loop, screen-lock-triggered journal, fused timeline view, clipboard URL auto-save, and a queryable audit trail with one-command emergency stop. Nav gains a `#beyond-siri` anchor. All 14 new i18n keys added across all 9 locales (Korean authored, others copy the English source so `check-i18n` stays green — translation polish tracked separately).
- **README refresh + demo tape update** — Features block now reflects v2.10's actual footprint (270+ tools / 29 modules / 14 skill built-ins / 9 event triggers / 3 interactive apps). Two new top-level sections land above the existing client-setup docs: a **Skills DSL** walkthrough with a ready-to-lift `sender-to-tasks` example (parallel + loop + retry + inputs + `on_error: continue`) and a **Safety & Operations** section covering HITL, rate limit, kill switch, audit log, and HTTP network policy. The "Why AirMCP?" comparison table picks up rows for Automations, HTTP transport, and the expanded safety story, and now lists the correct active version. `scripts/demo.tape` gets a new story arc (`--version` → `--help` → `doctor` — highlighting the new Compatibility + HTTP policy sections — → banner) and a roomier 1000×680 canvas so the widened doctor output doesn't clip. Tools-section counts auto-sync via `count-stats --sync`; `MODULE_NAMES` is no longer missing the `memory` / `audit` modules.
- **Memory module polish — outputSchema + `memory://recent` resource + `daily-journal` skill** — the v2.8 context-memory module graduates from scaffold to "first-class consumable". All four tools (`memory_put`, `memory_query`, `memory_forget`, `memory_stats`) now declare typed `outputSchema` with matching `structuredContent`, using a shared `memoryEntrySchema` so put/query stay in lockstep. New MCP resource `memory://recent` returns the 20 most recently updated entries for AI clients that prefer polling over the tool surface (gated on the `memory` module being enabled). New showcase built-in `daily-journal` combines `inputs` + `parallel` reads + `retry` on `summarize_text` + `memory_put` to persist a day's activity as a tagged `episode` — the reference pattern for "skills that remember". Built-in count: 13 → 14.
- **Skill prompt arguments** — skills with `expose_as: prompt` now support the same `inputs` block that tool-exposed skills got in the prior release. When declared, the skill registers via MCP's `registerPrompt` with an `argsSchema` (string-only per MCP spec), and the generated prompt text folds the bound values into an `Inputs:` block so the LLM picks them up as already-resolved. Skills without inputs keep using the legacy `server.prompt()` registration — no change to existing built-ins' wire format. 3 new unit tests cover the legacy-path fallback, `registerPrompt` + `argsSchema` synthesis, and no-args callback behaviour.
- **RFC 0002 Phase 2 — proxy header detection + `doctor` HTTP policy section** — the HTTP transport now soft-warns once-per-process when a `loopback-only` server sees `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`, or a non-loopback `Host` header — the motivating threat of RFC 0002 was a reverse proxy silently exposing a loopback server without auth. Warning hits stderr + audit log (`__proxy_signal_detected`) so an operator has a timestamped trail. `npx airmcp doctor` grows an `HTTP network policy` section that runs the same `resolveAllowNetwork` the server uses and surfaces the effective policy, token presence (not value), origin allow-list, plus explicit red flags for `unauthenticated` mode or `--bind-all` + `loopback-only` config conflicts. 2 new tests (resolver export surface + full four-policy roundtrip).
- **MCP App: `timeline_today`** — third interactive UI view (after `calendar_week_view` and `music_player`). Fuses today's calendar events and dueDate-carrying reminders onto a single 6am–10pm vertical axis, with an "Unscheduled" rail for items that don't fit a time slot (all-day events, reminders without a due time). First built-in App that merges two data sources in one UI. Gathers both sides via `Promise.allSettled` so a slow/failing source (e.g. Reminders permission not granted) doesn't block rendering — the other rail still shows. Registered only when `calendar` and `reminders` modules are both enabled.
- **Skill DSL runtime `inputs`** — skills exposed as tools can now declare typed runtime arguments in YAML. Inputs reach the template scope as `{{name}}` identically to prior-step results; loader rejects skills where an input name collides with a step id so resolution is always unambiguous. Converts cleanly to an MCP `inputSchema` (string/number/boolean with `description`, `default`, and `required` honoured). Existing showcase `sender-to-tasks` now accepts `{ query, mailbox, limit }` at call time instead of a hardcoded "newsletter" literal — one skill now covers newsletter triage, a specific sender, or any ad-hoc query. 8 new unit tests across loader (accept, step-id collision rejection, invalid identifier rejection), register (schema synthesis, arg forwarding, no-args fallback), executor (input seeding, input + step interaction, no-inputs equivalence).
- **`ai_plan_metrics` tool + expanded golden set** — new intelligence tool that samples N cases from `GOLDEN_PLANS`, runs each through the real on-device planner, and returns aggregate scores (parseRate, averageScore, expectedCoverageAvg, leakedForbiddenTotal) plus per-case breakdowns. Intended for users/maintainers to catch planner regressions after macOS / Apple Intelligence updates. Seedable case sampling (LCG Fisher–Yates) so before/after runs compare on identical slices. `GOLDEN_PLANS` expanded from 24 → 31 cases: 4 new `mustAvoid` negatives (read-only goals must not reach for destructive tools), 2 audit-introspection goals (`audit_log` / `audit_summary`), 1 `read_note`-by-id case. `DEFAULT_PLAN_TOOLS` grew from 12 → 29 so the tool pool covers mutation tools the negatives test against, plus the new audit + read tools. 5 new unit tests on the tool handler (bridge gate, aggregation, per-case failure tolerance, seed reproducibility).
- **Event bus: `screen_locked` / `screen_unlocked` triggers** — two new Swift `DistributedNotificationCenter` observers (`com.apple.screenIsLocked` / `com.apple.screenIsUnlocked`) surface lid-close / lock-screen state changes through the same event pipeline as calendar/focus/pasteboard. No TCC or Automation permission needed — both notifications are public. Wired end-to-end: `EventObserver.Event` enum, `AirMcpBridge` serialization, Node `AirMCPEventType` union + validator set, Skills `trigger.event` enum, `mcp-setup.ts` resource-invalidation listeners, and the `monitoring` field of `event_subscribe`. New showcase skill `evening-winddown` (drafts an on-lock "day in review" note via `parallel` reads + `retry` on `summarize_text`) demonstrates the trigger. Event-type total: 7 → 9. Built-in skills: 12 → 13.
- **Skill DSL `retry` + `retry_backoff_ms`** — per-step retry policy that runs BEFORE `on_error`. Up to `1 + retry` attempts with exponential backoff (base + ±25% jitter, capped at 60s). `isError` responses are treated as failures so both thrown errors and declared-error tool responses get the same retry treatment. Applied per-iteration inside `loop` steps so a single flaky item doesn't fail the whole batch. Two existing showcase skills now use it: `weekly-digest-note` wraps `summarize_text` (Foundation Models occasionally times out) and `sender-to-tasks` wraps `search_messages` (Mail.app sometimes returns empty results right after launch). 5 new unit tests. `retry: 0` (default) keeps existing behaviour unchanged.
- **Agent rate limit + emergency kill switch** — two-tier token-bucket caps the damage a runaway agent or buggy plan can do without user intervention. Defaults: 60 tool calls/minute (global) and 10 destructive calls/hour, overridable via `AIRMCP_MAX_TOOL_CALLS_PER_MINUTE` / `AIRMCP_MAX_DESTRUCTIVE_PER_HOUR`. Denied calls short-circuit before the handler runs and are logged to audit with `status: error`, so the deny trail stays queryable via `audit_log`. Emergency stop: creating `~/.config/airmcp/emergency-stop` blocks every destructive tool immediately (1-second probe cache, no restart needed) — a one-command panic button for live incidents. Bucket atomicity is preserved: a destructive-bucket denial does not consume a global-bucket token, so retries don't erode unrelated budgets. New `src/shared/rate-limit.ts`, integrated into `tool-registry` pre-handler gate; 7 new unit tests covering capacity, atomicity, kill-switch semantics.
- **`audit_log` / `audit_summary` tools** — consumption path for the on-device audit log. `audit_log` returns paginated JSONL entries filterable by tool name / status / time window (walks current + rotated siblings; tolerates malformed lines). `audit_summary` aggregates call count, error rate, and the busiest tools over a configurable window — useful for weekly reviews and for spotting runaway agents. Args remain PII-scrubbed at write time; both tools are read-only. New `src/audit/` module, 7 new end-to-end tests under `tests/audit-tools.test.js` covering time/tool/status filters, rotated-file walk, and malformed-line tolerance. Module count 27 → 28.
- **RFC 0002 Phase 1 — declarative HTTP `allowNetwork` policy** — network exposure is now expressed as a policy (`loopback-only` / `with-token` / `with-token+origin` / `unauthenticated`) instead of implied by CLI flags. Startup invariant check in `http-transport.ts` refuses to boot a misconfigured server (e.g. `--bind-all` without a token, or `with-token+origin` without an allow-list) so a reverse-proxy footgun can't turn a loopback server public. New `--unsafe-no-auth` flag opts into the `unauthenticated` mode explicitly and flags `.well-known/mcp.json` with `security: insecure`. `AIRMCP_ALLOW_NETWORK` env overrides the inferred policy. `.well-known/mcp.json` now exposes `network_policy` + `allowed_origins` so Managed Agents / discovery clients can reason about exposure before connecting. 12 new unit tests on `resolveAllowNetwork` / `validateNetworkPolicy`.
- **Skill DSL showcase built-ins (5)** — five new built-in skills that exercise the features added in v2.9.0 (`on_error`, `loop`, `parallel`, event triggers): `weekly-digest-note` (parallel fan-out + summarise + compose note), `focus-block-planner` (loop reminders → calendar blocks with per-iteration `on_error: continue`), `clipboard-url-to-reading` (`pasteboard_changed` trigger + defensive URL add), `favorites-digest` (photo metadata loop + terminal note), `sender-to-tasks` (mail search → reminder loop with error tolerance). Each skill is under 30 lines and README-demo-ready. Brings the built-in skill count from 7 to 12 and gives external users a concrete reference for every DSL feature.
- **outputSchema Wave 2** — 14 additional read tools now declare typed `outputSchema` with matching `structuredContent`: `read_note`, `list_folders`, `list_reminder_lists`, `read_reminder`, `list_calendars`, `read_event`, `list_messages`, `list_accounts`, `list_groups`, `list_bookmarks`, `list_reading_list`, `list_directory`, `list_playlists`, `list_tracks`. Together with Wave 1's 3 tools, this establishes 17 exact runtime contracts and makes these tools directly chainable from the skill executor without re-parsing the text block. `tests/output-schema-wave2.test.js` adds strict-parse drift guards for each new schema and `output-schema-structured.test.js` enforces fixture presence so any future tool that declares `outputSchema` without a matching fixture breaks the build.
- **Dev MCP scripts** — `npm run dev:mcp`, `dev:mcp:watch`, `dev:connect` for running the local checkout through the same `src/index.ts` entrypoint used by the CLI without hand-editing config paths.
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
