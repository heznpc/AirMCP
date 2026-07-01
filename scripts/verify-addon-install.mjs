#!/usr/bin/env node
/**
 * Verify staged AirMCP add-on packages as installed artifacts.
 *
 * `addons:check` proves the staged directories are internally importable.
 * This gate goes one step closer to a user install:
 *   1. build the root package and staged add-ons,
 *   2. npm-pack the root package plus selected add-on packages,
 *   3. install those tarballs into a clean throwaway project,
 *   4. boot the installed root package with AIRMCP_ADDON_PACKAGE_MODE=external-only,
 *   5. prove selected pack modules register over the real MCP stdio wire.
 *
 * The default intentionally checks one coherent workflow pack (`productivity`).
 * Use `--all` when you want a broader artifact smoke without changing the
 * default CI cost.
 */

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = Number(process.env.ADDON_INSTALL_VERIFY_TIMEOUT_MS ?? 45_000);

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

function firstText(callResp) {
  return callResp.result?.content?.find?.((c) => c.type === "text")?.text ?? "";
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
  };

  const client = startMcp(entry, work, env);
  const watchdog = setTimeout(() => {
    client.stop().finally(() => fail(`MCP wire verification timed out after ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
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

    const requiredModules = [
      ...new Set(
        packNames.flatMap((packName) => {
          const pack = packManifest.find((candidate) => candidate.name === packName);
          return pack?.modules ?? [];
        }),
      ),
    ];
    for (const moduleName of requiredModules) {
      if (!status.modulesEnabled?.includes?.(moduleName)) {
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

    return { tools: tools.length, registered: status.toolsRegistered, modulesEnabled: status.modulesEnabled };
  } catch (error) {
    const stderr = client.stderr();
    if (/required add-on package module failed to load|Cannot find package '@heznpc\/airmcp-/.test(stderr)) {
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
const tarballs = [];

try {
  console.log("[1/5] build root dist and stage add-on packages");
  sh("npm", ["run", "build"], { cwd: ROOT });
  sh(process.execPath, ["scripts/build-addon-packages.mjs", "--check"], { cwd: ROOT });

  const manifestPath = join(ROOT, "build", "addons", "manifest.json");
  const stagedManifest = readJson(manifestPath);
  const selectedPacks = all ? stagedManifest.packages.map((pack) => pack.name) : packs;
  const missing = selectedPacks.filter((packName) => !stagedManifest.packages.some((pack) => pack.name === packName));
  if (missing.length) fail(`unknown staged add-on pack(s): ${missing.join(", ")}`);

  console.log(`[2/5] npm pack root and add-on artifacts (${selectedPacks.join(", ")})`);
  const rootPack = npmPack(ROOT);
  tarballs.push(rootPack.tgz);
  const addonPacks = selectedPacks.map((packName) => {
    const pack = stagedManifest.packages.find((candidate) => candidate.name === packName);
    const packageRoot = join(ROOT, pack.packageDir);
    const artifact = npmPack(packageRoot);
    tarballs.push(artifact.tgz);
    return { ...artifact, packName, packageName: pack.packageName };
  });

  work = mkdtempSync(join(tmpdir(), "airmcp-addon-install-"));
  console.log(`[3/5] install tarballs into clean project ${work}`);
  sh("npm", ["init", "-y"], { cwd: work });
  sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", rootPack.tgz, ...addonPacks.map((pack) => pack.tgz)], {
    cwd: work,
  });

  const entry = join(work, "node_modules", "airmcp", "dist", "index.js");
  if (!existsSync(entry)) fail(`installed root package is missing ${entry}`);

  console.log("[4/5] boot installed root with AIRMCP_ADDON_PACKAGE_MODE=external-only");
  const result = await verifyInstalledRuntime({
    work,
    entry,
    packNames: selectedPacks,
    packManifest: stagedManifest.packages,
  });

  console.log("[5/5] artifact summary");
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
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  for (const tgz of tarballs) rmSync(tgz, { force: true });
  if (work) rmSync(work, { recursive: true, force: true });
}
