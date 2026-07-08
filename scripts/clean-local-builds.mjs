#!/usr/bin/env node
/**
 * Report and optionally remove ignored local build artifacts.
 *
 * Default mode is a dry run. Pass --apply to delete. The script only targets
 * known generated paths that are ignored by git, so source checkouts stay small
 * while local Swift/App builds can be reclaimed when they grow into GBs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const INCLUDE_DEPS = args.has("--deps") || args.has("--all");

const baseTargets = [
  "swift/.build",
  "ios/.build",
  "app/.build",
  "app/widget/.build",
  "build",
  "dist",
  "coverage",
  "AirMCP.app",
  "airmcp.mcpb",
  ".smithery",
  ".ruff_cache",
  "docs/site/.astro",
  "docs/site/dist",
];

const dependencyTargets = ["node_modules", "docs/site/node_modules"];

function fail(message) {
  console.error(`clean-local-builds: ${message}`);
  process.exit(1);
}

function relPath(absPath) {
  return relative(ROOT, absPath) || ".";
}

function assertInsideRoot(absPath) {
  if (absPath !== ROOT && !absPath.startsWith(`${ROOT}${sep}`)) {
    fail(`refusing to touch path outside repo: ${absPath}`);
  }
}

function addIfExists(targets, rel) {
  const abs = resolve(ROOT, rel);
  assertInsideRoot(abs);
  if (existsSync(abs)) targets.push(abs);
}

function addWorktreeTargets(targets) {
  const worktreesDir = resolve(ROOT, ".claude", "worktrees");
  if (!existsSync(worktreesDir)) return;
  for (const entry of readdirSync(worktreesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const prefix = `.claude/worktrees/${entry.name}`;
    for (const rel of [
      `${prefix}/swift/.build`,
      `${prefix}/ios/.build`,
      `${prefix}/app/.build`,
      `${prefix}/app/widget/.build`,
      `${prefix}/build`,
      `${prefix}/dist`,
      `${prefix}/coverage`,
      `${prefix}/docs/site/.astro`,
      `${prefix}/docs/site/dist`,
    ]) {
      addIfExists(targets, rel);
    }
    if (INCLUDE_DEPS) {
      for (const rel of [`${prefix}/node_modules`, `${prefix}/docs/site/node_modules`]) {
        addIfExists(targets, rel);
      }
    }
  }
}

function isIgnored(absPath) {
  const rel = relPath(absPath);
  const candidates = [rel];
  if (lstatSync(absPath).isDirectory() && !rel.endsWith("/")) {
    candidates.push(`${rel}/`);
  }
  return candidates.some((candidate) => {
    const result = spawnSync("git", ["check-ignore", "-q", "--", candidate], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return result.status === 0;
  });
}

function duKiB(absPath) {
  const result = spawnSync("du", ["-sk", absPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return 0;
  const [size] = result.stdout.trim().split(/\s+/);
  return Number.parseInt(size, 10) || 0;
}

function formatKiB(kib) {
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib < 10 ? 2 : 1)} MiB`;
  return `${(mib / 1024).toFixed(2)} GiB`;
}

const targets = [];
for (const rel of baseTargets) addIfExists(targets, rel);
if (INCLUDE_DEPS) {
  for (const rel of dependencyTargets) addIfExists(targets, rel);
}
addWorktreeTargets(targets);

const uniqueTargets = [...new Set(targets)].sort((a, b) => a.localeCompare(b));
const unsafe = uniqueTargets.filter((target) => !isIgnored(target));
if (unsafe.length) {
  fail(`refusing to remove non-ignored path(s): ${unsafe.map(relPath).join(", ")}`);
}

const measured = uniqueTargets
  .map((target) => ({ path: target, kib: duKiB(target) }))
  .filter((target) => target.kib > 0)
  .sort((a, b) => b.kib - a.kib);

if (!measured.length) {
  console.log("clean-local-builds: nothing to clean");
  process.exit(0);
}

const totalKiB = measured.reduce((sum, target) => sum + target.kib, 0);
console.log(`clean-local-builds: ${APPLY ? "deleting" : "dry run"} ${measured.length} ignored artifact path(s)`);
console.log(`clean-local-builds: reclaimable ${formatKiB(totalKiB)}`);
for (const target of measured) {
  console.log(`${formatKiB(target.kib).padStart(10)}  ${relPath(target.path)}`);
}

if (!APPLY) {
  console.log("clean-local-builds: pass --apply to delete these paths");
  console.log("clean-local-builds: pass --deps with --apply to include node_modules directories");
  process.exit(0);
}

for (const target of measured) {
  rmSync(target.path, { recursive: true, force: true });
}
console.log(`clean-local-builds: removed ${formatKiB(totalKiB)} of ignored local artifacts`);
