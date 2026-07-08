#!/usr/bin/env node
/**
 * Guard the public AirMCP footprint.
 *
 * Local developer worktrees can grow into GBs after Swift builds, but the
 * public source archive and npm tarball should stay small. This script makes
 * that distinction testable in CI and release preflight.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const args = process.argv.slice(2);

const DEFAULT_SOURCE_MAX = 10 * 1024 * 1024;
const DEFAULT_NPM_TARBALL_MAX = 1 * 1024 * 1024;
const DEFAULT_NPM_UNPACKED_MAX = 5 * 1024 * 1024;

function bytesFromMiB(value) {
  return Math.round(Number.parseFloat(value) * 1024 * 1024);
}

function optionBytes(name, fallback) {
  const prefix = `--${name}=`;
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return fallback;
  const value = bytesFromMiB(arg.slice(prefix.length));
  if (!Number.isFinite(value) || value <= 0) {
    fail(`invalid ${prefix}<MiB> value`);
  }
  return value;
}

const SOURCE_MAX = optionBytes("source-max-mib", DEFAULT_SOURCE_MAX);
const NPM_TARBALL_MAX = optionBytes("npm-max-mib", DEFAULT_NPM_TARBALL_MAX);
const NPM_UNPACKED_MAX = optionBytes("npm-unpacked-max-mib", DEFAULT_NPM_UNPACKED_MAX);

function fail(message, detail = "") {
  console.error(`public-size: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.toString?.() ?? "";
    const stderr = result.stderr?.toString?.() ?? "";
    fail(`command failed: ${cmd} ${cmdArgs.join(" ")}`, stderr || stdout);
  }
  return result;
}

function formatBytes(bytes) {
  const mib = bytes / 1024 / 1024;
  if (mib < 1) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${mib.toFixed(2)} MiB`;
}

function assertMax(label, actual, max) {
  if (actual > max) {
    fail(`${label} is ${formatBytes(actual)}, above budget ${formatBytes(max)}`);
  }
  console.log(`ok: ${label} ${formatBytes(actual)} <= ${formatBytes(max)}`);
}

function parseNpmPackJson(output) {
  const arrayStart = output.indexOf("[");
  const arrayEnd = output.lastIndexOf("]");
  const jsonText = arrayStart >= 0 && arrayEnd > arrayStart ? output.slice(arrayStart, arrayEnd + 1) : output;
  try {
    const [pack] = JSON.parse(jsonText);
    if (!pack) fail("npm pack dry-run returned no package metadata");
    return pack;
  } catch (error) {
    fail(`npm pack dry-run JSON was not parseable: ${error.message}`, output.slice(0, 2000));
  }
}

function verifySourceArchive() {
  const archive = run("git", ["archive", "--format=tar.gz", "HEAD"], { encoding: null });
  assertMax("source archive", archive.stdout.length, SOURCE_MAX);
}

function verifyTrackedPaths() {
  const output = run("git", ["ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }).stdout;
  const forbidden = output
    .split("\n")
    .filter(Boolean)
    .filter(
      (path) =>
        path === "node_modules" ||
        path.startsWith("node_modules/") ||
        path.includes("/node_modules/") ||
        path === ".build" ||
        path.includes("/.build/") ||
        (path.startsWith(".claude/") && !path.startsWith(".claude/commands/")) ||
        path.startsWith(".codex/") ||
        path.endsWith(".mcpb"),
    );
  if (forbidden.length) {
    fail(`tracked generated artifact path(s): ${forbidden.join(", ")}`);
  }
  console.log("ok: tracked paths exclude generated build artifacts");
}

function verifyNpmPack() {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  const restore = spawnSync(process.execPath, ["scripts/slim-root-package.mjs", "--restore"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (restore.status !== 0) {
    fail("failed to restore universal dist after npm pack dry-run", restore.stderr || restore.stdout);
  }
  if (result.status !== 0) {
    fail("command failed: npm pack --dry-run --json", result.stderr || result.stdout);
  }
  const pack = parseNpmPackJson(result.stdout);
  if (pack.name !== pkg.name || pack.version !== pkg.version) {
    fail(`npm pack metadata mismatch: expected ${pkg.name}@${pkg.version}, got ${pack.name}@${pack.version}`);
  }
  assertMax(`npm tarball ${pack.filename}`, pack.size, NPM_TARBALL_MAX);
  assertMax("npm unpacked size", pack.unpackedSize, NPM_UNPACKED_MAX);
}

verifyTrackedPaths();
verifySourceArchive();
verifyNpmPack();
