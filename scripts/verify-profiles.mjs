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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";
import { firstText, MCP_PROTOCOL_VERSION, parseStructuredResult, startMcp } from "./lib/mcp-stdio-client.mjs";

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
      "describe_tool",
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
      "describe_tool",
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
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "describe_tool",
      "run_tool",
    ],
    requiredModules: ["contacts", "mail", "messages"],
  },
  {
    name: "core-only-pack-boundary",
    profile: "full",
    exposure: "profile",
    modulePacks: "core-only",
    minTools: 90,
    maxTools: 135,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "describe_tool",
      "run_tool",
    ],
    requiredModules: ["notes", "reminders", "calendar", "shortcuts", "system", "finder", "weather"],
    forbiddenModules: ["contacts", "mail", "messages", "pages", "numbers", "keynote", "safari", "google"],
    requiredPacks: ["core"],
    unavailablePacks: ["communications", "productivity", "browser", "google-workspace"],
    missingPackModules: ["contacts", "mail", "messages", "pages", "numbers", "keynote", "safari", "google"],
  },
  {
    name: "communications-pack-boundary",
    profile: "full",
    exposure: "profile",
    modulePacks: "core,communications",
    minTools: 100,
    maxTools: 170,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "describe_tool",
      "run_tool",
      "send_mail",
    ],
    requiredModules: ["contacts", "mail", "messages"],
    forbiddenModules: ["pages", "numbers", "keynote", "safari", "google"],
    requiredPacks: ["core", "communications"],
    unavailablePacks: ["productivity", "browser", "google-workspace"],
    missingPackModules: ["pages", "numbers", "keynote", "safari", "google"],
  },
  {
    name: "productivity-pack-boundary",
    profile: "productivity",
    exposure: "profile",
    modulePacks: "core,productivity",
    minTools: 70,
    requiredTools: [
      "profile_status",
      "list_profiles",
      "list_module_packs",
      "discover_tools",
      "describe_tool",
      "run_tool",
    ],
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
      "describe_tool",
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
      "describe_tool",
      "run_tool",
      "list_notes",
      "list_events",
    ],
    requiredModules: ["notes", "calendar", "finder", "safari", "system", "photos", "google"],
    discoveryExpectations: [
      { query: "spreadsheet cell", expected: "numbers_set_cell" },
      { query: "screenshot", expected: "capture_screenshot" },
      { query: "send email", expected: "send_mail" },
      { query: "weather", expected: "get_current_weather" },
    ],
  },
];

