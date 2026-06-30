# RFC 0015 — Modular install and task-scoped harness

Status: Pack Contract Implemented

## Problem

AirMCP has grown like a local OS service: many Apple modules, app/runtime surfaces, safety gates, generated AppIntents, and package formats move together. Profiles and progressive exposure reduced the default `tools/list` context, but they do not fully answer two operator concerns:

- installation weight should track the modules a user actually needs,
- an agent task should not carry the whole registered tool universe just because the runtime can.

## Current implemented slice

The first shipped slice is the task harness:

- `start_tool_session` creates a short-lived allowlist of registered tools,
- `discover_tools({ sessionId })` searches only that allowlist,
- `run_tool({ sessionId })` refuses calls outside that allowlist,
- `AIRMCP_REQUIRE_TOOL_SESSION=true` can require sessions before `run_tool` dispatches hidden tools while keeping directly exposed tools callable,
- `tool_session_status` and `end_tool_session` make the session inspectable and revocable,
- profile matrix verification exercises the allow/deny path over the real MCP wire.

This is a cooperative MCP-client contract. It is not a security boundary by itself; HITL, OAuth scopes, rate limits, audit, emergency stop, and macOS permissions remain the hard gates.

The second shipped slice is the module-pack contract:

- `src/shared/module-packs.ts` defines DLC-like packs (`core`, `communications`, `productivity`, `browser`, `media`, `visual`, `location`, `device`, `intelligence`, `google-workspace`, `spatial`),
- `AIRMCP_MODULE_PACKS` and `config.json -> modulePacks` can restrict the available pack set while preserving `core`,
- module loading skips enabled-profile modules whose pack is unavailable before dynamic import,
- `list_module_packs` reports the active pack set over MCP,
- `profile_status` reports `modulePacksConfigured`, `modulePacksAvailable`, and `modulesMissingPacks`,
- `profiles:check` includes a real MCP wire case proving `productivity` remains available while `communications` modules become missing-pack modules when only `core,productivity` are active.

## Proposed install split

Keep the npm package as the reliable universal runtime until demand proves a smaller package matrix is worth the maintenance cost. Add module packs in this order:

| Layer | Package shape | Why first |
|---|---|---|
| Runtime core | `airmcp` | Owns config, transports, audit, HITL, OAuth, rate limits, profiles, and task sessions. |
| Optional bridges | source-built Swift bridge / future signed app component | Heavy native capability already differs from npm/MCPB distribution. |
| Module packs | future `@airmcp/<module-pack>` packages or signed app downloadable components | Only after pack-boundary tests prove install size/startup gain beats release complexity. |

## Acceptance gates before physical module-pack packages

- `profiles:check` reports startup/list timings for starter/progressive vs full/full and at least one restricted-pack profile.
- `npm pack --dry-run --json` shows package size regressions per release.
- `list_module_packs` and `profile_status.modulesMissingPacks` remain stable public truth surfaces.
- At least one real user/workflow needs a smaller install, not only a smaller context window.
- Pack boundaries have tests proving no profile loads a missing optional module by accident.

## Non-goals

- Do not split safety primitives out of core.
- Do not publish per-module packages before the signed app/notarization path is operational.
- Do not use AppIntents/Shortcuts as the module-pack mechanism; they are user-facing automation surfaces, not runtime dependency management.
