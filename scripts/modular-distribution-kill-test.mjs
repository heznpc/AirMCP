#!/usr/bin/env node
/**
 * Decide whether the physical add-on split has enough evidence to stay on the
 * publish path.
 *
 * This gate intentionally reads artifacts from the lower-level probes instead
 * of reinterpreting docs:
 *   - build/addons/split-measurement.json
 *   - build/addons/first-user-addon-drill.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build", "addons");
const DEFAULT_SPLIT_INPUT = join(BUILD_DIR, "split-measurement.json");
const DEFAULT_FIRST_USER_INPUT = join(BUILD_DIR, "first-user-addon-drill.json");
const DEFAULT_OUTPUT = join(BUILD_DIR, "modular-distribution-kill-test.json");

function fail(message) {
  console.error(`[addons:kill-test] FAIL - ${message}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (result.status !== 0) {
    console.error(`[addons:kill-test] command failed: ${cmd} ${args.join(" ")}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function parseArgs() {
  let noBuild = false;
  let jsonOnly = false;
  let splitInput = DEFAULT_SPLIT_INPUT;
  let firstUserInput = DEFAULT_FIRST_USER_INPUT;
  let output = DEFAULT_OUTPUT;

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--no-build") {
      noBuild = true;
      continue;
    }
    if (arg === "--json") {
      jsonOnly = true;
      continue;
    }
    if (arg === "--split-input") {
      const value = process.argv[i + 1];
      if (!value) fail("--split-input requires a path");
      splitInput = resolve(ROOT, value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--split-input=")) {
      splitInput = resolve(ROOT, arg.slice("--split-input=".length));
      continue;
    }
    if (arg === "--first-user-input") {
      const value = process.argv[i + 1];
      if (!value) fail("--first-user-input requires a path");
      firstUserInput = resolve(ROOT, value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--first-user-input=")) {
      firstUserInput = resolve(ROOT, arg.slice("--first-user-input=".length));
      continue;
    }
    if (arg === "--output") {
      const value = process.argv[i + 1];
      if (!value) fail("--output requires a path");
      output = resolve(ROOT, value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      output = resolve(ROOT, arg.slice("--output=".length));
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  return { noBuild, jsonOnly, splitInput, firstUserInput, output };
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} artifact missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function displayPath(path) {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function gate(name, ok, evidence, blocker) {
  return { name, ok, evidence, blocker: ok ? null : blocker };
}

function decide(split, firstUser) {
  const delta = split.delta ?? {};
  const gates = [
    gate(
      "size-win",
      split.decision !== "weak-size-win" &&
        delta.packedBytesSaved > 0 &&
        delta.unpackedBytesSaved > 0 &&
        delta.packageDirBytesSaved > 0,
      {
        decision: split.decision,
        packedBytesSaved: delta.packedBytesSaved,
        unpackedBytesSaved: delta.unpackedBytesSaved,
        packageDirBytesSaved: delta.packageDirBytesSaved,
      },
      "slim root plus selected add-ons did not beat the universal package on packed, unpacked, and installed package-dir bytes",
    ),
    gate(
      "startup-or-neutral",
      typeof delta.initMsSaved === "number" && delta.initMsSaved >= -250,
      { initMsSaved: delta.initMsSaved, toolsListMsSaved: delta.toolsListMsSaved },
      "split startup regressed by more than the 250ms local-noise budget",
    ),
    gate(
      "first-user-install-prompt",
      firstUser.ok === true &&
        Boolean(firstUser.rootOnly?.installPrompt?.message) &&
        Boolean(firstUser.rootOnly?.mcpDryRunCommand),
      {
        prompt: firstUser.rootOnly?.installPrompt?.message ?? null,
        dryRunCommand: firstUser.rootOnly?.mcpDryRunCommand ?? null,
      },
      "root-only slim install did not surface a user-actionable add-on install prompt",
    ),
    gate(
      "confirm-gated-install",
      firstUser.rootOnly?.confirmRequired === true &&
        firstUser.installedRuntime?.installToolDryRun?.dryRun === true &&
        firstUser.installedRuntime?.installToolDryRun?.confirmed !== true,
      {
        confirmRequired: firstUser.rootOnly?.confirmRequired,
        dryRun: firstUser.installedRuntime?.installToolDryRun?.dryRun,
        confirmed: firstUser.installedRuntime?.installToolDryRun?.confirmed,
      },
      "MCP add-on install path was not proven dry-run-first and confirmation-gated",
    ),
    gate(
      "installed-addon-load-bearing",
      firstUser.installedPrefix?.installStatus === "installed" &&
        Array.isArray(firstUser.installedRuntime?.modulesEnabled) &&
        firstUser.installedRuntime.modulesEnabled.length > 0 &&
        Array.isArray(firstUser.installedRuntime?.modulesMissingAddonPackages) &&
        firstUser.installedRuntime.modulesMissingAddonPackages.length === 0,
      {
        installStatus: firstUser.installedPrefix?.installStatus,
        modulesEnabled: firstUser.installedRuntime?.modulesEnabled,
        missingAddonPackages: firstUser.installedRuntime?.modulesMissingAddonPackages,
      },
      "installed add-on did not load cleanly in external-only mode",
    ),
  ];

  const blockers = gates.filter((item) => !item.ok);
  return {
    decision: blockers.length ? "kill-or-hold" : "continue",
    blockers: blockers.map((item) => ({ gate: item.name, reason: item.blocker })),
    gates,
  };
}

const args = parseArgs();

if (!args.noBuild) {
  console.log("[1/3] run split measurement and first-user drill");
  sh("npm", ["run", "addons:measure-split", "--", "--require-size-win"], { cwd: ROOT });
  sh("npm", ["run", "addons:first-user-drill", "--", "--no-build"], { cwd: ROOT });
} else {
  console.log("[1/3] reuse existing split measurement and first-user drill artifacts");
}

console.log("[2/3] evaluate modular distribution evidence");
const split = readJson(args.splitInput, "split measurement");
const firstUser = readJson(args.firstUserInput, "first-user drill");
const verdict = decide(split, firstUser);
const report = {
  ok: verdict.decision === "continue",
  decision: verdict.decision,
  version: split.version ?? firstUser.version ?? null,
  scenario: split.scenario ?? firstUser.pack ?? null,
  inputs: {
    splitMeasurement: displayPath(args.splitInput),
    firstUserDrill: displayPath(args.firstUserInput),
  },
  ...verdict,
  output: displayPath(args.output),
};

console.log("[3/3] write kill-test artifact");
mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n");

if (args.jsonOnly) {
  console.log(JSON.stringify(report));
} else {
  console.log(`[addons:kill-test] decision=${report.decision}`);
  for (const item of report.gates) {
    console.log(`  ${item.ok ? "ok" : "block"} ${item.name}`);
  }
  console.log(`[addons:kill-test] wrote ${report.output}`);
}

if (!report.ok) {
  fail(report.blockers.map((item) => `${item.gate}: ${item.reason}`).join("; "));
}
