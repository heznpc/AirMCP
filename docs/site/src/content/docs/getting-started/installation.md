---
title: Installation
description: How to install and set up AirMCP on your Mac.
---

## Prerequisites

- **macOS** (AirMCP uses JXA and Apple frameworks -- it only runs on macOS)
- **Node.js 20+** (LTS recommended)
- **An MCP client** such as Claude Desktop, Claude Code, Cursor, or Windsurf

## Quick Install

The recommended desktop runtime is AirMCP.app. Open the menubar app, explicitly start its local runtime, then connect Claude, Codex, Cursor, Windsurf, or another MCP client to the app-owned loopback server:

```bash
npx airmcp init
```

This will:

1. Ask which modules you want to enable
2. Create `~/.config/airmcp/config.json` with your selection
3. Ask whether to connect installed MCP clients, defaulting to **No**
4. Only after a Yes, detect clients and write the app-owned runtime entry

Non-interactive setup also leaves every client unchanged unless
`--connect-clients` is present.

## Manual Setup

If you prefer manual configuration, open AirMCP.app and choose **Start Local Runtime**. That explicit action creates the owner-only token at `~/Library/Application Support/AirMCP/http-token` and starts the loopback runtime at `http://127.0.0.1:3847/mcp`. Merely opening or finishing Setup does neither. Stdio-only clients use `npx -y airmcp connect` as a proxy into that runtime with `AIRMCP_HTTP_TOKEN` set.

### Codex

AirMCP never needs to be active in Codex unless you choose it. Inspect or
disable an existing persistent entry without deleting its other settings:

```bash
npx airmcp codex status
npx airmcp codex disable
```

Use `npx airmcp codex enable` only after you want Codex to connect at startup.
These `npx airmcp codex` commands resolve the persistent user config used by
their child Codex CLI in this order:
`AIRMCP_CODEX_CONFIG_PATH`, `$CODEX_HOME/config.toml`, then
`~/.codex/config.toml`. The explicit override is resolved against the invoking
working directory and must be named `config.toml`. Project-local overrides are
reported but never edited.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"],
      "env": {
        "AIRMCP_HTTP_TOKEN": "<token>"
      }
    }
  }
}
```

### Claude Code

Edit `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"],
      "env": {
        "AIRMCP_HTTP_TOKEN": "<token>"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"],
      "env": {
        "AIRMCP_HTTP_TOKEN": "<token>"
      }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"],
      "env": {
        "AIRMCP_HTTP_TOKEN": "<token>"
      }
    }
  }
}
```

## Enable All Modules

By default, AirMCP enables a starter set of modules when no config file exists. In the app-owned runtime, use the onboarding module picker or rerun the setup wizard and choose all modules:

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

AirMCP uses JXA (JavaScript for Automation) to control macOS apps. In the recommended app-owned runtime, macOS permission prompts should be associated with AirMCP.app rather than every individual AI client. Direct `npx -y airmcp` launches remain useful for development, but the launching terminal or MCP client owns those prompts.

To check permissions, run:

```bash
npx airmcp doctor
```

The `doctor` command verifies Node.js version, macOS version, permissions, client configs, and module availability.

## Verifying Installation

After setup, restart your MCP client and ask your AI assistant to list your notes or check the weather. If it responds with real data from your Mac, AirMCP is working.

You can also run the server directly to verify:

```bash
npx airmcp
```

This starts the MCP server in stdio mode. You should see the AirMCP banner with the list of enabled modules and tool count.

## HTTP Mode

For remote access or multi-client scenarios, AirMCP can run as an HTTP server:

```bash
npx airmcp --http
```

This starts an HTTP server on `127.0.0.1:3847` with the Streamable HTTP transport. See the [Configuration guide](/getting-started/configuration/) for HTTP options.
