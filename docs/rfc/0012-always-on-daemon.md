# RFC 0012 — Always-on daemon mode

- **Status**: Draft
- **Author**: heznpc + Claude
- **Created**: 2026-05-11
- **Target**: v2.14.0 (Phase 1 — `launchd` LaunchAgent + scheduled skills + queued HITL) · v2.15.0 (Phase 2 — full event-driven autonomy with absence HITL)
- **Related**: [RFC 0001](0001-error-categories.md) (correlation-id threading), [RFC 0007](0007-app-intent-bridge.md) (AppIntent bridge), [RFC 0010](0010-progressive-disclosure.md) (description budget), `src/skills/` (DSL + 9 event triggers), `src/shared/audit.ts` (HMAC chain), `src/memory/store.ts` (atomic persistence), `app/Sources/AirMCPApp/`

---

## 1. Motivation — the closed-loop gap

AirMCP today is a **request/response capability layer**. Every tool call originates from an MCP client (Claude Desktop / Code / Cursor / Codex / Gemini / Air / OpenClaw / …) that the user must explicitly start. When no client is running, AirMCP isn't doing anything — `event_subscribe` triggers fire only inside an active session, and Skills with `on_schedule:` exist in the DSL but have no executor outside a client-driven invocation.

This is the **layer that OpenClaw eats**. OpenClaw's macOS Gateway runs 24/7 as a menu-bar companion, owns permissions, and exposes capabilities to the agent as a node — the same agent loop runs whether the user is at their Mac or not. AirMCP gives more *depth* (Swift bridge into EventKit / HealthKit / PhotoKit / Vision / FoundationModels — see [README "Why AirMCP"](../../README.md#why-airmcp)) but **less continuity**.

Concrete scenarios where the current model fails:

| Scenario | Current AirMCP | What we need |
|----------|----------------|--------------|
| "Every weekday at 9:00, summarize today's calendar into a Note" | Skills `on_schedule:` ignored — needs a client to fire | Daemon-side scheduler |
| "When `mail_unread > 5`, post a Slack ping" | `event_subscribe` only fires inside an active session | Daemon-side event loop |
| "Charge complete → mute Focus mode" | Same as above — battery transition events not observed when client is closed | Same |
| "User leaves home Wi-Fi → run lock-down skill" | Same | Same |
| Cross-device handoff (Mac at home triggers iPhone notification at 6PM) | Each device runs its own client; no shared agent state | Daemon as the persistent state holder |

The Skills DSL already has `inputs`, `parallel`, `loop`, `on_error`, `retry`, **9 event triggers**, and runtime arg passing. What's missing is **the host that runs them when the user isn't at the keyboard**.

## 2. Goals + non-goals

### Goals

1. **`launchd` LaunchAgent** — AirMCP runs at login, survives reboots, restarts on crash, owns macOS permissions persistently (no re-prompt on every client restart).
2. **Skill scheduler** — `on_schedule: "0 9 * * 1-5"` cron syntax fires the skill at the local-time match without a client present.
3. **Daemon-side event loop** — the existing `event_subscribe` triggers (calendar / reminders / pasteboard / mail unread / focus mode / now playing / file modified / screen locked / unlocked) fire inside the daemon and bind to skills.
4. **HITL when the user isn't there** — destructive operations triggered autonomously *queue* with a deadline + reason, surface on user return via the menu-bar app and a system notification. Operator policy chooses whether the skill blocks waiting for approval or proceeds with `requireApproval: false` annotated.
5. **Compatibility with stdio + HTTP** — the daemon publishes its tool surface over the same transports (stdio for client connect, HTTP for browser/remote). Daemon mode is a **third mode**, not a replacement.
6. **Single source of state** — the memory store + audit log are the daemon's persistence. Clients reconnecting see continuity (`memory://recent` resource shows what fired while they were away).
7. **Sandbox compatibility** — the daemon is the existing notarized menu-bar app's lifecycle, not a separate process. No new entitlements beyond what the menu-bar app already declares.

### Non-goals

- **Replacing the MCP client** — the daemon doesn't run an LLM. It runs *deterministic skills*. Conversational agent loops still go through Claude / Codex / Gemini / Air / OpenClaw.
- **Embedded LLM** — no on-device model invocation outside the existing `intelligence` module's FoundationModels calls. (Phase 3 may revisit if Apple opens new on-device APIs at WWDC.)
- **Multi-user / multi-tenant** — the daemon runs per-macOS-user (LaunchAgent, not LaunchDaemon). Shared-Mac multi-tenant is RFC-deferred.
- **iOS daemon** — out of scope. iOS background execution is fundamentally different (BGTaskScheduler, BackgroundTasks framework). Tracked separately under RFC 0007 Phase B if warranted.
- **Chat UI** — the menu-bar app does not gain a chat surface. Conversation lives in the user's preferred MCP client.

