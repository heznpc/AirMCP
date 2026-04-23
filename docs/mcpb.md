# Claude Desktop one-click install (`.mcpb`)

Anthropic's [MCPB](https://github.com/modelcontextprotocol/mcpb) (MCP Bundle, also called "Desktop Extensions") packages an MCP server as a single drag-and-drop file. No `npm`, no editing `claude_desktop_config.json`, no shell.

AirMCP ships a `.mcpb` bundle with every release.

## Install

1. Download `airmcp-<version>.mcpb` from the [Releases](https://github.com/heznpc/AirMCP/releases) page (or build locally — see below).
2. Open **Claude Desktop**.
3. Drag the `.mcpb` onto the Claude Desktop window, or open **Settings → Extensions → Install from file…** and pick it.
4. Click **Install**. Claude Desktop shows the extension's configuration form:

   | Field | What it does |
   |---|---|
   | **Gemini API Key** (optional, sensitive) | Enables cloud embeddings for semantic tool search + note search. Leave blank to use Apple's on-device `NLContextualEmbedding` — no cloud calls are made without this key. |
   | **Load all 29 modules on startup** (default: off) | Off keeps AirMCP at the 7 starter modules (notes, calendar, reminders, contacts, mail, finder, system) — a small, fast-to-initialise surface. On registers every module (messages, music, safari, photos, shortcuts, Apple Intelligence, TV, maps, weather, iWork, Google Workspace, health, bluetooth, etc.). |

5. Claude Desktop launches AirMCP the first time you open a conversation. macOS will prompt for Contacts / Calendar / Reminders / Notes permissions as they're first used — grant each.

That's it. You can now say "Read my latest notes and summarize them" in any Claude Desktop chat.

## When to use `.mcpb` vs `npm`

| Path | Install | Updates | Config | Best for |
|---|---|---|---|---|
| **`.mcpb`** | Drag into Claude Desktop | Re-install newer `.mcpb` | UI form inside Claude Desktop | Users who want one-click. Non-developers. |
| **`npx airmcp init`** | CLI wizard | `npm update -g airmcp` or `npx airmcp@latest` | `~/.config/airmcp/config.json` | Developers. Anyone running stdio + HTTP simultaneously. CI scripts. |

Both paths use the same underlying server — the `.mcpb` is literally `server/dist/` + `node_modules/` zipped with a manifest. Tools, permissions, audit log, rate limiter, and skills behave identically.

## Runtime vs build-time gates

- **Gemini API Key unset + no Swift bridge** → AirMCP still works. Semantic tool search falls back to substring match; note search falls back to literal query. No cloud calls.
- **Gemini API Key set + no Swift bridge** → Cloud path works. Swift-backed tools (EventKit, HealthKit, Vision, Foundation Models) will fail at call time with a clear "Swift bridge not available" message until the user runs `npm run swift-build` inside the extension bundle.
- **Swift bridge pre-built** (future) — planned for a later release. Will ship a universal binary for `darwin-arm64` + `darwin-x64` inside the `.mcpb` so EventKit etc. work out of the box.

## Build locally

Developers can produce the bundle themselves:

```sh
npm ci
npm run build
npm run build:mcpb
# → build/mcpb/airmcp-<version>.mcpb
```

The build script (`scripts/build-mcpb.mjs`) runs `npm install --omit=dev --ignore-scripts` inside the bundle so it's fully self-contained — Claude Desktop never runs `npm` at install time.

## Verify the manifest

```sh
npm run build:mcpb:check
```

Validates `mcpb/manifest.template.json` substitutes + conforms to MCPB v0.3 shape. CI runs this on every push (see `.github/workflows/ci.yml`).

## Troubleshooting

### "Extension failed to load — invalid manifest"

Run `npm run build:mcpb:check` against the repo commit the bundle was built from. Mismatched Node `engines` between `package.json` and the manifest's `compatibility.runtimes.node` is the most common culprit. Post-install, `tests/mcpb-manifest.test.js` guards against this regression.

### "Tool X isn't visible in Claude"

AirMCP's tool list is dynamic (skills + dynamic shortcuts generate tools at runtime). Claude Desktop's MCPB installer reads `tools_generated: true` from the manifest and treats the server as having a runtime discovery model — the tool list populates after the first `tools/list` call. Open a conversation and ask Claude to "list AirMCP tools" to force the call.

### "I want a specific module off"

The UI only exposes the global "Load all 29 modules" toggle. For per-module disabling, drop the `.mcpb` path and use `npx airmcp init` instead (`~/.config/airmcp/config.json` has a module selection block).

### Bundle is large (>5 MB)

The bundle size is dominated by `node_modules` (~93 production deps, ~4.5 MB). A slimmer `.mcpb` would require:
- Bundling the server with `esbuild --bundle` before packaging (drops most transitive deps)
- Dropping dev-only optionals from `package.json dependencies`

Tracked as a future optimization; not blocking correctness.

## Related

- [MCPB spec v0.3](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [Anthropic: Desktop Extensions announcement](https://www.anthropic.com/engineering/desktop-extensions)
- [`scripts/build-mcpb.mjs`](../scripts/build-mcpb.mjs)
- [`mcpb/manifest.template.json`](../mcpb/manifest.template.json)
