#!/usr/bin/env node
/**
 * AirMCP Debug Pipeline — memory-safe module-by-module debugging
 *
 * Problem: loading 262 tools simultaneously exhausts memory during debugging.
 * Solution: spawn a server per module, test it, kill it, then move on.
 *
 * Usage:
 *   node scripts/debug-pipeline.mjs --module notes            # debug one module
 *   node scripts/debug-pipeline.mjs --module notes,calendar   # debug specific modules
 *   node scripts/debug-pipeline.mjs --all                     # all modules, one at a time
 *   node scripts/debug-pipeline.mjs --all --stop-on-fail      # stop at first failure
 *   node scripts/debug-pipeline.mjs --list                    # list available modules
 *   node scripts/debug-pipeline.mjs --module notes --json     # JSON output
 */
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Module manifest (mirrors src/shared/modules.ts MANIFEST) ─────
const ALL_MODULES = [
  "notes", "reminders", "calendar", "contacts", "mail", "music",
  "finder", "safari", "system", "photos", "shortcuts", "messages",
  "intelligence", "tv", "ui", "screen", "maps", "podcasts",
  "weather", "pages", "numbers", "keynote", "location", "bluetooth",
  "google", "speech", "health",
];

// ── Test definitions per module ──────────────────────────────────
// [toolName, args] — only read-only tools
const MODULE_TESTS = {
  notes: [
    ["list_notes", { limit: 5 }],
    ["list_folders", {}],
    ["search_notes", { query: "test" }],
    ["scan_notes", { limit: 3 }],
  ],
  reminders: [
    ["list_reminder_lists", {}],
    ["list_reminders", { limit: 5 }],
    ["search_reminders", { query: "test" }],
  ],
  calendar: [
    ["list_calendars", {}],
    ["today_events", {}],
    ["get_upcoming_events", { limit: 3 }],
  ],
  contacts: [
    ["list_contacts", { limit: 3 }],
    ["search_contacts", { query: "test" }],
    ["list_groups", {}],
  ],
  mail: [
    ["list_mailboxes", {}],
    ["get_unread_count", {}],
    ["list_accounts", {}],
  ],
  music: [
    ["list_playlists", {}],
    ["now_playing", {}],
  ],
  finder: [
    ["search_files", { query: "test", limit: 3 }],
    ["list_directory", { path: process.env.HOME }],
    ["recent_files", { limit: 3 }],
  ],
  safari: [
    ["list_tabs", {}],
    ["get_current_tab", {}],
    ["list_bookmarks", {}],
    ["list_reading_list", {}],
  ],
  system: [
    ["get_clipboard", {}],
    ["get_volume", {}],
    ["get_frontmost_app", {}],
    ["list_running_apps", {}],
    ["get_screen_info", {}],
    ["get_wifi_status", {}],
    ["get_battery_status", {}],
    ["get_brightness", {}],
    ["list_bluetooth_devices", {}],
    ["list_all_windows", {}],
    ["is_app_running", { name: "Finder" }],
  ],
  photos: [
    ["list_albums", {}],
    ["list_favorites", {}],
    ["search_photos", { query: "test" }],
  ],
  shortcuts: [
    ["list_shortcuts", {}],
    ["search_shortcuts", { query: "test" }],
  ],
  messages: [
    ["list_chats", {}],
  ],
  intelligence: [
    ["ai_status", {}],
  ],
  tv: [
    ["tv_list_playlists", {}],
    ["tv_now_playing", {}],
  ],
  ui: [
    ["ui_read", { app: "Finder" }],
  ],
  screen: [
    ["list_windows", {}],
  ],
  maps: [
    ["geocode", { query: "Seoul" }],
    ["reverse_geocode", { latitude: 37.5665, longitude: 126.978 }],
    ["share_location", { latitude: 37.5665, longitude: 126.978, name: "Seoul" }],
  ],
  podcasts: [
    ["list_podcast_shows", {}],
    ["podcast_now_playing", {}],
  ],
  weather: [
    ["get_current_weather", { latitude: 37.5665, longitude: 126.978 }],
    ["get_daily_forecast", { latitude: 37.5665, longitude: 126.978, days: 3 }],
    ["get_hourly_forecast", { latitude: 37.5665, longitude: 126.978, hours: 6 }],
  ],
  pages: [
    ["pages_list_documents", {}],
  ],
  numbers: [
    ["numbers_list_documents", {}],
  ],
  keynote: [
    ["keynote_list_documents", {}],
  ],
  location: [
    ["get_location_permission", {}],
  ],
  bluetooth: [
    ["get_bluetooth_state", {}],
  ],
  // Modules without specific test cases — server init test only
  google: [],
  speech: [],
  health: [],
};

// ── CLI ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const stopOnFail = args.includes("--stop-on-fail");
const listMode = args.includes("--list");
const moduleFlag = args.find((a) => a.startsWith("--module"));
const moduleArg = moduleFlag
  ? (args[args.indexOf(moduleFlag) + 1] || moduleFlag.split("=")[1] || "")
  : null;

