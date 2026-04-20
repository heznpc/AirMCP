---
title: Installation
description: How to install and set up AirMCP on your Mac.
---

## Prerequisites

- **macOS** (AirMCP uses JXA and Apple frameworks -- it only runs on macOS)
- **Node.js 20+** (LTS recommended)
- **An MCP client** such as Claude Desktop, Claude Code, Cursor, or Windsurf

## Quick Install

The fastest way to get started is the interactive setup wizard:

```bash
npx airmcp init
```

This will:

1. Ask which modules you want to enable (or choose "all")
2. Detect installed MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf)
3. Write the MCP server entry to each client's config file
4. Create `~/.config/airmcp/config.json` with your module selection

## Manual Setup

If you prefer manual configuration, add AirMCP to your MCP client's config file directly.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Claude Code

Edit `~/.claude/mcp.json`:

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

### Cursor

Edit `~/.cursor/mcp.json`:

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

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

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

## Enable All Modules

By default, AirMCP enables a starter set of modules (Notes, Reminders, Calendar, Shortcuts, System, Finder, Weather). To enable all 29 modules, use the `--full` flag:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "--full"]
    }
  }
}
```

Or set the environment variable:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp"],
      "env": {
        "AIRMCP_FULL": "true"
      }
    }
  }
}
```

## macOS Permissions

AirMCP uses JXA (JavaScript for Automation) to control macOS apps. The first time you use a module, macOS will prompt you to grant Accessibility or Automation permissions to your terminal or MCP client.

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
