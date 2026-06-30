# AirMCP Environment Variables

All AirMCP environment variables share the `AIRMCP_` prefix. The vast majority are **optional**; the common case is to set none of them and rely on defaults. This page indexes every knob with its default + common use case so operators don't have to grep the source.

If a variable accepts a path, `~` expands to `$HOME`. Booleans are `"true"` / `"false"` strings, never `0`/`1`.

---

## Quickstart

| You want… | Set |
|---|---|
| Bind HTTP server to all interfaces with token auth | `AIRMCP_ALLOW_NETWORK=with-token` + `AIRMCP_HTTP_TOKEN=…` |
| Bind HTTP server with OAuth 2.1 | `AIRMCP_ALLOW_NETWORK=with-oauth` + `AIRMCP_OAUTH_ISSUER=…` + `AIRMCP_OAUTH_AUDIENCE=…` |
| Disable a flaky module without removing config | `AIRMCP_DEBUG_MODULES=notes,calendar` (whitelist) |
| Use only selected module packs | `AIRMCP_MODULE_PACKS=core,productivity` |
| Stage physical add-on package artifacts | `npm run addons:build` |
| Send all 294 tools without compactDescription | `AIRMCP_COMPACT_TOOLS=false` + `AIRMCP_TOOL_EXPOSURE=full` |
| Require sessions before hidden tools can run | `AIRMCP_REQUIRE_TOOL_SESSION=true` |
| Inspect or edit module add-ons | `npx airmcp modules` |
| Increase audit-log signing strength for cross-host integrity | `AIRMCP_AUDIT_HMAC_KEY=<32+ random bytes>` |
| Block every destructive tool on a panic | `touch ~/.config/airmcp/emergency-stop` |

---

## Network & Auth (RFC 0002 / 0005)

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_ALLOW_NETWORK` | `loopback-only` | Inbound HTTP exposure policy. One of `loopback-only` / `with-token` / `with-token+origin` / `with-oauth` / `with-oauth+origin` / `unauthenticated`. Startup invariant refuses to boot a misconfigured server. Not an outbound egress allow-list. |
| `AIRMCP_ALLOWED_ORIGINS` | (empty) | Comma-separated list. Required when `ALLOW_NETWORK` ends in `+origin`. |
| `AIRMCP_HTTP_TOKEN` | (empty) | Bearer token. Required when `ALLOW_NETWORK=with-token*`. |
| `AIRMCP_HTTP_PORT` | `3847` | TCP port for the HTTP transport. |
| `AIRMCP_OAUTH_ISSUER` | (empty) | https:// origin of the authorization server. Required when `ALLOW_NETWORK=with-oauth*`. |
| `AIRMCP_OAUTH_AUDIENCE` | (empty) | RFC 8707 resource indicator (the `aud` claim a valid token must carry). Required when `ALLOW_NETWORK=with-oauth*`. |
| `AIRMCP_OAUTH_RESOURCE_DOCS` | (empty) | Optional URL. Surfaces in `/.well-known/oauth-protected-resource` per RFC 9728. |
| `AIRMCP_OAUTH_RESOURCE_POLICY` | (empty) | Optional privacy-policy URL for the same discovery card. |
| `AIRMCP_OAUTH_RESOURCE_TOS` | (empty) | Optional ToS URL for the same discovery card. |
| `AIRMCP_MAX_SESSIONS` | `50` | Max concurrent HTTP sessions. |
| `AIRMCP_SESSION_IDLE_TTL` | `300000` (5 min) | Idle-session evict timeout in ms. |

---

## Rate limit (PR #159 / #162)

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_RATE_LIMIT` | (enabled) | `false` disables every bucket. Both tool gate and HTTP IP gate honor it. |
| `AIRMCP_MAX_TOOL_CALLS_PER_MINUTE` | `60` | Per-tenant global bucket. |
| `AIRMCP_MAX_DESTRUCTIVE_PER_HOUR` | `10` | Per-tenant destructive bucket. |
| `AIRMCP_RATE_LIMIT_TENANT_CAP` | `256` | Max distinct OAuth `sub` values tracked. LRU-evicted past the cap. |
| `AIRMCP_HTTP_MAX_REQUESTS_PER_MINUTE` | `120` | HTTP per-IP cap. |
| `AIRMCP_HTTP_RATE_IP_CAP` | `10000` | Max distinct IPs tracked. FIFO-evicted past the cap. |
| `AIRMCP_EMERGENCY_STOP_PATH` | `~/.config/airmcp/emergency-stop` | Touch this file to block every destructive tool until the file is removed. 1s probe cache; no restart needed. |

---

