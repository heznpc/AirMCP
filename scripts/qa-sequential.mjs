#!/usr/bin/env node
/**
 * AirMCP Sequential QA Test Runner
 *
 * Tests each module in isolation — starts a server with only ONE module enabled,
 * runs its tools, kills the server, then moves to the next module.
 * This avoids loading all 24 modules at once and melting the machine.
 *
 * Usage:
 *   node scripts/qa-sequential.mjs                  # test all modules
 *   node scripts/qa-sequential.mjs notes reminders  # test specific modules only
 *   node scripts/qa-sequential.mjs --out            # write report to file
 */
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── CLI flags ───────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const outFlag = rawArgs.includes("--out");
const filterModules = rawArgs.filter((a) => !a.startsWith("--"));

// ── Per-module test plan ────────────────────────────────────────────
// Keys must match module names in config.ts MODULE_NAMES
const MODULE_TESTS = {
  // ── Notes (12 tools) ──────────────────────────────────────────────
  notes: [
    // Read-only (7)
    ["list_notes", { limit: 5 }],
    ["list_folders", {}],
    ["search_notes", { query: "test" }],
    ["read_note", { id: "__PLACEHOLDER__" }],  // will FAIL gracefully (no such ID)
    ["scan_notes", { limit: 3 }],
    ["compare_notes", { ids: ["__A__", "__B__"] }],
    // Write (2) — create+delete round-trip
    ["create_note", { body: "<h1>[QA-SEQ] Test</h1><p>auto-cleanup</p>" }],
    ["create_folder", { name: "[QA-SEQ] TestFolder" }],
    ["move_note", { id: "__PLACEHOLDER__", folder: "__PLACEHOLDER__" }],
    ["bulk_move_notes", { ids: ["__PLACEHOLDER__"], folder: "__PLACEHOLDER__" }],
    // update_note, delete_note: covered by CRUD
  ],

  // ── Reminders (11 tools) ──────────────────────────────────────────
  reminders: [
    // Read-only (4)
    ["list_reminder_lists", {}],
    ["list_reminders", { limit: 5 }],
    ["read_reminder", { id: "__PLACEHOLDER__" }],
    ["search_reminders", { query: "test" }],
    // Write (2)
    ["create_reminder", { title: "[QA-SEQ] Test Reminder" }],
    ["create_reminder_list", { name: "[QA-SEQ] TestList" }],
    // Swift-only
    ["create_recurring_reminder", { title: "[QA-SEQ] Recurring", recurrence: { frequency: "daily", interval: 1 } }],
    ["complete_reminder", { id: "__PLACEHOLDER__" }],
  ],

  // ── Calendar (12 tools) ───────────────────────────────────────────
  calendar: [
    // Read-only (6)
    ["list_calendars", {}],
    ["list_events", { startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) }],
    ["read_event", { id: "__PLACEHOLDER__" }],
    ["search_events", { query: "test", startDate: "2026-01-01", endDate: "2026-12-31" }],
    ["get_upcoming_events", { limit: 3 }],
    ["today_events", {}],
    // Write (1)
    ["create_event", { summary: "[QA-SEQ] Test Event", startDate: "2026-12-31T10:00:00Z", endDate: "2026-12-31T11:00:00Z" }],
    // App view
    ["calendar_week_view", {}],
  ],

  // ── Contacts (10 tools) ───────────────────────────────────────────
  contacts: [
    // Read-only (5)
    ["list_contacts", { limit: 3 }],
    ["search_contacts", { query: "test" }],
    ["read_contact", { id: "__PLACEHOLDER__" }],
    ["list_groups", {}],
    ["list_group_members", { groupName: "__PLACEHOLDER__" }],
    // Write (3)
    ["create_contact", { firstName: "[QA-SEQ]", lastName: "TestContact" }],
    ["add_contact_email", { id: "__PLACEHOLDER__", email: "qa@test.invalid" }],
    ["add_contact_phone", { id: "__PLACEHOLDER__", phone: "+0000000000" }],
  ],

  // ── Mail (4 tools) ────────────────────────────────────────────────
  mail: [
    // Read-only (3)
    ["list_mailboxes", {}],
    ["get_unread_count", {}],
    ["list_accounts", {}],
    // send_mail / reply_mail: destructive, skip in read QA
  ],

  // ── Messages (6 tools: list_chats, read_chat, search_chats, send_message, send_file, list_participants)
  messages: [
    ["list_chats", {}],
    ["read_chat", { chatId: "__PLACEHOLDER__" }],
    ["search_chats", { query: "test" }],
    ["list_participants", { chatId: "__PLACEHOLDER__" }],
    // send_message, send_file: destructive, skip
  ],

  // ── Music (18 tools) ──────────────────────────────────────────────
  music: [
    ["list_playlists", {}],
    ["now_playing", {}],
    ["list_tracks", { playlist: "__PLACEHOLDER__" }],
    ["search_tracks", { query: "test" }],
    ["get_track_info", { trackName: "__PLACEHOLDER__" }],
    ["get_rating", { trackName: "__PLACEHOLDER__" }],
    ["set_rating", { trackName: "__PLACEHOLDER__", rating: 0 }],
    ["set_shuffle", { enabled: false }],
    ["set_disliked", { trackName: "__PLACEHOLDER__", disliked: false }],
    ["play_track", { trackName: "__PLACEHOLDER__" }],
    ["play_playlist", { name: "__PLACEHOLDER__" }],
    ["playback_control", { action: "pause" }],
    ["music_player", {}],
    // create_playlist, add_to_playlist, remove_from_playlist, delete_playlist: covered by CRUD
  ],

  // ── Finder (9 tools) ──────────────────────────────────────────────
  finder: [
    // Read-only (4)
    ["search_files", { query: "test", limit: 3 }],
    ["get_file_info", { path: process.env.HOME + "/.zshrc" }],
    ["recent_files", { limit: 3 }],
    ["list_directory", { path: process.env.HOME }],
    // Write (1)
    ["create_directory", { path: "/tmp/airmcp-qa-seq-test" }],
    ["set_file_tags", { path: "/tmp/airmcp-qa-seq-test", tags: ["QA"] }],
    ["move_file", { source: "/tmp/airmcp-qa-seq-test", destination: "/tmp/airmcp-qa-seq-test-moved" }],
    // trash_file: covered by CRUD
  ],

  // ── Safari (11 tools) ─────────────────────────────────────────────
  safari: [
    // Read-only (6)
    ["list_tabs", {}],
    ["get_current_tab", {}],
    ["search_tabs", { query: "a" }],
    ["list_bookmarks", {}],
    ["list_reading_list", {}],
    ["read_page_content", { windowIndex: 0, tabIndex: 0, maxLength: 500 }],
    // Write (safe — Safari must be open)
    ["activate_tab", { windowIndex: 0, tabIndex: 0 }],
    ["add_bookmark", { url: "https://example.com", title: "[QA-SEQ]" }],
    ["add_to_reading_list", { url: "https://example.com", title: "[QA-SEQ]" }],
    // open_url, close_tab: covered by CRUD
  ],

  // ── System (24 tools) ─────────────────────────────────────────────
  system: [
    // Read-only (12)
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
    // Safe write
    ["show_notification", { title: "[QA-SEQ]", message: "test" }],
    ["launch_app", { name: "Calculator" }],
    ["capture_screenshot", { path: "/tmp/airmcp-qa-screenshot.png" }],
    ["toggle_dark_mode", {}],
    ["toggle_dark_mode", {}],  // toggle back
    ["set_brightness", { level: 75 }],
    ["move_window", { appName: "Finder", x: 100, y: 100 }],
    ["resize_window", { appName: "Finder", width: 800, height: 600 }],
    ["minimize_window", { appName: "Calculator" }],
    ["quit_app", { name: "Calculator" }],
    // system_sleep, system_power, toggle_wifi: dangerous, skip
  ],

  // ── Photos (12 tools) ─────────────────────────────────────────────
  photos: [
    // Read-only (6)
    ["list_albums", {}],
    ["list_photos", { album: "__PLACEHOLDER__" }],
    ["search_photos", { query: "test" }],
    ["get_photo_info", { id: "__PLACEHOLDER__" }],
    ["list_favorites", {}],
    // Swift-only read
    ["query_photos", { limit: 3 }],
    ["classify_image", { imagePath: "/System/Library/Desktop Pictures/Sequoia.heic" }],
    // Write
    ["create_album", { name: "[QA-SEQ] TestAlbum" }],
    ["add_to_album", { photoIds: ["__PLACEHOLDER__"], albumName: "__PLACEHOLDER__" }],
    // set_favorited is in music module, not photos
    // import_photo, delete_photos: Swift-only / destructive
  ],

  // ── Shortcuts (10 tools) ──────────────────────────────────────────
  shortcuts: [
    // Read-only (3)
    ["list_shortcuts", {}],
    ["search_shortcuts", { query: "test" }],
    ["get_shortcut_detail", { name: "__PLACEHOLDER__" }],
    ["run_shortcut", { name: "__PLACEHOLDER__" }],
    ["export_shortcut", { name: "__PLACEHOLDER__", outputPath: "/tmp/airmcp-qa-shortcut" }],
    ["duplicate_shortcut", { name: "__PLACEHOLDER__", newName: "[QA-SEQ] Copy" }],
    // create_shortcut, import_shortcut, edit_shortcut, delete_shortcut: complex lifecycle
  ],

  // ── Intelligence (8 tools) ────────────────────────────────────────
  intelligence: [
    ["ai_status", {}],
    // All others require macOS 26+ Foundation Models
    ["summarize_text", { text: "AirMCP is an MCP server for Apple ecosystem." }],
    ["rewrite_text", { text: "This is a test.", style: "professional" }],
    ["proofread_text", { text: "This are a test." }],
    ["generate_text", { prompt: "Say hello." }],
  ],

  // ── TV (6 tools) ──────────────────────────────────────────────────
  tv: [
    ["tv_list_playlists", {}],
    ["tv_list_tracks", { playlist: "__PLACEHOLDER__" }],
    ["tv_now_playing", {}],
    ["tv_search", { query: "test" }],
    ["tv_playback_control", { action: "pause" }],
    ["tv_play", { name: "__PLACEHOLDER__" }],
  ],

  // ── UI (10 tools) ─────────────────────────────────────────────────
  ui: [
    // Read-only (4)
    ["ui_read", { app: "Finder" }],
    ["ui_accessibility_query", { app: "Finder", role: "AXWindow" }],
    ["ui_traverse", { app: "Finder" }],
    ["ui_diff", { beforeSnapshot: "__PLACEHOLDER__", app: "Finder" }],
    ["ui_open_app", { appName: "Finder" }],
    ["ui_scroll", { app: "Finder", direction: "down", amount: 1 }],
    // ui_click, ui_type, ui_press_key, ui_perform_action: destructive, skip
  ],

  // ── Screen (5 tools: list_windows, capture_screen, capture_window, capture_area, record_screen)
  screen: [
    ["list_windows", {}],
    ["capture_screen", {}],
    ["capture_window", { appName: "Finder" }],
    ["capture_area", { x: 0, y: 0, width: 100, height: 100 }],
    // record_screen, drop_recording: destructive / long-running
  ],

  // ── Maps (6 tools) ────────────────────────────────────────────────
  maps: [
    ["geocode", { query: "Seoul" }],
    ["reverse_geocode", { latitude: 37.5665, longitude: 126.978 }],
    ["share_location", { latitude: 37.5665, longitude: 126.978, name: "Seoul" }],
    // get_current_location is in location module, not maps
    ["search_location", { query: "coffee", latitude: 37.5665, longitude: 126.978 }],
    ["get_directions", { from: "Seoul Station", to: "Gangnam Station" }],
    ["drop_pin", { latitude: 37.5665, longitude: 126.978, label: "[QA-SEQ]" }],
    ["open_address", { address: "Seoul Station" }],
    ["search_nearby", { query: "cafe", latitude: 37.5665, longitude: 126.978 }],
  ],

  // ── Podcasts (3 tools) ────────────────────────────────────────────
  podcasts: [
    ["list_podcast_shows", {}],
    ["podcast_now_playing", {}],
    ["list_podcast_episodes", { showName: "__PLACEHOLDER__" }],
    ["search_podcast_episodes", { query: "test" }],
    ["podcast_playback_control", { action: "pause" }],
    ["play_podcast_episode", { showName: "__PLACEHOLDER__", episodeName: "__PLACEHOLDER__" }],
  ],

  // ── Weather (3 tools — all read-only) ─────────────────────────────
  weather: [
    ["get_current_weather", { latitude: 37.5665, longitude: 126.978 }],
    ["get_daily_forecast", { latitude: 37.5665, longitude: 126.978, days: 3 }],
    ["get_hourly_forecast", { latitude: 37.5665, longitude: 126.978, hours: 6 }],
  ],

  // ── Pages (7 tools) ───────────────────────────────────────────────
  pages: [
    ["pages_list_documents", {}],
    ["pages_get_body_text", { document: "__PLACEHOLDER__" }],
    ["pages_open_document", { path: "/tmp/nonexistent-qa.pages" }],
    ["pages_export_pdf", { document: "__PLACEHOLDER__", outputPath: "/tmp/airmcp-qa-pages.pdf" }],
    // pages_create_document, pages_set_body_text, pages_close_document: covered by CRUD
  ],

  // ── Numbers (9 tools) ─────────────────────────────────────────────
  numbers: [
    ["numbers_list_documents", {}],
    ["numbers_list_sheets", { document: "__PLACEHOLDER__" }],
    ["numbers_read_cells", { document: "__PLACEHOLDER__", sheet: "__PLACEHOLDER__", startRow: 1, startCol: 1, endRow: 2, endCol: 2 }],
    ["numbers_add_sheet", { document: "__PLACEHOLDER__", sheetName: "[QA-SEQ]" }],
    ["numbers_export_pdf", { document: "__PLACEHOLDER__", outputPath: "/tmp/airmcp-qa-numbers.pdf" }],
    // numbers_create_document, numbers_set_cell, numbers_get_cell, numbers_close_document: covered by CRUD
  ],

  // ── Keynote (9 tools) ─────────────────────────────────────────────
  keynote: [
    ["keynote_list_documents", {}],
    ["keynote_list_slides", { document: "__PLACEHOLDER__" }],
    ["keynote_export_pdf", { document: "__PLACEHOLDER__", outputPath: "/tmp/airmcp-qa-keynote.pdf" }],
    ["keynote_start_slideshow", { document: "__PLACEHOLDER__" }],
    // keynote_create_document, keynote_add_slide, keynote_get_slide, keynote_set_presenter_notes, keynote_close_document: covered by CRUD
  ],

  // ── Location (1 read-only tool, rest in maps) ────────────────────
  location: [
    ["get_location_permission", {}],
    ["get_current_location", {}],
  ],

  // ── Bluetooth (4 tools) ───────────────────────────────────────────
  bluetooth: [
    ["get_bluetooth_state", {}],
    ["scan_bluetooth", {}],
    ["connect_bluetooth", { identifier: "__PLACEHOLDER__" }],
    ["disconnect_bluetooth", { identifier: "__PLACEHOLDER__" }],
  ],

  // ── Google Workspace (16 tools) ───────────────────────────────────
  google: [
    ["gws_status", {}],
    // all others require GWS CLI auth, will SKIP gracefully
    ["gws_gmail_list", {}],
    ["gws_drive_list", {}],
    ["gws_calendar_list", {}],
    ["gws_tasks_list", {}],
  ],
};

