#!/usr/bin/env node
/**
 * dev-mcp.mjs — build once and launch dist/index.js over stdio,
 * so you can exercise the MCP server manually (or wire it into an MCP client).
 *
 * Usage:
 *   node scripts/dev-mcp.mjs                  # build + run stdio server
 *   node scripts/dev-mcp.mjs --http           # build + run HTTP mode on 3847
 *   node scripts/dev-mcp.mjs --no-build       # skip rebuild (use existing dist/)
 *   node scripts/dev-mcp.mjs --watch          # rebuild on src/ changes (simple polling)
 *
 * The script forwards unknown flags to dist/index.js untouched, so:
 *   node scripts/dev-mcp.mjs --http --port 4000
 * will launch HTTP mode on port 4000.
 *
 * Rationale: a contributor shouldn't need to remember "npm run build && node dist/index.js"
 * every time they change a tool. One command, prints what it's doing, exits cleanly.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, statSync, readdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = resolve(REPO_ROOT, "dist", "index.js");
const SRC_DIR = resolve(REPO_ROOT, "src");

function log(msg) {
  console.error(`[dev-mcp] ${msg}`);
}

function parseArgs(argv) {
  const opts = { build: true, watch: false, passthrough: [], help: false };
  for (const a of argv) {
    if (a === "--no-build") opts.build = false;
    else if (a === "--watch") opts.watch = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts.passthrough.push(a);
  }
  return opts;
}

function help() {
  console.log(`dev-mcp — build + run AirMCP locally.

Usage:
  node scripts/dev-mcp.mjs [--no-build] [--watch] [-- server flags...]

Flags:
  --no-build   Skip "npm run build" (use existing dist/)
  --watch      Rebuild on src/ changes (simple mtime polling, 1s interval)
  -h, --help   Show this help

Any other flag is forwarded to dist/index.js, e.g.:
  node scripts/dev-mcp.mjs --http --port 4000
`);
}

function runBuild() {
  log("building (npm run build)…");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    log(`build failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

/** Very small file watcher — no external dep. Returns the newest mtime under srcDir. */
function latestMtime(dir) {
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = resolve(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          const m = statSync(p).mtimeMs;
          if (m > latest) latest = m;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return latest;
}

function spawnServer(args) {
  log(`starting: node dist/index.js ${args.join(" ")}`);
  return spawn("node", [DIST_ENTRY, ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    help();
    return;
  }

  if (opts.build) runBuild();
  if (!existsSync(DIST_ENTRY)) {
    log(`dist/index.js missing at ${DIST_ENTRY}. Did the build succeed?`);
    process.exit(1);
  }

  if (!opts.watch) {
    const child = spawnServer(opts.passthrough);
    const onSig = (sig) => () => {
      log(`received ${sig}, forwarding to server…`);
      child.kill(sig);
    };
    process.on("SIGINT", onSig("SIGINT"));
    process.on("SIGTERM", onSig("SIGTERM"));
    child.on("exit", (code) => {
      log(`server exited (${code ?? "null"})`);
      process.exit(code ?? 0);
    });
    return;
  }

  // Watch mode: rebuild + restart on src/ changes.
  let child = spawnServer(opts.passthrough);
  let last = latestMtime(SRC_DIR);
  log(`watching ${SRC_DIR} for changes…`);
  setInterval(() => {
    const now = latestMtime(SRC_DIR);
    if (now > last) {
      last = now;
      log("change detected — rebuilding and restarting");
      child.kill("SIGTERM");
      try {
        runBuild();
      } catch (e) {
        log(`rebuild failed: ${e?.message ?? e}`);
        return;
      }
      child = spawnServer(opts.passthrough);
    }
  }, 1000).unref();

  const forward = (sig) => () => {
    log(`received ${sig}, shutting down`);
    child.kill(sig);
    setTimeout(() => process.exit(0), 100);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
}

main();
