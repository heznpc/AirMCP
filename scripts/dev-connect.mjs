#!/usr/bin/env node
/**
 * dev-connect.mjs — print Claude Desktop / Claude Code MCP client config snippets
 * for the currently checked-out AirMCP working copy.
 *
 * Usage:
 *   node scripts/dev-connect.mjs            # prints snippets to stdout
 *   node scripts/dev-connect.mjs --json     # prints a machine-readable JSON
 *   node scripts/dev-connect.mjs --name foo # use a different server name (default: airmcp-dev)
 *
 * This script does NOT modify any file. It just prints what to paste where,
 * because the Claude Desktop config lives in ~/Library/Application Support/Claude/
 * and belongs to the user, not to this repo.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = resolve(REPO_ROOT, "dist", "index.js");

function parseArgs(argv) {
  const args = { json: false, name: "airmcp-dev" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--name") args.name = argv[++i] ?? args.name;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

function help() {
  console.log(`dev-connect — print a Claude Desktop / Claude Code MCP entry for this repo.

Usage:
  node scripts/dev-connect.mjs [--name <server-name>] [--json]

Flags:
  --name <name>   Server key to use in the config (default: airmcp-dev)
  --json          Emit just the JSON snippet (no prose)
  -h, --help      Show this help
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  if (!existsSync(DIST_ENTRY)) {
    console.error(`[dev-connect] dist/index.js not found at ${DIST_ENTRY}`);
    console.error(`[dev-connect] Run "npm run build" first, or use "npm run dev:mcp" which builds for you.`);
    process.exitCode = 1;
    return;
  }

  const entry = {
    [args.name]: {
      command: "node",
      args: [DIST_ENTRY],
      env: {
        AIRMCP_ENV: "dev",
      },
    },
  };

  if (args.json) {
    console.log(JSON.stringify({ mcpServers: entry }, null, 2));
    return;
  }

  const home = process.env.HOME ?? "~";
  const desktopConfig = `${home}/Library/Application Support/Claude/claude_desktop_config.json`;

  console.log(`# AirMCP dev connection`);
  console.log(``);
  console.log(`Add this entry to the "mcpServers" object in:`);
  console.log(`  ${desktopConfig}`);
  console.log(``);
  console.log(`(or the equivalent in your Claude Code / Cursor MCP settings)`);
  console.log(``);
  console.log(`-------- paste START --------`);
  console.log(JSON.stringify(entry, null, 2));
  console.log(`--------- paste END ---------`);
  console.log(``);
  console.log(`Then fully quit and relaunch Claude Desktop — MCP servers are only`);
  console.log(`re-read on launch. In a new chat, the "${args.name}" server should`);
  console.log(`show up in the tools panel.`);
  console.log(``);
  console.log(`After any source change, run:   npm run build`);
  console.log(`Or use:                         npm run dev:mcp    (build + watch)`);
}

main();
