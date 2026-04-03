#!/usr/bin/env node
/**
 * AirMCP Dev Test Mode — lightweight, git-aware, watch-capable developer testing
 *
 * Instead of spawning a full MCP server per module (debug-pipeline.mjs),
 * this uses a MockMcpServer that captures tool registrations in-process.
 * No stdio transport, no JSON-RPC, no child process — 10x lighter.
 *
 * Usage:
 *   npm run dev:test notes                  # test one module
 *   npm run dev:test notes,calendar         # test specific modules
 *   npm run dev:test --changed              # only git-changed modules
 *   npm run dev:test --all                  # all modules, sequential
 *   npm run dev:test notes --watch          # watch mode (auto re-test)
 *   npm run dev:test --tool list_notes      # test a single tool
 *   npm run dev:test --list                 # list available modules
 *   npm run dev:test --all --json           # JSON output
 *   npm run dev:test --all --stop-on-fail   # stop at first failure
 */

import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { watch, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Cache-bust counter for ESM re-imports in watch mode */
let importGeneration = 0;

function isFailed(r) {
  return r.status === "FAIL" || r.status === "ERROR";
}

function countResults(results) {
  let pass = 0, skip = 0, fail = 0;
  for (const r of results) {
    if (r.status === "PASS") pass++;
    else if (r.status === "SKIP") skip++;
    else fail++;
  }
  return { pass, skip, fail };
}

/** Reverse index: tool name -> module name (built from MODULE_TESTS) */
const TOOL_MODULE_INDEX = new Map();

// ── Module manifest (must match src/shared/modules.ts MANIFEST) ──────
const ALL_MODULES = [
  "notes", "reminders", "calendar", "contacts", "mail", "music",
  "finder", "safari", "system", "photos", "shortcuts", "messages",
  "intelligence", "tv", "ui", "screen", "maps", "podcasts",
  "weather", "pages", "numbers", "keynote", "location", "bluetooth",
  "google", "speech", "health",
];

// ── Read-only test cases per module ──────────────────────────────────
const MODULE_TESTS = {
  notes: [
    ["list_notes", { limit: 3 }],
    ["list_folders", {}],
    ["search_notes", { query: "test" }],
  ],
  reminders: [
    ["list_reminder_lists", {}],
    ["list_reminders", { limit: 3 }],
  ],
  calendar: [
    ["list_calendars", {}],
    ["today_events", {}],
  ],
  contacts: [
    ["list_contacts", { limit: 3 }],
    ["list_groups", {}],
  ],
  mail: [
    ["list_mailboxes", {}],
    ["get_unread_count", {}],
  ],
  music: [
    ["list_playlists", {}],
    ["now_playing", {}],
  ],
  finder: [
    ["search_files", { query: "test", limit: 3 }],
    ["list_directory", { path: process.env.HOME }],
  ],
  safari: [
    ["list_tabs", {}],
    ["get_current_tab", {}],
  ],
  system: [
    ["get_clipboard", {}],
    ["get_volume", {}],
    ["get_frontmost_app", {}],
  ],
  photos: [
    ["list_albums", {}],
    ["search_photos", { query: "test" }],
  ],
  shortcuts: [
    ["list_shortcuts", {}],
  ],
  messages: [
    ["list_chats", {}],
  ],
  intelligence: [
    ["ai_status", {}],
  ],
  tv: [
    ["tv_list_playlists", {}],
  ],
  ui: [
    ["ui_read", { app: "Finder" }],
  ],
  screen: [
    ["list_windows", {}],
  ],
  maps: [
    ["geocode", { query: "Seoul" }],
  ],
  podcasts: [
    ["list_podcast_shows", {}],
  ],
  weather: [
    ["get_current_weather", { latitude: 37.5665, longitude: 126.978 }],
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
  google: [],
  speech: [],
  health: [],
};

// Build reverse index on load
for (const [mod, tests] of Object.entries(MODULE_TESTS)) {
  for (const [toolName] of tests) {
    TOOL_MODULE_INDEX.set(toolName, mod);
  }
}

// ── MockMcpServer — captures registrations without MCP SDK ───────────

class MockMcpServer {
  constructor() {
    this.tools = new Map();   // name -> { config, handler }
    this.prompts = new Map();
    this.resources = new Map();
    this.server = {};         // dummy — some modules reference server.server
  }

  registerTool(name, config, handler) {
    this.tools.set(name, {
      title: config?.title,
      description: config?.description,
      handler,
      annotations: config?.annotations,
    });
  }

  tool(name, ...rest) {
    const handler = rest[rest.length - 1];
    const description = typeof rest[0] === "string" ? rest[0] : undefined;
    this.tools.set(name, { title: name, description, handler });
  }

  registerPrompt(name, config, handler) {
    this.prompts.set(name, { config, handler });
  }

  prompt(name, ...rest) {
    const handler = rest[rest.length - 1];
    this.prompts.set(name, { handler });
  }

  registerResource(name, uri, config, handler) {
    this.resources.set(name, { uri, config, handler });
  }

  resource(name, uri, ...rest) {
    const handler = rest[rest.length - 1];
    this.resources.set(name, { uri, handler });
  }

  /** Call a registered tool handler directly — no JSON-RPC overhead */
  async callTool(name, args = {}) {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`Tool "${name}" not found`);
    return entry.handler(args, {});
  }

  getToolNames() {
    return [...this.tools.keys()];
  }

  getToolCount() {
    return this.tools.size;
  }
}

// ── Minimal config for dev mode (never mutated, shared across calls) ─

const DEV_CONFIG = Object.freeze({
  includeShared: false,
  disabledModules: new Set(),
  shareApprovalModules: new Set(),
  allowSendMessages: false,
  allowSendMail: false,
  allowRunJavascript: false,
  hitl: Object.freeze({ level: "off", whitelist: new Set(), timeout: 30, socketPath: "" }),
  features: Object.freeze({
    auditLog: false,
    usageTracking: false,
    semanticToolSearch: false,
    proactiveContext: false,
  }),
});

// ── Git-aware: detect changed modules ────────────────────────────────

function getChangedModules() {
  try {
    // Staged + unstaged + untracked in src/
    const diffOutput = execSync(
      "git diff --name-only HEAD -- src/ && git diff --name-only --cached -- src/ && git ls-files --others --exclude-standard -- src/",
      { cwd: ROOT, encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (!diffOutput) return [];

    const changedFiles = diffOutput.split("\n").filter(Boolean);
    const moduleSet = new Set();

    for (const file of changedFiles) {
      // src/<module>/tools.ts -> extract <module>
      const match = file.match(/^src\/([^/]+)\//);
      if (match && ALL_MODULES.includes(match[1])) {
        moduleSet.add(match[1]);
      }
      // src/shared/* changes -> flag all modules (shared infra)
      if (file.startsWith("src/shared/")) {
        return ALL_MODULES.slice(); // everything affected
      }
    }

    return [...moduleSet];
  } catch {
    console.error("  ⚠ git diff failed — falling back to all modules");
    return ALL_MODULES.slice();
  }
}

// ── Load & test a single module in-process ───────────────────────────

async function testModule(moduleName) {
  const startTime = Date.now();
  const memBefore = process.memoryUsage();
  const server = new MockMcpServer();

  // Dynamic import with cache-bust query for watch mode
  const distUrl = resolve(ROOT, `dist/${moduleName}/tools.js`);
  try {
    const toolsMod = await import(distUrl + `?g=${importGeneration}`);
    const registerFn = findRegisterFn(toolsMod);
    if (!registerFn) {
      return { module: moduleName, initOk: false, error: "No register function found", results: [], durationMs: Date.now() - startTime };
    }
    registerFn(server, DEV_CONFIG);
  } catch (e) {
    return { module: moduleName, initOk: false, error: e.message, results: [], durationMs: Date.now() - startTime };
  }

  const toolCount = server.getToolCount();
  const toolNames = server.getToolNames();

  const tests = MODULE_TESTS[moduleName] || [];
  const results = [];

  for (const [toolName, toolArgs] of tests) {
    if (!server.tools.has(toolName)) {
      results.push({ tool: toolName, status: "SKIP", note: "Not registered in this module" });
      continue;
    }
    try {
      const resp = await callWithTimeout(server, toolName, toolArgs, 10000);
      const { status, note } = classify(resp);
      results.push({ tool: toolName, status, note });
    } catch (e) {
      results.push({ tool: toolName, status: "ERROR", note: e.message?.slice(0, 150) || "Unknown error" });
    }
  }

  const memAfter = process.memoryUsage();
  const memDeltaMB = parseFloat(((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(1));

  return { module: moduleName, initOk: true, toolCount, toolNames, results, memDeltaMB, durationMs: Date.now() - startTime };
}

/** Promise.race with proper timer cleanup to avoid setTimeout leaks */
function callWithTimeout(server, toolName, toolArgs, ms) {
  return new Promise((resolveP, rejectP) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; rejectP(new Error(`Timeout (${ms / 1000}s)`)); }
    }, ms);
    server.callTool(toolName, toolArgs).then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolveP(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); rejectP(e); } },
    );
  });
}

