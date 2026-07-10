# RFC 0015 — Modular install and task-scoped harness

Status: Universal Distribution Implemented

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
- each pack declares its optional compatibility package name without a `pack-` prefix (`airmcp`, `@heznpc/airmcp-productivity`, `@heznpc/airmcp-spatial`, ...),
- `AIRMCP_MODULE_PACKS` and `config.json -> modulePacks` can restrict the available pack set while preserving `core`,
- `npx airmcp modules` lists, enables, disables, installs, uninstalls, and doctors the active pack set,
- `npx airmcp modules enable <pack> --install` installs companion npm packages into the user-level add-on prefix before activating `modulePacks`,
- module loading skips enabled-profile modules whose pack is unavailable before dynamic import,
- `list_module_packs` reports the active pack set over MCP,
- `profile_status` reports `modulePacksConfigured`, `modulePacksAvailable`, `modulesMissingPacks`, `modulesMissingAddonPackages`, and install hints,
- `list_module_packs` reports installed add-on version, expected version, update status, and installed size,
- `install_module_pack` gives MCP clients a dry-run-first, `confirm:true`-gated path for semi-automatic add-on install/repair/uninstall,
- `profiles:check` includes a real MCP wire case proving `productivity` remains available while `communications` modules become missing-pack modules when only `core,productivity` are active.

The third shipped slice is a compatibility package path, not the default product shape:

- `scripts/build-addon-packages.mjs` stages tarball-ready package directories under `build/addons`,
- each staged package includes only its pack modules; shared runtime imports are rewritten to the peer root `airmcp` package instead of copied into every add-on,
- `AIRMCP_ADDON_PACKAGE_MODE=prefer-installed` tries an installed add-on package from normal package resolution and `AIRMCP_ADDON_INSTALL_PREFIX` before bundled fallback,
- `AIRMCP_ADDON_PACKAGE_MODE=external-only` turns missing add-ons into module-load failures outside `core`,
- root `npm pack` / `npm publish` and MCPB copy the universal `dist` tree without removing non-core entrypoints,
- `npm run addons:check` is wired into CI and `release:preflight`,
- `npm run addons:publish` dry-runs by default and only publishes scoped compatibility add-ons when `--publish` is explicit,
- shipped-artifact gates clean-install and boot both npm and MCPB in `full/full` bundled mode so a green release proves the complete standard JavaScript catalog is present.

## Release-shape decision

The physical split passed technical install probes but did not justify twelve required packages: the observed saving was roughly one percent of the installed footprint while a public MCPB could lose most non-core modules if add-ons were absent. v2.16 therefore keeps module packs as a logical activation/context boundary and restores universal release artifacts.

| Layer | Shipped shape | Contract |
| --- | --- | --- |
| Root runtime | universal `airmcp` tarball and universal `.mcpb` | Owns config, transports, safety infra, profiles, task sessions, and every standard JavaScript module entrypoint. |
| Logical packs | `modulePacks` / profiles / progressive exposure | Narrow what loads and what clients see without changing what the artifact contains. |
| Compatibility add-ons | staged `@heznpc/airmcp-productivity`, `@heznpc/airmcp-spatial`, and peers | Optional for `external-only` or compatibility deployments; ordinary users do not need them. |
| Native bridge | source-built or app-bundled Swift bridge | Remains the meaningful heavy/signing boundary and should be evaluated separately from thin JXA modules. |

`npx airmcp doctor` continues to treat the Swift bridge as an optional bridge, not a module add-on package. This keeps the real native binary/signing boundary visible without multiplying package complexity for thin JavaScript adapters.

## Acceptance gates

- `profiles:check` reports startup/list timings for starter/progressive vs full/full, multiple restricted-pack profiles, strict task-session behavior, and discovery golden queries.
- `npm run harness:check` proves `compatible`, `strict`, `app-runtime`, and `agent` adapter policy over the real MCP stdio wire, including the app-owned runtime inference path.
- `npm run tokens:check` keeps the eager tool-description budget bounded as modules grow.
- `npm run addons:check` stages every non-core package and fails on missing module/shared files or `pack-*` naming drift.
- `npm run addons:verify-install -- --all` installs every staged scoped add-on and proves `external-only` mode loads it without falling back to root-bundled module files.
- `npm run addons:measure-split`, `addons:first-user-drill`, and `addons:kill-test` remain diagnostic experiments. They do not block the universal release lane unless a future owner-ratified decision reopens the physical split.
- `npm pack --dry-run --json` must include non-core module entrypoints from every declared pack.
- `.mcpb` must contain the same universal module tree plus production dependencies.
- `npm run verify:package` must clean-install the exact root tarball and boot both default and `full/full` surfaces.
- `npm run verify:mcpb` must extract the exact bundle and prove representative modules and tools across communications, browser, visual, productivity, Google Workspace, device, and intelligence packs.
- `list_module_packs`, `install_module_pack`, `profile_status.modulesMissingPacks`, `profile_status.modulesMissingAddonPackages`, `profile_status.modulePackInstallIssues`, and `profile_status.missingPackInstallHints` remain stable public truth surfaces, including a human-readable install prompt message for missing add-ons.
- Pack boundaries have tests proving restricted profiles do not load unavailable modules by accident.

## Reopening a physical split

The current decision is **universal root + logical packs**. A future proposal to make physical add-ons required must bring all of the following evidence before changing release scripts:

- a material packed and installed-size reduction after add-ons and duplicated dependencies are counted,
- at least one real workflow that needs a smaller install rather than only a smaller active context,
- a single-install or transactional install/rollback user journey,
- public-registry ownership and same-version availability for every required package,
- npm and MCPB shipped-artifact tests proving the full profile cannot silently degrade,
- explicit owner approval of the added release and migration complexity.

Until then, split measurements may inform native bridge/app packaging, where the binary and signing cost is real, but they must not remove JavaScript modules from the root artifact.

## Non-goals

- Do not split safety primitives out of core.
- Do not use AppIntents/Shortcuts as the module-pack mechanism; they are user-facing automation surfaces, not runtime dependency management.
