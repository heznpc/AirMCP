---
title: Installation
description: Choose the AirMCP install path that matches your MCP client and the assets available in the current release.
---

## Choose your client first

AirMCP has two complete public install paths today. Choose the one that matches
the client you already use:

| Client | Use this path | What you need |
|---|---|---|
| **Claude Desktop** | Install the `.mcpb` desktop extension | `airmcp-<version>.mcpb` from [GitHub Releases](https://github.com/heznpc/AirMCP/releases) |
| **Codex, Claude Code, Cursor, Windsurf, and other stdio clients** | Connect the npm runtime directly over stdio | macOS and Node.js 20+ |

AirMCP.app is a third, app-owned runtime path. Use it only when the release you
are installing actually lists a signed `AirMCP-<version>.zip` asset. If that ZIP
is absent, there is no public app to start; use `.mcpb` or direct stdio instead.

## Claude Desktop: install the `.mcpb`

1. Open [GitHub Releases](https://github.com/heznpc/AirMCP/releases).
2. Download `airmcp-<version>.mcpb` from the release you want to install.
3. Open Claude Desktop.
4. Drag the `.mcpb` into Claude Desktop, or choose **Settings → Extensions → Install from file…**.
5. Keep the starter profile for the first run, then install the extension.

No npm command, AirMCP.app download, or JSON edit is required for this path.
See the [MCPB guide](https://github.com/heznpc/AirMCP/blob/main/docs/mcpb.md)
for configuration fields and troubleshooting.

## Other MCP clients: use direct stdio

Direct stdio is the current fallback when a release has no signed AirMCP.app
ZIP. First create the local AirMCP configuration without touching any client:

```bash
npx airmcp init --no-clients
```

Then preview and apply direct stdio entries for the clients AirMCP detects:

```bash
npx airmcp connect-clients --client-runtime direct --dry-run
npx airmcp connect-clients --client-runtime direct
```

Restart the configured client after applying the change. The resulting MCP
entry starts `npx -y airmcp` directly; it does not expect AirMCP.app or the
loopback server at `127.0.0.1:3847` to be running.

For a non-interactive starter setup, use:

```bash
npx airmcp init --profile starter --yes
npx airmcp connect-clients --client-runtime direct
```

The commands above make client registration a separate, explicit step across
released CLI versions: `--no-clients` prevents the setup wizard from writing
an app-owned entry, and `connect-clients --client-runtime direct` applies the
fallback only after you choose it.

## Manual direct-stdio configuration

Clients that accept an MCP server JSON object can use the same direct entry:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"]
    }
  }
}
```

### Codex

AirMCP never needs to be active in Codex unless you choose it. Inspect or
disable an existing persistent entry without deleting its other settings:

```bash
npx airmcp codex status
npx airmcp codex disable
```

Add a direct stdio entry explicitly with:

```bash
codex mcp add airmcp -- npx -y airmcp
```

Use `npx airmcp codex enable` only when an AirMCP entry already exists and you
want Codex to connect at startup. These `npx airmcp codex` commands resolve the
persistent user config used by their child Codex CLI in this order:
`AIRMCP_CODEX_CONFIG_PATH`, `$CODEX_HOME/config.toml`, then
`~/.codex/config.toml`. The explicit override is resolved against the invoking
working directory and must be named `config.toml`. Project-local overrides are
reported but never edited.

## AirMCP.app: only when the release includes it

When [GitHub Releases](https://github.com/heznpc/AirMCP/releases) lists a signed
`AirMCP-<version>.zip` alongside the `.mcpb`, you can use the app-owned runtime:

1. Download and extract that ZIP, then open AirMCP.app.
2. Complete Setup and explicitly choose **Start Local Runtime**.
3. Run `npx airmcp connect-clients --dry-run`, review the detected changes, and
   then run `npx airmcp connect-clients`.
4. Restart the configured MCP clients.

Starting the local runtime creates the owner-only token at
`~/Library/Application Support/AirMCP/http-token` and starts the loopback
runtime at `http://127.0.0.1:3847/mcp`. Merely opening AirMCP.app or finishing
Setup does neither. Stdio-only clients use `npx -y airmcp connect` as a proxy
into that runtime with `AIRMCP_HTTP_TOKEN` set.

The app-owned path centralizes runtime state, approvals, and Trust Center
history. Do not configure this path from an older npm release unless the
matching signed app ZIP is available and running; otherwise clients will fail
their MCP startup handshake.

## Enable All Modules

By default, AirMCP enables a starter set of modules when no config file exists.
For direct stdio, rerun the setup wizard to change the selection. When a signed
AirMCP.app release is installed, you can instead use its onboarding module
picker.

```bash
npx airmcp init
```

Or edit `~/.config/airmcp/config.json` directly:

```json
{
  "disabledModules": []
}
```

## macOS Permissions

AirMCP uses JXA (JavaScript for Automation) to control macOS apps. With direct
stdio, the launching terminal or MCP client owns the macOS permission prompts.
When the signed app-owned runtime is installed and running, those prompts
should instead be associated with AirMCP.app.

To check permissions, run:

```bash
npx airmcp doctor
```

The `doctor` command verifies Node.js version, macOS version, permissions, client configs, and module availability.

## Verifying Installation

After setup, restart your MCP client and begin with a read-only request:

> Tell me today's calendar events and overdue reminders. Do not change anything.

If the assistant returns real data from your Mac, the client and AirMCP runtime
are connected. A later write request should remain a separate, explicitly
approved call.

You can also run the server directly to verify:

```bash
npx airmcp
```

This starts the MCP server in stdio mode. You should see the AirMCP banner with
the list of enabled modules and tool count.

## HTTP Mode

For remote access or multi-client scenarios, AirMCP can run as an HTTP server:

```bash
npx airmcp --http
```

This starts an HTTP server on `127.0.0.1:3847` with the Streamable HTTP transport. See the [Configuration guide](/getting-started/configuration/) for HTTP options.