## 3. Architecture

### 3.1 Where the daemon lives

**Inside the existing menu-bar app's process** (`app/Sources/AirMCPApp/`). Not a separate `airmcpd` binary.

Reasons:

- The menu-bar app already runs on login (LaunchAgent via Apple's standard `LSUIElement = true` pattern), already owns macOS permissions, and is already notarized + Gatekeeper-green.
- Splitting into a separate daemon would require **two notarization flows** and **duplicated permission requests** (the daemon would be a separate Code-signed entity from the user's view).
- The menu-bar app already starts the MCP server in-process; the daemon is *the same in-process server* with its lifecycle decoupled from any MCP client connection.

### 3.2 Lifecycle

```
[macOS login]
    ↓
[LSUIElement menu-bar app launches]
    ↓
[App.swift] — boots the in-process MCP server
    ↓
[NEW: SkillScheduler + EventLoop start]
    ↓
[Periodic: cron tick checks scheduled skills]
[Async: event-source subscribe (calendar / battery / mail / …)]
    ↓
[Either fires → SkillExecutor.run(skill, context)]
    ↓
[ToolRegistry handles the tool calls — same path as a client-driven call]
    ↓
[HITL if destructive: enqueue → menu-bar notifies → user approves/rejects]
    ↓
[Memory + audit log persist results]
    ↓
[On client connect later: client sees fresh memory + audit history]
```

### 3.3 Skill scheduler

Skills DSL already supports `on_schedule:` as a metadata field but it has no executor. Phase 1 adds:

```yaml
# ~/.config/airmcp/skills/morning-brief.yaml
name: morning-brief
expose_as: tool
on_schedule: "0 9 * * 1-5"   # weekdays 9:00 local time
inputs:
  date: { type: string, default: today }
steps:
  - id: events
    tool: today_events
  - id: reminders
    tool: list_reminders
    args: { dueOn: today }
  - id: brief
    tool: create_note
    args:
      title: "Morning brief — ${date}"
      body: "${events.events.length} events / ${reminders.total} due tasks"
```

Implementation:

- `SkillScheduler` class instantiated at server boot (only when running inside the menu-bar app — detected via existence of `process.env.AIRMCP_DAEMON_MODE === "true"`).
- Walks the skill registry, collects every skill with `on_schedule:`, parses cron expressions via a tiny dependency-free parser (`scripts/lib/cron.mjs`).
- Single `setInterval(60_000)` tick — every minute, evaluate which skills are due and dispatch.
- Per-skill last-fire timestamp persisted in `~/.config/airmcp/scheduler-state.json` (atomic-write, same pattern as `MemoryStore`) so a restart doesn't double-fire or skip.

### 3.4 Daemon-side event loop

Existing `event_subscribe` infrastructure (RFC-undocumented but in `src/cross/triggers.ts`) registers EventEmitter listeners on:

1. `calendar.event_starts_in_5min`
2. `calendar.event_added`
3. `reminders.due_now`
4. `pasteboard.changed`
5. `mail.unread_increased` (>= threshold)
6. `system.focus_mode_changed`
7. `system.now_playing_changed`
8. `finder.file_modified` (watched dirs)
9. `system.screen_locked` / `screen_unlocked`

In daemon mode, these listeners fire continuously. Phase 1 wires a new `on_event:` skill metadata field:

```yaml
on_event:
  - source: mail.unread_increased
    threshold: 10
```

When the event fires, `SkillExecutor` runs the matched skill with the event payload as `inputs`.

### 3.5 HITL when the user is absent

This is the hardest design problem. Current HITL pipes through MCP elicitation or Unix socket — both assume an active user.

**Proposal**: a destructive operation invoked by an autonomous skill takes one of three paths based on a per-skill annotation:

```yaml
on_schedule: "0 18 * * *"
hitl_policy:
  destructive_on_absence: queue   # queue | proceed | abort (default: queue)
  queue_ttl: 4h
  on_user_return: notify
```

| Mode | Behavior | Use case |
|------|----------|----------|
| `queue` | Destructive call buffers in `~/.config/airmcp/hitl-queue.jsonl`. Menu-bar shows badge. User clicks → reviews → approves/rejects each. After `queue_ttl`, skill marks the action `expired` and continues with `failed` state. | Default; safest. |
| `proceed` | Action fires immediately, `hitl_bypass: true` recorded in audit. Requires `AIRMCP_AUTONOMOUS_DESTRUCTIVE=true` env opt-in. | Trusted automation (e.g. "delete temp files older than 30d"). |
| `abort` | Skill fails on the destructive step with `permission_denied` category if user not present. | Conservative. |

**User-presence detection**: macOS `IOKit.IOHIDIdleTime` — if idle > 60s the user is "absent" for HITL purposes. The threshold is configurable.

**Notification on return**: `screen_unlocked` event triggers a flush of the queue with a single notification "AirMCP has 3 pending actions waiting for review."

### 3.6 State persistence

Already in place; no schema change:

- **`MemoryStore`** (PR #154) — atomic write + serialized op queue + proto-pollution guard. Daemon writes to it; clients on reconnect read it. Memory entries from autonomous skills get a `source: "skill:<name>"` tag so a client can distinguish.
- **`audit_log`** (PR #152) — HMAC-chained. Every daemon-fired tool call adds an audit entry with `correlationId` (RFC 0001 PR #190) and a new `actor: "daemon-skill:<name>"` field. Verification (`audit_summary` + `--deep`) catches tampering across all tool sources.
- **NEW** — `scheduler-state.json` (last-fire timestamps per skill).
- **NEW** — `hitl-queue.jsonl` (pending destructive actions awaiting user approval).

### 3.7 Sandbox + permission model

The menu-bar app is already sandboxed with the entitlements it needs (Calendar, Reminders, Photos, Health, etc.). Daemon mode does not change the entitlement set.

**Impact**:

- Skills running in daemon mode hit the same TCC prompts the menu-bar app already requested at first run. No re-prompts.
- File-system access is sandboxed to `~/.config/airmcp/`, `~/.airmcp/`, and the user-selected paths via `NSDocument` open dialogs.
- HTTP transport (`--http` flag) still requires `AIRMCP_HTTP_TOKEN` and the existing `allowNetwork` policy. No change.
- One new entitlement consideration: **`com.apple.developer.endpoint-security.client`** is NOT requested. If a future skill wants e.g. process-creation events, that's RFC-future-work.

### 3.8 Coexistence with stdio / HTTP transports

Daemon mode adds a third transport: **internal scheduler/event loop**. Stdio + HTTP transports keep working unchanged. A user running Claude Desktop while the daemon runs in the background:

- Claude Desktop connects via stdio → uses the same `ToolRegistry` instance.
- Daemon-fired skills also use the same `ToolRegistry`.
- Both paths share the rate-limit (60/min, 10 destructive/hr) — autonomous calls and user-driven calls compete for budget. Configurable via `AIRMCP_DAEMON_RATE_BUDGET_PCT` (default: 50% reserved for daemon).
- Both share the audit log; correlation-id distinguishes per-call origin.

## 4. Phasing

### Phase 1 — v2.14.0 (target: 4-6 weeks of work, but agent-augmented likely 1-2 weeks calendar)

- `launchd` LaunchAgent plist generation + install on first menu-bar launch
- `SkillScheduler` + cron parser
- `on_event:` daemon-side wiring
- `hitl-queue.jsonl` + queue UI in menu-bar app
- `IOHIDIdleTime` user-presence check
- `AIRMCP_DAEMON_MODE` env detection
- `scheduler-state.json` persistence
- New env knobs: `AIRMCP_DAEMON_RATE_BUDGET_PCT`, `AIRMCP_AUTONOMOUS_DESTRUCTIVE`, `AIRMCP_HITL_QUEUE_TTL`
- `airmcp doctor --deep` extended to verify daemon health (LaunchAgent loaded, skill scheduler running, queue depth)
- `audit_log` `actor` field + correlationId on every daemon-fired call
- 3-5 example skills shipping in `dist/skills/builtins/`: morning-brief, charge-complete-focus, mail-unread-ping
- Tests: scheduler tick determinism, queue persistence across restart, HITL flush on screen-unlock, rate budget enforcement

### Phase 2 — v2.15.0

- **Smarter HITL**: per-tool default policy (e.g. `delete_*` always queue, `set_volume` never queue), per-skill override
- **Cross-device hints**: daemon emits machine-readable events to a sibling iOS app via Continuity (RFC 0007 Phase B intersection)
- **Skill marketplace** stub: `~/.config/airmcp/skills/<author>/<name>/` directory layout + `airmcp skill install <url>` CLI (no central registry yet — just local file install)
- **Better scheduler observability**: `airmcp scheduler list` / `airmcp scheduler logs <skill>` CLI
- **Audit retention policy** for daemon-driven entries (separate retention from user-driven, configurable)

### Phase 3 — depends on WWDC 2026 (RFC 0011)

- If Apple ships system MCP API — daemon may need to coexist with it; potentially become a "skill source" that the system MCP host consumes. Tracked under RFC 0011 follow-up.
- If Apple ships Siri AI extension routing — daemon-fired skills may surface as Siri suggestions ("AirMCP did this for you while you were away — want to undo?").

## 5. Open questions

1. **Should daemon mode be off by default?** Two camps:
   - *On*: matches OpenClaw/Mac Mini 24/7 pitch out of the box.
   - *Off*: surprise factor — users who installed AirMCP for client-driven use don't expect autonomous fires. **Lean: off, with a one-click enable in the menu-bar app + `airmcp daemon enable` CLI**.
2. **Cron expression syntax** — strictly POSIX (5 fields), or extended (7 fields with seconds + year)? **Lean: POSIX 5-field, the additional precision is rarely worth the complexity.**
3. **Skill compilation cache** — re-parse YAML every tick or compile once at boot? **Lean: compile once, invalidate on file change via `fs.watch` on the skills dir.**
4. **`hitl-queue.jsonl` rotation** — when does it grow unbounded? Define a hard cap (10K entries) + audit-log spillover for older.
5. **Failure escalation** — if a scheduled skill fails 3 consecutive times, do we auto-disable it? Auto-page the user? Just log? **Lean: log + menu-bar amber dot, no auto-disable. User reviews via `audit_summary`.**
6. **Skill dependency graph** — can skill A `on_schedule` depend on skill B's last result? Phase 2 question.
7. **Race on cold-launch** — daemon starts at user login; some events (like `screen_locked` immediately after) might fire before the skill registry is fully loaded. Define a startup-grace window (e.g. 5s) where events are buffered.
8. **Memory store growth** — daemon writes more than client-driven mode. Existing `memory_forget` heuristics may need re-tuning. Phase 2 measures actual growth before deciding.

## 6. Comparison to OpenClaw

OpenClaw's Gateway architecture solves a similar problem with a different trade-off:

| Property | OpenClaw Gateway | AirMCP daemon (this RFC) |
|----------|------------------|--------------------------|
| Process | Separate daemon binary | In-process with menu-bar app |
| Skill format | Markdown + executable scripts (5,400+ marketplace) | YAML DSL with declared steps (14 built-ins, file-install user skills) |
| Permissions | Sudo-elevated install via Homebrew per skill | macOS sandbox + entitlements declared once |
| Cross-device | iMessage bridge (macOS-only) | Stdio/HTTP transports + sibling iOS AppIntents |
| Trust model | Permissive — runs as user, sudo when skills demand | Conservative — sandboxed, HITL queue for absent-user destructive |
| Setup | Mac Mini 24/7 host blueprint | Any Mac — daemon piggybacks on existing app lifecycle |

This RFC is **not OpenClaw parity** — different layers, different trade-offs. AirMCP keeps the **capability-layer + safety-first** identity. Daemon mode adds the *continuity* OpenClaw users get, without abandoning the sandbox or HITL primitives.

## 7. Migration / rollout

- v2.14.0 ships daemon mode **off by default**. Existing users see no change unless they opt in.
- Menu-bar app gains a "Daemon" pane: enable toggle, list of scheduled skills, HITL queue, last-fire log.
- `airmcp init --daemon` flag in the wizard offers to enable on first run for new users who explicitly opt in.
- README "Why AirMCP" gains a "Daemon mode (optional)" subsection alongside the existing client-driven flow.
- A tutorial doc (`docs/daemon-mode.md`) ships with the example skills + walkthrough.
- Telemetry: zero new collection; existing audit log is the source of truth.

## 8. Decision

**Accept this RFC** as a Phase 1 design contract before implementation begins.

Implementation PRs will reference this RFC and update Status: Draft → Accepted on the first implementation PR merge, → Implemented on Phase 1 close.