## Audit log (PR #152)

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_AUDIT_LOG` | (enabled) | `false` skips audit emission entirely. |
| `AIRMCP_AUDIT_FLUSH_INTERVAL` | `30000` (30s) | ms between buffer flushes. |
| `AIRMCP_AUDIT_HMAC_KEY` | host-derived | Operator-provided key enables cross-host integrity verification (move `audit.jsonl` to a different machine + verify with the same key). The host-derived fallback is tamper-detection grade only. |

---

## HITL / Elicitation (RFC 0008)

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_HITL_LEVEL` | `sensitive-only` | One of `off` / `destructive-only` / `sensitive-only` / `all-writes` / `all`. Picks which tools require approval. |
| `AIRMCP_ELICITATION_DISABLE` | (off) | `true` skips MCP elicitation prompts and falls through to socket HITL. Useful for fully-scripted destructive pipelines. |
| `AIRMCP_MANAGED_CLIENTS` | (empty) | Comma-separated client names. Suppresses elicitation when these clients connect (they have their own approval UI). All Claude products are auto-detected via the `claude` prefix. |
| `AIRMCP_SHARE_APPROVAL` | (off) | Per-tool share-guard approval flag. |
| `AIRMCP_ALLOW_SEND_MAIL` | (off) | Gates `send_mail`. |
| `AIRMCP_ALLOW_SEND_MESSAGES` | (off) | Gates `send_message`. |
| `AIRMCP_ALLOW_RUN_JAVASCRIPT` | (off) | Gates the JXA `eval` surface. |

---

## Module control

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_FULL` | (off) | `true` enables every standard module ignoring the config's `disabledModules`. Profile-only modules stay opt-in. |
| `AIRMCP_PROFILE` | `starter` | Runtime profile: `starter`, `communications-safe`, `productivity`, or `full`. May also include opt-in modules such as `spatial_prep`. |
| `AIRMCP_TOOL_EXPOSURE` | profile-dependent | `progressive` exposes the front door, `profile` exposes the selected profile, `full` exposes every loaded tool. |
| `AIRMCP_MODULE_PACKS` | all packs | Comma-separated DLC-like pack allow-list. `core` is always kept. Examples: `core-only`, `core,communications`, `core,productivity,spatial`, or `all`. Modules whose profile is enabled but pack is unavailable are reported through `profile_status.modulesMissingPacks`. |
| `AIRMCP_ADDON_PACKAGE_MODE` | `prefer-installed` | Module import mode. `prefer-installed` tries installed physical add-on packages such as `@heznpc/airmcp-productivity` before bundled fallback; `bundled` skips external packages; `external-only` refuses missing add-ons outside `core`. |
| `AIRMCP_REQUIRE_TOOL_SESSION` | (off unless app/CLI config sets it) | `true` makes `run_tool` require a valid `sessionId` before dispatching hidden tools. Directly exposed tools remain callable without a session. New app/CLI-generated configs set `requireToolSession: true`; no-config direct stdio keeps the compatible default. |
| `AIRMCP_HARNESS_ADAPTER` | inferred | Task harness policy: `compatible`, `strict`, `app-runtime`, or `agent`. App-owned HTTP runtime is inferred from `AIRMCP_APP_OWNED_RUNTIME`; config-driven strict sessions infer `strict`. |
| `AIRMCP_TOOL_SESSION_MAX_TOOLS` | `64` | Maximum tools allowed in one task-scoped session. Capped at 64. |
| `AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS` | `900` | Default task session lifetime. |
| `AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS` | `3600` | Maximum task session lifetime. Capped at 3600. |
| `AIRMCP_ENABLE_SPATIAL_PREP` | (off) | `true` enables the experimental read-only spatial asset prep tools. |
| `AIRMCP_DEBUG_MODULES` | (empty) | Comma-separated whitelist. When set, only listed modules load — easier debugging of import / boot issues. |
| `AIRMCP_DEBUG_SEQUENTIAL` | (off) | `true` loads modules one-by-one instead of `Promise.all()`. Memory-safe debugging. |
| `AIRMCP_DISABLE_POLLERS` | (off) | `true` suppresses event poller registration (mail unread, focus mode, etc.). |
| `AIRMCP_INCLUDE_SHARED` | (off) | `true` opts notes / reminders into shared (iCloud-shared) item access. |
| `AIRMCP_PROACTIVE_CONTEXT` | (off) | Toggles the proactive context module. |
| `AIRMCP_SEMANTIC_SEARCH` | (off) | Toggles the semantic search index + tools. |
| `AIRMCP_FAKE_OS_VERSION` | (empty) | Override the detected macOS version in tests. |
| `AIRMCP_TEST_MODE` | (off) | `1` enables test-only reset hooks (e.g. `_resetForTests`). |

---

## Embedding / AI

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_LOCAL_ONLY` | (off) | `true` / `1` disables every cloud embedding path. `detectProvider` returns `swift` or `none` only, the hybrid Swift→Gemini fallback is refused (Swift error surfaces to the caller instead of silent re-try), and `AIRMCP_EMBEDDING_PROVIDER=gemini`/`hybrid` is overridden with a stderr warning. Set this when you want a hard privacy contract — note titles + previews stay on-device. |
| `AIRMCP_EMBEDDING_PROVIDER` | (auto-detect) | Explicit override. One of `gemini` / `swift` / `hybrid` / `none`. Auto-detect picks `hybrid` if both `GEMINI_API_KEY` and the Swift bridge are available, else the highest-priority single backend. Rejected with warning under `AIRMCP_LOCAL_ONLY=true`. |
| `AIRMCP_EMBEDDING_MODEL` | `gemini-embedding-2` | Override for the Gemini provider. |
| `AIRMCP_EMBEDDING_DIM` | `256` | Output dim (256/512/1024/2048/3072). 256 is optimal for tool/note search. |
| `AIRMCP_EMBED_CACHE_MAX_MB` | `256` | LRU embedding cache cap in megabytes. |
| `AIRMCP_GEMINI_API_URL` | (default endpoint) | Override the Gemini base URL. |
| `AIRMCP_INDEX_COOLDOWN` | `300000` (5 min) | Backoff after an indexing failure before retry. |