function estimateDescriptionTokens(tools) {
  return tools.reduce((sum, t) => sum + Math.ceil(String(t.description ?? "").length / TOKEN_RATIO), 0);
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
    const client = startMcp({ entry: ENTRY, cwd: ROOT, env, timeoutMs: TIMEOUT_MS });

    const watchdog = setTimeout(() => {
      client.stop().finally(() => {
        resolve({
          ok: false,
          name: testCase.name,
          error: `overall timeout after ${TIMEOUT_MS}ms`,
          stderr: client.stderr(),
        });
      });
    }, TIMEOUT_MS);

    (async () => {
      try {
        const bootStarted = process.hrtime.bigint();
        const initResp = await client.request(
          "initialize",
          {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "airmcp-profile-verify", version: "0.0.0" },
          },
          1,
        );
        if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
        const initializedAt = process.hrtime.bigint();
        client.notify("notifications/initialized");

        const listStarted = process.hrtime.bigint();
        const listResp = await client.request("tools/list", {}, 2);
        const listedAt = process.hrtime.bigint();
        const tools = listResp.result?.tools;
        if (!Array.isArray(tools)) throw new Error(`tools/list malformed: ${JSON.stringify(listResp)}`);
        const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
        if (statusResp.error || statusResp.result?.isError) {
          throw new Error(`profile_status failed: ${JSON.stringify(statusResp)}`);
        }
        const status = parseStructuredResult(statusResp);
        if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);
        const packsResp = await client.request("tools/call", { name: "list_module_packs", arguments: {} }, 11);
        if (packsResp.error || packsResp.result?.isError) {
          throw new Error(`list_module_packs failed: ${JSON.stringify(packsResp)}`);
        }
        const packs = parseStructuredResult(packsResp);
        if (!packs) throw new Error(`list_module_packs was not parseable: ${JSON.stringify(packsResp)}`);

        if (testCase.name === "starter-progressive" || testCase.name === "starter-progressive-require-session") {
          const sessionResp = await client.request(
            "tools/call",
            {
              name: "start_tool_session",
              arguments: { tools: ["profile_status"], label: "profile-check", ttlSeconds: 60 },
            },
            4,
          );
          const session = parseStructuredResult(sessionResp);
          if (!session?.sessionId) throw new Error(`start_tool_session failed: ${JSON.stringify(sessionResp)}`);
          const allowedResp = await client.request(
            "tools/call",
            { name: "run_tool", arguments: { name: "profile_status", sessionId: session.sessionId } },
            5,
          );
          if (allowedResp.error || allowedResp.result?.isError) {
            throw new Error(`run_tool session-allowed call failed: ${JSON.stringify(allowedResp)}`);
          }
          const deniedResp = await client.request(
            "tools/call",
            { name: "run_tool", arguments: { name: "list_notes", sessionId: session.sessionId } },
            6,
          );
          if (!deniedResp.result?.isError) {
            throw new Error(`run_tool session denied call unexpectedly succeeded: ${JSON.stringify(deniedResp)}`);
          }
        }

        if (testCase.requireToolSession) {
          const discoverResp = await client.request(
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

          const describeResp = await client.request(
            "tools/call",
            { name: "describe_tool", arguments: { name: "create_note", full: true } },
            12,
          );
          if (describeResp.error || describeResp.result?.isError) {
            throw new Error(`describe_tool hidden detail failed: ${JSON.stringify(describeResp)}`);
          }
          const described = parseStructuredResult(describeResp);
          if (described?.name !== "create_note" || described?.descriptionDetail !== "full") {
            throw new Error(`describe_tool did not return full create_note detail: ${JSON.stringify(describeResp)}`);
          }

          const noSessionResp = await client.request(
            "tools/call",
            { name: "run_tool", arguments: { name: "create_note" } },
            8,
          );
          if (!noSessionResp.result?.isError || !firstText(noSessionResp).includes("Tool session required")) {
            throw new Error(`run_tool hidden no-session call was not rejected: ${JSON.stringify(noSessionResp)}`);
          }

          const createSessionResp = await client.request(
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

          const missingArgsResp = await client.request(
            "tools/call",
            { name: "run_tool", arguments: { name: "create_note", args: {}, sessionId: createSession.sessionId } },
            10,
          );
          if (
            !missingArgsResp.result?.isError ||
            !firstText(missingArgsResp).includes('Invalid arguments for tool "create_note"')
          ) {
            throw new Error(
              `run_tool hidden session call did not reach target validation: ${JSON.stringify(missingArgsResp)}`,
            );
          }
        }

        const discoveryResults = [];
        for (const [idx, expectation] of (testCase.discoveryExpectations ?? []).entries()) {
          const discoverResp = await client.request(
            "tools/call",
            { name: "discover_tools", arguments: { query: expectation.query, limit: 10 } },
            20 + idx,
          );
          if (discoverResp.error || discoverResp.result?.isError) {
            throw new Error(`discover_tools "${expectation.query}" failed: ${JSON.stringify(discoverResp)}`);
          }
          const discover = parseStructuredResult(discoverResp);
          if (!discover?.matches?.some?.((match) => match.name === expectation.expected)) {
            throw new Error(
              `discover_tools "${expectation.query}" did not return ${expectation.expected}: ${JSON.stringify(discoverResp)}`,
            );
          }
          discoveryResults.push({ query: expectation.query, expected: expectation.expected });
        }

        resolve({
          ok: true,
          testCase,
          tools,
          status,
          packs,
          discoveryResults,
          stderr: client.stderr(),
          timings: {
            initMs: Number((initializedAt - bootStarted) / 1_000_000n),
            listMs: Number((listedAt - listStarted) / 1_000_000n),
          },
        });
      } catch (error) {
        resolve({
          ok: false,
          name: testCase.name,
          error: error instanceof Error ? error.message : String(error),
          stderr: client.stderr(),
        });
      } finally {
        clearTimeout(watchdog);
        await client.stop();
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
  if (result.tools.length < testCase.minTools)
    problems.push(`only ${result.tools.length} tools exposed (floor ${testCase.minTools})`);
  if (testCase.maxTools !== undefined && result.tools.length > testCase.maxTools) {
    problems.push(`${result.tools.length} tools exposed (ceiling ${testCase.maxTools})`);
  }
  if (result.status.profile !== testCase.profile) problems.push(`profile_status.profile=${result.status.profile}`);
  if (result.status.toolExposure !== testCase.exposure)
    problems.push(`profile_status.toolExposure=${result.status.toolExposure}`);
  if (result.status.requireToolSession !== Boolean(testCase.requireToolSession)) {
    problems.push(`profile_status.requireToolSession=${result.status.requireToolSession}`);
  }
  if (missingTools.length) problems.push(`missing tools: ${missingTools.join(", ")}`);
  if (missingModules.length) problems.push(`missing enabled modules: ${missingModules.join(", ")}`);
  if (unexpectedlyEnabledModules.length)
    problems.push(`unexpected enabled modules: ${unexpectedlyEnabledModules.join(", ")}`);
  if (missingPackModules.length) problems.push(`missing modulesMissingPacks: ${missingPackModules.join(", ")}`);
  if (missingPacks.length) problems.push(`missing active packs: ${missingPacks.join(", ")}`);
  if (unexpectedlyAvailablePacks.length)
    problems.push(`unexpected available packs: ${unexpectedlyAvailablePacks.join(", ")}`);

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
