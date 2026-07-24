#!/usr/bin/env node
/**
 * Verify staged AirMCP add-on packages as installed artifacts.
 *
 * `addons:check` proves the staged directories are internally importable.
 * This gate goes one step closer to a user install:
 *   1. build the root package and staged add-ons,
 *   2. npm-pack the root package plus selected add-on packages,
 *   3. install only the root tarball and prove external-only refuses bundled fallback,
 *   4. install root plus add-ons into a clean throwaway project,
 *   5. boot the installed root package with AIRMCP_ADDON_PACKAGE_MODE=external-only,
 *   6. prove selected pack modules register over the real MCP stdio wire.
 *
 * The default intentionally checks one coherent workflow pack (`productivity`).
 * Use `--all` when you want a broader artifact smoke without changing the
 * default CI cost.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";
import {
  expectNoWireError,
  firstText,
  MCP_PROTOCOL_VERSION,
  parseStructuredResult,
  startMcp,
} from "./lib/mcp-stdio-client.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = Number(process.env.ADDON_INSTALL_VERIFY_TIMEOUT_MS ?? 45_000);
const COMPATIBILITY_OPTIONAL_MODULES = new Set(["health", "intelligence"]);

const PACK_ASSERTIONS = {
  productivity: {
    profile: "productivity",
    requiredModules: ["pages", "numbers", "keynote"],
    forbiddenModules: ["contacts", "mail", "messages"],
    discovery: { query: "spreadsheet cell", expected: "numbers_set_cell" },
    describeTool: "numbers_set_cell",
    validationTool: "numbers_set_cell",
  },
};

const OPT_IN_PACK_ASSERTIONS = {
  spatial: { enableEnv: "AIRMCP_ENABLE_SPATIAL_PREP", canaryTool: "list_vr_assets" },
  webhooks: { enableEnv: "AIRMCP_ENABLE_WEBHOOKS", canaryTool: "webhook_listen_status" },
  powerautomate: { enableEnv: "AIRMCP_ENABLE_POWERAUTOMATE", canaryTool: "cloudflow_trigger" },
};

let profileModulesByName = null;

function fail(message) {
  console.error(`[addons:verify-install] FAIL — ${message}`);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (result.status !== 0) {
    console.error(`[addons:verify-install] command failed: ${cmd} ${args.join(" ")}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function parsePackArgs() {
  if (process.argv.includes("--all")) return { all: true, packs: [] };
  const packs = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
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
    if (arg !== "--check") fail(`unknown argument: ${arg}`);
  }
  return { all: false, packs: packs.length ? packs : ["productivity"] };
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
        const isExplicitOptIn = packName in OPT_IN_PACK_ASSERTIONS;
        return (pack?.modules ?? []).filter((moduleName) => isExplicitOptIn || profileModules.has(moduleName));
      }),
    ),
  ];
}

function optInEnvironment(packNames) {
  return Object.fromEntries(
    packNames.flatMap((packName) => {
      const assertion = OPT_IN_PACK_ASSERTIONS[packName];
      return assertion ? [[assertion.enableEnv, "true"]] : [];
    }),
  );
}

function expectedCanaryTools(packNames) {
  return packNames.flatMap((packName) => {
    const assertion = OPT_IN_PACK_ASSERTIONS[packName];
    return assertion ? [assertion.canaryTool] : [];
  });
}

function getPackPackageName(packManifest, packName) {
  return packManifest.find((candidate) => candidate.name === packName)?.packageName ?? null;
}

function getAddonLoadFailureLines(stderr) {
  return stderr
    .split(/\r?\n/)
    .filter((line) => line.includes("required add-on package module failed to load"));
}

function hasAddonLoadFailureForModule(stderr, moduleName) {
  return getAddonLoadFailureLines(stderr).some(
    (line) =>
      line.includes(`"module":"${moduleName}"`) ||
      line.includes(`"module": "${moduleName}"`) ||
      line.includes(`/${moduleName}/tools.js`) ||
      line.includes(`/${moduleName}/prompts.js`),
  );
}

function throwWithStderr(message, stderr) {
  const failures = getAddonLoadFailureLines(stderr);
  const suffix = failures.length ? `\n--- add-on load failures ---\n${failures.slice(-20).join("\n")}` : "";
  throw new Error(`${message}${suffix}`);
}

async function verifyInstalledRuntime({ work, entry, packNames, packManifest }) {
  const primaryPack = packNames[0] ?? "productivity";
  const assertion = PACK_ASSERTIONS[primaryPack] ?? {};
  const profile = assertion.profile ?? "full";
  const env = {
    ...cleanBootEnv(),
    AIRMCP_PROFILE: profile,
    AIRMCP_TOOL_EXPOSURE: "profile",
    AIRMCP_MODULE_PACKS: ["core", ...packNames].join(","),
    AIRMCP_ADDON_PACKAGE_MODE: "external-only",
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
    ...optInEnvironment(packNames),
  };

  const client = startMcp({ entry, cwd: work, env, timeoutMs: TIMEOUT_MS });
  const watchdog = setTimeout(() => {
    client.stop().finally(() => fail(`MCP wire verification timed out after ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "airmcp-addon-install-verify", version: "0.0.0" },
      },
      1,
    );
    if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
    client.notify("notifications/initialized");

    const listResp = await client.request("tools/list", {}, 2);
    const tools = listResp.result?.tools;
    if (!Array.isArray(tools) || tools.length < 10) {
      throw new Error(`tools/list malformed or too small: ${JSON.stringify(listResp)}`);
    }
    const toolNames = new Set(tools.map((tool) => tool.name));
    const missingCanaries = expectedCanaryTools(packNames).filter((toolName) => !toolNames.has(toolName));
    if (missingCanaries.length) {
      throw new Error(`installed opt-in add-on canary tools are missing: ${missingCanaries.join(", ")}`);
    }

    const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
    expectNoWireError(statusResp, "profile_status");
    const status = parseStructuredResult(statusResp);
    if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);

    const packsResp = await client.request("tools/call", { name: "list_module_packs", arguments: {} }, 4);
    expectNoWireError(packsResp, "list_module_packs");
    const packs = parseStructuredResult(packsResp);
    if (!packs) throw new Error(`list_module_packs was not parseable: ${JSON.stringify(packsResp)}`);

    const activePacks = new Set(packs.active ?? []);
    for (const packName of ["core", ...packNames]) {
      if (!activePacks.has(packName)) throw new Error(`active packs missing ${packName}: ${JSON.stringify(packs)}`);
    }

    const stderr = client.stderr();
    const hardLoadFailures = getAddonLoadFailureLines(stderr);
    if (hardLoadFailures.length) {
      throwWithStderr("installed add-on mode emitted required package load failures", stderr);
    }

    const requiredModules = await getExpectedPackModules(packNames, packManifest, profile);
    const compatibilitySkipped = [];
    for (const moduleName of requiredModules) {
      if (!status.modulesEnabled?.includes?.(moduleName)) {
        if (COMPATIBILITY_OPTIONAL_MODULES.has(moduleName) && !hasAddonLoadFailureForModule(stderr, moduleName)) {
          compatibilitySkipped.push(moduleName);
          continue;
        }
        throw new Error(`module ${moduleName} was not enabled from installed add-on: ${JSON.stringify(status)}`);
      }
    }

    for (const moduleName of assertion.forbiddenModules ?? []) {
      if (status.modulesEnabled?.includes?.(moduleName)) {
        throw new Error(
          `module ${moduleName} should not be enabled for ${packNames.join(",")}: ${JSON.stringify(status)}`,
        );
      }
    }

    if (assertion.discovery) {
      const discoverResp = await client.request(
        "tools/call",
        { name: "discover_tools", arguments: { query: assertion.discovery.query, limit: 10 } },
        5,
      );
      expectNoWireError(discoverResp, "discover_tools");
      const discover = parseStructuredResult(discoverResp);
      if (!discover?.matches?.some?.((match) => match.name === assertion.discovery.expected)) {
        throw new Error(
          `discover_tools did not return ${assertion.discovery.expected}: ${JSON.stringify(discoverResp)}`,
        );
      }
    }

    if (assertion.describeTool) {
      const describeResp = await client.request(
        "tools/call",
        { name: "describe_tool", arguments: { name: assertion.describeTool, full: true } },
        6,
      );
      expectNoWireError(describeResp, "describe_tool");
      const described = parseStructuredResult(describeResp);
      if (described?.name !== assertion.describeTool || described?.descriptionDetail !== "full") {
        throw new Error(`describe_tool returned wrong detail: ${JSON.stringify(describeResp)}`);
      }
    }

    if (assertion.validationTool) {
      const invalidResp = await client.request(
        "tools/call",
        { name: "run_tool", arguments: { name: assertion.validationTool, args: {} } },
        7,
      );
      const text = firstText(invalidResp);
      if (!invalidResp.result?.isError || !text.includes(`Invalid arguments for tool "${assertion.validationTool}"`)) {
        throw new Error(
          `run_tool did not reach ${assertion.validationTool} argument validation: ${JSON.stringify(invalidResp)}`,
        );
      }
    }

    return {
      tools: tools.length,
      registered: status.toolsRegistered,
      modulesEnabled: status.modulesEnabled,
      compatibilitySkipped,
    };
  } catch (error) {
    const stderr = client.stderr();
    if (stderr.includes("required add-on package module failed to load")) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n--- stderr ---\n${stderr.slice(-4000)}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(watchdog);
    await client.stop();
  }
}

async function verifyBundledFallbackRefused({ work, entry, packNames, packManifest }) {
  const primaryPack = packNames[0] ?? "productivity";
  const assertion = PACK_ASSERTIONS[primaryPack] ?? {};
  const profile = assertion.profile ?? "full";
  const env = {
    ...cleanBootEnv(),
    AIRMCP_PROFILE: profile,
    AIRMCP_TOOL_EXPOSURE: "profile",
    AIRMCP_MODULE_PACKS: ["core", ...packNames].join(","),
    AIRMCP_ADDON_PACKAGE_MODE: "external-only",
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
    ...optInEnvironment(packNames),
  };

  const client = startMcp({ entry, cwd: work, env, timeoutMs: TIMEOUT_MS });
  const watchdog = setTimeout(() => {
    client.stop().finally(() => fail(`root-only fallback verification timed out after ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "airmcp-addon-negative-verify", version: "0.0.0" },
      },
      1,
    );
    if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
    client.notify("notifications/initialized");

    const listResp = await client.request("tools/list", {}, 2);
    const tools = listResp.result?.tools;
    if (!Array.isArray(tools) || tools.length < 10) {
      throw new Error(`tools/list malformed or too small: ${JSON.stringify(listResp)}`);
    }

    const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
    expectNoWireError(statusResp, "profile_status");
    const status = parseStructuredResult(statusResp);
    if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);

    const stderr = client.stderr();
    const expectedModules = await getExpectedPackModules(packNames, packManifest, profile);
    const leakedModules = expectedModules.filter((moduleName) => status.modulesEnabled?.includes?.(moduleName));
    if (leakedModules.length) {
      throwWithStderr(
        `root-only install loaded selected add-on module(s) despite external-only mode: ${leakedModules.join(", ")}`,
        stderr,
      );
    }

    const expectedPackages = [];
    for (const packName of packNames) {
      const modules = await getExpectedPackModules([packName], packManifest, profile);
      const packageName = getPackPackageName(packManifest, packName);
      if (modules.length && packageName) expectedPackages.push(packageName);
    }
    const missingFailurePackages = expectedPackages.filter((packageName) => !stderr.includes(packageName));
    if (missingFailurePackages.length) {
      throwWithStderr(
        `root-only install did not prove missing package failure(s): ${missingFailurePackages.join(", ")}`,
        stderr,
      );
    }

    return { tools: tools.length, registered: status.toolsRegistered, modulesEnabled: status.modulesEnabled };
  } catch (error) {
    const stderr = client.stderr();
    if (stderr.includes("required add-on package module failed to load")) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n--- stderr ---\n${stderr.slice(-4000)}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(watchdog);
    await client.stop();
  }
}

const { all, packs } = parsePackArgs();
let work = null;
let rootOnlyWork = null;
const tarballs = [];

try {
  console.log("[1/6] build root dist and stage add-on packages");
  sh("npm", ["run", "build"], { cwd: ROOT });
  sh(process.execPath, ["scripts/build-addon-packages.mjs", "--check"], { cwd: ROOT });

  const manifestPath = join(ROOT, "build", "addons", "manifest.json");
  const stagedManifest = readJson(manifestPath);
  const selectedPacks = all ? stagedManifest.packages.map((pack) => pack.name) : packs;
  const missing = selectedPacks.filter((packName) => !stagedManifest.packages.some((pack) => pack.name === packName));
  if (missing.length) fail(`unknown staged add-on pack(s): ${missing.join(", ")}`);

  console.log(`[2/6] npm pack root and add-on artifacts (${selectedPacks.join(", ")})`);
  const rootPack = npmPack(ROOT);
  tarballs.push(rootPack.tgz);
  const addonPacks = selectedPacks.map((packName) => {
    const pack = stagedManifest.packages.find((candidate) => candidate.name === packName);
    const packageRoot = join(ROOT, pack.packageDir);
    const artifact = npmPack(packageRoot);
    tarballs.push(artifact.tgz);
    return { ...artifact, packName, packageName: pack.packageName };
  });

  rootOnlyWork = mkdtempSync(join(tmpdir(), "airmcp-addon-root-only-"));
  console.log(`[3/6] prove root-only install refuses bundled fallback ${rootOnlyWork}`);
  sh("npm", ["init", "-y"], { cwd: rootOnlyWork });
  sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", rootPack.tgz], { cwd: rootOnlyWork });
  const rootOnlyEntry = join(rootOnlyWork, "node_modules", "airmcp", "dist", "index.js");
  if (!existsSync(rootOnlyEntry)) fail(`installed root-only package is missing ${rootOnlyEntry}`);
  await verifyBundledFallbackRefused({
    work: rootOnlyWork,
    entry: rootOnlyEntry,
    packNames: selectedPacks,
    packManifest: stagedManifest.packages,
  });

  work = mkdtempSync(join(tmpdir(), "airmcp-addon-install-"));
  console.log(`[4/6] install tarballs into clean project ${work}`);
  sh("npm", ["init", "-y"], { cwd: work });
  sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", rootPack.tgz, ...addonPacks.map((pack) => pack.tgz)], {
    cwd: work,
  });

  const entry = join(work, "node_modules", "airmcp", "dist", "index.js");
  if (!existsSync(entry)) fail(`installed root package is missing ${entry}`);

  console.log("[5/6] boot installed root with AIRMCP_ADDON_PACKAGE_MODE=external-only");
  const result = await verifyInstalledRuntime({
    work,
    entry,
    packNames: selectedPacks,
    packManifest: stagedManifest.packages,
  });

  console.log("[6/6] artifact summary");
  const rows = [
    { name: "airmcp", filename: rootPack.filename, packed: rootPack.packageSize, unpacked: rootPack.unpackedSize },
    ...addonPacks.map((pack) => ({
      name: pack.packageName,
      filename: pack.filename,
      packed: pack.packageSize,
      unpacked: pack.unpackedSize,
    })),
  ];
  for (const row of rows) {
    console.log(`  ${row.name}: ${row.filename} packed=${row.packed}B unpacked=${row.unpacked}B`);
  }
  console.log(
    `ok: installed add-on pack(s) ${selectedPacks.join(", ")} registered ${result.registered} tools; tools/list exposed ${result.tools}`,
  );
  if (result.compatibilitySkipped.length) {
    console.log(`ok: compatibility-gated module(s) skipped on this host: ${result.compatibilitySkipped.join(", ")}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  for (const tgz of tarballs) rmSync(tgz, { force: true });
  if (work) rmSync(work, { recursive: true, force: true });
  if (rootOnlyWork) rmSync(rootOnlyWork, { recursive: true, force: true });
}