> When `hybrid` mode falls back from Swift to Gemini, AirMCP writes an `__embedding_fallback` line to the audit log with the original Swift error reason. `audit_summary` surfaces every cloud crossing so the trail is visible even when `AIRMCP_LOCAL_ONLY` is off.

---

## Telemetry / Observability

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_TELEMETRY` | (off) | `true` enables OpenTelemetry trace emission via the optional `@opentelemetry/api` peer dep. |
| `AIRMCP_USAGE_TRACKING` | (enabled) | `false` disables the in-process usage tracker (next-tool suggestions). |
| `AIRMCP_USAGE_PROFILE_PATH` | `~/.airmcp/profile.json` | Override path. Primarily used by tests to isolate state. |
| `AIRMCP_TOKEN_RATIO` | `4` | Char-per-token ratio for `npm run tokens` (override for sensitivity testing). |

---

## Timeouts & Buffers

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_TIMEOUT_JXA` | `30000` | JXA `osascript` timeout (ms). |
| `AIRMCP_TIMEOUT_SWIFT` | `60000` | Swift bridge call timeout (ms). |
| `AIRMCP_TIMEOUT_GEOCODE` | `10000` | Geocoding API timeout (ms). |
| `AIRMCP_TIMEOUT_GWS` | `15000` | Google Workspace CLI default timeout (ms). |
| `AIRMCP_BUFFER_JXA` | `10485760` (10 MB) | JXA stdout cap. |
| `AIRMCP_BUFFER_SWIFT` | `10485760` (10 MB) | Swift stdout cap. |
| `AIRMCP_BUFFER_SWIFT_LINE` | `1048576` (1 MB) | Single Swift NDJSON line cap. |
| `AIRMCP_JXA_CONCURRENCY` | `3` | Max parallel `osascript` processes. |
| `AIRMCP_CB_THRESHOLD` | `3` | Circuit breaker open threshold. |
| `AIRMCP_CB_OPEN_MS` | `60000` | Circuit breaker open duration (ms). |

---