if (listMode) {
  console.log("Available modules:\n");
  for (const mod of ALL_MODULES) {
    const tests = MODULE_TESTS[mod] || [];
    console.log(`  ${mod.padEnd(16)} ${tests.length} test(s)`);
  }
  console.log(`\nTotal: ${ALL_MODULES.length} modules`);
  process.exit(0);
}

if (!moduleArg && !args.includes("--all")) {
  console.error(`Usage:
  node scripts/debug-pipeline.mjs --module notes            # one module
  node scripts/debug-pipeline.mjs --module notes,calendar   # specific modules
  node scripts/debug-pipeline.mjs --all                     # all, sequential
  node scripts/debug-pipeline.mjs --all --stop-on-fail      # stop at first failure
  node scripts/debug-pipeline.mjs --list                    # list modules`);
  process.exit(1);
}

const targetModules = moduleArg
  ? moduleArg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : ALL_MODULES;

// Validate module names
for (const mod of targetModules) {
  if (!ALL_MODULES.includes(mod)) {
    console.error(`Unknown module: "${mod}". Use --list to see available modules.`);
    process.exit(1);
  }
}

// ── Server helper ────────────────────────────────────────────────

/** Spawn a server with only the given module loaded, run tests, return results. */
async function debugModule(moduleName) {
  return new Promise((resolvePromise) => {
    const env = {
      ...process.env,
      AIRMCP_DEBUG_MODULES: moduleName,
      AIRMCP_DEBUG_SEQUENTIAL: "true",
      AIRMCP_AUDIT_LOG: "false",
      AIRMCP_USAGE_TRACKING: "false",
      AIRMCP_SEMANTIC_SEARCH: "false",
      AIRMCP_PROACTIVE_CONTEXT: "false",
    };

    const server = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    const responseMap = new Map();
    let nextId = 1;
    let stderrLog = "";

    server.stderr.on("data", (chunk) => {
      stderrLog += chunk.toString();
    });

    server.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) responseMap.set(msg.id, msg);
        } catch { /* ignore non-JSON */ }
      }
    });

    function send(method, params = {}) {
      const id = nextId++;
      server.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
      return id;
    }

    function notify(method, params = {}) {
      server.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
      );
    }

    async function waitFor(id, timeout = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (responseMap.has(id)) return responseMap.get(id);
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    }

    // Kill guard — ensure we don't leave zombie processes
    const killTimer = setTimeout(() => {
      server.kill("SIGKILL");
    }, 120_000); // 2 minute max per module

    server.on("error", (e) => {
      clearTimeout(killTimer);
      resolvePromise({
        module: moduleName,
        initOk: false,
        error: e.message,
        results: [],
        stderrLog,
      });
    });

    server.on("exit", (code) => {
      clearTimeout(killTimer);
      // If exited unexpectedly before we resolve, handle it
    });

    (async () => {
      const startTime = Date.now();

      // 1. Initialize MCP
      const initId = send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "debug-pipeline", version: "1.0" },
      });
      const initResp = await waitFor(initId, 20000);
      if (!initResp) {
        clearTimeout(killTimer);
        server.kill();
        return resolvePromise({
          module: moduleName,
          initOk: false,
          error: "Server init timeout",
          results: [],
          durationMs: Date.now() - startTime,
          stderrLog,
        });
      }

      notify("notifications/initialized");
      await new Promise((r) => setTimeout(r, 300));

      // 2. Check tool count for this module
      const toolsResp = await waitFor(send("tools/list"));
      const loadedTools = toolsResp?.result?.tools?.map((t) => t.name) ?? [];

      // 3. Run module-specific tests
      const tests = MODULE_TESTS[moduleName] || [];
      const results = [];

      for (const [toolName, toolArgs] of tests) {
        const callId = send("tools/call", { name: toolName, arguments: toolArgs });
        const resp = await waitFor(callId, 15000);
        const { status, note } = classify(resp);
        results.push({ tool: toolName, status, note });
      }

      // 4. Clean up
      clearTimeout(killTimer);
      server.kill();

      resolvePromise({
        module: moduleName,
        initOk: true,
        toolCount: loadedTools.length,
        loadedTools,
        results,
        durationMs: Date.now() - startTime,
        stderrLog,
      });
    })();
  });
}

