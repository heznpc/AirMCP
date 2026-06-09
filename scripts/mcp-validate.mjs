#!/usr/bin/env node
/**
 * mcp-validate.mjs — wrapper around @modelcontextprotocol/inspector --cli.
 *
 * Why a wrapper (not a one-line npm script):
 *
 * 1. Pinned inspector version. `npx -y @modelcontextprotocol/inspector` is
 *    unpinned — every CI run resolves whatever was published most recently,
 *    so an inspector breaking change blocks unrelated PRs and a supply-chain
 *    compromise lands in CI on the next push. Pinned to INSPECTOR_VERSION
 *    below; bump deliberately, not by accident.
 *
 * 2. Captures BOTH stdout and stderr instead of `> /dev/null`. The previous
 *    one-liner discarded stdout (which is where inspector emits the JSON-RPC
 *    `error` envelopes on hard failures) and only forwarded the exit code.
 *    Soft warnings on stderr were lost in CI log noise. This script captures
 *    both streams, exits non-zero on (a) child exit != 0, (b) any `"error"`
 *    or `"isError":true` token in the response, (c) zero-tool response.
 *
 * 3. Boots via cleanBootEnv (scripts/lib/clean-boot-env.mjs) — the shared env
 *    for all three boot gates (smoke-mcp / verify-published / here). It strips
 *    host AIRMCP_*, pins a STARTER config path, and sets AIRMCP_TEST_MODE=1, so
 *    the three gates measure the same default surface instead of drifting on
 *    whatever the host has configured.
 *
 * 4. Bounded by an internal timeout (INSPECTOR_TIMEOUT_MS). Inspector usually
 *    exits cleanly after `--method tools/list`, but a teardown bug in the
 *    server (orphan timer, open socket, stdin-close without exit) could
 *    otherwise let the CI runner sit until GitHub's default 6 h budget.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Bump deliberately when validating against a new inspector release.
const INSPECTOR_VERSION = "0.21.2";
const INSPECTOR_PKG = `@modelcontextprotocol/inspector@${INSPECTOR_VERSION}`;

const INSPECTOR_TIMEOUT_MS = 90_000;

function run() {
  return new Promise((resolveRun) => {
    const proc = spawn(
      "npx",
      ["-y", INSPECTOR_PKG, "--cli", "node", resolve(REPO_ROOT, "dist/index.js"), "--method", "tools/list"],
      {
        cwd: REPO_ROOT,
        env: cleanBootEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolveRun({ code: 124, stdout, stderr: stderr + `\n[mcp-validate] timed out after ${INSPECTOR_TIMEOUT_MS}ms` });
    }, INSPECTOR_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

const { code, stdout, stderr } = await run();

// 1. Hard failure — non-zero child exit.
if (code !== 0) {
  process.stderr.write(`[mcp-validate] inspector exited with code ${code}\n`);
  if (stderr) process.stderr.write(`--- stderr ---\n${stderr}\n`);
  if (stdout) process.stderr.write(`--- stdout (last 2000 chars) ---\n${stdout.slice(-2000)}\n`);
  process.exit(code);
}

// 2. Soft failure — response contains JSON-RPC error envelope or isError.
//    A malformed tool registration can let tools/list return some tools while
//    embedding an error for the bad one. The previous `> /dev/null` would
//    have hidden this.
if (/"error"\s*:|"isError"\s*:\s*true/.test(stdout)) {
  process.stderr.write(`[mcp-validate] response contains an error envelope\n`);
  process.stderr.write(`--- stdout (last 4000 chars) ---\n${stdout.slice(-4000)}\n`);
  if (stderr) process.stderr.write(`--- stderr ---\n${stderr}\n`);
  process.exit(1);
}

// 3. Sanity — parse the response and require at least one tool.
try {
  const parsed = JSON.parse(stdout);
  const toolCount = Array.isArray(parsed?.tools) ? parsed.tools.length : 0;
  if (toolCount === 0) {
    process.stderr.write(`[mcp-validate] tools/list returned zero tools — expected ≥1\n`);
    process.exit(1);
  }
  process.stderr.write(`[mcp-validate] ok — ${toolCount} tools, inspector ${INSPECTOR_VERSION}\n`);
} catch (e) {
  process.stderr.write(`[mcp-validate] tools/list response is not valid JSON: ${e instanceof Error ? e.message : String(e)}\n`);
  process.stderr.write(`--- stdout (first 2000 chars) ---\n${stdout.slice(0, 2000)}\n`);
  process.exit(1);
}