// ── Test a single tool by name (across all modules) ──────────────────

async function testSingleTool(toolName, toolArgs) {
  // Try reverse index first, then fall back to full scan
  const hintModule = TOOL_MODULE_INDEX.get(toolName);
  const searchOrder = hintModule
    ? [hintModule, ...ALL_MODULES.filter((m) => m !== hintModule)]
    : ALL_MODULES;

  for (const mod of searchOrder) {
    const distPath = resolve(ROOT, `dist/${mod}/tools.js`);
    if (!existsSync(distPath)) continue;

    try {
      const server = new MockMcpServer();
      const toolsMod = await import(distPath);
      const registerFn = findRegisterFn(toolsMod);
      if (!registerFn) continue;
      registerFn(server, DEV_CONFIG);

      if (!server.tools.has(toolName)) continue;

      console.error(`\n  Found "${toolName}" in module: ${mod}`);
      console.error(`  Module has ${server.getToolCount()} tools total\n`);

      const entry = server.tools.get(toolName);
      if (entry.description) console.error(`  Description: ${entry.description.slice(0, 120)}`);
      if (entry.annotations) {
        console.error(`  Annotations: readOnly=${entry.annotations.readOnlyHint}, destructive=${entry.annotations.destructiveHint}`);
      }
      console.error("");

      const start = Date.now();
      try {
        const resp = await callWithTimeout(server, toolName, toolArgs || {}, 15000);
        const duration = Date.now() - start;
        const { status, note } = classify(resp);
        const text = resp?.content?.[0]?.text || "";

        console.error(`  Status: ${status}${note ? ` — ${note}` : ""}`);
        console.error(`  Duration: ${duration}ms`);
        if (status === "PASS" && text) {
          const preview = text.length > 500 ? text.slice(0, 500) + "\n  ... (truncated)" : text;
          console.error(`  Result:\n${preview.split("\n").map(l => "    " + l).join("\n")}`);
        }
        return !isFailed({ status }) ? 0 : 1;
      } catch (e) {
        console.error(`  ERROR: ${e.message}`);
        return 1;
      }
    } catch {
      continue;
    }
  }

  console.error(`\n  ✗ Tool "${toolName}" not found in any module.`);
  console.error(`  Use --list to see available modules, or check the tool name.`);
  return 1;
}