## Triggers (RFC 0008-related)

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_TRIGGER_MAX_RETRIES` | `5` | Max retry attempts for a failing trigger. |
| `AIRMCP_TRIGGER_BASE_BACKOFF_MS` | `1000` | Initial backoff between retries. |
| `AIRMCP_TRIGGER_MAX_BACKOFF_MS` | `60000` | Cap on exponential backoff. |
| `AIRMCP_MAIL_POLL_MS` | `30000` | Mail unread-count poll interval. |
| `AIRMCP_MUSIC_POLL_MS` | `5000` | Music now-playing poll interval. |

---

## Tooling / scripts

| Variable | Default | Notes |
|---|---|---|
| `AIRMCP_CONFIG_PATH` | `~/.config/airmcp/config.json` | Override config-file path. |
| `AIRMCP_TEMP_DIR` | `os.tmpdir()` | Temp directory for screenshots / recordings / intermediate exports. |
| `AIRMCP_USER_AGENT` | `AirMCP/2.x (https://github.com/heznpc/AirMCP)` | User-Agent for outbound HTTP. |
| `AIRMCP_COMPACT_TOOLS` | (enabled) | `false` ships full descriptions in `tools/list` (skips `compactDescription`). Roughly doubles the description token budget. |
| `AIRMCP_EXT_APPS_CDN` | (default URL) | CDN for the MCP Apps client library. |
| `AIRMCP_INTENTS_OUT` | (repo path) | Override output path for `gen-swift-intents.mjs`. |
| `AIRMCP_INTENTS_MANIFEST` | (repo path) | Manifest path consumed by the intents codegen. |
| `AIRMCP_MANIFEST_OUT` | `docs/tool-manifest.json` | Override output path for `dump-tool-manifest.mjs`. |
| `AIRMCP_APPINTENTS_DESTRUCTIVE` | (off) | Opt-in flag for destructive App Intents (RFC 0007 §A.3). |
| `AIRMCP_GEOCODING_API_URL` | Open-Meteo | Override the geocoding endpoint. |
| `AIRMCP_REVERSE_GEOCODE_API_URL` | Nominatim | Override the reverse geocoding endpoint. |
| `AIRMCP_WEATHER_API_URL` | Open-Meteo | Override the forecast endpoint. |

---

## Internal / test-only

These are documented for completeness; you should rarely set them in production.

| Variable | Notes |
|---|---|
| `NODE_ENV=test` | Unlocks test-only reset hooks. |
| `AIRMCP_TEST_MODE=1` | Same as above for callers without control over `NODE_ENV`. |
| `AIRMCP_DISABLE_*` | Module-level kill switches surfaced via `npx airmcp --help` and validated against known module names. |

---

## Task-scoped tool sessions

AirMCP's profile/exposure settings control what loads and what appears in `tools/list`. For a single agent task, clients can narrow further with the MCP tools `start_tool_session`, `discover_tools`, `describe_tool`, `run_tool`, `tool_session_status`, and `end_tool_session`:

1. `start_tool_session({ tools: ["search_notes", "read_note"], ttlSeconds: 900 })`
2. `discover_tools({ query: "notes", sessionId })` only searches that allowlist.
3. `run_tool({ name: "read_note", args: {...}, sessionId })` refuses tools outside the allowlist.

This is a cooperative harness contract for MCP clients and higher-level agent runners. By default it preserves the compatible no-session path for hidden tools. Set `AIRMCP_REQUIRE_TOOL_SESSION=true` or `AIRMCP_HARNESS_ADAPTER=strict` when the client or harness is ready for strict task scoping: hidden tools still appear through compact `discover_tools` results, `describe_tool` fetches the full description for one selected tool, and `run_tool` refuses to dispatch hidden tools unless the caller passes a valid `sessionId`. Directly exposed tools remain callable without a session.

It does not replace OS permissions, HITL approval, OAuth scopes, rate limits, or the emergency stop; those gates still run inside the target tool call.

---

## Module packs

AirMCP module packs are the runtime contract for DLC-like installation. `npx airmcp modules` and `AIRMCP_MODULE_PACKS` let operators activate only selected packs today. `npm run addons:build` stages physical npm package directories under `build/addons`, and the runtime tries installed add-on packages first in `prefer-installed` mode before falling back to bundled modules. Add-on package names intentionally omit the word "pack": for example `@heznpc/airmcp-productivity`, `@heznpc/airmcp-communications`, and `@heznpc/airmcp-spatial`.

Built-in packs:

- `core`: notes, reminders, calendar, shortcuts, system, Finder, weather, audit visibility
- `communications`: contacts, mail, messages
- `productivity`: Pages, Numbers, Keynote
- `browser`: Safari
- `media`: Music, TV, Podcasts, speech
- `visual`: Photos, screen, UI automation
- `location`: Maps, current location
- `device`: Bluetooth, Health
- `intelligence`: Apple Intelligence, memory
- `google-workspace`: Google Workspace
- `spatial`: experimental spatial prep

Use `npx airmcp modules list` locally or `list_module_packs` over MCP to inspect the active pack set and add-on package names. Use `npx airmcp modules enable productivity,communications` to write a narrow `modulePacks` config. `profile_status` also reports `modulePacksConfigured`, `modulePacksAvailable`, and `modulesMissingPacks` so a client can tell whether a module is disabled by profile/config or unavailable because its pack is not active.

---

## Where to look in source

- Defaults + parsers: [`src/shared/constants.ts`](../src/shared/constants.ts)
- Config schema: [`src/shared/config.ts`](../src/shared/config.ts)
- Tool sessions: [`src/shared/tool-sessions.ts`](../src/shared/tool-sessions.ts) + front-door registration in [`src/server/mcp-setup.ts`](../src/server/mcp-setup.ts)
- Network policy: [`src/server/http-transport.ts`](../src/server/http-transport.ts) + RFC 0002
- Rate limit: [`src/shared/rate-limit.ts`](../src/shared/rate-limit.ts)
- Audit: [`src/shared/audit.ts`](../src/shared/audit.ts)
- HITL: [`src/shared/hitl-guard.ts`](../src/shared/hitl-guard.ts) + RFC 0008