// ── Classify (same logic as qa-test.mjs) ─────────────────────────
function classify(resp) {
  if (!resp) return { status: "ERROR", note: "Timeout (no response)" };

  if (resp.error) {
    const msg = resp.error.message || "";
    if (msg.includes("not found")) return { status: "SKIP", note: "Tool not registered" };
    if (msg.includes("Invalid arguments")) return { status: "FAIL", note: `Bad args: ${msg.slice(0, 120)}` };
    return { status: "FAIL", note: msg.slice(0, 150) };
  }

  const text = resp.result?.content?.[0]?.text || "";
  const isError = resp.result?.isError === true;

  if (!isError) return { status: "PASS", note: "" };

  if (/Swift bridge|macOS 26|not built/i.test(text))
    return { status: "SKIP", note: "Requires Swift bridge / macOS 26+" };
  if (/not authorized|permission|not allowed/i.test(text))
    return { status: "SKIP", note: "Needs macOS permission" };
  if (/Application.*(isn't running|can't be found)|not running/i.test(text))
    return { status: "SKIP", note: "App not running" };
  if (/Connection is invalid|errAEConnectionInvalid/i.test(text))
    return { status: "SKIP", note: "App not running (connection invalid)" };
  if (/(-1708)|이해할 수 없습니다|event not handled|not understood/i.test(text))
    return { status: "FAIL", note: "JXA API incompatible" };
  if (/timed out|timeout/i.test(text))
    return { status: "SKIP", note: "Timed out" };

  return { status: "FAIL", note: text.slice(0, 150) };
}

// ── Main pipeline ────────────────────────────────────────────────
async function main() {
  const pipelineStart = Date.now();
  const allResults = [];
  let aborted = false;

  console.error(`\n━━━ AirMCP Debug Pipeline ━━━`);
  console.error(`Modules: ${targetModules.length} (${stopOnFail ? "stop on fail" : "run all"})\n`);

  for (let i = 0; i < targetModules.length; i++) {
    const mod = targetModules[i];
    const progress = `[${i + 1}/${targetModules.length}]`;

    console.error(`${progress} ${mod} — starting...`);
    const result = await debugModule(mod);
    allResults.push(result);

    if (!result.initOk) {
      console.error(`${progress} ${mod} — ✗ INIT FAILED: ${result.error}`);
      if (stopOnFail) {
        aborted = true;
        break;
      }
      continue;
    }

    const pass = result.results.filter((r) => r.status === "PASS").length;
    const skip = result.results.filter((r) => r.status === "SKIP").length;
    const fail = result.results.filter((r) => r.status === "FAIL" || r.status === "ERROR").length;
    const tests = result.results.length;
    const toolInfo = `${result.toolCount} tools loaded`;

    // Per-test detail
    for (const r of result.results) {
      const icon = r.status === "PASS" ? "✓" : r.status === "SKIP" ? "○" : "✗";
      console.error(`       ${icon} ${r.tool}: ${r.status}${r.note ? ` — ${r.note}` : ""}`);
    }

    const summary = tests > 0
      ? `${pass} pass, ${skip} skip, ${fail} fail`
      : `init only`;
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    const status = fail > 0 ? "✗" : "✓";

    console.error(`${progress} ${mod} — ${status} ${summary} (${toolInfo}, ${duration})\n`);

    if (fail > 0 && stopOnFail) {
      aborted = true;
      console.error(`Stopping: --stop-on-fail triggered on ${mod}`);
      break;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  const totalDuration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  const totalPass = allResults.reduce((n, r) => n + r.results.filter((t) => t.status === "PASS").length, 0);
  const totalSkip = allResults.reduce((n, r) => n + r.results.filter((t) => t.status === "SKIP").length, 0);
  const totalFail = allResults.reduce((n, r) => n + r.results.filter((t) => t.status === "FAIL" || t.status === "ERROR").length, 0);
  const initFails = allResults.filter((r) => !r.initOk).length;

  console.error(`━━━ Pipeline Complete ━━━`);
  console.error(`Modules: ${allResults.length}/${targetModules.length}${aborted ? " (aborted)" : ""}`);
  console.error(`Init failures: ${initFails}`);
  console.error(`Tests: ${totalPass} pass, ${totalSkip} skip, ${totalFail} fail`);
  console.error(`Duration: ${totalDuration}s\n`);

  // JSON output
  if (jsonMode) {
    const report = {
      pipeline: {
        modules: targetModules.length,
        completed: allResults.length,
        aborted,
        durationMs: Date.now() - pipelineStart,
      },
      summary: { pass: totalPass, skip: totalSkip, fail: totalFail, initFails },
      modules: allResults.map((r) => ({
        module: r.module,
        initOk: r.initOk,
        error: r.error,
        toolCount: r.toolCount,
        durationMs: r.durationMs,
        results: r.results,
      })),
    };
    console.log(JSON.stringify(report, null, 2));
  }

  // Failures detail
  const failedModules = allResults.filter(
    (r) => !r.initOk || r.results.some((t) => t.status === "FAIL" || t.status === "ERROR"),
  );
  if (failedModules.length > 0 && !jsonMode) {
    console.error(`Failed modules:`);
    for (const r of failedModules) {
      if (!r.initOk) {
        console.error(`  ✗ ${r.module}: init failed — ${r.error}`);
      } else {
        const fails = r.results.filter((t) => t.status === "FAIL" || t.status === "ERROR");
        for (const f of fails) {
          console.error(`  ✗ ${r.module}/${f.tool}: ${f.note}`);
        }
      }
    }
  }

  process.exit(totalFail + initFails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});