// ── Classify result (same logic as debug-pipeline.mjs) ───────────────

function classify(resp) {
  if (!resp) return { status: "ERROR", note: "No response" };

  const isError = resp.isError === true;
  const text = resp.content?.[0]?.text || "";

  if (!isError) return { status: "PASS", note: "" };

  if (/Swift bridge|macOS 26|not built/i.test(text))
    return { status: "SKIP", note: "Requires Swift bridge / macOS 26+" };
  if (/not authorized|permission|not allowed/i.test(text))
    return { status: "SKIP", note: "Needs macOS permission" };
  if (/Application.*(isn't running|can't be found)|not running/i.test(text))
    return { status: "SKIP", note: "App not running" };
  if (/Connection is invalid|errAEConnectionInvalid/i.test(text))
    return { status: "SKIP", note: "App not running (connection invalid)" };
  if (/timed out|timeout/i.test(text))
    return { status: "SKIP", note: "Timed out" };

  return { status: "FAIL", note: text.slice(0, 150) };
}

// ── Find register function in module ─────────────────────────────────

function findRegisterFn(mod) {
  let fallback;
  for (const [key, val] of Object.entries(mod)) {
    if (typeof val === "function" && key.startsWith("register")) {
      if (key.includes("Dynamic")) {
        fallback = fallback ?? val;
        continue;
      }
      return val;
    }
  }
  return fallback;
}

// ── Build check ──────────────────────────────────────────────────────

function ensureBuild() {
  const distIndex = resolve(ROOT, "dist/index.js");
  if (!existsSync(distIndex)) {
    console.error("  Building project first (dist/ not found)...\n");
    try {
      execSync("npm run build", { cwd: ROOT, stdio: "inherit", timeout: 60000 });
    } catch {
      console.error("  ✗ Build failed. Fix build errors first.");
      process.exit(1);
    }
    console.error("");
  }
}