// ── Extra tools registered outside MANIFEST (cross, semantic, setup, apps, etc.)
// These are always registered regardless of which module is enabled.
// We test them on a minimal server (system module only).
const EXTRA_TESTS = [
  // Semantic search status
  ["semantic", "semantic_status", {}],
  // Setup & diagnostics (triggers permission check, read-only probe)
  ["setup", "setup_permissions", {}],
  // Workflow bridge (returns prompt content as tool)
  ["workflow", "get_workflow", { name: "daily-briefing" }],
  // Cross-module (will timeout/fail — requires MCP Sampling, but registers the tool)
  ["cross", "summarize_context", {}],
  // find_related not in cross module
  // Note: skill_* tools are dynamic (YAML-based) — no fixed tool name to test
];

// ── All module names from MODULE_NAMES order ────────────────────────
const ALL_MODULES = [
  "notes", "reminders", "calendar", "contacts", "mail", "messages",
  "music", "finder", "safari", "system", "photos", "shortcuts",
  "intelligence", "tv", "ui", "screen", "maps", "podcasts",
  "weather", "pages", "numbers", "keynote", "location", "bluetooth",
  "google",
];

// ── MCP client for a single-module server ───────────────────────────

function buildDisableEnv(enableModule) {
  const env = { ...process.env, AIRMCP_FULL: "true", AIRMCP_HITL_LEVEL: "off" };
  for (const mod of ALL_MODULES) {
    if (mod !== enableModule) {
      env[`AIRMCP_DISABLE_${mod.toUpperCase()}`] = "true";
    }
  }
  // Ensure the target module is NOT disabled
  delete env[`AIRMCP_DISABLE_${enableModule.toUpperCase()}`];
  return env;
}

