#!/usr/bin/env node
/**
 * Verify the registry-introspection container the way Glama does.
 *
 * Glama builds every listed server from a Dockerfile and runs the MCP
 * introspection exchange inside a sandbox. When that build or exchange fails the
 * listing stays up but distribution is withheld — the server drops out of search
 * results, category listings, and recommendations until a reproducible build
 * succeeds. That failure is silent from this side of the fence, which is why it
 * is asserted here rather than discovered from a registry email.
 *
 * This does NOT claim AirMCP works on Linux. Tool CALLS need JXA / osascript /
 * the Swift bridges and will fail in the container. What must hold is narrower:
 * the image builds, the server boots, it states its identity, and it answers
 * tools/list — which is the whole of what an indexer reads.
 *
 * Usage: node scripts/verify-container-introspection.mjs [--image <tag>]
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const imageIndex = args.indexOf("--image");
const IMAGE = imageIndex >= 0 ? args[imageIndex + 1] : "airmcp-registry-introspection";
// The cold-boot front door deliberately exposes a subset, so this floor only has
// to prove a real catalogue came back rather than an empty list.
const MIN_TOOLS = Number(process.env.CONTAINER_MIN_TOOLS ?? 10);
const TIMEOUT_MS = Number(process.env.CONTAINER_TIMEOUT_MS ?? 60_000);

function fail(message, detail) {
  console.error(`[container-introspection] FAIL — ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

const child = spawn("docker", ["run", "--rm", "-i", IMAGE], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
const messages = [];

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  let newline;
  while ((newline = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Boot banner and other non-JSON stdout noise.
    }
  }
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.on("error", (error) => fail(`could not run docker: ${error.message}`));

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "registry-introspection-probe", version: "0" },
  },
});

const initDeadline = Date.now() + TIMEOUT_MS;
const waitForInit = setInterval(() => {
  const init = messages.find((m) => m.id === 1);
  if (init) {
    clearInterval(waitForInit);
    if (!init.result) fail("initialize returned no result", JSON.stringify(init));
    if (!init.result.instructions) {
      fail("initialize carried no `instructions` — the identity claim an indexer reads would be empty");
    }
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const listDeadline = Date.now() + TIMEOUT_MS;
    const waitForList = setInterval(() => {
      const list = messages.find((m) => m.id === 2);
      if (list) {
        clearInterval(waitForList);
        const tools = list.result?.tools;
        if (!Array.isArray(tools)) fail("tools/list returned no tools array", JSON.stringify(list).slice(0, 400));
        if (tools.length < MIN_TOOLS) {
          fail(`tools/list returned ${tools.length} tools, expected at least ${MIN_TOOLS}`);
        }
        console.log(
          `[container-introspection] ok: ${IMAGE} booted, stated its identity, and listed ${tools.length} tools`,
        );
        child.kill();
        process.exit(0);
      }
      if (Date.now() > listDeadline) fail("timed out waiting for tools/list", stderr.slice(-800));
    }, 200);
    return;
  }
  if (Date.now() > initDeadline) fail("timed out waiting for initialize", stderr.slice(-800));
}, 200);
