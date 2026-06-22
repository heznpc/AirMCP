---
title: Installation
description: How to install and set up AirMCP on your Mac.
---

## Prerequisites

- **macOS** (AirMCP uses JXA and Apple frameworks -- it only runs on macOS)
- **Node.js 20+** (LTS recommended)
- **An MCP client** such as Claude Desktop, Claude Code, Cursor, or Windsurf

## Quick Install

The recommended desktop runtime is AirMCP.app: start the menubar app once, then connect Claude, Codex, Cursor, Windsurf, or another MCP client to the app-owned loopback server. The CLI wizard configures detected clients for that shape:

```bash
npx airmcp init
```

This will:

1. Ask which modules you want to enable (or choose "all")
2. Detect installed MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf)
3. Write an AirMCP.app-owned runtime entry to each client's config file
4. Create `~/.config/airmcp/config.json` with your module selection

## Manual Setup

If you prefer manual configuration, start AirMCP.app first. HTTP-capable clients connect to `http://127.0.0.1:3847/mcp`; stdio-only clients use `npx -y airmcp connect` as a proxy into that app-owned runtime.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "airmcp": {
      "command": "npx",
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"]
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
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"]
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
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"]
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
      "args": ["-y", "airmcp", "connect", "--url", "http://127.0.0.1:3847/mcp"]
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
