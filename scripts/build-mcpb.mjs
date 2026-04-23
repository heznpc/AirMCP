#!/usr/bin/env node
// Build an `.mcpb` Desktop Extensions bundle for Claude Desktop
// (spec: modelcontextprotocol/mcpb MANIFEST.md v0.3).
//
// Layout produced in build/mcpb/ before zipping:
//
//   manifest.json              — generated from mcpb/manifest.template.json
//   icon.png                   — copied from icons/airmcp-icon-256.png
//   server/
//     package.json             — trimmed: just deps, no scripts
//     dist/                    — Node build output (copy of repo dist/)
//     node_modules/            — production deps only (`npm install --omit=dev`)
//
// The resulting bundle is a single `.mcpb` zip that Claude Desktop's
// "Browse extensions" picks up with zero CLI interaction from the user.
//
// Notes on scope
// - `npm install --omit=dev --prefix server/` runs inside the build dir,
//   so the bundle is self-contained. Users don't need node_modules
//   pre-populated locally.
// - We do NOT sign or notarize the archive. Notarization is a follow-up
//   (P2-1); Claude Desktop currently accepts unsigned .mcpb.
// - We do NOT ship a swift-bridge binary yet. Cloud-path tools work
//   out of the box; Swift-backed tools (EventKit, HealthKit, etc.)
//   require `npm run swift-build` on the user side. A future pass can
//   pre-build a universal binary for darwin-arm64 + darwin-x64 and
//   drop it into the bundle.
//
// Usage:
//   npm run build:mcpb          # produce build/mcpb/airmcp-{version}.mcpb
//   npm run build:mcpb -- --check  # verify manifest substitution only, no zip

import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_DIR = join(ROOT, "build", "mcpb");
const TEMPLATE_PATH = join(ROOT, "mcpb", "manifest.template.json");
const CHECK_ONLY = process.argv.includes("--check");

// ── Read package.json for metadata ───────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

// ── Substitute manifest placeholders ─────────────────────────────────
const template = readFileSync(TEMPLATE_PATH, "utf-8");
const manifestText = template
  .replaceAll("{{VERSION}}", pkg.version)
  .replaceAll("{{DESCRIPTION}}", pkg.description.replace(/"/g, '\\"'));

// Parse-validate so a bad template fails here, not at Claude Desktop load.
let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch (e) {
  console.error(`[mcpb] template produced invalid JSON: ${e.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== "0.3") {
  console.error(`[mcpb] manifest_version mismatch (expected "0.3", got "${manifest.manifest_version}")`);
  process.exit(1);
}
if (manifest.version !== pkg.version) {
  console.error(`[mcpb] manifest.version (${manifest.version}) != package.json version (${pkg.version})`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.error(
    `[mcpb --check] manifest OK — v${manifest.version}, ${Object.keys(manifest.user_config ?? {}).length} user_config keys`,
  );
  process.exit(0);
}

// ── Fresh build dir ──────────────────────────────────────────────────
if (existsSync(BUILD_DIR)) rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });

// ── Write manifest + icon ────────────────────────────────────────────
writeFileSync(join(BUILD_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
cpSync(join(ROOT, "icons", "airmcp-icon-256.png"), join(BUILD_DIR, "icon.png"));

// ── Server tree ──────────────────────────────────────────────────────
const serverDir = join(BUILD_DIR, "server");
mkdirSync(serverDir, { recursive: true });

// Trim package.json: deps + minimal runtime metadata. No scripts (Claude
// Desktop does not run them), no dev-only fields (commitlint, lint-staged).
const trimmedPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  main: "dist/index.js",
  bin: pkg.bin,
  dependencies: pkg.dependencies,
  // Keep `overrides` so npm install respects the pinned Hono CVE fixes
  // (see CHANGELOG v2.10 Security entry).
  ...(pkg.overrides ? { overrides: pkg.overrides } : {}),
};
writeFileSync(join(serverDir, "package.json"), JSON.stringify(trimmedPkg, null, 2) + "\n");

// Build output — require that `npm run build` has produced dist/.
if (!existsSync(join(ROOT, "dist", "index.js"))) {
  console.error(`[mcpb] dist/index.js not found — run \`npm run build\` first`);
  process.exit(1);
}
cpSync(join(ROOT, "dist"), join(serverDir, "dist"), { recursive: true });

// ── Install production deps into the bundle ──────────────────────────
console.error("[mcpb] installing production dependencies into bundle…");
const npmInstall = spawnSync(
  "npm",
  ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline"],
  { cwd: serverDir, stdio: "inherit" },
);
if (npmInstall.status !== 0) {
  console.error(`[mcpb] npm install failed with status ${npmInstall.status}`);
  process.exit(1);
}

// Drop package-lock.json — runtime doesn't need it, and it inflates
// the bundle by ~200 KB.
const lockPath = join(serverDir, "package-lock.json");
if (existsSync(lockPath)) rmSync(lockPath);

// ── Zip ──────────────────────────────────────────────────────────────
const outPath = join(BUILD_DIR, `airmcp-${pkg.version}.mcpb`);
console.error(`[mcpb] zipping → ${outPath}`);

// Use the system zip CLI — macOS ships it by default, every CI runner
// has it, and writing our own ZIP encoder for one use-case is scope
// creep. The tradeoff is Windows CI would need a separate path, but
// AirMCP is macOS-first and Windows isn't a supported build host.
const zipResult = spawnSync(
  "zip",
  ["-r", "-q", `airmcp-${pkg.version}.mcpb`, "manifest.json", "icon.png", "server"],
  { cwd: BUILD_DIR, stdio: "inherit" },
);
if (zipResult.status !== 0) {
  console.error(`[mcpb] zip failed with status ${zipResult.status}`);
  process.exit(1);
}

const outStat = statSync(outPath);
console.error(
  `[mcpb] OK — ${outPath} (${(outStat.size / 1024 / 1024).toFixed(2)} MB, ${Object.keys(manifest.user_config ?? {}).length} user_config keys)`,
);
