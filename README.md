<p align="center">
  <img src="icons/airmcp-icon-256.png" alt="AirMCP" width="128">
</p>

# AirMCP

[![npm version](https://img.shields.io/npm/v/airmcp)](https://www.npmjs.com/package/airmcp)
[![Tests](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/heznpc/AirMCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/heznpc/AirMCP)](https://github.com/heznpc/AirMCP/stargazers)

**Apple-native action runtime for MCP clients.** AirMCP lets Claude, Codex,
Cursor, Raycast, Siri, Shortcuts, Xcode agents, and other MCP-capable AI clients
read, organize, and act across your Mac apps through one governed local runtime.

The catalog is broad: 295 tools across 31 modules. The important part is the
layer underneath: profile-based exposure, task-scoped tool sessions, per-call
human approval, HMAC-chained audit logs, rate limits, OAuth scopes, and local
controls for sensitive Apple workspace actions.

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
- **Siri and Shortcuts bridge** generated from the MCP manifest through
  AppIntents, with destructive intents gated separately.
- **Native Swift bridge, optional** for EventKit, PhotoKit, HealthKit, Vision,
  on-device semantic search, and FoundationModels preview builds.
- **Dual transport**: stdio for standard MCP clients, HTTP/SSE for shared
  local runtimes, browser clients, registries, and always-on hosts.

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

The wizard selects a profile, writes MCP client config, and stores preferences
in `~/.config/airmcp/config.json`.

Non-interactive examples:

```bash
npx airmcp init --profile starter --yes
npx airmcp init --profile communications-safe --yes
npx airmcp init --profile productivity --yes
npx airmcp init --profile productivity --yes --client-runtime direct
```

Check the install:

```bash
npx airmcp doctor
```

## Common Workflows

Once connected, ask your MCP client in natural language:

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
npx airmcp workflows daily-briefing --prompt
```

The complete generated tool manifest is in
[docs/tool-manifest.json](docs/tool-manifest.json).

Current generated surfaces: 232 Shortcuts / Siri AppIntents, 83 Interactive Snippet views,
and 13 AppEnum pickers. The sessionless discovery card uses MCP schema version
2025-11-25.

## Safety Model

AirMCP treats local app access as a governed action layer, not a blind shell for
agents.

- **Per-call human approval** for destructive and sensitive actions at the
  default `sensitive-only` HITL level.
- **HMAC-chained audit log** at `~/.airmcp/audit.jsonl`, with tamper detection
  covered by tests.
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

The recommended desktop pattern is one local AirMCP runtime, with clients
connecting to it. The app or setup wizard generates a per-install token at:

```text
~/Library/Application Support/AirMCP/http-token
```

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

## Siri and Shortcuts

AirMCP can generate AppIntents and AppShortcuts from the same MCP tool manifest.
That gives Siri, Shortcuts, Spotlight, widgets, and the Action Button typed
access to the same governed runtime.

Destructive intents are opt-in with `AIRMCP_APPINTENTS_DESTRUCTIVE=true`.
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
- Optional Swift bridge built from source for Swift-backed tools. It is not
  bundled into the npm package, `.mcpb`, or menubar app distribution.
- FoundationModels-backed Apple Intelligence preview requires macOS 26+, Apple
  Silicon, and `AIRMCP_ENABLE_FOUNDATION_MODELS`.

The iOS server is preview, not the shipping surface. macOS is the supported
runtime.

## Documentation

- [Tool manifest](docs/tool-manifest.json): generated list of registered tools.
- [Workflows](docs/workflows.md): target workflows and prompt catalog.
- [Skills DSL](docs/skills.md): YAML workflow syntax and built-ins.
- [Shortcuts](docs/shortcuts.md): Siri, Shortcuts, Spotlight, and AppIntents.
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