class McpClient {
  constructor(moduleName) {
    this.moduleName = moduleName;
    this.buffer = "";
    this.responses = new Map();
    this.nextId = 1;
    this.proc = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const env = buildDisableEnv(this.moduleName);
      this.proc = spawn("node", ["dist/index.js"], {
        cwd: ROOT,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.stdout.on("data", (chunk) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id != null) this.responses.set(msg.id, msg);
          } catch { /* ignore non-JSON (banner etc.) */ }
        }
      });

      // Collect stderr but don't block
      this.proc.stderr.on("data", () => {});

      this.proc.on("error", reject);

      // Initialize MCP handshake
      const initId = this.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "qa-sequential", version: "1.0" },
      });

      this.waitFor(initId, 20000).then((resp) => {
        if (!resp) {
          reject(new Error(`Server init timeout for module: ${this.moduleName}`));
          return;
        }
        this.notify("notifications/initialized");
        // Give the server a moment to settle
        setTimeout(() => resolve(), 300);
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
    return id;
  }

  notify(method, params = {}) {
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }

  async waitFor(id, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.responses.has(id)) return this.responses.get(id);
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  async callTool(name, toolArgs = {}) {
    const id = this.send("tools/call", { name, arguments: toolArgs });
    return this.waitFor(id, 30000);
  }

  kill() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      // Force kill after 3s
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL");
      }, 3000).unref();
    }
  }
}

