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

| Layer            | Package shape                                                                                                  | Why first                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime core     | `airmcp`                                                                                                       | Owns config, transports, audit, HITL, OAuth, rate limits, profiles, and task sessions.                                             |
| Optional bridges | source-built Swift bridge / future signed app component                                                        | Heavy native capability already differs from npm/MCPB distribution.                                                                |
| Module add-ons   | staged `@heznpc/airmcp-productivity` / `@heznpc/airmcp-spatial` packages or signed app downloadable components | Runtime can already import installed add-ons first; publishing waits until package-size/startup evidence beats release complexity. |

`npx airmcp doctor` treats the Swift bridge as an optional bridge, not a module add-on package. That keeps the first physical split focused on the heaviest native binary/signing boundary before multiplying npm package surfaces.

## Acceptance gates before publishing physical module-pack packages

- `profiles:check` reports startup/list timings for starter/progressive vs full/full, multiple restricted-pack profiles, strict task-session behavior, and discovery golden queries.
- `npm run harness:check` proves `compatible`, `strict`, `app-runtime`, and `agent` adapter policy over the real MCP stdio wire.
- `npm run tokens:check` keeps the eager tool-description budget bounded as modules grow.
- `npm run addons:check` stages every non-core package and fails on missing module/shared files or `pack-*` naming drift.
- `npm run addons:verify-install` packs the root package plus at least one staged add-on, installs both into a clean project, and boots with `AIRMCP_ADDON_PACKAGE_MODE=external-only`.
- `npm pack --dry-run --json` shows package size regressions per release.
- `list_module_packs` and `profile_status.modulesMissingPacks` remain stable public truth surfaces.
- At least one real user/workflow needs a smaller install, not only a smaller context window.
- Pack boundaries have tests proving no profile loads a missing optional module by accident.

## Post-validation decision matrix

This matrix is the decision surface after an add-on modular-distribution kill-test. It decides whether the staged package split graduates, stalls, or rolls back to runtime-only module packs. It does not change the current safety model: bundled fallback remains the default user-safe path until install evidence is clean across npm, MCPB, app runtime, and no-config stdio.

Validation evidence must include:

- `npm run release:preflight` or the equivalent explicit sequence: `build`, `tokens:check`, `profiles:check`, `harness:check`, `addons:check`, `addons:verify-install`, `verify:package`, `npm pack --dry-run --json`, and `build:mcpb`.
- Add-on package install smoke test in `AIRMCP_ADDON_PACKAGE_MODE=external-only` for at least one non-core pack and one restricted-pack profile.
- Wire test coverage for `compatible`, `strict`, `app-runtime`, and `agent` harness adapter policies.
- Size and startup/list timing measurements for universal bundled install vs add-on install. Thresholds are owner-ratified release gates, not inferred by the implementation session.

| Validation result       | Decision                                                                                                            | Immediate action                                                                                                                                                                                            | Follow-up goal                                                                                                             | Public status                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Validation passes       | Graduate add-ons to opt-in prerelease distribution, still with bundled fallback.                                    | Prepare npm prerelease/canary add-on package plan and document install path; keep `airmcp` universal package as the default.                                                                                | Add shipped-artifact CI coverage for installed add-ons before any stable publish or fallback removal.                      | "Add-on packages are opt-in prerelease; universal package remains supported." |
| Size win is weak        | Do not publish physical add-ons yet. Runtime module packs remain useful; physical split stays staged.               | Record the measured size/startup deltas and keep `addons:check` in CI/release preflight.                                                                                                                    | Re-evaluate heavier boundaries first: Swift bridge/app component, shared dependency pruning, or pack granularity changes.  | "Staging validated technically, but release value is not proven."             |
| Install fails           | Block add-on distribution. Keep bundled fallback and runtime pack activation only.                                  | Preserve failing artifact, install log, package manifest, and import mode; fix package layout, dependency, export, or peer-version issue before another kill-test.                                          | Add a regression test for the exact install failure if it is reproducible locally or in CI.                                | "No add-on package publish; use bundled `airmcp`."                            |
| Adapter wire tests fail | Block graduation of the task-harness contract for affected adapters; do not use add-on split to widen distribution. | Keep compatible/no-session stdio behavior available; fix `start_tool_session`, `discover_tools`, `describe_tool`, `run_tool`, `tool_session_status`, or `end_tool_session` wire behavior before publishing. | Add or tighten wire cases for the failing adapter policy, especially hidden-tool rejection and session allowlist behavior. | "Task harness remains staged for the failing adapter."                        |

If multiple rows apply, choose the most conservative result in this order: install failure, adapter wire failure, weak size win, pass.

## Non-goals

- Do not split safety primitives out of core.
- Do not remove bundled fallback until installed add-ons have passed shipped-artifact checks across npm, MCPB, app runtime, and no-config stdio.
- Do not use AppIntents/Shortcuts as the module-pack mechanism; they are user-facing automation surfaces, not runtime dependency management.
