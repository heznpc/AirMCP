#!/usr/bin/env node
/**
 * Dry release preflight.
 *
 * Builds and inspects the artifacts a user would install before any publish
 * step is allowed to run. This is intentionally local/CI-only: it never creates
 * a tag, never calls npm publish, and never mutates a GitHub Release.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const OUT_DIR = join(ROOT, "build", "release-preflight");
const args = new Set(process.argv.slice(2));
const INCLUDE_APP = args.has("--app");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const rendered = [cmd, ...cmdArgs].join(" ");
    console.error(`release-preflight: command failed (${result.status}): ${rendered}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function fail(message) {
  console.error(`release-preflight: ${message}`);
  process.exit(1);
}

function assertFile(path, label) {
  if (!existsSync(path)) fail(`${label} missing: ${path}`);
  const size = statSync(path).size;
  if (size <= 0) fail(`${label} is empty: ${path}`);
  return size;
}

function listZip(path) {
  const output = run("unzip", ["-Z1", path], { capture: true });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readZipJson(path, entry) {
  const output = run("unzip", ["-p", path, entry], { capture: true });
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`${entry} in ${path} is not valid JSON: ${error.message}`);
  }
}

function verifyNpmDryRun() {
  const output = run("npm", ["pack", "--dry-run", "--json"], { capture: true });
  let pack;
  try {
    [pack] = JSON.parse(output);
  } catch (error) {
    fail(`npm pack --dry-run --json did not return parseable JSON: ${error.message}`);
  }
  if (!pack || pack.version !== version) {
    fail(`npm dry-run version mismatch: expected ${version}, got ${pack?.version ?? "none"}`);
  }
  const filePaths = (pack.files ?? []).map((file) => file.path);
  const forbidden = filePaths.filter(
    (path) =>
      path.startsWith("build/") ||
      path.startsWith("experiments/") ||
      path.endsWith(".mcpb") ||
      path.endsWith(".env") ||
      path === ".npmrc",
  );
  if (forbidden.length) {
    fail(`npm dry-run includes non-shipped or sensitive paths: ${forbidden.join(", ")}`);
  }
  if (!filePaths.includes("dist/index.js")) {
    fail("npm dry-run is missing dist/index.js");
  }
  console.log(`ok: npm dry-run: ${pack.filename}, ${filePaths.length} files, dist-only publish surface`);
}

function verifyMcpb(path) {
  const size = assertFile(path, ".mcpb");
  const entries = listZip(path);
  const required = ["manifest.json", "icon.png", "server/package.json", "server/dist/index.js"];
  const missing = required.filter((entry) => !entries.includes(entry));
  if (missing.length) fail(`.mcpb is missing required entries: ${missing.join(", ")}`);
  if (!entries.some((entry) => entry.startsWith("server/node_modules/"))) {
    fail(".mcpb is missing bundled production dependencies under server/node_modules/");
  }
  const forbidden = entries.filter(
    (entry) =>
      entry.startsWith("src/") ||
      entry.startsWith("experiments/") ||
      entry.includes("/experiments/") ||
      entry.endsWith(".env") ||
      entry === ".npmrc" ||
      entry.endsWith("/.npmrc"),
  );
  if (forbidden.length) fail(`.mcpb includes forbidden paths: ${forbidden.join(", ")}`);

  const manifest = readZipJson(path, "manifest.json");
  if (manifest.version !== version) {
    fail(`.mcpb manifest version mismatch: expected ${version}, got ${manifest.version}`);
  }
  if (manifest.manifest_version !== "0.3") {
    fail(`.mcpb manifest_version mismatch: expected 0.3, got ${manifest.manifest_version}`);
  }
  console.log(`ok: .mcpb: ${path} (${(size / 1024 / 1024).toFixed(2)} MB), manifest v${manifest.version}`);
}

function buildAppArchive() {
  run("bash", ["scripts/bundle-app.sh", "bundle"], {
    env: { ...process.env, AIRMCP_SKIP_WIDGET: "1" },
  });
  const appPath = join(ROOT, "AirMCP.app");
  assertFile(join(appPath, "Contents", "MacOS", "AirMCP"), "AirMCP.app executable");
  const zipPath = join(OUT_DIR, `AirMCP-${version}-adhoc.zip`);
  run("ditto", ["-c", "-k", "--norsrc", "--keepParent", appPath, zipPath]);
  const size = assertFile(zipPath, "ad-hoc app archive");
  console.log(`ok: ad-hoc app archive: ${zipPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log(`release-preflight: AirMCP v${version}`);
run("npm", ["run", "build"]);
run("npm", ["run", "tokens:check"]);
run("npm", ["run", "profiles:check"]);
run("npm", ["run", "harness:check"]);
run("npm", ["run", "addons:check"]);
run("npm", ["run", "addons:verify-install"]);
run("npm", ["run", "verify:package"]);
verifyNpmDryRun();
run("npm", ["run", "build:mcpb"]);

const mcpbPath = join(ROOT, "build", "mcpb", `airmcp-${version}.mcpb`);
verifyMcpb(mcpbPath);
copyFileSync(mcpbPath, join(OUT_DIR, `airmcp-${version}.mcpb`));

if (INCLUDE_APP) {
  buildAppArchive();
} else {
  console.log("release-preflight: skipping app bundle archive (pass --app to include it)");
}

console.log(`ok: release preflight artifacts ready in ${OUT_DIR}`);