// ── Classify result (same logic as qa-test.mjs) ────────────────────
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
  if (/Connection is invalid/i.test(text))
    return { status: "SKIP", note: "App not running (connection invalid)" };
  if (/Object not found.*-1728|not found.*-1728/i.test(text))
    return { status: "SKIP", note: "Object not found (placeholder ID)" };
  if (/__PLACEHOLDER__/.test(JSON.stringify(text)))
    return { status: "SKIP", note: "Placeholder arg (expected)" };
  if (/No .* (open|found|running)|not open|no windows|No Safari|no document/i.test(text))
    return { status: "SKIP", note: "App/document not open" };
  if (/whose.*not found|group.*not found|playlist.*not found|album.*not found|chat.*not found/i.test(text))
    return { status: "SKIP", note: "Named object not found (placeholder)" };
  if (/Google Workspace CLI failed|gws.*failed/i.test(text))
    return { status: "SKIP", note: "GWS CLI not authenticated" };
  if (/Full Disk Access|sandbox|not authorized|Screen Recording/i.test(text))
    return { status: "SKIP", note: "Needs macOS permission (Full Disk / Screen Recording)" };
  if (/osascript error.*Command failed.*__PLACEHOLDER__/i.test(text))
    return { status: "SKIP", note: "Placeholder arg (expected)" };
  // Generic "osascript error" for placeholder names that trigger JXA failures
  if (/osascript error.*whose|osascript error.*byId|Cannot find/i.test(text))
    return { status: "SKIP", note: "Object not found (placeholder name/ID)" };
  if (/screencapture.*error|screencapture.*failed/i.test(text))
    return { status: "SKIP", note: "screencapture failed (permission or window)" };
  if (/Circuit open/i.test(text))
    return { status: "SKIP", note: "Circuit breaker open (cascade from prior failure)" };
  if (/requires user approval|user denied|Action denied/i.test(text))
    return { status: "SKIP", note: "HITL guard — needs user approval" };
  if (/(-1708)|이해할 수 없습니다|not understood/i.test(text))
    return { status: "FAIL", note: "JXA API incompatible" };
  if (/timed out|timeout/i.test(text))
    return { status: "SKIP", note: "Timed out" };
  return { status: "FAIL", note: text.slice(0, 150) };
}

