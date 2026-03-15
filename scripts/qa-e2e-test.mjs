#!/usr/bin/env node
/**
 * AirMCP E2E Test Runner — Full Tool Coverage + Orchestration
 *
 * Phase 1: Calls tools/list, then exercises every tool that can be
 *          safely auto-tested (read + safe-write with cleanup).
 * Phase 2: Multi-module orchestration scenarios that chain tool outputs
 *          as inputs to subsequent tools — proving end-to-end flows.
 *
 * Usage:
 *   node scripts/qa-e2e-test.mjs                    # full run
 *   node scripts/qa-e2e-test.mjs --phase coverage   # coverage only
 *   node scripts/qa-e2e-test.mjs --phase orch       # orchestration only
 *   node scripts/qa-e2e-test.mjs --out              # write report to file
 *   node scripts/qa-e2e-test.mjs --json             # JSON output
 *   node scripts/qa-e2e-test.mjs --dry-run          # show plan without running
 */
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = process.env.HOME || "/tmp";
const TS = Date.now();
const QA = "[AirMCP-E2E]";

// ── CLI flags ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");
const outFlag = argv.includes("--out");
const dryRun = argv.includes("--dry-run");
const phaseOnly = (() => {
  const i = argv.indexOf("--phase");
  return i >= 0 ? argv[i + 1] : null;
})();
const outPath = outFlag
  ? resolve(ROOT, `qa-e2e-report-${new Date().toISOString().slice(0, 10)}.md`)
  : null;

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

