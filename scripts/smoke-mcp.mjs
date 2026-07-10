#!/usr/bin/env node
// MCP stdio smoke test — boots `dist/index.js`, performs the required
// latest stable MCP handshake (initialize → notifications/initialized),
// asks for tools/list, and asserts the server returns a plausible
// number of tools.
//
// Intent: catch regressions that unit tests cannot — a bad module
// registration path, a top-level throw during server construction, or
// a regression in the MCP SDK wiring. This test does NOT invoke any
// tool handler that needs TCC permissions; the handshake + tools/list
// round-trip is the contract it guards.
//
// Boots at the DEFAULT (STARTER/progressive) surface via cleanBootEnv (see
// scripts/lib/clean-boot-env.mjs): the host's config.json and AIRMCP_* are
// stripped, so tools/list is the deterministic small front-door set on any
// runner (local or CI), not whatever the host has enabled. SMOKE_MIN_TOOLS
// defaults to 10 — enough to catch a near-empty boot while allowing the
// progressive exposure surface to stay token-light.
//
// Env knobs:
//   SMOKE_MIN_TOOLS  — minimum tools/list length to pass (default: 10)
//   SMOKE_TIMEOUT_MS — ms to wait for a full response set (default: 20_000)

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";
import { MCP_PROTOCOL_VERSION } from "./lib/mcp-stdio-client.mjs";

const MIN_TOOLS = Number(process.env.SMOKE_MIN_TOOLS ?? 10);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 20_000);

const server = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: cleanBootEnv(),
});

const rl = createInterface({ input: server.stdout });

// Track responses keyed by JSON-RPC id. The server may interleave
// notifications (no id) and responses; we only consume id-keyed rows.
const pending = new Map();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // banner line or stderr leak; ignore
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function request(method, params, id) {
  const payload = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
  server.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for id=${id} (${method})`));
      }
    }, TIMEOUT_MS);
  });
}

function notify(method) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

const watchdog = setTimeout(() => {
  console.error(`[smoke] overall timeout after ${TIMEOUT_MS}ms`);
  server.kill("SIGKILL");
  process.exit(2);
}, TIMEOUT_MS);

let exitCode = 0;
try {
  const initResp = await request(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "airmcp-smoke", version: "0.0.0" },
    },
    1,
  );
  if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
  notify("notifications/initialized");

  const toolsResp = await request("tools/list", {}, 2);
  const tools = toolsResp.result?.tools;
  if (!Array.isArray(tools)) throw new Error(`tools/list malformed: ${JSON.stringify(toolsResp)}`);
  if (tools.length < MIN_TOOLS) {
    throw new Error(`tools/list returned ${tools.length} tools; expected >= ${MIN_TOOLS}`);
  }
  console.error(`[smoke] OK — ${tools.length} tools registered`);
} catch (e) {
  console.error(`[smoke] FAIL — ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 1;
} finally {
  clearTimeout(watchdog);
  server.kill("SIGTERM");
  setTimeout(() => {
    if (!server.killed) server.kill("SIGKILL");
    process.exit(exitCode);
  }, 2000).unref();
}
