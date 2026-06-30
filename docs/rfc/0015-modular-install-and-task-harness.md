# RFC 0015 — Modular install and task-scoped harness

Status: Add-on Staging Implemented

## Problem

AirMCP has grown like a local OS service: many Apple modules, app/runtime surfaces, safety gates, generated AppIntents, and package formats move together. Profiles and progressive exposure reduced the default `tools/list` context, but they do not fully answer two operator concerns:

- installation weight should track the modules a user actually needs,
- an agent task should not carry the whole registered tool universe just because the runtime can.

## Current implemented slice

The first shipped slice is the task harness:

- `start_tool_session` creates a short-lived allowlist of registered tools,
- `discover_tools({ sessionId })` searches only that allowlist,
- `run_tool({ sessionId })` refuses calls outside that allowlist,
- `describe_tool` fetches the full description for one selected tool after `discover_tools` returns compact matches,
- `AIRMCP_REQUIRE_TOOL_SESSION=true` can require sessions before `run_tool` dispatches hidden tools while keeping directly exposed tools callable,
- `src/shared/task-adapters.ts` separates client policy (`compatible`, `strict`, `app-runtime`, `agent`) from server registration code,
- new app/CLI-generated configs set `requireToolSession: true`; direct no-config stdio remains compatible,
- `tool_session_status` and `end_tool_session` make the session inspectable and revocable,
- profile matrix verification exercises the allow/deny path over the real MCP wire.

This is a cooperative MCP-client contract. It is not a security boundary by itself; HITL, OAuth scopes, rate limits, audit, emergency stop, and macOS permissions remain the hard gates.

The second shipped slice is the module-pack contract:

- `src/shared/module-packs.ts` defines DLC-like packs (`core`, `communications`, `productivity`, `browser`, `media`, `visual`, `location`, `device`, `intelligence`, `google-workspace`, `spatial`),
- each pack declares its add-on package name without a `pack-` prefix (`airmcp`, `@heznpc/airmcp-productivity`, `@heznpc/airmcp-spatial`, ...),
- `AIRMCP_MODULE_PACKS` and `config.json -> modulePacks` can restrict the available pack set while preserving `core`,
- `npx airmcp modules` lists, enables, disables, and doctors the active pack set,
- module loading skips enabled-profile modules whose pack is unavailable before dynamic import,
- `list_module_packs` reports the active pack set over MCP,
- `profile_status` reports `modulePacksConfigured`, `modulePacksAvailable`, and `modulesMissingPacks`,
- `profiles:check` includes a real MCP wire case proving `productivity` remains available while `communications` modules become missing-pack modules when only `core,productivity` are active.

The third shipped slice is physical package staging:

- `scripts/build-addon-packages.mjs` stages tarball-ready package directories under `build/addons`,
- each staged package includes only its pack modules plus the shared runtime files those modules import,
- `AIRMCP_ADDON_PACKAGE_MODE=prefer-installed` tries an installed add-on package before bundled fallback,
- `AIRMCP_ADDON_PACKAGE_MODE=external-only` turns missing add-ons into module-load failures outside `core`,
- `npm run addons:check` is wired into CI and `release:preflight`.

## Proposed install split

Keep the npm package as the reliable universal fallback while add-on packages prove install-size and startup wins. Split module packs in this order:

| Layer | Package shape | Why first |
|---|---|---|
| Runtime core | `airmcp` | Owns config, transports, audit, HITL, OAuth, rate limits, profiles, and task sessions. |
| Optional bridges | source-built Swift bridge / future signed app component | Heavy native capability already differs from npm/MCPB distribution. |
| Module add-ons | staged `@heznpc/airmcp-productivity` / `@heznpc/airmcp-spatial` packages or signed app downloadable components | Runtime can already import installed add-ons first; publishing waits until package-size/startup evidence beats release complexity. |

`npx airmcp doctor` treats the Swift bridge as an optional bridge, not a module add-on package. That keeps the first physical split focused on the heaviest native binary/signing boundary before multiplying npm package surfaces.

## Acceptance gates before publishing physical module-pack packages

- `profiles:check` reports startup/list timings for starter/progressive vs full/full, multiple restricted-pack profiles, strict task-session behavior, and discovery golden queries.
- `npm run tokens:check` keeps the eager tool-description budget bounded as modules grow.
- `npm run addons:check` stages every non-core package and fails on missing module/shared files or `pack-*` naming drift.
- `npm pack --dry-run --json` shows package size regressions per release.
- `list_module_packs` and `profile_status.modulesMissingPacks` remain stable public truth surfaces.
- At least one real user/workflow needs a smaller install, not only a smaller context window.
- Pack boundaries have tests proving no profile loads a missing optional module by accident.

## Non-goals

- Do not split safety primitives out of core.
- Do not remove bundled fallback until installed add-ons have passed shipped-artifact checks across npm, MCPB, app runtime, and no-config stdio.
- Do not use AppIntents/Shortcuts as the module-pack mechanism; they are user-facing automation surfaces, not runtime dependency management.
