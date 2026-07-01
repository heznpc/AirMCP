# RFC 0015 — Modular install and task-scoped harness

Status: Slim Root Default Implemented

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
- `npx airmcp modules` lists, enables, disables, installs, uninstalls, and doctors the active pack set,
- `npx airmcp modules enable <pack> --install` installs companion npm packages into the user-level add-on prefix before activating `modulePacks`,
- module loading skips enabled-profile modules whose pack is unavailable before dynamic import,
- `list_module_packs` reports the active pack set over MCP,
- `profile_status` reports `modulePacksConfigured`, `modulePacksAvailable`, `modulesMissingPacks`, `modulesMissingAddonPackages`, and install hints,
- `profiles:check` includes a real MCP wire case proving `productivity` remains available while `communications` modules become missing-pack modules when only `core,productivity` are active.

The third shipped slice is physical package split:

- `scripts/build-addon-packages.mjs` stages tarball-ready package directories under `build/addons`,
- each staged package includes only its pack modules; shared runtime imports are rewritten to the peer root `airmcp` package instead of copied into every add-on,
- `AIRMCP_ADDON_PACKAGE_MODE=prefer-installed` tries an installed add-on package from normal package resolution and `AIRMCP_ADDON_INSTALL_PREFIX` before bundled fallback,
- `AIRMCP_ADDON_PACKAGE_MODE=external-only` turns missing add-ons into module-load failures outside `core`,
- `npm pack` / `npm publish` prepack builds a slim root artifact and postpack restores the universal local `dist`,
- `npm run addons:check` is wired into CI and `release:preflight`,
- `npm run addons:publish` dry-runs by default and only publishes staged add-ons when `--publish` is explicit.

## Implemented install split

Release artifacts now use a slim root by default while the source checkout keeps a universal local `dist` for development and measurement. Split module packs in this order:

| Layer            | Package shape                                                                                                  | Why first                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime core     | `airmcp`                                                                                                       | Owns config, transports, audit, HITL, OAuth, rate limits, profiles, and task sessions.                                             |
| Optional bridges | source-built Swift bridge / future signed app component                                                        | Heavy native capability already differs from npm/MCPB distribution.                                                                |
| Module add-ons   | staged `@heznpc/airmcp-productivity` / `@heznpc/airmcp-spatial` packages or signed app downloadable components | Runtime imports installed add-ons first; missing slim-root packages surface install hints instead of silently pretending the module exists. |

`npx airmcp doctor` treats the Swift bridge as an optional bridge, not a module add-on package. That keeps the first physical split focused on the heaviest native binary/signing boundary before multiplying npm package surfaces.

## Acceptance gates before publishing physical module-pack packages

- `profiles:check` reports startup/list timings for starter/progressive vs full/full, multiple restricted-pack profiles, strict task-session behavior, and discovery golden queries.
- `npm run harness:check` proves `compatible`, `strict`, `app-runtime`, and `agent` adapter policy over the real MCP stdio wire, including the app-owned runtime inference path.
- `npm run tokens:check` keeps the eager tool-description budget bounded as modules grow.
- `npm run addons:check` stages every non-core package and fails on missing module/shared files or `pack-*` naming drift.
- `npm run addons:verify-install -- --all` packs the slim root package plus every staged add-on, first proves a root-only install cannot silently use bundled fallback in `AIRMCP_ADDON_PACKAGE_MODE=external-only`, then installs the add-on artifacts and proves the selected packs register over MCP stdio.
- `npm run addons:measure-split` packs the universal local build with lifecycle scripts disabled, compares it with slim-root plus selected add-ons, and records packed/unpacked/install-size plus startup/list timing deltas.
- `npm pack --dry-run --json` must include `dist/.airmcp-slim-root.json` and must not include non-core module `tools.js` / `prompts.js` entrypoints.
- `.mcpb` release artifacts must include the same slim-root marker and must not leak non-core module entrypoints.
- `list_module_packs`, `profile_status.modulesMissingPacks`, `profile_status.modulesMissingAddonPackages`, and `profile_status.missingPackInstallHints` remain stable public truth surfaces, including a human-readable install prompt message for missing add-ons.
- At least one real user/workflow needs a smaller install, not only a smaller context window.
- Pack boundaries have tests proving no profile loads a missing optional module by accident.

## Post-validation decision matrix

This matrix is the decision surface after an add-on modular-distribution kill-test. It decides whether the slim-root/add-on split stays the default, stalls, or rolls back to runtime-only module packs. It does not change the safety model: `core` keeps the front door, and missing non-core packages surface install hints instead of widening permissions.

Validation evidence must include:

- `npm run release:preflight` or the equivalent explicit sequence: `build`, `tokens:check`, `profiles:check`, `harness:check`, `addons:check`, `addons:verify-install -- --all`, `addons:measure-split -- --require-size-win`, `verify:package`, `npm pack --dry-run --json`, and `build:mcpb`.
- Add-on package install smoke test in `AIRMCP_ADDON_PACKAGE_MODE=external-only` for at least one non-core pack and one restricted-pack profile, with both root-only negative provenance and installed-add-on positive registration checks.
- Wire test coverage for explicit `compatible`, `strict`, `app-runtime`, and `agent` harness adapter policies plus app-owned runtime inference.
- Size and startup/list timing measurements for universal bundled install vs slim-root add-on install. Thresholds are owner-ratified release gates, not inferred by the implementation session.
- Shipped-artifact checks proving npm and MCPB artifacts are slim root artifacts, not merely measured temporary artifacts.

| Validation result       | Decision                                                                                                            | Immediate action                                                                                                                                                                                            | Follow-up goal                                                                                                             | Public status                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Validation passes       | Keep slim root as the default release shape.                                                                       | Publish root and add-on artifacts only when shipped-artifact checks pass; keep the install prompt path documented.                                                                                           | Expand clean-install coverage from the default productivity pack to every publish-target add-on.                           | "Slim root is the default; install add-ons on demand."                        |
| Size win is weak        | Do not widen add-on publishing. Keep the slim gate, but re-check whether the split is worth the product complexity. | Record measured size/startup deltas and require owner ratification before adding more physical packages.                                                                                                     | Re-evaluate heavier boundaries first: Swift bridge/app component, shared dependency pruning, or pack granularity changes.  | "Slim root works technically, but value needs tighter evidence."              |
| Install fails           | Block add-on distribution and block stable release.                                                                | Preserve failing artifact, install log, package manifest, and import mode; fix package layout, dependency, export, or peer-version issue before another release attempt.                                    | Add a regression test for the exact install failure if it is reproducible locally or in CI.                                | "No add-on package publish until install is fixed."                           |
| Adapter wire tests fail | Block graduation of the task-harness contract for affected adapters; do not use add-on split to widen distribution. | Keep compatible/no-session stdio behavior available; fix `start_tool_session`, `discover_tools`, `describe_tool`, `run_tool`, `tool_session_status`, or `end_tool_session` wire behavior before publishing. | Add or tighten wire cases for the failing adapter policy, especially hidden-tool rejection and session allowlist behavior. | "Task harness remains staged for the failing adapter."                        |

If multiple rows apply, choose the most conservative result in this order: install failure, adapter wire failure, weak size win, pass.

## Non-goals

- Do not split safety primitives out of core.
- Do not use AppIntents/Shortcuts as the module-pack mechanism; they are user-facing automation surfaces, not runtime dependency management.