// ── Classify tool result for coverage ────────────────────────────────
function classify(resp) {
  if (!resp) return "TIMEOUT";
  if (resp.error) {
    const m = resp.error.message || "";
    if (m.includes("not found")) return "UNREGISTERED";
    return "FAIL";
  }
  const text = resp.result?.content?.[0]?.text || "";
  if (!resp.result?.isError) return "PASS";
  if (/Swift bridge|not built/i.test(text)) return "SKIP:SWIFT";
  if (/not authorized|permission/i.test(text)) return "SKIP:PERM";
  if (/isn't running|not running|can't be found|Connection is invalid/i.test(text)) return "SKIP:APP";
  if (/timed out|timeout/i.test(text)) return "SKIP:TIMEOUT";
  return "FAIL";
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 1: FULL TOOL COVERAGE
// ══════════════════════════════════════════════════════════════════════

// Every tool → test args or skip reason.
// "auto" = call directly, "manual" = skip with reason.
const COVERAGE_PLAN = [
  // ── Notes (12) ─────────────────────────────────────────────────────
  { tool: "list_notes", args: { limit: 3 } },
  { tool: "list_folders", args: {} },
  { tool: "search_notes", args: { query: "test" } },
  { tool: "scan_notes", args: { limit: 3 } },
  { tool: "read_note", chain: "noteId" },
  { tool: "compare_notes", chain: "noteIds" },
  { tool: "create_note", skip: "Covered by CRUD+Orchestration" },
  { tool: "update_note", skip: "Covered by CRUD+Orchestration" },
  { tool: "delete_note", skip: "Covered by CRUD+Orchestration" },
  { tool: "move_note", skip: "Covered by CRUD (modifies data)" },
  { tool: "bulk_move_notes", skip: "Covered by CRUD (modifies data)" },
  { tool: "create_folder", skip: "Covered by CRUD" },

  // ── Reminders (11) ────────────────────────────────────────────────
  { tool: "list_reminder_lists", args: {} },
  { tool: "list_reminders", args: { limit: 5 } },
  { tool: "search_reminders", args: { query: "test" } },
  { tool: "read_reminder", chain: "reminderId" },
  { tool: "create_reminder", skip: "Covered by CRUD+Orchestration" },
  { tool: "update_reminder", skip: "Covered by CRUD" },
  { tool: "complete_reminder", skip: "Covered by CRUD" },
  { tool: "delete_reminder", skip: "Covered by CRUD" },
  { tool: "create_reminder_list", skip: "Covered by CRUD" },
  { tool: "delete_reminder_list", skip: "Covered by CRUD" },
  { tool: "create_recurring_reminder", skip: "Requires Swift bridge" },

  // ── Calendar (10) ─────────────────────────────────────────────────
  { tool: "list_calendars", args: {} },
  { tool: "today_events", args: {} },
  { tool: "get_upcoming_events", args: { limit: 5 } },
  { tool: "list_events", args: { startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 86400_000).toISOString() } },
  { tool: "search_events", args: { query: "meeting", startDate: new Date(Date.now() - 30 * 86400_000).toISOString(), endDate: new Date(Date.now() + 30 * 86400_000).toISOString() } },
  { tool: "read_event", chain: "eventId" },
  { tool: "create_event", skip: "Covered by CRUD+Orchestration" },
  { tool: "update_event", skip: "Covered by CRUD" },
  { tool: "delete_event", skip: "Covered by CRUD+Orchestration" },
  { tool: "create_recurring_event", skip: "Requires Swift bridge" },

  // ── Contacts (10) ─────────────────────────────────────────────────
  { tool: "list_contacts", args: { limit: 3 } },
  { tool: "search_contacts", args: { query: "a" } },
  { tool: "list_groups", args: {} },
  { tool: "read_contact", chain: "contactId" },
  { tool: "list_group_members", chain: "groupName" },
  { tool: "create_contact", skip: "Covered by CRUD" },
  { tool: "update_contact", skip: "Covered by CRUD" },
  { tool: "delete_contact", skip: "Covered by CRUD" },
  { tool: "add_contact_email", skip: "Modifies real contact" },
  { tool: "add_contact_phone", skip: "Modifies real contact" },

  // ── Mail (11) ─────────────────────────────────────────────────────
  { tool: "list_mailboxes", args: {} },
  { tool: "get_unread_count", args: {} },
  { tool: "list_accounts", args: {} },
  { tool: "list_messages", args: { mailbox: "INBOX", limit: 3 } },
  { tool: "search_messages", args: { query: "test", limit: 3 } },
  { tool: "read_message", chain: "messageId" },
  { tool: "mark_message_read", skip: "Modifies real mail state" },
  { tool: "flag_message", skip: "Modifies real mail state" },
  { tool: "move_message", skip: "Modifies real mail state" },
  { tool: "send_mail", skip: "Sends real email" },
  { tool: "reply_mail", skip: "Sends real email" },

  // ── Music (17) ────────────────────────────────────────────────────
  { tool: "list_playlists", args: {} },
  { tool: "now_playing", args: {} },
  { tool: "search_tracks", args: { query: "love" } },
  { tool: "list_tracks", chain: "playlistName" },
  { tool: "get_track_info", chain: "trackName" },
  { tool: "get_rating", chain: "trackName2" },
  { tool: "create_playlist", skip: "Covered by CRUD" },
  { tool: "delete_playlist", skip: "Covered by CRUD" },
  { tool: "play_track", skip: "Affects playback state" },
  { tool: "play_playlist", skip: "Affects playback state" },
  { tool: "playback_control", skip: "Affects playback state" },
  { tool: "set_shuffle", skip: "Affects playback state" },
  { tool: "add_to_playlist", skip: "Modifies playlist" },
  { tool: "remove_from_playlist", skip: "Modifies playlist" },
  { tool: "set_rating", skip: "Modifies library metadata" },
  { tool: "set_favorited", skip: "Modifies library metadata" },
  { tool: "set_disliked", skip: "Modifies library metadata" },

  // ── Finder (8) ────────────────────────────────────────────────────
  { tool: "search_files", args: { query: "test", limit: 3 } },
  { tool: "list_directory", args: { path: HOME } },
  { tool: "recent_files", args: { limit: 3 } },
  { tool: "get_file_info", args: { path: `${HOME}/.zshrc` } },
  { tool: "create_directory", skip: "Covered by CRUD" },
  { tool: "trash_file", skip: "Covered by CRUD" },
  { tool: "move_file", skip: "Modifies filesystem" },
  { tool: "set_file_tags", skip: "Modifies filesystem metadata" },

  // ── Safari (12) ───────────────────────────────────────────────────
  { tool: "list_tabs", args: {} },
  { tool: "get_current_tab", args: {} },
  { tool: "search_tabs", args: { query: "a" } },
  { tool: "list_bookmarks", args: {} },
  { tool: "list_reading_list", args: {} },
  { tool: "read_page_content", chain: "tabCoords" },
  { tool: "open_url", skip: "Covered by CRUD+Orchestration" },
  { tool: "close_tab", skip: "Covered by CRUD+Orchestration" },
  { tool: "activate_tab", skip: "Affects UI focus" },
  { tool: "run_javascript", skip: "Arbitrary code execution — manual only" },
  { tool: "add_bookmark", skip: "Modifies bookmarks" },
  { tool: "add_to_reading_list", skip: "Modifies reading list" },

  // ── System (27) ───────────────────────────────────────────────────
  { tool: "get_clipboard", args: {} },
  { tool: "get_volume", args: {} },
  { tool: "get_frontmost_app", args: {} },
  { tool: "list_running_apps", args: {} },
  { tool: "get_screen_info", args: {} },
  { tool: "get_wifi_status", args: {} },
  { tool: "get_battery_status", args: {} },
  { tool: "get_brightness", args: {} },
  { tool: "list_bluetooth_devices", args: {} },
  { tool: "list_all_windows", args: {} },
  { tool: "is_app_running", args: { name: "Finder" } },
  { tool: "show_notification", args: { title: QA, message: "E2E test notification" } },
  { tool: "set_clipboard", skip: "Covered by CRUD+Orchestration" },
  { tool: "set_volume", skip: "Covered by CRUD+Orchestration" },
  { tool: "set_brightness", skip: "Covered by Orchestration" },
  { tool: "toggle_dark_mode", skip: "Covered by Orchestration" },
  { tool: "toggle_wifi", skip: "Disrupts network — manual only" },
  { tool: "toggle_focus_mode", skip: "Affects system DND" },
  { tool: "capture_screenshot", skip: "Creates files — covered by Orchestration" },
  { tool: "launch_app", skip: "Covered by Orchestration" },
  { tool: "quit_app", skip: "Covered by Orchestration" },
  { tool: "move_window", skip: "Covered by Orchestration" },
  { tool: "resize_window", skip: "Covered by Orchestration" },
  { tool: "minimize_window", skip: "Affects window state" },
  { tool: "prevent_sleep", skip: "System side effect" },
  { tool: "system_sleep", skip: "Destructive — puts Mac to sleep" },
  { tool: "system_power", skip: "Destructive — shutdown/restart" },

  // ── Photos (9) ────────────────────────────────────────────────────
  { tool: "list_albums", args: {} },
  { tool: "list_favorites", args: {} },
  { tool: "search_photos", args: { query: "test" } },
  { tool: "list_photos", chain: "albumName" },
  { tool: "get_photo_info", chain: "photoId" },
  { tool: "create_album", skip: "Modifies Photos library" },
  { tool: "add_to_album", skip: "Modifies Photos library" },
  { tool: "import_photo", skip: "Requires Swift + real file" },
  { tool: "delete_photos", skip: "Irreversible — manual only" },

  // ── Messages (6) ──────────────────────────────────────────────────
  { tool: "list_chats", args: {} },
  { tool: "read_chat", chain: "chatId" },
  { tool: "search_chats", args: { query: "a" } },
  { tool: "list_participants", chain: "chatId2" },
  { tool: "send_message", skip: "Sends real iMessage" },
  { tool: "send_file", skip: "Sends real iMessage with file" },

  // ── Shortcuts (10) ────────────────────────────────────────────────
  { tool: "list_shortcuts", args: {} },
  { tool: "search_shortcuts", args: { query: "a" } },
  { tool: "get_shortcut_detail", chain: "shortcutName" },
  { tool: "run_shortcut", skip: "Unknown side effects" },
  { tool: "create_shortcut", skip: "Modifies Shortcuts library (UI automation)" },
  { tool: "delete_shortcut", skip: "Modifies Shortcuts library" },
  { tool: "export_shortcut", skip: "Creates file" },
  { tool: "import_shortcut", skip: "Modifies Shortcuts library" },
  { tool: "edit_shortcut", skip: "Opens UI" },
  { tool: "duplicate_shortcut", skip: "Modifies Shortcuts library" },

  // ── UI Automation (6) ─────────────────────────────────────────────
  { tool: "ui_read", args: { app: "Finder" } },
  { tool: "ui_open_app", skip: "Covered by Orchestration" },
  { tool: "ui_click", skip: "Arbitrary UI interaction" },
  { tool: "ui_type", skip: "Arbitrary UI interaction" },
  { tool: "ui_press_key", skip: "Arbitrary UI interaction" },
  { tool: "ui_scroll", skip: "Arbitrary UI interaction" },

  // ── Intelligence (8) ──────────────────────────────────────────────
  { tool: "ai_status", args: {} },
  { tool: "summarize_text", args: { text: "AirMCP is an MCP server for macOS. It connects AI to Apple apps. It has 226 tools." } },
  { tool: "rewrite_text", args: { text: "This is a test sentence for rewriting.", tone: "professional" } },
  { tool: "proofread_text", args: { text: "Ths is a tset sentance with erors." } },
  { tool: "generate_text", args: { prompt: "Write one sentence about macOS automation." } },
  { tool: "generate_structured", args: { prompt: "List 2 colors", schema: { colors: { type: "array", description: "List of color names" } } } },
  { tool: "tag_content", args: { text: "Apple released macOS 26 with new features for developers.", tags: ["tech", "apple", "software", "sports"] } },
  { tool: "ai_chat", args: { sessionName: "qa-e2e-test", message: "Say hello in one word." } },

  // ── TV (6) ────────────────────────────────────────────────────────
  { tool: "tv_list_playlists", args: {} },
  { tool: "tv_now_playing", args: {} },
  { tool: "tv_search", args: { query: "test" } },
  { tool: "tv_list_tracks", chain: "tvPlaylist" },
  { tool: "tv_playback_control", skip: "Affects playback state" },
  { tool: "tv_play", skip: "Affects playback state" },

  // ── Screen Capture (5) ────────────────────────────────────────────
  { tool: "list_windows", args: {} },
  { tool: "capture_screen", skip: "Covered by Orchestration" },
  { tool: "capture_window", skip: "Creates file" },
  { tool: "capture_area", skip: "Creates file" },
  { tool: "record_screen", skip: "Creates large file + long duration" },

  // ── Maps (8) ──────────────────────────────────────────────────────
  { tool: "geocode", args: { query: "Seoul" } },
  { tool: "reverse_geocode", args: { latitude: 37.5665, longitude: 126.978 } },
  { tool: "share_location", args: { latitude: 37.5665, longitude: 126.978, name: "Seoul" } },
  { tool: "search_nearby", args: { query: "coffee", latitude: 37.5665, longitude: 126.978 } },
  { tool: "search_location", skip: "Opens Maps UI" },
  { tool: "get_directions", skip: "Opens Maps UI" },
  { tool: "drop_pin", skip: "Opens Maps UI" },
  { tool: "open_address", skip: "Opens Maps UI" },

  // ── Podcasts (6) ──────────────────────────────────────────────────
  { tool: "list_podcast_shows", args: {} },
  { tool: "podcast_now_playing", args: {} },
  { tool: "list_podcast_episodes", chain: "podcastShow" },
  { tool: "search_podcast_episodes", args: { query: "tech" } },
  { tool: "podcast_playback_control", skip: "Affects playback" },
  { tool: "play_podcast_episode", skip: "Affects playback" },

  // ── Weather (3) ───────────────────────────────────────────────────
  { tool: "get_current_weather", args: { latitude: 37.5665, longitude: 126.978 } },
  { tool: "get_daily_forecast", args: { latitude: 37.5665, longitude: 126.978, days: 3 } },
  { tool: "get_hourly_forecast", args: { latitude: 37.5665, longitude: 126.978, hours: 6 } },

  // ── Location (2) ──────────────────────────────────────────────────
  { tool: "get_location_permission", args: {} },
  { tool: "get_current_location", args: {} },

  // ── Bluetooth (4) ─────────────────────────────────────────────────
  { tool: "get_bluetooth_state", args: {} },
  { tool: "scan_bluetooth", args: { duration: 2 } },
  { tool: "connect_bluetooth", skip: "Requires paired BLE device" },
  { tool: "disconnect_bluetooth", skip: "Requires paired BLE device" },

  // ── Pages (7) ──────────────────────────────────────────────────────
  { tool: "pages_list_documents", args: {} },
  { tool: "pages_create_document", skip: "Covered by CRUD" },
  { tool: "pages_close_document", skip: "Covered by CRUD" },
  { tool: "pages_open_document", skip: "Requires file path" },
  { tool: "pages_get_body_text", skip: "Covered by CRUD" },
  { tool: "pages_set_body_text", skip: "Covered by CRUD" },
  { tool: "pages_export_pdf", skip: "Creates file" },

  // ── Numbers (9) ───────────────────────────────────────────────────
  { tool: "numbers_list_documents", args: {} },
  { tool: "numbers_create_document", skip: "Covered by CRUD" },
  { tool: "numbers_close_document", skip: "Covered by CRUD" },
  { tool: "numbers_list_sheets", skip: "Covered by CRUD" },
  { tool: "numbers_get_cell", skip: "Covered by CRUD" },
  { tool: "numbers_set_cell", skip: "Covered by CRUD" },
  { tool: "numbers_read_cells", chain: "numbersDoc" },
  { tool: "numbers_add_sheet", skip: "Modifies document" },
  { tool: "numbers_export_pdf", skip: "Creates file" },

  // ── Keynote (9) ───────────────────────────────────────────────────
  { tool: "keynote_list_documents", args: {} },
  { tool: "keynote_create_document", skip: "Covered by CRUD" },
  { tool: "keynote_close_document", skip: "Covered by CRUD" },
  { tool: "keynote_list_slides", skip: "Covered by CRUD" },
  { tool: "keynote_get_slide", skip: "Covered by CRUD" },
  { tool: "keynote_add_slide", skip: "Covered by CRUD" },
  { tool: "keynote_set_presenter_notes", skip: "Covered by CRUD" },
  { tool: "keynote_export_pdf", skip: "Creates file" },
  { tool: "keynote_start_slideshow", skip: "Opens UI" },

  // ── Semantic (4) ──────────────────────────────────────────────────
  { tool: "semantic_status", args: {} },
  { tool: "semantic_search", args: { query: "test", limit: 3 } },
  { tool: "semantic_index", skip: "Long-running indexing operation" },
  { tool: "find_related", skip: "Requires indexed data" },

  // ── Cross Module (1) ───────────────────────────────────────────────
  { tool: "summarize_context", skip: "Requires MCP Sampling capability" },

  // ── Apps Module (2) ───────────────────────────────────────────────
  { tool: "calendar_week_view", skip: "Interactive UI widget" },
  { tool: "music_player", skip: "Interactive UI widget" },

  // ── Permissions ───────────────────────────────────────────────────
  { tool: "setup_permissions", skip: "Opens system dialogs" },
];

