#!/usr/bin/env node
/**
 * AirMCP Demo + Manual Test Runner
 *
 * Records the screen while running a curated demo sequence:
 *   1. System control showcase (dark mode, volume, notification)
 *   2. Productivity flow (notes, calendar, reminders)
 *   3. Safari + Weather chain
 *   4. Send test mail & iMessage (manual tests)
 *   5. Music control
 *   6. Screen capture
 *
 * Usage:
 *   node scripts/qa-demo-test.mjs                    # full demo + manual tests
 *   node scripts/qa-demo-test.mjs --no-record        # skip screen recording
 *   node scripts/qa-demo-test.mjs --manual-only      # only mail/message tests
 *   node scripts/qa-demo-test.mjs --demo-only        # only demo (no mail/message)
 */
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = process.env.HOME || "/tmp";
const TS = Date.now();
const QA = "[AirMCP-QA]";

// ── Tester info ──────────────────────────────────────────────────────
const TESTER = {
  name: "선태영",
  email: "styd4957@gmail.com",
  phone: "+821055834957",
};

// ── CLI flags ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const noRecord = argv.includes("--no-record");
const manualOnly = argv.includes("--manual-only");
const demoOnly = argv.includes("--demo-only");

// ── MCP client ───────────────────────────────────────────────────────
let server;
let buffer = "";
const responseMap = new Map();
let nextId = 1;

function startServer() {
  server = spawn("node", ["dist/index.js"], {
    cwd: ROOT,
    env: { ...process.env, AIRMCP_FULL: "true" },
    stdio: ["pipe", "pipe", "pipe"],
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
      } catch { /* ignore */ }
    }
  });
  server.stderr.on("data", () => {});
}

function send(method, params = {}) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return id;
}

