#!/usr/bin/env node
/**
 * Rehearse the first-user add-on path without touching the public registry.
 *
 * The drill installs a temporary slim root tarball into a clean project, proves
 * the user gets an install prompt for a missing add-on, installs the local
 * staged add-on tarball into the persistent add-on prefix, activates the pack,
 * then boots the installed root in external-only mode.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectNoWireError, parseStructuredResult, startMcp } from "./lib/mcp-stdio-client.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build", "addons");
const DEFAULT_OUTPUT = join(BUILD_DIR, "first-user-addon-drill.json");
const TIMEOUT_MS = Number(process.env.ADDON_FIRST_USER_DRILL_TIMEOUT_MS ?? 45_000);

function fail(message) {
  console.error(`[addons:first-user-drill] FAIL - ${message}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`[addons:first-user-drill] command failed: ${cmd} ${args.join(" ")}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function parseArgs() {
  let pack = "productivity";
  let noBuild = false;
  let jsonOnly = false;
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
    if (arg === "--pack") {
      const value = process.argv[i + 1];
      if (!value) fail("--pack requires a pack name");
      pack = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--pack=")) {
      pack = arg.slice("--pack=".length);
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

  return { pack, noBuild, jsonOnly, output };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function npmPack(cwd) {
  const output = sh("npm", ["pack", "--json", "--ignore-scripts"], { cwd });
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

function makeSlimRootPackageSource(packManifest) {
  const rootPkg = readJson(join(ROOT, "package.json"));
  const sourceDir = mkdtempSync(join(tmpdir(), "airmcp-first-user-slim-src-"));
  cpSync(join(ROOT, "dist"), join(sourceDir, "dist"), { recursive: true });

  const removed = [];
  for (const pack of packManifest) {
    if (pack.name === "core") continue;
    for (const moduleName of pack.modules ?? []) {
      for (const fileName of ["tools.js", "prompts.js"]) {
        const filePath = join(sourceDir, "dist", moduleName, fileName);
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
          removed.push(`dist/${moduleName}/${fileName}`);
        }
      }
    }
  }

  writeFileSync(
    join(sourceDir, "package.json"),
    JSON.stringify(
      {
        ...rootPkg,
        airmcp: {
          ...(rootPkg.airmcp ?? {}),
          slimRootExperiment: true,
          removedModuleEntrypoints: removed,
        },
      },
      null,
      2,
    ) + "\n",
  );
  return { sourceDir, removed };
}

function cleanEnv(home, prefix, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AIRMCP_")) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    AIRMCP_ADDON_INSTALL_PREFIX: prefix,
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
    AIRMCP_HITL_LEVEL: "off",
    ...extra,
  };
}

function runCliJson(entry, args, env) {
  const output = sh(process.execPath, [entry, "modules", ...args, "--json"], {
    cwd: dirname(dirname(entry)),
    env,
  });
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`modules ${args.join(" ")} did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function bootForStatus({ entry, work, env, packName, expectInstalled }) {
  const client = startMcp({ entry, cwd: work, env, timeoutMs: TIMEOUT_MS });
  const watchdog = setTimeout(() => {
    client.stop().finally(() => fail(`MCP first-user drill timed out after ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "airmcp-first-user-addon-drill", version: "0.0.0" },
      },
      1,
    );
    if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
    client.notify("notifications/initialized");

    const listResp = await client.request("tools/list", {}, 2);
    const tools = listResp.result?.tools;
    if (!Array.isArray(tools) || tools.length < 8) {
      throw new Error(`tools/list malformed or too small: ${JSON.stringify(listResp)}`);
    }

    const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
    expectNoWireError(statusResp, "profile_status");
    const status = parseStructuredResult(statusResp);
    if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);

    const packsResp = await client.request("tools/call", { name: "list_module_packs", arguments: {} }, 4);
    expectNoWireError(packsResp, "list_module_packs");
    const packs = parseStructuredResult(packsResp);
    if (!packs) throw new Error(`list_module_packs was not parseable: ${JSON.stringify(packsResp)}`);

    const dryRunResp = await client.request(
      "tools/call",
      { name: "install_module_pack", arguments: { pack: packName, dryRun: true } },
      5,
    );
    expectNoWireError(dryRunResp, "install_module_pack dryRun");
    const mcpDryRun = parseStructuredResult(dryRunResp);
    if (!mcpDryRun?.command || mcpDryRun.dryRun !== true) {
      throw new Error(`install_module_pack dryRun was not useful: ${JSON.stringify(dryRunResp)}`);
    }

    const realWithoutConfirmResp = await client.request(
      "tools/call",
      { name: "install_module_pack", arguments: { pack: packName } },
      6,
    );
    if (!realWithoutConfirmResp.result?.isError) {
      throw new Error("install_module_pack without confirm should be rejected");
    }

    if (expectInstalled) {
      const missing = new Set(status.modulesMissingAddonPackages ?? []);
      const selected = packs.packs?.find?.((pack) => pack.name === packName);
      if (!selected?.installed || selected.installStatus !== "installed") {
        throw new Error(`installed pack status was wrong: ${JSON.stringify(selected)}`);
      }
      for (const moduleName of selected.modules ?? []) {
        if (missing.has(moduleName)) {
          throw new Error(`installed module still reported missing: ${moduleName}`);
        }
      }
    } else if (!Array.isArray(status.missingPackInstallHints) || status.missingPackInstallHints.length === 0) {
      throw new Error(`missing add-on prompt was not surfaced: ${JSON.stringify(status)}`);
    }

    return {
      toolsExposed: tools.length,
      toolsRegistered: status.toolsRegistered,
      modulesEnabled: status.modulesEnabled,
      modulesMissingAddonPackages: status.modulesMissingAddonPackages,
      missingPackInstallHints: status.missingPackInstallHints,
      modulePacksActive: packs.active,
      packStatus: packs.packs?.find?.((pack) => pack.name === packName) ?? null,
      installToolDryRun: mcpDryRun,
      confirmRequired: true,
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

const args = parseArgs();
let work = null;
let home = null;
let slimSourceDir = null;
const tarballs = [];

try {
  if (!args.noBuild) {
    console.log("[1/7] build root dist and stage add-on packages");
    sh("npm", ["run", "build"], { cwd: ROOT });
    sh(process.execPath, ["scripts/build-addon-packages.mjs", "--check"], { cwd: ROOT });
  } else {
    console.log("[1/7] reuse existing dist and staged add-on packages");
    if (!existsSync(join(ROOT, "dist", "index.js"))) fail("dist/index.js missing; run without --no-build first");
    if (!existsSync(join(BUILD_DIR, "manifest.json"))) {
      fail("build/addons/manifest.json missing; run without --no-build first");
    }
  }

  const packageJson = readJson(join(ROOT, "package.json"));
  const stagedManifest = readJson(join(BUILD_DIR, "manifest.json"));
  const pack = stagedManifest.packages?.find?.((candidate) => candidate.name === args.pack);
  if (!pack) fail(`unknown staged add-on pack: ${args.pack}`);

  console.log(`[2/7] pack temporary slim root and local add-on (${pack.name})`);
  const slim = makeSlimRootPackageSource(stagedManifest.packages);
  slimSourceDir = slim.sourceDir;
  const rootPack = npmPack(slimSourceDir);
  tarballs.push(rootPack.tgz);
  const addonRoot = join(ROOT, "build", "addons", packageDirName(pack.packageName), "package");
  const addonPack = npmPack(addonRoot);
  tarballs.push(addonPack.tgz);

  work = mkdtempSync(join(tmpdir(), "airmcp-first-user-work-"));
  home = mkdtempSync(join(tmpdir(), "airmcp-first-user-home-"));
  const prefix = join(home, ".airmcp", "addons");
  const env = cleanEnv(home, prefix);

  console.log(`[3/7] install slim root into clean project ${work}`);
  sh("npm", ["init", "-y"], { cwd: work });
  sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", rootPack.tgz], { cwd: work });
  const entry = join(work, "node_modules", "airmcp", "dist", "index.js");
  if (!existsSync(entry)) fail(`installed root package is missing ${entry}`);

  console.log("[4/7] prove missing add-on prompt before installation");
  const rootOnlyStatus = await bootForStatus({
    entry,
    work,
    env: cleanEnv(home, prefix, {
      AIRMCP_PROFILE: "productivity",
      AIRMCP_TOOL_EXPOSURE: "profile",
      AIRMCP_MODULE_PACKS: `core,${pack.name}`,
      AIRMCP_ADDON_PACKAGE_MODE: "external-only",
    }),
    packName: pack.name,
    expectInstalled: false,
  });

  const cliDryRun = runCliJson(entry, ["enable", pack.name, "--install", "--dry-run"], env);
  if (
    !cliDryRun.operation?.packages?.some?.(
      (spec) => spec === pack.packageName || spec.startsWith(`${pack.packageName}@`),
    )
  ) {
    fail(`CLI dry-run did not include ${pack.packageName}: ${JSON.stringify(cliDryRun.operation)}`);
  }

  console.log(`[5/7] install local add-on tarball into persistent prefix ${prefix}`);
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ private: true, name: "airmcp-addons" }, null, 2) + "\n");
  sh(
    "npm",
    ["install", "--prefix", prefix, "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", addonPack.tgz],
    {
      cwd: work,
    },
  );

  console.log("[6/7] activate the pack in user config");
  const activated = runCliJson(entry, ["enable", pack.name], env);
  if (!activated.plannedActive?.includes?.(pack.name)) {
    fail(`CLI enable did not activate ${pack.name}: ${JSON.stringify(activated)}`);
  }
  const installedList = runCliJson(entry, ["list"], env);
  const installedPack = installedList.packs?.find?.((candidate) => candidate.name === pack.name);
  if (!installedPack?.installed || installedPack.installStatus !== "installed") {
    fail(`CLI list did not see installed add-on: ${JSON.stringify(installedPack)}`);
  }

  console.log("[7/7] boot activated installed add-on in external-only mode");
  const installedRuntime = await bootForStatus({
    entry,
    work,
    env: cleanEnv(home, prefix, {
      AIRMCP_PROFILE: "productivity",
      AIRMCP_TOOL_EXPOSURE: "profile",
      AIRMCP_ADDON_PACKAGE_MODE: "external-only",
    }),
    packName: pack.name,
    expectInstalled: true,
  });

  const report = {
    ok: true,
    version: packageJson.version,
    pack: pack.name,
    packageName: pack.packageName,
    rootArtifact: {
      filename: rootPack.filename,
      packedBytes: rootPack.packageSize,
      unpackedBytes: rootPack.unpackedSize,
      removedEntrypoints: slim.removed.length,
    },
    addonArtifact: {
      filename: addonPack.filename,
      packedBytes: addonPack.packageSize,
      unpackedBytes: addonPack.unpackedSize,
    },
    rootOnly: {
      missingAddonPackages: rootOnlyStatus.modulesMissingAddonPackages,
      installPrompt: rootOnlyStatus.missingPackInstallHints?.[0] ?? null,
      mcpDryRunCommand: rootOnlyStatus.installToolDryRun.command,
      confirmRequired: rootOnlyStatus.confirmRequired,
    },
    cliDryRun: {
      command: cliDryRun.operation.command,
      plannedActive: cliDryRun.plannedActive,
      skipped: cliDryRun.operation.skipped,
    },
    installedPrefix: {
      prefix,
      installedVersion: installedPack.installedVersion,
      expectedVersion: installedPack.expectedVersion,
      installedSizeBytes: installedPack.installedSizeBytes,
      installStatus: installedPack.installStatus,
    },
    activated: {
      plannedActive: activated.plannedActive,
      active: activated.active,
    },
    installedRuntime,
    output: args.output.startsWith(`${ROOT}/`) ? args.output.slice(ROOT.length + 1) : args.output,
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n");
  if (args.jsonOnly) {
    console.log(JSON.stringify(report));
  } else {
    console.log(
      `[addons:first-user-drill] ok pack=${pack.name} prompt=${Boolean(report.rootOnly.installPrompt)} installed=${installedPack.installStatus}`,
    );
    console.log(`[addons:first-user-drill] wrote ${report.output}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  for (const tgz of tarballs) rmSync(tgz, { force: true });
  if (slimSourceDir) rmSync(slimSourceDir, { recursive: true, force: true });
  if (work && process.env.AIRMCP_KEEP_FIRST_USER_DRILL_WORKDIR !== "true")
    rmSync(work, { recursive: true, force: true });
  if (home && process.env.AIRMCP_KEEP_FIRST_USER_DRILL_WORKDIR !== "true")
    rmSync(home, { recursive: true, force: true });
}