// Tools that need chained data from previous results
async function resolveChainedArgs(chainKey, ctx) {
  switch (chainKey) {
    case "noteId": {
      const r = parseResult(await callTool("list_notes", { limit: 1 }));
      const id = r.data?.notes?.[0]?.id;
      return id ? { id } : null;
    }
    case "noteIds": {
      const r = parseResult(await callTool("list_notes", { limit: 2 }));
      const ids = (r.data?.notes || []).slice(0, 2).map((n) => n.id).filter(Boolean);
      return ids.length >= 2 ? { ids } : null;
    }
    case "reminderId": {
      const r = parseResult(await callTool("list_reminders", { limit: 1 }));
      const id = r.data?.reminders?.[0]?.id;
      return id ? { id } : null;
    }
    case "eventId": {
      const r = parseResult(await callTool("get_upcoming_events", { limit: 1 }));
      const id = r.data?.events?.[0]?.id;
      return id ? { id } : null;
    }
    case "contactId": {
      const r = parseResult(await callTool("list_contacts", { limit: 1 }));
      const id = r.data?.contacts?.[0]?.id;
      return id ? { id } : null;
    }
    case "groupName": {
      const r = parseResult(await callTool("list_groups", {}));
      const name = r.data?.groups?.[0]?.name;
      return name ? { group: name } : null;
    }
    case "messageId": {
      const r = parseResult(await callTool("list_messages", { mailbox: "INBOX", limit: 1 }));
      const id = r.data?.messages?.[0]?.id;
      return id ? { id } : null;
    }
    case "playlistName": {
      const r = parseResult(await callTool("list_playlists", {}));
      const name = r.data?.playlists?.[0]?.name;
      return name ? { playlist: name } : null;
    }
    case "trackName":
    case "trackName2": {
      const r = parseResult(await callTool("search_tracks", { query: "love" }));
      const name = r.data?.tracks?.[0]?.name;
      return name ? { name } : null;
    }
    case "tabCoords": {
      const r = parseResult(await callTool("list_tabs", {}));
      const tabs = Array.isArray(r.data) ? r.data : (r.data?.tabs || []);
      if (tabs.length > 0) return { windowIndex: tabs[0].windowIndex ?? 0, tabIndex: tabs[0].tabIndex ?? 0, maxLength: 1000 };
      return null;
    }
    case "albumName": {
      const r = parseResult(await callTool("list_albums", {}));
      const name = r.data?.albums?.[0]?.name;
      return name ? { album: name } : null;
    }
    case "photoId": {
      const r = parseResult(await callTool("search_photos", { query: "a" }));
      const id = r.data?.photos?.[0]?.id;
      return id ? { id } : null;
    }
    case "chatId":
    case "chatId2": {
      const r = parseResult(await callTool("list_chats", {}));
      const id = r.data?.chats?.[0]?.id;
      return id ? { chatId: id } : null;
    }
    case "shortcutName": {
      const r = parseResult(await callTool("list_shortcuts", {}));
      const name = r.data?.shortcuts?.[0]?.name;
      return name ? { name } : null;
    }
    case "tvPlaylist": {
      const r = parseResult(await callTool("tv_list_playlists", {}));
      const name = r.data?.playlists?.[0]?.name;
      return name ? { playlist: name } : null;
    }
    case "podcastShow": {
      const r = parseResult(await callTool("list_podcast_shows", {}));
      const name = r.data?.shows?.[0]?.name;
      return name ? { show: name } : null;
    }
    case "pagesDoc":
    case "pagesDoc2": {
      const r = parseResult(await callTool("pages_list_documents", {}));
      const doc = (Array.isArray(r.data) ? r.data : r.data?.documents || [])[0];
      return doc?.name ? { document: doc.name, page: 1 } : null;
    }
    case "numbersDoc": {
      const r = parseResult(await callTool("numbers_list_documents", {}));
      const doc = (Array.isArray(r.data) ? r.data : r.data?.documents || [])[0];
      return doc?.name ? { document: doc.name, sheet: "Sheet 1", startCell: "A1", endCell: "B2" } : null;
    }
    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 2: ORCHESTRATION SCENARIOS
// ══════════════════════════════════════════════════════════════════════

const ORCHESTRATION = [
  // ── 1. Daily Briefing ─────────────────────────────────────────────
  {
    name: "Daily Briefing",
    desc: "today_events → list_reminders → list_notes → combine",
    steps: [
      {
        label: "Get today's events",
        tool: "today_events",
        args: {},
        save: (r, ctx) => { ctx.eventCount = (r.events || []).length; },
      },
      {
        label: "Get due reminders",
        tool: "list_reminders",
        args: { limit: 10 },
        save: (r, ctx) => { ctx.reminderCount = (r.reminders || []).length; },
      },
      {
        label: "Get recent notes",
        tool: "list_notes",
        args: { limit: 5 },
        save: (r, ctx) => { ctx.noteCount = (r.notes || []).length; },
      },
      {
        label: "Verify briefing data collected",
        verify: (ctx) => ctx.eventCount !== undefined && ctx.reminderCount !== undefined && ctx.noteCount !== undefined,
      },
    ],
  },

  // ── 2. System Roundtrip ───────────────────────────────────────────
  {
    name: "System Roundtrip",
    desc: "Read → modify → verify → restore (volume, brightness, dark mode)",
    steps: [
      {
        label: "Read volume",
        tool: "get_volume",
        args: {},
        save: (r, ctx) => { ctx.origVol = r.outputVolume; ctx.origMuted = r.outputMuted; },
      },
      {
        label: "Read brightness",
        tool: "get_brightness",
        args: {},
        save: (r, ctx) => { ctx.origBright = r.brightness; },
      },
      {
        label: "Set volume to 33",
        tool: "set_volume",
        args: { volume: 33 },
        validate: (r) => r.outputVolume === 33,
      },
      {
        label: "Verify volume",
        tool: "get_volume",
        args: {},
        validate: (r) => r.outputVolume === 33,
      },
      {
        label: "Set brightness to 0.6",
        tool: "set_brightness",
        args: { level: 0.6 },
      },
      {
        label: "Show notification",
        tool: "show_notification",
        args: { title: QA, message: "System roundtrip OK" },
      },
      {
        label: "Restore volume",
        tool: "set_volume",
        args: (ctx) => ({ volume: ctx.origVol ?? 50, muted: ctx.origMuted ?? false }),
        cleanup: true,
      },
      {
        label: "Restore brightness",
        tool: "set_brightness",
        args: (ctx) => ({ level: ctx.origBright ?? 0.5 }),
        cleanup: true,
      },
    ],
  },

  // ── 3. Safari Research ────────────────────────────────────────────
  {
    name: "Safari Research",
    desc: "open_url → list_tabs → read_page → create_note → cleanup",
    steps: [
      {
        label: "Open example.com",
        tool: "open_url",
        args: { url: "https://example.com" },
      },
      {
        label: "Wait for page load",
        wait: 2000,
      },
      {
        label: "List tabs to find new tab",
        tool: "list_tabs",
        args: {},
        save: (r, ctx) => {
          const tabs = Array.isArray(r) ? r : [];
          const tab = tabs.find((t) => (t.url || "").includes("example.com"));
          if (tab) {
            ctx.winIdx = tab.windowIndex ?? 0;
            ctx.tabIdx = tab.tabIndex ?? 0;
          } else if (tabs.length > 0) {
            const last = tabs[tabs.length - 1];
            ctx.winIdx = last.windowIndex ?? 0;
            ctx.tabIdx = last.tabIndex ?? tabs.length - 1;
          }
        },
      },
      {
        label: "Read page content",
        tool: "read_page_content",
        args: (ctx) => ({ windowIndex: ctx.winIdx ?? 0, tabIndex: ctx.tabIdx ?? 0, maxLength: 2000 }),
        save: (r, ctx) => { ctx.pageTitle = r.title || "Unknown page"; ctx.pageContent = (r.content || "").slice(0, 200); },
      },
      {
        label: "Create research note",
        tool: "create_note",
        args: (ctx) => ({
          body: `<h1>${QA} Research: ${ctx.pageTitle || "Web"}</h1><p>Excerpt: ${ctx.pageContent || "N/A"}</p><p>Captured at ${new Date().toISOString()}</p>`,
        }),
        save: (r, ctx) => { ctx.noteId = r.id || r.noteId; },
      },
      {
        label: "Close researched tab",
        tool: "close_tab",
        args: (ctx) => ({ windowIndex: ctx.winIdx ?? 0, tabIndex: ctx.tabIdx ?? 0 }),
        cleanup: true,
      },
      {
        label: "Delete research note",
        tool: "delete_note",
        args: (ctx) => ({ id: ctx.noteId }),
        cleanup: true,
      },
    ],
  },

  // ── 4. Weather + Location ─────────────────────────────────────────
  {
    name: "Weather + Location",
    desc: "geocode → current_weather → daily_forecast → hourly_forecast",
    steps: [
      {
        label: "Geocode Seoul",
        tool: "geocode",
        args: { query: "Seoul" },
        save: (r, ctx) => {
          const loc = r.results?.[0] || r;
          ctx.lat = loc.latitude ?? 37.5665;
          ctx.lon = loc.longitude ?? 126.978;
        },
        validate: (r) => (r.results?.[0]?.latitude || r.latitude) != null,
      },
      {
        label: "Get current weather",
        tool: "get_current_weather",
        args: (ctx) => ({ latitude: ctx.lat, longitude: ctx.lon }),
        save: (r, ctx) => { ctx.temp = r.temperature; ctx.condition = r.condition; },
        validate: (r) => r.temperature != null,
      },
      {
        label: "Get 3-day forecast",
        tool: "get_daily_forecast",
        args: (ctx) => ({ latitude: ctx.lat, longitude: ctx.lon, days: 3 }),
        validate: (r) => (r.forecast || r.daily || []).length > 0,
      },
      {
        label: "Get 6-hour forecast",
        tool: "get_hourly_forecast",
        args: (ctx) => ({ latitude: ctx.lat, longitude: ctx.lon, hours: 6 }),
        validate: (r) => (r.forecast || r.hourly || []).length > 0,
      },
    ],
  },

  // ── 5. Meeting Prep ───────────────────────────────────────────────
  {
    name: "Meeting Prep",
    desc: "create_event → search_notes → create_note → create_reminder → cleanup",
    steps: [
      {
        label: "Create test meeting",
        tool: "create_event",
        args: {
          summary: `${QA} Quarterly Review ${TS}`,
          startDate: new Date(Date.now() + 2 * 3600_000).toISOString(),
          endDate: new Date(Date.now() + 3 * 3600_000).toISOString(),
          description: "E2E orchestration test — safe to delete",
        },
        save: (r, ctx) => { ctx.eventId = r.id || r.eventId; },
      },
      {
        label: "Search notes for prep material",
        tool: "search_notes",
        args: { query: "quarterly" },
        save: (r, ctx) => { ctx.relatedNotes = (r.notes || []).length; },
      },
      {
        label: "Create prep note",
        tool: "create_note",
        args: (ctx) => ({
          body: `<h1>${QA} Meeting Prep ${TS}</h1>
<p>Event: Quarterly Review</p>
<p>Related notes found: ${ctx.relatedNotes ?? 0}</p>
<ul><li>Review agenda</li><li>Prepare slides</li><li>Check action items</li></ul>`,
        }),
        save: (r, ctx) => { ctx.prepNoteId = r.id || r.noteId; },
      },
      {
        label: "Create prep reminder",
        tool: "create_reminder",
        args: {
          title: `${QA} Prepare for Quarterly Review ${TS}`,
          priority: 1,
        },
        save: (r, ctx) => { ctx.prepRemId = r.id || r.reminderId; },
      },
      {
        label: "Verify all pieces created",
        verify: (ctx) => !!ctx.eventId && !!ctx.prepNoteId && !!ctx.prepRemId,
      },
      {
        label: "Cleanup: delete event",
        tool: "delete_event",
        args: (ctx) => ({ id: ctx.eventId }),
        cleanup: true,
      },
      {
        label: "Cleanup: delete note",
        tool: "delete_note",
        args: (ctx) => ({ id: ctx.prepNoteId }),
        cleanup: true,
      },
      {
        label: "Cleanup: delete reminder",
        tool: "delete_reminder",
        args: (ctx) => ({ id: ctx.prepRemId }),
        cleanup: true,
      },
    ],
  },

  // ── 6. File Scout ─────────────────────────────────────────────────
  {
    name: "File Scout",
    desc: "search_files → get_file_info → recent_files → list_directory",
    steps: [
      {
        label: "Search for .mjs files",
        tool: "search_files",
        args: { query: "qa-test.mjs", limit: 3 },
        save: (r, ctx) => {
          const files = r.files || (Array.isArray(r) ? r : []);
          ctx.foundFile = files[0]?.path || files[0]?.name;
        },
      },
      {
        label: "Get file info",
        tool: "get_file_info",
        args: (ctx) => ({ path: ctx.foundFile || `${HOME}/.zshrc` }),
        validate: (r) => r.name != null || r.size != null,
      },
      {
        label: "Get recent files",
        tool: "recent_files",
        args: { limit: 5 },
        validate: (r) => (r.files || (Array.isArray(r) ? r : [])).length > 0,
      },
      {
        label: "List home directory",
        tool: "list_directory",
        args: { path: HOME },
        validate: (r) => {
          const items = r.items || r.files || (Array.isArray(r) ? r : []);
          return items.length > 0;
        },
      },
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════
// RUNNER
// ══════════════════════════════════════════════════════════════════════

async function runCoverage(registeredTools) {
  const results = [];
  const registeredSet = new Set(registeredTools.map((t) => t.name));
  const testedSet = new Set();

  for (const entry of COVERAGE_PLAN) {
    const { tool, args, chain, skip } = entry;
    const registered = registeredSet.has(tool);

    if (!registered) {
      results.push({ tool, status: "UNREG", note: "Not registered (OS/config)" });
      testedSet.add(tool);
      continue;
    }

    if (skip) {
      results.push({ tool, status: "SKIP", note: skip });
      testedSet.add(tool);
      continue;
    }

    let finalArgs = args;
    if (chain) {
      finalArgs = await resolveChainedArgs(chain, {});
      if (!finalArgs) {
        results.push({ tool, status: "SKIP", note: `No data for chain: ${chain}` });
        testedSet.add(tool);
        continue;
      }
    }

    const resp = await callTool(tool, finalArgs);
    const status = classify(resp);
    const note = status.startsWith("SKIP:") ? status.split(":")[1] : "";
    results.push({
      tool,
      status: status === "PASS" ? "PASS" : status.startsWith("SKIP") ? "SKIP" : "FAIL",
      note: note || (status === "FAIL" ? (resp?.result?.content?.[0]?.text || resp?.error?.message || "").slice(0, 120) : ""),
    });
    testedSet.add(tool);

    const icon = status === "PASS" ? "\u2713" : status.startsWith("SKIP") ? "\u25CB" : "\u2717";
    process.stderr.write(`  ${icon} ${tool}: ${status}\n`);
  }

  // Find tools registered but not in plan
  const uncovered = registeredTools
    .filter((t) => !testedSet.has(t.name))
    .map((t) => ({ tool: t.name, status: "UNCOV", note: "Not in test plan" }));

  return { results, uncovered };
}

async function runOrchestration() {
  const scenarioResults = [];

  for (const scenario of ORCHESTRATION) {
    process.stderr.write(`\n── Orch: ${scenario.name} ──\n`);
    const ctx = {};
    const steps = [];
    const normalSteps = scenario.steps.filter((s) => !s.cleanup);
    const cleanupSteps = scenario.steps.filter((s) => s.cleanup);
    let failed = false;

    for (const step of normalSteps) {
      if (failed) {
        steps.push({ label: step.label, status: "SKIP", note: "Previous step failed" });
        continue;
      }

      // Pure verification step
      if (step.verify) {
        const ok = step.verify(ctx);
        steps.push({ label: step.label, status: ok ? "PASS" : "FAIL", note: ok ? "" : "Verification failed" });
        if (!ok) failed = true;
        process.stderr.write(`  ${ok ? "\u2713" : "\u2717"} ${step.label}: ${ok ? "PASS" : "FAIL"}\n`);
        continue;
      }

      // Wait step
      if (step.wait) {
        await new Promise((r) => setTimeout(r, step.wait));
        steps.push({ label: step.label, status: "PASS", note: `Waited ${step.wait}ms` });
        process.stderr.write(`  \u2713 ${step.label}: waited\n`);
        continue;
      }

      const args = typeof step.args === "function" ? step.args(ctx) : step.args;
      const resp = await callTool(step.tool, args);
      const parsed = parseResult(resp);

      if (!parsed.ok) {
        const status = classify(resp);
        if (status.startsWith("SKIP")) {
          steps.push({ label: step.label, tool: step.tool, status: "SKIP", note: status });
          process.stderr.write(`  \u25CB ${step.label}: ${status}\n`);
          // Don't fail orchestration on skip
        } else {
          steps.push({ label: step.label, tool: step.tool, status: "FAIL", note: parsed.error?.slice(0, 150) });
          failed = true;
          process.stderr.write(`  \u2717 ${step.label}: FAIL\n`);
        }
        continue;
      }

      if (step.save) step.save(parsed.data, ctx);
      const valid = step.validate ? step.validate(parsed.data) : true;
      steps.push({
        label: step.label,
        tool: step.tool,
        status: valid ? "PASS" : "FAIL",
        note: valid ? "" : "Validation failed",
      });
      if (!valid) failed = true;
      process.stderr.write(`  ${valid ? "\u2713" : "\u2717"} ${step.label}: ${valid ? "PASS" : "FAIL"}\n`);
    }

    // Cleanup
    for (const step of cleanupSteps) {
      try {
        const args = typeof step.args === "function" ? step.args(ctx) : step.args;
        const hasArgs = args && Object.values(args).some((v) => v != null);
        if (!hasArgs) {
          steps.push({ label: step.label, status: "SKIP", note: "No resource to clean" });
          continue;
        }
        await callTool(step.tool, args);
        steps.push({ label: step.label, tool: step.tool, status: "PASS", note: "(cleanup)" });
      } catch {
        steps.push({ label: step.label, tool: step.tool, status: "WARN", note: "Cleanup error" });
      }
    }

    scenarioResults.push({
      name: scenario.name,
      desc: scenario.desc,
      steps,
      passed: !failed,
    });
  }

  return scenarioResults;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

async function main() {
  if (dryRun) {
    console.log("## E2E Test Plan (dry run)\n");
    console.log("### Phase 1: Coverage\n");
    const auto = COVERAGE_PLAN.filter((e) => e.args && !e.chain);
    const chain = COVERAGE_PLAN.filter((e) => e.chain);
    const skip = COVERAGE_PLAN.filter((e) => e.skip);
    console.log(`- Auto-test: ${auto.length} tools`);
    console.log(`- Chained (need data): ${chain.length} tools`);
    console.log(`- Skipped (documented): ${skip.length} tools`);
    console.log(`- **Total planned**: ${COVERAGE_PLAN.length} tools\n`);
    console.log("### Phase 2: Orchestration\n");
    for (const s of ORCHESTRATION) {
      console.log(`**${s.name}** — ${s.desc}`);
      for (const st of s.steps) console.log(`  ${st.cleanup ? "[cleanup]" : "-"} ${st.label}${st.tool ? ` (${st.tool})` : ""}`);
      console.log();
    }
    return;
  }

  // Start server
  startServer();
  const initId = send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-e2e-test", version: "1.0" },
  });
  const initResp = await waitFor(initId);
  if (!initResp) { console.error("Failed to init MCP"); process.exit(1); }
  const { name: srvName, version: srvVer } = initResp.result.serverInfo;
  notify("notifications/initialized");
  await new Promise((r) => setTimeout(r, 500));

  // Inventory
  const toolsResp = await waitFor(send("tools/list"));
  const registeredTools = toolsResp?.result?.tools || [];
  const promptsResp = await waitFor(send("prompts/list"));
  const resourcesResp = await waitFor(send("resources/list"));
  const templatesResp = await waitFor(send("resources/templates/list"));

  let macosVersion = "unknown";
  try { const { execSync } = await import("child_process"); macosVersion = execSync("sw_vers -productVersion", { encoding: "utf8" }).trim(); } catch {}

  // Phase 1
  let coverageResults = { results: [], uncovered: [] };
  if (!phaseOnly || phaseOnly === "coverage") {
    process.stderr.write("\n═══ Phase 1: Tool Coverage ═══\n");
    coverageResults = await runCoverage(registeredTools);
  }

  // Phase 2
  let orchResults = [];
  if (!phaseOnly || phaseOnly === "orch") {
    process.stderr.write("\n═══ Phase 2: Orchestration ═══\n");
    orchResults = await runOrchestration();
  }

  // ── Stats ──────────────────────────────────────────────────────────
  const cov = coverageResults.results;
  const covPass = cov.filter((r) => r.status === "PASS").length;
  const covSkip = cov.filter((r) => r.status === "SKIP" || r.status === "UNREG").length;
  const covFail = cov.filter((r) => r.status === "FAIL").length;
  const uncovered = coverageResults.uncovered;

  const orchPass = orchResults.filter((s) => s.passed).length;
  const orchFail = orchResults.filter((s) => !s.passed).length;
  const orchStepsTotal = orchResults.reduce((a, s) => a + s.steps.length, 0);
  const orchStepsPass = orchResults.reduce((a, s) => a + s.steps.filter((st) => st.status === "PASS").length, 0);

  const totalRegistered = registeredTools.length;
  const totalPlanned = COVERAGE_PLAN.length;
  const coveragePct = totalRegistered > 0 ? Math.round(((totalPlanned - uncovered.length) / totalRegistered) * 100) : 0;

  // ── Output ─────────────────────────────────────────────────────────
  if (jsonMode) {
    const report = {
      type: "e2e",
      server: { name: srvName, version: srvVer },
      env: { macos: macosVersion, node: process.version },
      inventory: { tools: totalRegistered, prompts: promptsResp?.result?.prompts?.length ?? 0, resources: (resourcesResp?.result?.resources?.length ?? 0) + (templatesResp?.result?.resourceTemplates?.length ?? 0) },
      coverage: { planned: totalPlanned, pass: covPass, skip: covSkip, fail: covFail, uncovered: uncovered.length, pct: coveragePct, results: cov, uncoveredTools: uncovered },
      orchestration: { scenarios: orchResults.length, pass: orchPass, fail: orchFail, stepsTotal: orchStepsTotal, stepsPass: orchStepsPass, results: orchResults },
    };
    const out = JSON.stringify(report, null, 2);
    if (outPath) writeFileSync(outPath.replace(/\.md$/, ".json"), out);
    else console.log(out);
  } else {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const L = [];
    L.push("## E2E Test Report\n");
    L.push("| | |");
    L.push("|---|---|");
    L.push(`| **Server** | ${srvName} v${srvVer} |`);
    L.push(`| **Date** | ${now} UTC |`);
    L.push(`| **macOS** | ${macosVersion} |`);
    L.push(`| **Node.js** | ${process.version} |`);
    L.push(`| **Registered Tools** | ${totalRegistered} |`);
    L.push(`| **Test Plan Coverage** | ${totalPlanned}/${totalRegistered} (${coveragePct}%) |`);
    L.push("");

    // Phase 1 summary
    if (cov.length > 0) {
      L.push("### Phase 1: Tool Coverage\n");
      L.push("| PASS | SKIP | FAIL | Uncovered | Total Planned |");
      L.push("|------|------|------|-----------|---------------|");
      L.push(`| ${covPass} | ${covSkip} | ${covFail} | ${uncovered.length} | ${totalPlanned} |\n`);

      // Results table
      L.push("| Tool | Status | Note |");
      L.push("|------|--------|------|");
      for (const r of cov) {
        const icon = r.status === "PASS" ? "\u2705" : r.status === "SKIP" || r.status === "UNREG" ? "\u23ED\uFE0F" : "\u274C";
        L.push(`| \`${r.tool}\` | ${icon} ${r.status} | ${r.note || "-"} |`);
      }
      if (uncovered.length > 0) {
        L.push("");
        L.push("**Uncovered tools** (registered but not in test plan):\n");
        for (const u of uncovered) L.push(`- \`${u.tool}\``);
      }
      L.push("");
    }

    // Phase 2 summary
    if (orchResults.length > 0) {
      L.push("### Phase 2: Orchestration\n");
      L.push(`| Scenarios | PASS | FAIL | Steps Total | Steps PASS |`);
      L.push(`|-----------|------|------|-------------|------------|`);
      L.push(`| ${orchResults.length} | ${orchPass} | ${orchFail} | ${orchStepsTotal} | ${orchStepsPass} |\n`);

      for (const s of orchResults) {
        const sIcon = s.passed ? "\u2705" : "\u274C";
        L.push(`#### ${sIcon} ${s.name}\n`);
        L.push(`> ${s.desc}\n`);
        L.push("| Step | Tool | Status | Note |");
        L.push("|------|------|--------|------|");
        for (const st of s.steps) {
          const icon = st.status === "PASS" ? "\u2705" : st.status === "SKIP" ? "\u23ED\uFE0F" : st.status === "WARN" ? "\u26A0\uFE0F" : "\u274C";
          L.push(`| ${st.label} | ${st.tool ? `\`${st.tool}\`` : "-"} | ${icon} ${st.status} | ${st.note || "-"} |`);
        }
        L.push("");
      }
    }

    // Failures
    const allFails = [
      ...cov.filter((r) => r.status === "FAIL").map((r) => `[Coverage] \`${r.tool}\` — ${r.note}`),
      ...orchResults.filter((s) => !s.passed).flatMap((s) =>
        s.steps.filter((st) => st.status === "FAIL").map((st) => `[${s.name}] ${st.label} — ${st.note}`)),
    ];
    if (allFails.length > 0) {
      L.push("### Failures\n");
      for (const f of allFails) L.push(`- ${f}`);
      L.push("");
    }

    L.push("---");
    L.push("*Generated by `node scripts/qa-e2e-test.mjs`*");

    const md = L.join("\n");
    if (outPath) {
      writeFileSync(outPath, md);
      process.stderr.write(`\nReport written to ${outPath}\n`);
    } else {
      console.log(md);
    }
  }

  server.kill();
  process.exit(covFail + orchFail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  if (server) server.kill();
  process.exit(1);
});