// ── Rebuild (for watch mode) ─────────────────────────────────────────

function rebuild() {
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "pipe", timeout: 60000 });
    return true;
  } catch (e) {
    console.error("  ✗ Build failed:");
    console.error(e.stderr?.toString().split("\n").slice(0, 10).join("\n"));
    return false;
  }
}

// ── Watch mode ───────────────────────────────────────────────────────

async function watchMode(targetModules) {
  console.error(`\n  👀 Watching src/ for changes... (Ctrl+C to stop)\n`);
  console.error(`  Modules: ${targetModules.join(", ")}\n`);

  let debounce = null;
  let running = false;

  const srcDir = resolve(ROOT, "src");

  async function runTests() {
    if (running) return;
    running = true;

    console.error(`\n${"─".repeat(60)}`);
    console.error(`  Re-testing at ${new Date().toLocaleTimeString()}...\n`);

    // Bump generation so testModule() imports fresh URLs
    importGeneration++;

    if (!rebuild()) {
      running = false;
      return;
    }

    for (const mod of targetModules) {
      const result = await testModule(mod);
      printModuleResult(result, 0, targetModules.length);
    }

    console.error(`\n  Waiting for changes...\n`);
    running = false;
  }

  // Watch src/ recursively
  watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith(".ts")) return;
    if (debounce) clearTimeout(debounce);

    console.error(`  ⟳ ${filename} changed`);
    debounce = setTimeout(runTests, 500);
  });

  // Run initial test
  await runTests();

  // Keep process alive
  await new Promise(() => {});
}

// ── Print helpers ────────────────────────────────────────────────────

function printModuleResult(result, index, total) {
  const progress = total > 1 ? `[${index + 1}/${total}]` : "";

  if (!result.initOk) {
    console.error(`  ${progress} ✗ ${result.module} — INIT FAILED: ${result.error}`);
    return;
  }

  // Per-test detail
  for (const r of result.results) {
    const icon = r.status === "PASS" ? "✓" : r.status === "SKIP" ? "○" : "✗";
    console.error(`     ${icon} ${r.tool}: ${r.status}${r.note ? ` — ${r.note}` : ""}`);
  }

  const { pass, skip, fail } = countResults(result.results);
  const tests = result.results.length;

  const summary = tests > 0
    ? `${pass} pass, ${skip} skip, ${fail} fail`
    : `init only (${result.toolCount} tools registered)`;
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
  const mem = result.memDeltaMB !== undefined ? `, +${result.memDeltaMB}MB` : "";
  const status = fail > 0 ? "✗" : "✓";

  console.error(`  ${progress} ${status} ${result.module} — ${summary} (${result.toolCount} tools, ${duration}${mem})`);
}

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const stopOnFail = args.includes("--stop-on-fail");
const listMode = args.includes("--list");
const watchFlag = args.includes("--watch");
const changedFlag = args.includes("--changed");
const allFlag = args.includes("--all");

// --tool <name> [--args '{"key":"val"}']
const toolIdx = args.indexOf("--tool");
const singleTool = toolIdx !== -1 ? args[toolIdx + 1] : null;
const argsIdx = args.indexOf("--args");
const singleToolArgs = argsIdx !== -1 ? JSON.parse(args[argsIdx + 1] || "{}") : {};

// Positional module names (not flags)
const flagValues = new Set();
if (singleTool) flagValues.add(singleTool);
if (argsIdx !== -1 && args[argsIdx + 1]) flagValues.add(args[argsIdx + 1]);
const positionalModules = args.filter(
  (a) => !a.startsWith("--") && !flagValues.has(a),
);

const USAGE = `  Usage:
    npm run dev:test notes                  # test one module
    npm run dev:test notes,calendar         # test specific modules
    npm run dev:test --changed              # git-changed modules only
    npm run dev:test --all                  # all modules
    npm run dev:test notes --watch          # watch mode
    npm run dev:test --tool list_notes      # test a single tool
    npm run dev:test --list                 # list modules`;

if (listMode) {
  console.log("\n  Available modules:\n");
  for (const mod of ALL_MODULES) {
    const tests = MODULE_TESTS[mod] || [];
    console.log(`    ${mod.padEnd(16)} ${tests.length} test(s)`);
  }
  console.log(`\n  Total: ${ALL_MODULES.length} modules\n`);
  console.log(USAGE);
  console.log("");
  process.exit(0);
}

// Ensure dist/ exists
ensureBuild();