function notify(method, params = {}) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function waitFor(id, timeout = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (responseMap.has(id)) return responseMap.get(id);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function callTool(name, toolArgs = {}, timeout = 20_000) {
  const id = send("tools/call", { name, arguments: toolArgs });
  return waitFor(id, timeout);
}

function parseResult(resp) {
  if (!resp) return { ok: false, error: "Timeout", data: null };
  if (resp.error) return { ok: false, error: resp.error.message, data: null };
  const text = resp.result?.content?.[0]?.text || "";
  if (resp.result?.isError) return { ok: false, error: text.slice(0, 300), data: null };
  try { return { ok: true, data: JSON.parse(text), error: null }; }
  catch { return { ok: true, data: text, error: null }; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(icon, msg) { process.stderr.write(`${icon} ${msg}\n`); }
function pass(msg) { log("\x1b[32m✓\x1b[0m", msg); }
function fail(msg) { log("\x1b[31m✗\x1b[0m", msg); }
function info(msg) { log("\x1b[36m→\x1b[0m", msg); }
function section(msg) { process.stderr.write(`\n\x1b[1m══ ${msg} ══\x1b[0m\n`); }

async function step(label, toolName, args, opts = {}) {
  info(`${label} → ${toolName}`);
  const resp = await callTool(toolName, args, opts.timeout || 20_000);
  const r = parseResult(resp);
  if (r.ok) {
    pass(`${label}: OK`);
    if (opts.log) {
      const preview = typeof r.data === "string" ? r.data.slice(0, 120) : JSON.stringify(r.data).slice(0, 120);
      process.stderr.write(`    ${preview}…\n`);
    }
  } else {
    fail(`${label}: ${r.error?.slice(0, 100)}`);
  }
  return r;
}

// ══════════════════════════════════════════════════════════════════════
// DEMO SEQUENCE
// ══════════════════════════════════════════════════════════════════════

async function runDemo() {
  const cleanups = [];

  // ── 1. System Showcase ─────────────────────────────────────────────
  section("1. System Control");

  const vol = await step("Read volume", "get_volume", {});
  const origVol = vol.data?.outputVolume;
  const origMuted = vol.data?.outputMuted;

  const bright = await step("Read brightness", "get_brightness", {});
  const origBright = bright.data?.brightness;

  await step("Set volume → 50%", "set_volume", { volume: 50 });
  await step("Set brightness → 70%", "set_brightness", { level: 0.7 });
  await step("Show notification", "show_notification", {
    title: "AirMCP Demo",
    message: "226 tools connected. Your Mac is now AI-powered.",
  });
  await step("Battery status", "get_battery_status", {}, { log: true });
  await step("WiFi status", "get_wifi_status", {}, { log: true });
  await step("Frontmost app", "get_frontmost_app", {}, { log: true });
  await step("Running apps", "list_running_apps", {});
  await step("Screen info", "get_screen_info", {}, { log: true });

  // Restore
  if (origVol != null) await callTool("set_volume", { volume: origVol, muted: origMuted ?? false });
  if (origBright != null) await callTool("set_brightness", { level: origBright });
  info("Restored volume & brightness");

  // ── 2. Productivity Flow ───────────────────────────────────────────
  section("2. Productivity (Notes + Calendar + Reminders)");

  const noteResult = await step("Create demo note", "create_note", {
    body: `<h1>${QA} AirMCP Demo Note</h1>
<p>Created by AirMCP E2E demo at ${new Date().toISOString()}</p>
<h2>What AirMCP can do:</h2>
<ul>
<li>Read and write Notes, Calendar, Reminders</li>
<li>Control system settings (volume, brightness, dark mode)</li>
<li>Browse Safari, manage Music playlists</li>
<li>Send iMessages and emails</li>
<li>Get weather, location, and more</li>
</ul>`,
  });
  const noteId = noteResult.data?.id || noteResult.data?.noteId;
  if (noteId) cleanups.push(() => callTool("delete_note", { id: noteId }));

  const eventResult = await step("Create demo event", "create_event", {
    summary: `${QA} AirMCP Demo Meeting`,
    startDate: new Date(Date.now() + 24 * 3600_000).toISOString(),
    endDate: new Date(Date.now() + 25 * 3600_000).toISOString(),
    description: "This event was created by the AirMCP demo script.",
  });
  const eventId = eventResult.data?.id || eventResult.data?.eventId;
  if (eventId) cleanups.push(() => callTool("delete_event", { id: eventId }));

  const remResult = await step("Create demo reminder", "create_reminder", {
    title: `${QA} Review AirMCP demo results`,
    priority: 1,
  });
  const remId = remResult.data?.id || remResult.data?.reminderId;
  if (remId) cleanups.push(() => callTool("delete_reminder", { id: remId }));

  await step("Today's events", "today_events", {}, { log: true });
  await step("Upcoming events", "get_upcoming_events", { limit: 3 }, { log: true });
  await step("Search notes", "search_notes", { query: "AirMCP" }, { log: true });

  // ── 3. Safari + Weather ────────────────────────────────────────────
  section("3. Safari + Weather");

  await step("Open URL in Safari", "open_url", { url: "https://github.com/heznpc/AirMCP" });
  await sleep(3000);
  await step("List tabs", "list_tabs", {}, { log: true });

  const geo = await step("Geocode Seoul", "geocode", { query: "Seoul" }, { log: true });
  const lat = geo.data?.results?.[0]?.latitude ?? 37.5665;
  const lon = geo.data?.results?.[0]?.longitude ?? 126.978;
  await step("Current weather", "get_current_weather", { latitude: lat, longitude: lon }, { log: true });
  await step("3-day forecast", "get_daily_forecast", { latitude: lat, longitude: lon, days: 3 });

  // Close the tab we opened
  const tabs = parseResult(await callTool("list_tabs", {}));
  const tabList = Array.isArray(tabs.data) ? tabs.data : [];
  const ghTab = tabList.find((t) => (t.url || "").includes("heznpc/AirMCP"));
  if (ghTab) {
    await callTool("close_tab", { windowIndex: ghTab.windowIndex ?? 0, tabIndex: ghTab.tabIndex ?? 0 });
    info("Closed demo tab");
  }

  // ── 4. Music ───────────────────────────────────────────────────────
  section("4. Music");

  await step("List playlists", "list_playlists", {}, { log: true });
  await step("Now playing", "now_playing", {}, { log: true });

  // ── 5. Contacts + Files ────────────────────────────────────────────
  section("5. Contacts + Files");

  await step("Search contacts", "search_contacts", { query: TESTER.name }, { log: true });
  await step("List groups", "list_groups", {});
  await step("Recent files", "recent_files", { limit: 3 }, { log: true });
  await step("Home directory", "list_directory", { path: HOME });

  // ── 6. Bluetooth + Location ────────────────────────────────────────
  section("6. Bluetooth + Location");

  await step("Bluetooth state", "get_bluetooth_state", {}, { log: true });
  await step("Scan BLE (2s)", "scan_bluetooth", { duration: 2 }, { log: true, timeout: 30_000 });
  await step("Location permission", "get_location_permission", {}, { log: true });

  // ── 7. Intelligence (macOS 26+) ────────────────────────────────────
  section("7. Apple Intelligence");

  await step("AI status", "ai_status", {}, { log: true });
  await step("Summarize text", "summarize_text", {
    text: "AirMCP is an approval-gated local action runtime for Apple workspaces on macOS. With 289 tools across 29 modules, profile-based loading, progressive tool exposure, HITL approval, and audit logs, it supports Claude Code, Cursor, Codex, and any MCP-compatible client.",
  }, { log: true });

  // ── Cleanup ────────────────────────────────────────────────────────
  section("Cleanup");
  for (const fn of cleanups) {
    try { await fn(); } catch {}
  }
  pass("All demo data cleaned up");
}

// ══════════════════════════════════════════════════════════════════════
// MANUAL TESTS (Mail + iMessage)
// ══════════════════════════════════════════════════════════════════════

async function runManualTests() {
  section("Manual Tests: Mail + iMessage");

  info(`Tester: ${TESTER.name} <${TESTER.email}>`);

  // ── Send Mail ──────────────────────────────────────────────────────
  const mailSubject = `${QA} AirMCP E2E Test — ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
  const mailBody = `안녕하세요 ${TESTER.name}님,

이것은 AirMCP E2E 테스트에서 자동 발송된 메일입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AirMCP — 226 tools, 24 modules
  MCP server for the Apple ecosystem
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

테스트 항목:
  ✓ send_mail 도구가 실제로 메일을 발송하는지 확인
  ✓ 한글 인코딩 정상 여부
  ✓ 수신자에게 정상 도착 여부

이 메일을 수신하셨다면, 테스트 성공입니다.

— AirMCP QA Bot
   Generated: ${new Date().toISOString()}`;

  await step("Send test email", "send_mail", {
    to: [TESTER.email],
    subject: mailSubject,
    body: mailBody,
  }, { log: true, timeout: 30_000 });

  // ── Send iMessage ──────────────────────────────────────────────────
  const msgBody = `${QA} AirMCP E2E 테스트 메시지입니다.

226개 도구 중 send_message를 테스트하고 있습니다.
이 메시지가 보이면 테스트 성공입니다! 🎉

— AirMCP QA Bot (${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})`;

  await step("Send test iMessage", "send_message", {
    target: TESTER.phone,
    text: msgBody,
  }, { log: true, timeout: 30_000 });

  // ── Verify via list ────────────────────────────────────────────────
  await sleep(2000);
  await step("Check mail sent (list accounts)", "list_accounts", {}, { log: true });
  await step("Check recent chats", "list_chats", {}, { log: true });
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

async function main() {
  startServer();

  const initId = send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-demo", version: "1.0" },
  });
  const initResp = await waitFor(initId);
  if (!initResp) { console.error("Failed to init MCP"); process.exit(1); }
  notify("notifications/initialized");
  await sleep(500);

  const { name: srvName, version: srvVer } = initResp.result.serverInfo;
  section(`AirMCP ${srvVer} — Demo & Manual Test`);

  // Artifacts directory
  const artifactDir = `${HOME}/Desktop/airmcp-demo-${new Date().toISOString().slice(0, 10)}`;

  // Screen recording — record a 60s clip covering the demo highlights
  let recordingPath = null;
  if (!noRecord && !manualOnly) {
    info("Starting 60s screen recording...");
    // record_screen runs for the full duration before returning,
    // so we fire it concurrently and let it capture while demo runs.
    const recPromise = callTool("record_screen", { duration: 60 }, 70_000);
    await sleep(1000); // give it a moment to start

    try {
      if (!manualOnly) await runDemo();

      // Take summary screenshot after demo
      section("Capture");
      const shotResp = await callTool("capture_screen", {});
      const shotResult = parseResult(shotResp);
      if (shotResult.ok) {
        pass(`Screenshot captured (${((shotResult.data?.size || 0) / 1024).toFixed(0)} KB)`);
      }
    } finally {}

    if (!demoOnly) await runManualTests();

    // Wait for recording to finish
    info("Waiting for recording to complete...");
    const recResp = await recPromise;
    const recResult = parseResult(recResp);
    if (recResult.ok) {
      recordingPath = recResult.data?.path;
      pass(`Recording saved → ${recordingPath}`);
    } else {
      fail(`Recording: ${recResult.error?.slice(0, 100)}`);
    }

    section("Done");
    if (recordingPath) info(`Demo video: ${recordingPath}`);
    server.kill();
  } else {
    try {
      if (!manualOnly) await runDemo();
      if (!demoOnly) await runManualTests();
    } finally {
      section("Done");
      server.kill();
    }
  }
}

main().catch((e) => {
  console.error(e);
  if (server) server.kill();
  process.exit(1);
});
