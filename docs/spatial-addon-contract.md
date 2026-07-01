# Spatial Add-on Contract

The `spatial` add-on is a context bridge, not a renderer.

AirMCP's job is to collect local Apple-workspace context and produce auditable, editable handoff artifacts for downstream VR/spatial tools. The add-on may grow to support headset or scene workflows, but it must keep the same boundary as the other optional packs: install on demand, activate through `modulePacks`, and stay removable without weakening `core`.

## Allowed Scope

- Read local asset context from Finder, Photos, Keynote, screen captures, and user-selected files.
- Produce manifests that describe assets, provenance, dimensions, permissions, labels, and suggested scene placement.
- Export handoff folders that a separate renderer, design tool, or headset workflow can consume.
- Keep writes explicit and auditable. Generated manifests or export folders must be user-directed outputs, not background sync.
- Surface missing dependency or package state through `list_module_packs`, `profile_status`, and `install_module_pack`.

## Out Of Scope

- Bundling a full 3D render engine into the root `airmcp` package.
- Owning headset runtime deployment, device pairing, or app-store distribution inside `core`.
- Silent background conversion of user media.
- Network upload of assets unless a future tool has a narrow, explicit opt-in and audit path.

## Future Add-on Pattern

Future VR/spatial packages should follow the same shape as current add-ons:

1. Keep `core` as the transport, config, audit, HITL, and safety runtime.
2. Publish optional package code under `@heznpc/airmcp-<name>` with no `pack-*` naming.
3. Register modules only when the pack is active and installed.
4. Provide `dryRun` previews for install/export operations before writes.
5. Keep renderer-specific integrations behind separate add-ons or downstream handoff tools.

This keeps spatial workflows DLC-like: users add the capability when needed, and uninstall it without changing the base AirMCP trust surface.
