#!/usr/bin/env node
/**
 * Verify AirMCP's profile-first runtime contract over the real MCP wire path.
 *
 * This boots dist/index.js for representative profile/exposure combinations,
 * performs initialize -> tools/list -> tools/call(profile_status), and checks:
 *   - the server boots,
 *   - required front-door/core tools are exposed,
 *   - the reported active profile/exposure matches the requested contract,
 *   - progressive exposure is materially smaller than full exposure.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = join(ROOT, "dist", "index.js");
const TIMEOUT_MS = Number(process.env.PROFILE_VERIFY_TIMEOUT_MS ?? 30_000);
const TOKEN_RATIO = Number(process.env.AIRMCP_TOKEN_RATIO ?? 4);

if (!existsSync(ENTRY)) {
  console.error(`[profiles] ${ENTRY} not found — run \`npm run build\` first`);
  process.exit(2);
}

const CASES = [
  {
    name: "starter-progressive",
    profile: "starter",
    exposure: "progressive",
    minTools: 10,
    maxTools: 40,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "run_tool",
      "list_notes",
      "list_events",
    ],
    requiredModules: ["notes", "reminders", "calendar", "shortcuts", "system", "finder", "weather"],
  },
  {
    name: "starter-progressive-require-session",
    profile: "starter",
    exposure: "progressive",
    requireToolSession: true,
    minTools: 10,
    maxTools: 40,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "start_tool_session",
      "discover_tools",
      "run_tool",
      "list_notes",
      "list_events",
    ],
    requiredModules: ["notes", "reminders", "calendar", "shortcuts", "system", "finder", "weather"],
  },
  {
    name: "communications-safe-progressive",
    profile: "communications-safe",
    exposure: "progressive",
    minTools: 10,
    maxTools: 45,
    requiredTools: ["profile_status", "list_profiles", "list_module_packs", "discover_tools", "run_tool"],
    requiredModules: ["contacts", "mail", "messages"],
  },
  {
    name: "productivity-pack-boundary",
    profile: "productivity",
    exposure: "profile",
    modulePacks: "core,productivity",
    minTools: 70,
    requiredTools: ["profile_status", "list_profiles", "list_module_packs", "discover_tools", "run_tool"],
    requiredModules: ["pages", "numbers", "keynote"],
    forbiddenModules: ["contacts", "mail", "messages"],
    requiredPacks: ["core", "productivity"],
    unavailablePacks: ["communications"],
    missingPackModules: ["contacts", "mail", "messages"],
  },
  {
    name: "productivity-profile",
    profile: "productivity",
    exposure: "profile",
    minTools: 90,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "run_tool",
      "send_mail",
      "send_message",
    ],
    requiredModules: ["pages", "numbers", "keynote", "mail", "messages"],
  },
  {
    name: "full-full",
    profile: "full",
    exposure: "full",
    minTools: 220,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "run_tool",
      "list_notes",
      "list_events",
    ],
    requiredModules: ["notes", "calendar", "finder", "safari", "system", "photos", "google"],
  },
];

function estimateDescriptionTokens(tools) {
  return tools.reduce((sum, t) => sum + Math.ceil(String(t.description ?? "").length / TOKEN_RATIO), 0);
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

function bootCase(testCase) {
  return new Promise((resolve) => {
    const env = {
      ...cleanBootEnv(),
      AIRMCP_PROFILE: testCase.profile,
      AIRMCP_TOOL_EXPOSURE: testCase.exposure,
      AIRMCP_FAKE_OS_VERSION: "0",
      AIRMCP_REQUIRE_TOOL_SESSION: testCase.requireToolSession ? "true" : "false",
      ...(testCase.modulePacks ? { AIRMCP_MODULE_PACKS: testCase.modulePacks } : {}),
      AIRMCP_SEMANTIC_SEARCH: "false",
      AIRMCP_AUDIT_LOG: "false",
      AIRMCP_USAGE_TRACKING: "false",
      AIRMCP_PROACTIVE_CONTEXT: "false",
    };
    const proc = spawn("node", [ENTRY], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
    const rl = createInterface({ input: proc.stdout });
    const pending = new Map();
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: resolvePending } = pending.get(msg.id);
        pending.delete(msg.id);
        resolvePending(msg);
      }
    });

    function request(method, params, id) {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
      return new Promise((resolveReq, rejectReq) => {
        pending.set(id, { resolve: resolveReq });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rejectReq(new Error(`timeout waiting for id=${id} (${method})`));
          }
        }, TIMEOUT_MS);
      });
    }

    function notify(method) {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    }

    const watchdog = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ ok: false, name: testCase.name, error: `overall timeout after ${TIMEOUT_MS}ms`, stderr });
    }, TIMEOUT_MS);

    (async () => {
      try {
        const bootStarted = process.hrtime.bigint();
        const initResp = await request(
          "initialize",
          {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "airmcp-profile-verify", version: "0.0.0" },
          },
          1,
        );
        if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
        const initializedAt = process.hrtime.bigint();
        notify("notifications/initialized");

        const listStarted = process.hrtime.bigint();
        const listResp = await request("tools/list", {}, 2);
        const listedAt = process.hrtime.bigint();
        const tools = listResp.result?.tools;
        if (!Array.isArray(tools)) throw new Error(`tools/list malformed: ${JSON.stringify(listResp)}`);
        const statusResp = await request("tools/call", { name: "profile_status", arguments: {} }, 3);
        if (statusResp.error || statusResp.result?.isError) {
          throw new Error(`profile_status failed: ${JSON.stringify(statusResp)}`);
        }
        const status = parseStructuredResult(statusResp);
        if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);
        const packsResp = await request("tools/call", { name: "list_module_packs", arguments: {} }, 11);
        if (packsResp.error || packsResp.result?.isError) {
          throw new Error(`list_module_packs failed: ${JSON.stringify(packsResp)}`);
        }
        const packs = parseStructuredResult(packsResp);
        if (!packs) throw new Error(`list_module_packs was not parseable: ${JSON.stringify(packsResp)}`);

        if (testCase.name === "starter-progressive" || testCase.name === "starter-progressive-require-session") {
          const sessionResp = await request(
            "tools/call",
            { name: "start_tool_session", arguments: { tools: ["profile_status"], label: "profile-check", ttlSeconds: 60 } },
            4,
          );
          const session = parseStructuredResult(sessionResp);
          if (!session?.sessionId) throw new Error(`start_tool_session failed: ${JSON.stringify(sessionResp)}`);
          const allowedResp = await request(
            "tools/call",
            { name: "run_tool", arguments: { name: "profile_status", sessionId: session.sessionId } },
            5,
          );
          if (allowedResp.error || allowedResp.result?.isError) {
            throw new Error(`run_tool session-allowed call failed: ${JSON.stringify(allowedResp)}`);
          }
          const deniedResp = await request(
            "tools/call",
            { name: "run_tool", arguments: { name: "list_notes", sessionId: session.sessionId } },
            6,
          );
          if (!deniedResp.result?.isError) {
            throw new Error(`run_tool session denied call unexpectedly succeeded: ${JSON.stringify(deniedResp)}`);
          }
        }

        if (testCase.requireToolSession) {
          const discoverResp = await request(
            "tools/call",
            { name: "discover_tools", arguments: { query: "create note", limit: 10 } },
            7,
          );
          if (discoverResp.error || discoverResp.result?.isError) {
            throw new Error(`discover_tools hidden lookup failed: ${JSON.stringify(discoverResp)}`);
          }
          const discover = parseStructuredResult(discoverResp);
          if (!discover?.matches?.some?.((match) => match.name === "create_note")) {
            throw new Error(`discover_tools did not return hidden create_note: ${JSON.stringify(discoverResp)}`);
          }

          const noSessionResp = await request("tools/call", { name: "run_tool", arguments: { name: "create_note" } }, 8);
          if (!noSessionResp.result?.isError || !firstText(noSessionResp).includes("Tool session required")) {
            throw new Error(`run_tool hidden no-session call was not rejected: ${JSON.stringify(noSessionResp)}`);
          }

          const createSessionResp = await request(
            "tools/call",
            {
              name: "start_tool_session",
              arguments: { tools: ["create_note"], label: "hidden-create-check", ttlSeconds: 60 },
            },
            9,
          );
          const createSession = parseStructuredResult(createSessionResp);
          if (!createSession?.sessionId) {
            throw new Error(`start_tool_session for hidden create_note failed: ${JSON.stringify(createSessionResp)}`);
          }

          const missingArgsResp = await request(
            "tools/call",
            { name: "run_tool", arguments: { name: "create_note", args: {}, sessionId: createSession.sessionId } },
            10,
          );
          if (
            !missingArgsResp.result?.isError ||
            !firstText(missingArgsResp).includes('Invalid arguments for tool "create_note"')
          ) {
            throw new Error(`run_tool hidden session call did not reach target validation: ${JSON.stringify(missingArgsResp)}`);
          }
        }

        resolve({
          ok: true,
          testCase,
          tools,
          status,
          packs,
          stderr,
          timings: {
            initMs: Number((initializedAt - bootStarted) / 1_000_000n),
            listMs: Number((listedAt - listStarted) / 1_000_000n),
          },
        });
      } catch (error) {
        resolve({ ok: false, name: testCase.name, error: error instanceof Error ? error.message : String(error), stderr });
      } finally {
        clearTimeout(watchdog);
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 1000).unref();
      }
    })();
  });
}

const results = [];
let failed = false;

for (const testCase of CASES) {
  const result = await bootCase(testCase);
  results.push(result);
  if (!result.ok) {
    failed = true;
    console.error(`[profiles] FAIL ${result.name}: ${result.error}`);
    if (result.stderr) console.error(result.stderr.slice(-2000));
    continue;
  }

  const names = new Set(result.tools.map((t) => t.name));
  const missingTools = testCase.requiredTools.filter((name) => !names.has(name));
  const missingModules = testCase.requiredModules.filter((name) => !result.status.modulesEnabled.includes(name));
  const unexpectedlyEnabledModules = (testCase.forbiddenModules ?? []).filter((name) =>
    result.status.modulesEnabled.includes(name),
  );
  const missingPackModules = (testCase.missingPackModules ?? []).filter(
    (name) => !result.status.modulesMissingPacks?.includes(name),
  );
  const activePacks = new Set(result.packs.active ?? []);
  const missingPacks = (testCase.requiredPacks ?? []).filter((name) => !activePacks.has(name));
  const unexpectedlyAvailablePacks = (testCase.unavailablePacks ?? []).filter((name) => activePacks.has(name));
  const problems = [];
  if (result.tools.length < testCase.minTools) problems.push(`only ${result.tools.length} tools exposed (floor ${testCase.minTools})`);
  if (testCase.maxTools !== undefined && result.tools.length > testCase.maxTools) {
    problems.push(`${result.tools.length} tools exposed (ceiling ${testCase.maxTools})`);
  }
  if (result.status.profile !== testCase.profile) problems.push(`profile_status.profile=${result.status.profile}`);
  if (result.status.toolExposure !== testCase.exposure) problems.push(`profile_status.toolExposure=${result.status.toolExposure}`);
  if (result.status.requireToolSession !== Boolean(testCase.requireToolSession)) {
    problems.push(`profile_status.requireToolSession=${result.status.requireToolSession}`);
  }
  if (missingTools.length) problems.push(`missing tools: ${missingTools.join(", ")}`);
  if (missingModules.length) problems.push(`missing enabled modules: ${missingModules.join(", ")}`);
  if (unexpectedlyEnabledModules.length) problems.push(`unexpected enabled modules: ${unexpectedlyEnabledModules.join(", ")}`);
  if (missingPackModules.length) problems.push(`missing modulesMissingPacks: ${missingPackModules.join(", ")}`);
  if (missingPacks.length) problems.push(`missing active packs: ${missingPacks.join(", ")}`);
  if (unexpectedlyAvailablePacks.length) problems.push(`unexpected available packs: ${unexpectedlyAvailablePacks.join(", ")}`);

  if (problems.length) {
    failed = true;
    console.error(`[profiles] FAIL ${testCase.name}: ${problems.join("; ")}`);
  } else {
    console.error(
      `[profiles] OK ${testCase.name}: ${result.tools.length} exposed / ${result.status.toolsRegistered} registered / ~${estimateDescriptionTokens(result.tools)} desc tokens`,
      ` / init ${result.timings.initMs}ms / tools/list ${result.timings.listMs}ms`,
    );
  }
}

const starter = results.find((r) => r.ok && r.testCase.name === "starter-progressive");
const full = results.find((r) => r.ok && r.testCase.name === "full-full");
if (starter && full && starter.tools.length >= full.tools.length) {
  failed = true;
  console.error(
    `[profiles] FAIL exposure delta: starter-progressive exposed ${starter.tools.length}, full-full exposed ${full.tools.length}`,
  );
}

if (failed) process.exit(1);

console.error("[profiles] all profile boot/exposure checks passed");
