#!/usr/bin/env node
/**
 * verify-published-package.mjs — a forcing function on the SHIPPED npm artifact.
 *
 * Why this exists (RFC 0013 §4 floor applied to the shipped thing; root-cause in
 * RFC 0014): CI proved Swift *compiled* and `dist/` *built*, but nothing ever
 * booted the *packaged tarball* the way a user actually gets it via
 * `npx -y airmcp`. So packaging regressions shipped green:
 *   - a missing dist file (the banner.js npx crash — dist/index.js imported
 *     dist/shared/banner.js which wasn't present in the resolved package),
 *   - an incomplete `files` field,
 *   - a dist that builds locally but is broken once isolated from the repo.
 *
 * This packs the real tarball, installs it into a CLEAN throwaway project (no
 * repo on PATH, deps resolved fresh — exactly a user's environment), boots the
 * INSTALLED server under the pinned MCP Inspector, and asserts `tools/list`
 * round-trips with a substantial registered surface and the core JXA tools
 * present. It tests the artifact users run, not the repo working tree.
 *
 * It deliberately does NOT assert the Swift-backed tools *work* — those need the
 * optional bridge + real apps/permissions and are honestly surfaced elsewhere.
 * Its job is to catch "the published package is broken / incomplete" — the class
 * that four masking mechanisms (graceful degradation, local build artifacts, CI
 * compiles-but-doesn't-package, docs-ahead-of-distribution) let through before.
 *
 * Usage: node scripts/verify-published-package.mjs
 * Exit 0 = the packaged tarball boots clean and serves the expected surface.
 */

import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Keep in sync with scripts/mcp-validate.mjs — same pinned inspector.
const INSPECTOR_VERSION = "0.21.2";
const INSPECTOR_PKG = `@modelcontextprotocol/inspector@${INSPECTOR_VERSION}`;
const INSPECTOR_TIMEOUT_MS = 120_000;

// Surface floor for the DEFAULT boot. A plain `npx -y airmcp` (no --full, no
// config.json) applies the STARTER preset (config.ts:339) — a curated subset,
// ~125 tools here — NOT all 272. The "272 tools" headline is the --full /
// registered count (owned by count-stats + tool-count-drift). This gate tests
// the *default user experience*, so the floor only needs to catch "booted to
// near-empty" (a broken/incomplete package), robust to per-machine gating.
const MIN_TOOLS = 100;
// Tools that MUST be present in any environment (pure JXA, no bridge/hardware
// gate). If any of these is missing, the package shipped broken.
const REQUIRED_CORE_TOOLS = ["list_notes", "list_reminders", "list_events", "list_directory"];

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    console.error(`✗ command failed: ${cmd} ${args.join(" ")}`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    process.exit(1);
  }
  return (r.stdout || "").trim();
}

function bootAndList(entry, cwd) {
  return new Promise((done) => {
    const proc = spawn(
      "npx",
      ["-y", INSPECTOR_PKG, "--cli", "node", entry, "--method", "tools/list"],
      { cwd, env: { ...process.env, AIRMCP_TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      done({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, INSPECTOR_TIMEOUT_MS);
    proc.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

function parseTools(stdout) {
  // Inspector emits the JSON-RPC result on stdout; npx/npm notices may prefix it.
  // Slice from the first '{' and parse the largest valid JSON object.
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  for (let end = stdout.length; end > start; end--) {
    if (stdout[end - 1] !== "}") continue;
    try {
      const obj = JSON.parse(stdout.slice(start, end));
      if (obj && Array.isArray(obj.tools)) return obj.tools;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

const work = mkdtempSync(join(tmpdir(), "airmcp-pkgverify-"));
let tgz = null;
try {
  console.log("[1/3] npm pack (builds dist via prepublishOnly) …");
  // `npm pack` prints notices on stderr and the tarball name on stdout (last line).
  const packOut = sh("npm", ["pack"], { cwd: REPO_ROOT });
  const tgzName = packOut.split("\n").map((s) => s.trim()).filter(Boolean).pop();
  tgz = join(REPO_ROOT, tgzName);
  if (!existsSync(tgz)) {
    console.error(`✗ npm pack did not produce ${tgzName}`);
    process.exit(1);
  }
  console.log(`    packed ${tgzName}`);

  console.log("[2/3] clean install of the tarball into a throwaway project …");
  sh("npm", ["init", "-y"], { cwd: work });
  sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", tgz], { cwd: work });
  const entry = join(work, "node_modules", "airmcp", "dist", "index.js");
  if (!existsSync(entry)) {
    console.error(`✗ installed package is missing the entrypoint: ${entry}`);
    process.exit(1);
  }

  console.log("[3/3] boot the INSTALLED server under MCP Inspector …");
  // eslint-disable-next-line no-undef -- top-level await is fine in an ESM script
  const { code, stdout, stderr } = await bootAndList(entry, work);

  if (code !== 0) {
    console.error(`✗ installed server did not boot cleanly (exit ${code}).`);
    console.error("--- stdout ---\n" + stdout.slice(0, 4000));
    console.error("--- stderr ---\n" + stderr.slice(0, 4000));
    process.exit(1);
  }
  if (/ERR_MODULE_NOT_FOUND|Cannot find module/.test(stdout + stderr)) {
    console.error("✗ packaged tarball is missing a module at runtime (incomplete dist / files field).");
    console.error((stdout + stderr).slice(0, 4000));
    process.exit(1);
  }

  const tools = parseTools(stdout);
  if (!tools) {
    console.error("✗ could not parse a tools/list response from the installed server.");
    console.error("--- stdout ---\n" + stdout.slice(0, 4000));
    process.exit(1);
  }

  const names = new Set(tools.map((t) => t.name));
  const missing = REQUIRED_CORE_TOOLS.filter((n) => !names.has(n));
  const problems = [];
  if (tools.length < MIN_TOOLS) problems.push(`only ${tools.length} tools served (floor ${MIN_TOOLS})`);
  if (missing.length) problems.push(`missing required core tools: ${missing.join(", ")}`);

  if (problems.length) {
    console.error("✗ published tarball booted but the surface is wrong:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`✓ packaged tarball boots clean and serves ${tools.length} tools (core JXA tools present).`);
  console.log("  (This gate tests the SHIPPED artifact, closing the docs-ahead-of-distribution gap.)");
} finally {
  if (tgz) rmSync(tgz, { force: true });
  rmSync(work, { recursive: true, force: true });
}