// ── Single tool mode ─────────────────────────────────────────────────
if (singleTool) {
  console.error(`\n━━━ AirMCP Dev Test — single tool ━━━`);
  const code = await testSingleTool(singleTool, singleToolArgs);
  console.error("");
  process.exit(code);
}

// ── Determine target modules ─────────────────────────────────────────
let targetModules;

if (changedFlag) {
  targetModules = getChangedModules();
  if (targetModules.length === 0) {
    console.error("\n  ✓ No changed modules detected (git diff clean)\n");
    process.exit(0);
  }
  console.error(`\n  Git detected changes in: ${targetModules.join(", ")}\n`);
} else if (allFlag) {
  targetModules = ALL_MODULES.slice();
} else if (positionalModules.length > 0) {
  // Support both "notes calendar" and "notes,calendar"
  targetModules = positionalModules.flatMap((a) => a.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean);
} else {
  console.error(`\n${USAGE}\n`);
  process.exit(1);
}

// Validate
for (const mod of targetModules) {
  if (!ALL_MODULES.includes(mod)) {
    console.error(`  ✗ Unknown module: "${mod}". Use --list to see available modules.`);
    process.exit(1);
  }
}

// ── Watch mode ───────────────────────────────────────────────────────
if (watchFlag) {
  await watchMode(targetModules);
  process.exit(0);
}

// ── Main pipeline ────────────────────────────────────────────────────
const pipelineStart = Date.now();
const allResults = [];
let aborted = false;

console.error(`\n━━━ AirMCP Dev Test ━━━`);
console.error(`  Mode: in-process (no server spawn)`);
console.error(`  Modules: ${targetModules.length}${stopOnFail ? " (stop on fail)" : ""}\n`);

for (let i = 0; i < targetModules.length; i++) {
  const mod = targetModules[i];
  const result = await testModule(mod);
  allResults.push(result);

  printModuleResult(result, i, targetModules.length);

  const hasFail = !result.initOk || result.results.some(isFailed);
  if (hasFail && stopOnFail) {
    aborted = true;
    console.error(`\n  Stopping: --stop-on-fail triggered on ${mod}`);
    break;
  }
}

// ── Summary ──────────────────────────────────────────────────────────
const totalDuration = ((Date.now() - pipelineStart) / 1000).toFixed(1);
let totalPass = 0, totalSkip = 0, totalFail = 0, initFails = 0, totalMemRaw = 0;
for (const r of allResults) {
  if (!r.initOk) initFails++;
  totalMemRaw += r.memDeltaMB || 0;
  const c = countResults(r.results);
  totalPass += c.pass;
  totalSkip += c.skip;
  totalFail += c.fail;
}
const totalMem = totalMemRaw.toFixed(1);

console.error(`\n━━━ Summary ━━━`);
console.error(`  Modules: ${allResults.length}/${targetModules.length}${aborted ? " (aborted)" : ""}`);
console.error(`  Tests: ${totalPass} pass, ${totalSkip} skip, ${totalFail} fail`);
if (initFails > 0) console.error(`  Init failures: ${initFails}`);
console.error(`  Memory: +${totalMem}MB total heap delta`);
console.error(`  Duration: ${totalDuration}s\n`);

// JSON output
if (jsonMode) {
  const report = {
    mode: "dev-test",
    pipeline: {
      modules: targetModules.length,
      completed: allResults.length,
      aborted,
      durationMs: Date.now() - pipelineStart,
    },
    summary: { pass: totalPass, skip: totalSkip, fail: totalFail, initFails, memDeltaMB: parseFloat(totalMem) },
    modules: allResults.map((r) => ({
      module: r.module,
      initOk: r.initOk,
      error: r.error,
      toolCount: r.toolCount,
      toolNames: r.toolNames,
      memDeltaMB: r.memDeltaMB,
      durationMs: r.durationMs,
      results: r.results,
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

// Failed modules detail
const failedModules = allResults.filter(
  (r) => !r.initOk || r.results.some(isFailed),
);
if (failedModules.length > 0 && !jsonMode) {
  console.error("  Failed:");
  for (const r of failedModules) {
    if (!r.initOk) {
      console.error(`    ✗ ${r.module}: init failed — ${r.error}`);
    } else {
      const fails = r.results.filter(isFailed);
      for (const f of fails) {
        console.error(`    ✗ ${r.module}/${f.tool}: ${f.note}`);
      }
    }
  }
  console.error("");
}

process.exit(totalFail + initFails > 0 ? 1 : 0);
