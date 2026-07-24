<p align="center">
  <img src="icons/airmcp-icon-256.png" alt="AirMCP" width="128">
</p>

# AirMCP

[![npm version](https://img.shields.io/npm/v/airmcp)](https://www.npmjs.com/package/airmcp)
[![Tests](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/heznpc/AirMCP)](https://github.com/heznpc/AirMCP/stargazers)

**Governed MCP runtime for the Apple ecosystem.** AirMCP lets Claude, Codex,
Cursor, Raycast, Xcode agents, and other MCP clients work across Notes, Mail,
Calendar, Reminders, Finder, Safari, Shortcuts, and the rest of your Apple
workspace. The macOS runtime is available today; the iOS runtime is in preview.

AirMCP is the connector and control layer, not another agent. It mediates Apple
workspace actions through profiles, progressive exposure, per-call human
approval, HMAC-chained audit logs, rate limits, OAuth scopes, and local controls.

> Multi-language project page: [heznpc.github.io/AirMCP](https://heznpc.github.io/AirMCP/)

## What You Get

- **Apple workspace tools** for Notes, Reminders, Calendar, Contacts, Mail,
  Messages, Music, Finder, Safari, Photos, Shortcuts, system control, screen
  capture, Weather, Maps, Location, Bluetooth, and more.
- **Google Workspace tools** for Gmail, Drive, Sheets, Calendar, Docs, Tasks,
  People, and raw `gws` CLI access.
- **Profiles and progressive exposure** so clients start with a small front
  door instead of every loaded tool.
- **Skills DSL workflows** with `parallel`, `loop`, `retry`, `on_error`, runtime
  inputs, and event triggers.
- **App Intent action bridge** generated from the MCP manifest for macOS
  Shortcuts, with an iOS-only App Shortcuts provider and destructive intents gated separately.
- **Native Swift bridge** for EventKit, PhotoKit, HealthKit, Vision, on-device
  semantic search, and FoundationModels preview builds. AirMCP.app embeds the
  normal bridge; it is optional for npm and MCPB users, who can build it
  separately when needed.
- **Dual transport**: stdio for standard MCP clients, HTTP/SSE for shared
  local runtimes, browser clients, registries, and always-on hosts.

## Apple Platform Direction

AirMCP is one governed action layer with platform-specific roles, rather than a
copy of the full Mac runtime on every device.

| Platform | Status | Role |
| --- | --- | --- |
| macOS | Available | Full local MCP runtime and broad Apple app and system integration. |
| iOS / iPadOS | Preview | Native Calendar, Reminders, Contacts, Health, and Location actions, plus in-process AppIntents. |
| visionOS | Roadmap | Spatial interaction and native actions, with Mac routing for Mac-only automation. |
| watchOS | Roadmap | Commands, notifications, and per-call approval through a paired iPhone runtime. |

The shared Swift and AppIntents layers are the portability boundary. Platform
sandboxing and lifecycle rules still determine which actions run locally and
which route to a paired Mac or iPhone.

## Quick Start

### Claude Desktop one-click

1. Download `airmcp-<version>.mcpb` from
   [Releases](https://github.com/heznpc/AirMCP/releases).
2. Drag it onto Claude Desktop, or use **Settings -> Extensions -> Install from
   file...**.
3. Choose modules in the install form and finish setup.

Full guide: [docs/mcpb.md](docs/mcpb.md).

### CLI wizard

Install Node.js 20+, then run:

```bash
npx airmcp init
```

The wizard selects a profile and stores preferences in
`~/.config/airmcp/config.json`. Client registration is a separate consent
step whose default is **No**; no Claude, Codex, Cursor, or Windsurf setting is
read or changed until you opt in.

For Codex, Claude Code, Cursor, Windsurf, and other stdio clients, use the
direct runtime unless the matching GitHub Release includes a signed
`AirMCP-<version>.zip`:

```bash
npx airmcp init --no-clients
npx airmcp connect-clients --client-runtime direct --dry-run
npx airmcp connect-clients --client-runtime direct
```

The app-owned runtime is available only after installing that signed app ZIP
and explicitly choosing **Start Local Runtime**. Do not configure a client to
wait for AirMCP.app when the release does not include the app asset.

Non-interactive examples:

```bash
npx airmcp init --profile starter --yes
npx airmcp init --profile communications-safe --yes
npx airmcp init --profile productivity --yes
npx airmcp init --profile productivity --yes --connect-clients
npx airmcp init --profile productivity --yes --connect-clients --client-runtime direct
```

Check the install:

```bash
npx airmcp doctor
```

## Common Workflows

Once connected, ask your MCP client in natural language:

- "Tell me today's calendar events and overdue reminders. Do not change
  anything."
- "Brief me on today's calendar, overdue reminders, unread mail, and recent
  notes."
- "Turn today's meetings into a prep checklist."
- "Draft replies for urgent mail, but ask before sending anything."
- "For my next meeting, find related notes, contacts, files, and reminders."
- "Search my Safari tabs for that article and save the summary to Notes."
- "Run my Morning Routine shortcut."
- "Take a screenshot and save it to my Desktop."

More workflow examples live in [docs/workflows.md](docs/workflows.md).

## Runtime Model

AirMCP is designed to keep a large local capability surface usable without
dumping the full catalog into every client context.

The complete generated catalog currently contains 297 tools across 32 modules.
Profiles and progressive exposure keep clients from loading it all at once.

- **Profiles**: `starter`, `communications-safe`, `productivity`, `full`, or
  `custom`.
- **Tool exposure**: `progressive`, `profile`, or `full`.
- **Module packs**: enable only the packs you want with `npx airmcp modules` or
  `AIRMCP_MODULE_PACKS=core,productivity`.
- **Task sessions**: `start_tool_session`, `discover_tools`, and `run_tool`
  allow a broad runtime to behave like a narrow task-specific toolbelt.
- **Opt-in network modules**: `webhooks` and `powerautomate` stay off in every
  profile until explicitly enabled.

Useful commands:

```bash
npx airmcp modules
npx airmcp modules enable productivity --install
npx airmcp --full
npx airmcp workflows
npx airmcp workflows --readiness
npx airmcp workflows today-overview --prompt
```

`today-overview` is the starter-safe first workflow: it reads only Calendar
and Reminders and never writes data. Paste the printed prompt into a connected
MCP client for a governed first run with client authorization and AirMCP audit
coverage.

`workflows <id> --preview` is a separate local diagnostic. It reads Apple apps
directly, bypasses the MCP governance path, and creates no AirMCP audit entry;
do not use it as the first-success workflow. Broader diagnostics such as
`daily-briefing --preview` report missing modules before reading live data.

The complete generated tool manifest is in
[docs/tool-manifest.json](docs/tool-manifest.json).

Current generated surfaces: 233 App Intent action types, 85 Interactive Snippet views,
14 AppEnum pickers, and an iOS-only provider with 8 read-only App Shortcuts that match the preview runtime. The sessionless discovery card uses MCP schema version
2025-11-25.

## Safety Model

AirMCP treats local app access as a governed action layer, not a blind shell for
agents.

The claim is verifiable, not marketing: read the first-party `airmcp://trust`
resource for a live `governed` verdict composed from the tamper-evident audit
chain, the active HITL level, the rate-limit / emergency-stop state, and the
audit key grade — available before any tool access is widened. Preview any
destructive call with `preview_action` to see exactly what it would record and
whether it would be gated, without running it.

- **Per-call human approval** for destructive and sensitive actions at the
  default `sensitive-only` HITL level.
- **HMAC-chained audit log** at `~/.airmcp/audit.jsonl`, with tamper detection
  covered by tests.
- **Native Trust Center** for governed-run timelines, approval state, audit
  integrity, emergency controls, permission probes, and redacted local export.
  Audit history is never read in the background: **Load** or **Refresh** makes
  one explicit `audit_log` request, and the effective HITL policy may require
  approval for that call.
- **Rate limits**: 60/min globally and 10 destructive/hr.
- **Emergency stop**: `touch ~/.config/airmcp/emergency-stop` blocks destructive
  tools without restarting the server.
- **Inbound HTTP policy** through `AIRMCP_ALLOW_NETWORK`: loopback-only by
  default, with token, origin, or OAuth modes available for wider exposure.
- **OAuth 2.1 + Resource Indicators** for HTTP runtimes that need scoped access
  control, with RS256/ES256 JWT verification.

Environment variables are indexed in [docs/environment.md](docs/environment.md).
HTTP policy details are in
[RFC 0002](docs/rfc/0002-http-allow-network.md), and OAuth details are in
[RFC 0005](docs/rfc/0005-oauth-resource-indicators.md).

## Client Setup

When the matching GitHub Release includes a signed AirMCP.app ZIP, the
app-owned desktop pattern keeps one local runtime behind every connected
client. A per-install token is created only by an explicit action: **Start
Local Runtime** in AirMCP.app, or an opted-in app-runtime client connection
such as `--connect-clients` / `connect-clients`. It is stored at:

```text
~/Library/Application Support/AirMCP/http-token
```

The macOS Setup window is consent-driven: it appears automatically once and
resumes its last step when reopened. Merely opening or moving through Setup
does not start the runtime or edit a client, and first-run **Finish Later**
with no runtime saves the selection only. If an app-owned runtime is already
running and the selection changed, **Finish Setup** may stop and restart that
exact owned generation so the persisted and effective scopes match. **Start
Local Runtime** creates the token and opts into automatic startup; each client
is registered only after its own **Connect** action and a fresh
scope/readiness check.

Existing Codex registrations can be inspected or disabled without deleting
their settings:

```bash
npx airmcp codex status
npx airmcp codex disable
```

The `npx airmcp codex` commands follow their child Codex CLI's active user
config root: `AIRMCP_CODEX_CONFIG_PATH` first, then
`$CODEX_HOME/config.toml`, then `~/.codex/config.toml`. The explicit override
is resolved against the invoking working directory and must be named
`config.toml`.

Stdio clients can proxy into the app-owned HTTP runtime:

```bash
npx -y airmcp connect --url http://127.0.0.1:3847/mcp
```

Set `AIRMCP_HTTP_TOKEN` to the token value when using that proxy.

Examples:

```bash
claude mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y airmcp connect --url http://127.0.0.1:3847/mcp
codex mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y airmcp connect --url http://127.0.0.1:3847/mcp
```

Direct stdio mode still works for development or isolated client-owned runtimes:

```bash
npx -y airmcp
```

Browser-based MCP clients should use HTTP mode with token and origin checks. See
[docs/oauth-browser-pkce.md](docs/oauth-browser-pkce.md) for the browser/OAuth
path.

## App Intents and Shortcuts

AirMCP generates App Intent actions from the same MCP tool manifest. On macOS,
those actions are available in the Shortcuts action library; Apple does not
support the `AppShortcutsProvider` phrase surface on macOS. iOS preview builds
can additionally compile the workflow-first App Shortcuts provider.

Destructive intent source generation is opt-in at build/codegen time with
`AIRMCP_APPINTENTS_DESTRUCTIVE=true`; setting it beside an already-built app
does not expand that binary's intent surface.
`AskAirMCPIntent` and FoundationModels-backed Apple Intelligence paths are
preview-only and require explicit Swift builds.

Guide: [docs/shortcuts.md](docs/shortcuts.md). Architecture:
[RFC 0007](docs/rfc/0007-app-intent-bridge.md).

## Local Development

```bash
git clone https://github.com/heznpc/AirMCP.git
cd AirMCP
npm install
npm run build
node dist/index.js
```

Useful checks:

```bash
npm test
npm run mcp:validate
npm run dev:test -- notes
npm run dev:test:changed
```

Swift bridge:

```bash
npm run swift-build
```

FoundationModels preview builds require macOS 26+, Apple Silicon, a compatible
SDK, and the explicit compile flag:

```bash
cd swift
swift build -c release -Xswiftc -DAIRMCP_ENABLE_FOUNDATION_MODELS
```

Local build artifacts can grow after Swift or app builds. To inspect or reclaim
ignored artifacts:

```bash
npm run clean:local
npm run clean:local:apply
npm run size:check
```

Testing guide: [docs/testing.md](docs/testing.md).

## Requirements

- macOS for the server runtime.
- Node.js 20 or newer.
- macOS Automation, Accessibility, Full Disk Access, Location, Bluetooth, or
  Photos permissions as required by the modules you enable.
- The self-contained AirMCP.app distribution embeds its fixed Node runtime and
  the normal Swift bridge. The npm package and `.mcpb` do not embed the Swift
  binary; users of those artifacts build it from source for Swift-backed tools.
- FoundationModels-backed Apple Intelligence preview requires macOS 26+, Apple
  Silicon, and `AIRMCP_ENABLE_FOUNDATION_MODELS`.

The macOS runtime is the current supported release. The iOS runtime is a
preview; visionOS and watchOS are roadmap targets, not released products.

## Documentation

- [Tool manifest](docs/tool-manifest.json): generated list of registered tools.
- [Workflows](docs/workflows.md): target workflows and prompt catalog.
- [Skills DSL](docs/skills.md): YAML workflow syntax and built-ins.
- [Shortcuts](docs/shortcuts.md): macOS App Intent actions and the iOS-only App Shortcuts surface.
- [Environment variables](docs/environment.md): all runtime knobs.
- [MCPB install](docs/mcpb.md): Claude Desktop extension package.
- [OAuth browser PKCE](docs/oauth-browser-pkce.md): browser client setup.
- [RFC index](docs/rfc/README.md): design records and architecture notes.
- [Testing](docs/testing.md): development test workflow.
- [Project direction](docs/direction.md): product direction and positioning.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR
guidelines.

First-time contributors can look for
[`good first issue`](https://github.com/heznpc/AirMCP/labels/good%20first%20issue).

## Community

- [GitHub Discussions](https://github.com/heznpc/AirMCP/discussions)
- [Issues](https://github.com/heznpc/AirMCP/issues)
- [Changelog](CHANGELOG.md)

## License

MIT