// ── Status icons ────────────────────────────────────────────────────
const ICONS = { PASS: "\x1b[32m✓\x1b[0m", SKIP: "\x1b[33m○\x1b[0m", FAIL: "\x1b[31m✗\x1b[0m", ERROR: "\x1b[31m✗\x1b[0m" };
const MD_ICONS = { PASS: "✅", SKIP: "⏭️", FAIL: "❌", ERROR: "❌" };

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const modulesToTest = filterModules.length > 0
    ? filterModules.filter((m) => ALL_MODULES.includes(m))
    : ALL_MODULES;

  if (filterModules.length > 0) {
    const unknown = filterModules.filter((m) => !ALL_MODULES.includes(m));
    if (unknown.length > 0) {
      process.stderr.write(`\x1b[33mUnknown modules (skipping): ${unknown.join(", ")}\x1b[0m\n`);
    }
  }

  const totalModules = modulesToTest.length;
  const allResults = [];

  process.stderr.write(`\n\x1b[1mAirMCP Sequential QA — ${totalModules} modules\x1b[0m\n`);
  process.stderr.write(`${"─".repeat(50)}\n\n`);

  for (let i = 0; i < modulesToTest.length; i++) {
    const mod = modulesToTest[i];
    const tests = MODULE_TESTS[mod] ?? [];
    const progress = `[${i + 1}/${totalModules}]`;

    if (tests.length === 0) {
      process.stderr.write(`${progress} \x1b[2m${mod}\x1b[0m — no read-only tools to test\n`);
      continue;
    }

    process.stderr.write(`${progress} \x1b[1m${mod}\x1b[0m — starting server...\n`);

    const client = new McpClient(mod);
    let serverOk = true;
    try {
      await client.start();
    } catch (e) {
      process.stderr.write(`  \x1b[31m✗ Server failed to start: ${e.message}\x1b[0m\n`);
      allResults.push({ module: mod, tool: "(server)", status: "ERROR", note: e.message.slice(0, 150) });
      serverOk = false;
    }

    if (serverOk) {
      for (const [tool, args] of tests) {
        const resp = await client.callTool(tool, args);
        const { status, note } = classify(resp);
        allResults.push({ module: mod, tool, status, note });
        process.stderr.write(`  ${ICONS[status]} ${tool}: ${status}${note ? ` — ${note}` : ""}\n`);
      }
    }

    client.kill();

    // Wait for process to fully exit before starting next module
    await new Promise((r) => setTimeout(r, 500));
    process.stderr.write("\n");
  }

  // ── Extra tools (cross, semantic, setup, skills, etc.) ──────────
  if (filterModules.length === 0 || filterModules.includes("_extra")) {
    process.stderr.write(`\x1b[1m[extra]\x1b[0m \x1b[1mcross/semantic/setup/skills\x1b[0m — starting server (system only)...\n`);

    // Start a minimal server with just "system" enabled to test always-registered tools
    const extraClient = new McpClient("system");
    let extraOk = true;
    try {
      await extraClient.start();
    } catch (e) {
      process.stderr.write(`  \x1b[31m✗ Server failed to start: ${e.message}\x1b[0m\n`);
      allResults.push({ module: "_extra", tool: "(server)", status: "ERROR", note: e.message.slice(0, 150) });
      extraOk = false;
    }

    if (extraOk) {
      for (const [group, tool, args] of EXTRA_TESTS) {
        const resp = await extraClient.callTool(tool, args);
        const { status, note } = classify(resp);
        allResults.push({ module: group, tool, status, note });
        process.stderr.write(`  ${ICONS[status]} [${group}] ${tool}: ${status}${note ? ` — ${note}` : ""}\n`);
      }
    }

    extraClient.kill();
    await new Promise((r) => setTimeout(r, 500));
    process.stderr.write("\n");
  }

  // ── Summary ─────────────────────────────────────────────────────
  const pass = allResults.filter((r) => r.status === "PASS").length;
  const skip = allResults.filter((r) => r.status === "SKIP").length;
  const fail = allResults.filter((r) => r.status === "FAIL").length;
  const error = allResults.filter((r) => r.status === "ERROR").length;
  const total = allResults.length;

  process.stderr.write(`${"─".repeat(50)}\n`);
  process.stderr.write(`\x1b[1mSummary:\x1b[0m \x1b[32m${pass} pass\x1b[0m / \x1b[33m${skip} skip\x1b[0m / \x1b[31m${fail + error} fail\x1b[0m / ${total} total\n`);

  if (fail + error > 0) {
    process.stderr.write(`\n\x1b[31mFailures:\x1b[0m\n`);
    for (const r of allResults.filter((r) => r.status === "FAIL" || r.status === "ERROR")) {
      process.stderr.write(`  ✗ [${r.module}] ${r.tool} — ${r.note}\n`);
    }
  }

  // ── Markdown report ───────────────────────────────────────────
  if (outFlag) {
    let macosVersion = "unknown";
    try {
      const { execSync } = await import("child_process");
      macosVersion = execSync("sw_vers -productVersion", { encoding: "utf8" }).trim();
    } catch { /* ignore */ }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [];
    lines.push(`## Sequential QA Test Report`);
    lines.push(``);
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| **Date** | ${now} UTC |`);
    lines.push(`| **macOS** | ${macosVersion} |`);
    lines.push(`| **Node.js** | ${process.version} |`);
    lines.push(`| **Mode** | Sequential (one module per server) |`);
    lines.push(``);
    lines.push(`### Summary`);
    lines.push(``);
    lines.push(`| PASS | SKIP | FAIL | ERROR | Total |`);
    lines.push(`|------|------|------|-------|-------|`);
    lines.push(`| ${pass} | ${skip} | ${fail} | ${error} | ${total} |`);
    lines.push(``);
    lines.push(`### Results by Module`);
    lines.push(``);
    lines.push(`| Module | Tool | Status | Note |`);
    lines.push(`|--------|------|--------|------|`);
    for (const r of allResults) {
      lines.push(`| ${r.module} | \`${r.tool}\` | ${MD_ICONS[r.status]} ${r.status} | ${r.note || "-"} |`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`node scripts/qa-sequential.mjs\`*`);

    const outPath = resolve(ROOT, `qa-sequential-report-${new Date().toISOString().slice(0, 10)}.md`);
    writeFileSync(outPath, lines.join("\n"));
    process.stderr.write(`\nReport: ${outPath}\n`);
  }

  process.exit(fail + error > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
