#!/usr/bin/env node
/**
 * Measure the staged physical add-on split against the universal package.
 *
 * This is a kill-test, not a publish step. It builds a temporary slim root
 * package that removes non-core module entrypoints while keeping shared/static
 * helper files required by the always-imported runtime, then compares:
 *
 *   universal bundled root       vs       slim root + selected add-ons
 *
 * Thresholds are intentionally not baked in. The script exits non-zero only
 * when it cannot build, install, boot, or measure the artifacts. Pass
 * `--require-size-win` when a future owner-ratified release gate wants weak
 * size evidence to block.
 */

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build", "addons");
const DEFAULT_OUTPUT = join(BUILD_DIR, "split-measurement.json");
const TIMEOUT_MS = Number(process.env.ADDON_SPLIT_MEASURE_TIMEOUT_MS ?? 45_000);
const COMPATIBILITY_OPTIONAL_MODULES = new Set(["health", "intelligence"]);

const PACK_ASSERTIONS = {
  productivity: {
    profile: "productivity",
    requiredModules: ["pages", "numbers", "keynote"],
    forbiddenModules: ["contacts", "mail", "messages"],
  },
};

let profileModulesByName = null;

function fail(message) {
  console.error(`[addons:measure-split] FAIL — ${message}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (result.status !== 0) {
    console.error(`[addons:measure-split] command failed: ${cmd} ${args.join(" ")}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function parseArgs() {
  const packs = [];
  let all = false;
  let noBuild = false;
  let jsonOnly = false;
  let requireSizeWin = false;
  let output = DEFAULT_OUTPUT;

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--no-build") {
      noBuild = true;
      continue;
    }
    if (arg === "--json") {
      jsonOnly = true;
      continue;
    }
    if (arg === "--require-size-win") {
      requireSizeWin = true;
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
    if (arg === "--pack") {
      const value = process.argv[i + 1];
      if (!value) fail("--pack requires a pack name");
      packs.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--pack=")) {
      packs.push(arg.slice("--pack=".length));
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  if (all && packs.length) fail("--all cannot be combined with --pack");
  return { all, packs: packs.length ? packs : ["productivity"], noBuild, jsonOnly, requireSizeWin, output };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function npmPack(cwd) {
  const output = sh("npm", ["pack", "--json"], { cwd });
  let parsed;
  try {
    const arrayStart = output.indexOf("[");
    const arrayEnd = output.lastIndexOf("]");
    const jsonText = arrayStart >= 0 && arrayEnd > arrayStart ? output.slice(arrayStart, arrayEnd + 1) : output;
    parsed = JSON.parse(jsonText);
  } catch (error) {
    fail(`npm pack output was not JSON in ${cwd}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first?.filename) fail(`npm pack did not report a filename in ${cwd}`);
  const tgz = join(cwd, first.filename);
  if (!existsSync(tgz)) fail(`npm pack did not create ${tgz}`);
  return {
    tgz,
    filename: first.filename,
    packageSize: first.size,
    unpackedSize: first.unpackedSize,
  };
}

function packageDirName(packageName) {
  return packageName.replace(/^@/, "").replace("/", "__");
}

function packageInstallPath(work, packageName) {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    return join(work, "node_modules", scope, name);
  }
  return join(work, "node_modules", packageName);
}

function dirSizeBytes(path) {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += dirSizeBytes(join(path, entry));
  }
  return total;
}

function parseStructuredResult(callResp) {
  const result = callResp.result;
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find?.((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getProfileModuleSet(profile) {
  if (!profileModulesByName) {
    const profilesUrl = pathToFileURL(join(ROOT, "dist", "shared", "profiles.js")).href;
    const { PROFILE_MODULES } = await import(profilesUrl);
    profileModulesByName = PROFILE_MODULES;
  }
  return new Set(profileModulesByName[profile] ?? profileModulesByName.full ?? []);
}

async function getExpectedPackModules(packNames, packManifest, profile) {
  const profileModules = await getProfileModuleSet(profile);
  return [
    ...new Set(
      packNames.flatMap((packName) => {
        const pack = packManifest.find((candidate) => candidate.name === packName);
        return (pack?.modules ?? []).filter((moduleName) => profileModules.has(moduleName));
      }),
    ),
  ];
}

function getAddonLoadFailureLines(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.includes("required add-on package module failed to load") ||
        line.includes("Cannot find package '@heznpc/airmcp-"),
    );
}

function startMcp(entry, cwd, env) {
  const proc = spawn("node", [entry], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map();
  let stderr = "";
  let closed = false;
  let stopping = null;

  proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  proc.on("close", () => {
    closed = true;
  });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: resolvePending, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolvePending(msg);
    }
  });

  function request(method, params, id) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rejectReq(new Error(`timeout waiting for id=${id} (${method})`));
        }
      }, TIMEOUT_MS);
      pending.set(id, { resolve: resolveReq, timer });
    });
  }

  function notify(method) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  function stop() {
    if (closed) return Promise.resolve();
    if (stopping) return stopping;
    stopping = new Promise((resolveStop) => {
      rl.close();
      try {
        proc.stdin.end();
      } catch {
        /* child may already be gone */
      }
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
      const timer = setTimeout(() => {
        if (!closed) proc.kill("SIGKILL");
        resolveStop();
      }, 1000);
      timer.unref();
      proc.once("close", () => {
        clearTimeout(timer);
        resolveStop();
      });
      proc.kill("SIGTERM");
    });
    return stopping;
  }

  return { request, notify, stop, stderr: () => stderr };
}

function expectNoWireError(resp, label) {
  if (resp.error || resp.result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(resp)}`);
  }
}

async function bootAndMeasure({ entry, work, profile, packNames, addonMode, expectedModules, forbiddenModules }) {
  const env = {
    ...cleanBootEnv(),
    AIRMCP_PROFILE: profile,
    AIRMCP_TOOL_EXPOSURE: "profile",
    AIRMCP_MODULE_PACKS: ["core", ...packNames].join(","),
    AIRMCP_ADDON_PACKAGE_MODE: addonMode,
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
  };

  const started = performance.now();
  const client = startMcp(entry, work, env);
  const watchdog = setTimeout(() => {
    client.stop().finally(() => fail(`MCP boot measurement timed out after ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "airmcp-addon-split-measure", version: "0.0.0" },
      },
      1,
    );
    if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
    const initMs = performance.now() - started;
    client.notify("notifications/initialized");

    const listStarted = performance.now();
    const listResp = await client.request("tools/list", {}, 2);
    const listMs = performance.now() - listStarted;
    const tools = listResp.result?.tools;
    if (!Array.isArray(tools) || tools.length < 10) {
      throw new Error(`tools/list malformed or too small: ${JSON.stringify(listResp)}`);
    }

    const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
    expectNoWireError(statusResp, "profile_status");
    const status = parseStructuredResult(statusResp);
    if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);

    const stderr = client.stderr();
    const loadFailures = getAddonLoadFailureLines(stderr);
    if (addonMode === "external-only" && loadFailures.length) {
      throw new Error(`split install emitted required add-on load failures:\n${loadFailures.slice(-20).join("\n")}`);
    }

    const compatibilitySkipped = [];
    for (const moduleName of expectedModules) {
      if (!status.modulesEnabled?.includes?.(moduleName)) {
        if (COMPATIBILITY_OPTIONAL_MODULES.has(moduleName)) {
          compatibilitySkipped.push(moduleName);
          continue;
        }
        throw new Error(`module ${moduleName} was not enabled in ${addonMode} mode: ${JSON.stringify(status)}`);
      }
    }

    for (const moduleName of forbiddenModules) {
      if (status.modulesEnabled?.includes?.(moduleName)) {
        throw new Error(`module ${moduleName} should not be enabled: ${JSON.stringify(status)}`);
      }
    }

    return {
      initMs: Math.round(initMs),
      toolsListMs: Math.round(listMs),
      toolsExposed: tools.length,
      toolsRegistered: status.toolsRegistered,
      modulesEnabled: status.modulesEnabled,
      compatibilitySkipped,
    };
  } catch (error) {
    const stderr = client.stderr();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- stderr ---\n${stderr.slice(-4000)}`,
    );
  } finally {
    clearTimeout(watchdog);
    await client.stop();
  }
}

function makeSlimRootPackageSource(packManifest) {
  const rootPkg = readJson(join(ROOT, "package.json"));
  const sourceDir = mkdtempSync(join(tmpdir(), "airmcp-slim-root-src-"));
  cpSync(join(ROOT, "dist"), join(sourceDir, "dist"), { recursive: true });

  const removed = [];
  for (const pack of packManifest) {
    if (pack.name === "core") continue;
    for (const moduleName of pack.modules) {
      for (const fileName of ["tools.js", "prompts.js"]) {
        const filePath = join(sourceDir, "dist", moduleName, fileName);
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
          removed.push(`dist/${moduleName}/${fileName}`);
        }
      }
    }
  }

  const slimPkg = {
    ...rootPkg,
    airmcp: {
      ...(rootPkg.airmcp ?? {}),
      slimRootExperiment: true,
      removedModuleEntrypoints: removed,
    },
  };
  writeFileSync(join(sourceDir, "package.json"), JSON.stringify(slimPkg, null, 2) + "\n");
  return { sourceDir, removed };
}

async function installAndMeasure({
  label,
  rootPack,
  addonPacks,
  packNames,
  profile,
  addonMode,
  expectedModules,
  forbiddenModules,
}) {
  const work = mkdtempSync(join(tmpdir(), `airmcp-split-${label}-`));
  try {
    sh("npm", ["init", "-y"], { cwd: work });
    sh(
      "npm",
      ["install", "--no-audit", "--no-fund", "--no-save", rootPack.tgz, ...addonPacks.map((pack) => pack.tgz)],
      {
        cwd: work,
      },
    );
    const entry = join(work, "node_modules", "airmcp", "dist", "index.js");
    if (!existsSync(entry)) fail(`${label} install is missing ${entry}`);

    const packagePaths = [
      packageInstallPath(work, "airmcp"),
      ...addonPacks.map((pack) => packageInstallPath(work, pack.packageName)),
    ];
    const packageDirBytes = packagePaths.reduce((sum, path) => sum + dirSizeBytes(path), 0);
    const nodeModulesBytes = dirSizeBytes(join(work, "node_modules"));
    const boot = await bootAndMeasure({
      entry,
      work,
      profile,
      packNames,
      addonMode,
      expectedModules,
      forbiddenModules,
    });
    return { packageDirBytes, nodeModulesBytes, ...boot };
  } finally {
    if (process.env.AIRMCP_KEEP_SPLIT_MEASURE_WORKDIR !== "true") {
      rmSync(work, { recursive: true, force: true });
    } else {
      console.error(`[addons:measure-split] kept ${label} workdir: ${work}`);
    }
  }
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + item[key], 0);
}

function formatBytes(bytes) {
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${sign}${(abs / 1024 / 1024).toFixed(2)}MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(1)}KB`;
  return `${sign}${abs}B`;
}

function formatMs(ms) {
  return `${ms}ms`;
}

function displayPath(path) {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function printSummary(measurement) {
  const { universal, split, delta } = measurement;
  const rows = [
    ["packed", formatBytes(universal.packedBytes), formatBytes(split.packedBytes), formatBytes(delta.packedBytesSaved)],
    [
      "unpacked",
      formatBytes(universal.unpackedBytes),
      formatBytes(split.unpackedBytes),
      formatBytes(delta.unpackedBytesSaved),
    ],
    [
      "installed package dirs",
      formatBytes(universal.packageDirBytes),
      formatBytes(split.packageDirBytes),
      formatBytes(delta.packageDirBytesSaved),
    ],
    [
      "node_modules total",
      formatBytes(universal.nodeModulesBytes),
      formatBytes(split.nodeModulesBytes),
      formatBytes(delta.nodeModulesBytesSaved),
    ],
    ["initialize", formatMs(universal.initMs), formatMs(split.initMs), formatMs(delta.initMsSaved)],
    ["tools/list", formatMs(universal.toolsListMs), formatMs(split.toolsListMs), formatMs(delta.toolsListMsSaved)],
    ["tools exposed", String(universal.toolsExposed), String(split.toolsExposed), String(delta.toolsExposed)],
    [
      "tools registered",
      String(universal.toolsRegistered),
      String(split.toolsRegistered),
      String(delta.toolsRegistered),
    ],
  ];

  console.log(`[addons:measure-split] scenario=${measurement.scenario} profile=${measurement.profile}`);
  console.log("metric                  universal        slim+addons      saved");
  for (const [metric, left, right, saved] of rows) {
    console.log(`${metric.padEnd(23)} ${left.padStart(12)}   ${right.padStart(12)}   ${saved.padStart(10)}`);
  }
  console.log(`[addons:measure-split] decision=${measurement.decision}`);
  if (split.compatibilitySkipped.length) {
    console.log(`[addons:measure-split] compatibility-gated skipped: ${split.compatibilitySkipped.join(", ")}`);
  }
  console.log(`[addons:measure-split] wrote ${measurement.output}`);
}

function decide(delta) {
  const sizeWin = delta.packedBytesSaved > 0 && delta.unpackedBytesSaved > 0 && delta.packageDirBytesSaved > 0;
  const startupWin = delta.initMsSaved > 0;
  if (sizeWin && startupWin) return "size-and-startup-win";
  if (sizeWin) return "size-win-startup-neutral";
  return "weak-size-win";
}

const args = parseArgs();
let slimSourceDir = null;
const tarballs = [];

try {
  if (!args.noBuild) {
    console.log("[1/6] build root dist and stage add-on packages");
    sh("npm", ["run", "build"], { cwd: ROOT });
    sh(process.execPath, ["scripts/build-addon-packages.mjs", "--check"], { cwd: ROOT });
  } else {
    console.log("[1/6] reuse existing dist and staged add-on packages");
    if (!existsSync(join(ROOT, "dist", "index.js"))) fail("dist/index.js missing; run without --no-build first");
    if (!existsSync(join(BUILD_DIR, "manifest.json"))) {
      fail("build/addons/manifest.json missing; run without --no-build first");
    }
  }

  const stagedManifest = readJson(join(BUILD_DIR, "manifest.json"));
  const selectedPacks = args.all ? stagedManifest.packages.map((pack) => pack.name) : args.packs;
  const missing = selectedPacks.filter((packName) => !stagedManifest.packages.some((pack) => pack.name === packName));
  if (missing.length) fail(`unknown staged add-on pack(s): ${missing.join(", ")}`);

  const primaryPack = selectedPacks[0] ?? "productivity";
  const assertion = PACK_ASSERTIONS[primaryPack] ?? {};
  const profile = assertion.profile ?? "full";
  const expectedModules = await getExpectedPackModules(selectedPacks, stagedManifest.packages, profile);
  const forbiddenModules = assertion.forbiddenModules ?? [];

  console.log(`[2/6] npm pack universal root and selected add-ons (${selectedPacks.join(", ")})`);
  const universalRootPack = npmPack(ROOT);
  tarballs.push(universalRootPack.tgz);
  const addonPacks = selectedPacks.map((packName) => {
    const pack = stagedManifest.packages.find((candidate) => candidate.name === packName);
    const packageRoot = join(ROOT, pack.packageDir);
    const artifact = npmPack(packageRoot);
    tarballs.push(artifact.tgz);
    return { ...artifact, packName, packageName: pack.packageName };
  });

  console.log("[3/6] create temporary slim root package");
  const slim = makeSlimRootPackageSource(stagedManifest.packages);
  slimSourceDir = slim.sourceDir;
  const slimRootPack = npmPack(slimSourceDir);
  tarballs.push(slimRootPack.tgz);

  console.log("[4/6] install and boot universal bundled package");
  const universalBoot = await installAndMeasure({
    label: "universal",
    rootPack: universalRootPack,
    addonPacks: [],
    packNames: selectedPacks,
    profile,
    addonMode: "bundled",
    expectedModules,
    forbiddenModules,
  });

  console.log("[5/6] install and boot slim root plus add-ons");
  const splitBoot = await installAndMeasure({
    label: "split",
    rootPack: slimRootPack,
    addonPacks,
    packNames: selectedPacks,
    profile,
    addonMode: "external-only",
    expectedModules,
    forbiddenModules,
  });

  console.log("[6/6] write measurement artifact");
  const universal = {
    artifacts: [{ name: "airmcp", filename: universalRootPack.filename }],
    packedBytes: universalRootPack.packageSize,
    unpackedBytes: universalRootPack.unpackedSize,
    ...universalBoot,
  };
  const split = {
    artifacts: [
      { name: "airmcp", filename: slimRootPack.filename, removedEntrypoints: slim.removed.length },
      ...addonPacks.map((pack) => ({ name: pack.packageName, filename: pack.filename })),
    ],
    packedBytes: slimRootPack.packageSize + sumBy(addonPacks, "packageSize"),
    unpackedBytes: slimRootPack.unpackedSize + sumBy(addonPacks, "unpackedSize"),
    ...splitBoot,
  };
  const delta = {
    packedBytesSaved: universal.packedBytes - split.packedBytes,
    unpackedBytesSaved: universal.unpackedBytes - split.unpackedBytes,
    packageDirBytesSaved: universal.packageDirBytes - split.packageDirBytes,
    nodeModulesBytesSaved: universal.nodeModulesBytes - split.nodeModulesBytes,
    initMsSaved: universal.initMs - split.initMs,
    toolsListMsSaved: universal.toolsListMs - split.toolsListMs,
    toolsExposed: universal.toolsExposed - split.toolsExposed,
    toolsRegistered: universal.toolsRegistered - split.toolsRegistered,
  };
  const measurement = {
    version: readJson(join(ROOT, "package.json")).version,
    scenario: selectedPacks.join(","),
    profile,
    selectedPacks,
    slimRootRemovedEntrypoints: slim.removed,
    universal,
    split,
    delta,
    decision: decide(delta),
    output: displayPath(args.output),
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, JSON.stringify(measurement, null, 2) + "\n");
  if (!args.jsonOnly) printSummary(measurement);
  else console.log(JSON.stringify(measurement));

  if (args.requireSizeWin && measurement.decision === "weak-size-win") {
    fail("split measurement did not prove a size win");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  for (const tgz of tarballs) rmSync(tgz, { force: true });
  if (slimSourceDir) rmSync(slimSourceDir, { recursive: true, force: true });
}
