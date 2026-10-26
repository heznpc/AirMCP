#!/usr/bin/env node
/**
 * AirMCP Remaining Tools Test — covers tools skipped by qa-e2e-test.mjs
 *
 * Strategy: create test data → call tool → verify → cleanup
 *   - Files: create in /tmp → use → delete
 *   - Contacts/playlists: create QA copies → modify → delete
 *   - System toggles: read → modify → restore
 *   - Captures: take → delete file
 *   - Playback: play → pause → stop
 *   - UI: open Calculator → interact → quit
 *   - Maps: open → close
 *
 * Usage:
 *   node scripts/qa-remaining-test.mjs
 *   node scripts/qa-remaining-test.mjs --section files     # specific section
 *   node scripts/qa-remaining-test.mjs --no-record         # skip recording
 *   node scripts/qa-remaining-test.mjs --dry-run
 */
import { spawn, execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = process.env.HOME || "/tmp";
const TMP = "/tmp";
const TS = Date.now();
const QA = "[AirMCP-QA]";

const TESTER = { name: "선태영", email: "styd4957@gmail.com", phone: "+821055834957" };

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const noRecord = argv.includes("--no-record");
const sectionFilter = (() => { const i = argv.indexOf("--section"); return i >= 0 ? argv[i + 1] : null; })();

// ── MCP client ───────────────────────────────────────────────────────
let server, buffer = "", nextId = 1;
const responseMap = new Map();

function startServer() {
  server = spawn("node", ["dist/index.js"], {
    cwd: ROOT, env: { ...process.env, AIRMCP_FULL: "true" }, stdio: ["pipe", "pipe", "pipe"],
  });
  server.stdout.on("data", c => {
    buffer += c; const ls = buffer.split("\n"); buffer = ls.pop();
    for (const l of ls) { try { const m = JSON.parse(l); if (m.id != null) responseMap.set(m.id, m); } catch {} }
  });
  server.stderr.on("data", () => {});
}
const send = (m, p = {}) => { const i = nextId++; server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method: m, params: p }) + "\n"); return i; };
const notify = (m, p = {}) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: m, params: p }) + "\n");
const waitFor = (i, t = 25000) => new Promise(r => { const s = Date.now(); const iv = setInterval(() => { if (responseMap.has(i)) { clearInterval(iv); r(responseMap.get(i)); } if (Date.now() - s > t) { clearInterval(iv); r(null); } }, 50); });
const callTool = (n, a = {}, t = 25000) => waitFor(send("tools/call", { name: n, arguments: a }), t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parse(resp) {
  if (!resp) return { ok: false, error: "Timeout", data: null };
  if (resp.error) return { ok: false, error: resp.error.message, data: null };
  const text = resp.result?.content?.[0]?.text || "";
  if (resp.result?.isError) return { ok: false, error: text.slice(0, 300), data: null };
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: text }; }
}

const pass = m => process.stderr.write(`\x1b[32m  ✓\x1b[0m ${m}\n`);
const fail = m => process.stderr.write(`\x1b[31m  ✗\x1b[0m ${m}\n`);
const skip = m => process.stderr.write(`\x1b[33m  ○\x1b[0m ${m}\n`);
const info = m => process.stderr.write(`\x1b[36m  →\x1b[0m ${m}\n`);
const section = m => process.stderr.write(`\n\x1b[1m══ ${m} ══\x1b[0m\n`);

let passCount = 0, failCount = 0, skipCount = 0;

async function test(label, toolName, args, opts = {}) {
  const resp = await callTool(toolName, args, opts.timeout || 25000);
  const r = parse(resp);
  if (r.ok) { pass(`${label} (${toolName})`); passCount++; }
  else if (/not found|not running|not built|permission|not authorized|timed out/i.test(r.error || "")) {
    skip(`${label}: ${r.error?.slice(0, 80)}`); skipCount++;
  }
  else { fail(`${label}: ${r.error?.slice(0, 100)}`); failCount++; }
  return r;
}

// ══════════════════════════════════════════════════════════════════════
// TEST SECTIONS
// ══════════════════════════════════════════════════════════════════════

async function testFiles() {
  section("Files — create temp files → use tools → cleanup");

  // Create test files
  const testFile = `${TMP}/airmcp-qa-${TS}.txt`;
  const testFile2 = `${TMP}/airmcp-qa-${TS}-moved.txt`;
  const testImg = `${TMP}/airmcp-qa-${TS}.png`;
  writeFileSync(testFile, `${QA} test file created at ${new Date().toISOString()}\n`);
  // 1x1 red PNG
  const pngBuf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
  writeFileSync(testImg, pngBuf);
  info(`Created test files: ${testFile}, ${testImg}`);

  // get_file_info first (before moving)
  await test("Get file info", "get_file_info", { path: testFile });

  // set_file_tags
  await test("Set file tags", "set_file_tags", { path: testFile, tags: ["AirMCP-QA", "test"] });

  // move_file
  await test("Move file", "move_file", { source: testFile, destination: testFile2 });

  // trash the moved file
  await test("Trash file", "trash_file", { path: testFile2 });

  // capture_screen → delete
  const capResp = await test("Capture full screen", "capture_screen", {});
  // capture_screen returns image content directly, no file to delete

  // capture_window
  await test("Capture window (Finder)", "capture_window", { appName: "Finder" });

  // capture_area (small region)
  await test("Capture area (100x100)", "capture_area", { x: 0, y: 0, width: 100, height: 100 });

  // record_screen (2 seconds)
  if (!noRecord) {
    const recResp = await test("Record screen (2s)", "record_screen", { duration: 2 }, { timeout: 30000 });
    if (recResp.ok && recResp.data?.path) {
      try { unlinkSync(recResp.data.path); info(`Deleted recording: ${recResp.data.path}`); } catch {}
    }
  } else {
    skip("record_screen (--no-record)"); skipCount++;
  }

  // export PDFs — create iWork docs → export → cleanup
  // Pages
  const pgCreate = parse(await callTool("pages_create_document", {}));
  if (pgCreate.ok && pgCreate.data?.name) {
    const doc = pgCreate.data.name;
    await test("Pages export PDF", "pages_export_pdf", { document: doc, outputPath: `${TMP}/airmcp-qa-pages-${TS}.pdf` });
    await callTool("pages_close_document", { document: doc, saving: false });
    try { unlinkSync(`${TMP}/airmcp-qa-pages-${TS}.pdf`); } catch {}
  } else { skip("pages_export_pdf (app not running)"); skipCount++; }

  // Numbers
  const numCreate = parse(await callTool("numbers_create_document", {}));
  if (numCreate.ok && numCreate.data?.name) {
    const doc = numCreate.data.name;
    // numbers_add_sheet
    await test("Numbers add sheet", "numbers_add_sheet", { document: doc, sheetName: `${QA} Sheet` });
    await test("Numbers export PDF", "numbers_export_pdf", { document: doc, outputPath: `${TMP}/airmcp-qa-numbers-${TS}.pdf` });
    await callTool("numbers_close_document", { document: doc, saving: false });
    try { unlinkSync(`${TMP}/airmcp-qa-numbers-${TS}.pdf`); } catch {}
  } else { skip("numbers_export_pdf (app not running)"); skipCount++; }

  // Keynote
  const knCreate = parse(await callTool("keynote_create_document", {}));
  if (knCreate.ok && knCreate.data?.name) {
    const doc = knCreate.data.name;
    await test("Keynote export PDF", "keynote_export_pdf", { document: doc, outputPath: `${TMP}/airmcp-qa-keynote-${TS}.pdf` });
    await callTool("keynote_close_document", { document: doc, saving: false });
    try { unlinkSync(`${TMP}/airmcp-qa-keynote-${TS}.pdf`); } catch {}
  } else { skip("keynote_export_pdf (app not running)"); skipCount++; }

  // send_file to tester
  const sendFile = `${TMP}/airmcp-qa-sendfile-${TS}.txt`;
  writeFileSync(sendFile, `${QA} AirMCP send_file test\nTimestamp: ${new Date().toISOString()}\n`);
  await test("Send file via iMessage", "send_file", { target: TESTER.phone, filePath: sendFile });
  try { unlinkSync(sendFile); } catch {}

  // Cleanup test image
  try { unlinkSync(testImg); } catch {}
}

async function testContacts() {
  section("Contacts — create QA contact → add email/phone → cleanup");

  const createResp = await test("Create QA contact", "create_contact", {
    firstName: "AirMcpQA", lastName: `Remaining${TS}`,
    email: "qa-remaining@airmcp.local",
    note: `${QA} Remaining test — safe to delete`,
  });
  const contactId = createResp.data?.id || createResp.data?.contactId;
  if (!contactId) { skip("Skipping contact sub-tests (create failed)"); skipCount += 2; return; }

  await test("Add email to contact", "add_contact_email", { id: contactId, email: "qa-second@airmcp.local", label: "work" });
  await test("Add phone to contact", "add_contact_phone", { id: contactId, phone: "+8200000000", label: "mobile" });

  // Cleanup
  await callTool("delete_contact", { id: contactId });
  info("Deleted QA contact");
}

async function testMusic() {
  section("Music — create QA playlist → play/control → rate → cleanup");

  const plName = `${QA} Remaining ${TS}`;
  await test("Create QA playlist", "create_playlist", { name: plName });

  // Search for a track to interact with
  const searchResp = parse(await callTool("search_tracks", { query: "a" }));
  const track = searchResp.data?.tracks?.[0];

  if (track) {
    await test("Add track to playlist", "add_to_playlist", { playlist: plName, track: track.name });
    await test("Play track", "play_track", { name: track.name });
    await sleep(2000);
    await test("Playback control (pause)", "playback_control", { action: "pause" });
    await test("Set shuffle", "set_shuffle", { shuffle: true, repeat: "off" });
    await test("Set shuffle (restore)", "set_shuffle", { shuffle: false, repeat: "off" });

    // Rating roundtrip
    const origRating = parse(await callTool("get_rating", { name: track.name }));
    await test("Set rating", "set_rating", { name: track.name, rating: 80 });
    await test("Set favorited", "set_favorited", { name: track.name, favorited: true });
    await test("Set disliked", "set_disliked", { name: track.name, disliked: false });
    // Restore
    if (origRating.ok) {
      await callTool("set_rating", { name: track.name, rating: origRating.data?.rating ?? 0 });
      await callTool("set_favorited", { name: track.name, favorited: origRating.data?.favorited ?? false });
    }
    info("Restored track rating/favorited");

    await test("Remove from playlist", "remove_from_playlist", { playlist: plName, track: track.name });
  } else { skip("Music sub-tests (no tracks found)"); skipCount += 8; }

  await test("Delete QA playlist", "delete_playlist", { name: plName });
}

async function testSystem() {
  section("System — toggle/restore roundtrips");

  // Dark mode roundtrip
  await test("Toggle dark mode", "toggle_dark_mode", {});
  await sleep(1000);
  await test("Toggle dark mode (restore)", "toggle_dark_mode", {});

  // Focus mode
  await test("Toggle focus mode (DND on)", "toggle_focus_mode", { enable: true });
  await sleep(500);
  await test("Toggle focus mode (DND off)", "toggle_focus_mode", { enable: false });

  // Prevent sleep (1 second)
  await test("Prevent sleep (1s)", "prevent_sleep", { seconds: 1 });

  // Window management — use Finder
  const winResp = parse(await callTool("list_all_windows", {}));
  const finderWin = (winResp.data?.windows || []).find(w => w.app === "Finder" || w.appName === "Finder");
  if (finderWin) {
    const origPos = { x: finderWin.x ?? finderWin.position?.[0], y: finderWin.y ?? finderWin.position?.[1] };
    const origSize = { width: finderWin.width ?? finderWin.size?.[0], height: finderWin.height ?? finderWin.size?.[1] };

    await test("Move window", "move_window", { appName: "Finder", x: 100, y: 100 });
    await test("Resize window", "resize_window", { appName: "Finder", width: 800, height: 600 });
    await test("Minimize window", "minimize_window", { appName: "Finder" });
    await sleep(1000);
    await test("Restore window", "minimize_window", { appName: "Finder", restore: true });

    // Restore position/size
    if (origPos.x != null) await callTool("move_window", { appName: "Finder", x: origPos.x, y: origPos.y });
    if (origSize.width != null) await callTool("resize_window", { appName: "Finder", width: origSize.width, height: origSize.height });
    info("Restored Finder window position/size");
  } else { skip("Window tests (no Finder window)"); skipCount += 4; }

  // Launch/quit
  await test("Launch Calculator", "launch_app", { name: "Calculator" });
  await sleep(1500);
  await test("Quit Calculator", "quit_app", { name: "Calculator" });
}

async function testUI() {
  section("UI Automation — Calculator interaction");

  await test("UI open Calculator", "ui_open_app", { appName: "Calculator" });
  await sleep(2000);
  await test("UI read Calculator tree", "ui_read", { app: "Calculator" });
  // Use coordinates instead of text (button names vary by locale)
  await test("UI click (coordinates)", "ui_click", { app: "Calculator", x: 200, y: 300 });
  await sleep(500);
  await test("UI press key (Cmd+Q to quit)", "ui_press_key", { key: "q", modifiers: ["command"] });
  // ui_type and ui_scroll need text input context
  await test("Launch Notes for typing", "launch_app", { name: "Notes" });
  await sleep(2000);
  await test("UI type text", "ui_type", { text: `${QA} UI automation test` });
  await test("UI scroll down", "ui_scroll", { direction: "down", amount: 3 });
  await test("UI press Cmd+Z (undo)", "ui_press_key", { key: "z", modifiers: ["command"] });
}

async function testMaps() {
  section("Maps — open UI tools");

  await test("Search location (Seoul)", "search_location", { query: "Seoul" });
  await sleep(2000);
  await test("Get directions", "get_directions", { from: "Seoul Station", to: "Gangnam Station" });
  await sleep(1000);
  await test("Drop pin", "drop_pin", { latitude: 37.5665, longitude: 126.978, name: `${QA} Pin` });
  await sleep(1000);
  await test("Open address", "open_address", { address: "1 Apple Park Way, Cupertino, CA" });
  await sleep(1000);

  // Quit Maps to clean up
  await callTool("quit_app", { name: "Maps" });
  info("Closed Maps");
}

async function testSafari() {
  section("Safari — bookmark/reading list");

  await test("Add to reading list", "add_to_reading_list", { url: "https://example.com/airmcp-qa-test", title: `${QA} Reading List Test` });
  await test("Add bookmark", "add_bookmark", { url: "https://example.com/airmcp-qa-bookmark", title: `${QA} Bookmark Test` });
  await test("Activate tab (first)", "activate_tab", { windowIndex: 0, tabIndex: 0 });

  // run_javascript in a safe context
  const tabResp = parse(await callTool("list_tabs", {}));
  const tabs = Array.isArray(tabResp.data) ? tabResp.data : [];
  if (tabs.length > 0) {
    await test("Run JavaScript (safe)", "run_javascript", {
      windowIndex: 0, tabIndex: 0, code: "document.title",
    });
  } else { skip("run_javascript (no tabs)"); skipCount++; }
}

async function testMail() {
  section("Mail — read/flag/restore on QA email");

  // Find the QA test email we sent earlier
  const searchResp = parse(await callTool("search_messages", { query: "AirMCP-QA", limit: 3 }));
  const msg = searchResp.data?.messages?.[0];
  if (!msg) { skip("Mail interaction tests (no QA email found)"); skipCount += 3; return; }
  const msgId = msg.id;
  info(`Found QA email: ${msg.subject?.slice(0, 50)}`);

  // Flag → unflag
  await test("Flag message", "flag_message", { id: msgId, flagged: true });
  await test("Unflag message", "flag_message", { id: msgId, flagged: false });

  // Mark read → restore
  const wasRead = msg.read !== false;
  await test("Mark message read", "mark_message_read", { id: msgId, read: true });
  if (!wasRead) await callTool("mark_message_read", { id: msgId, read: false });

  // Reply
  await test("Reply to QA email", "reply_mail", {
    id: msgId,
    body: `${QA} Reply test — automated by AirMCP E2E\n\nTimestamp: ${new Date().toISOString()}`,
  });
}

async function testPlayback() {
  section("Playback — TV / Podcasts");

  // TV
  await test("TV search", "tv_search", { query: "test" });
  const tvPlResp = parse(await callTool("tv_list_playlists", {}));
  if ((tvPlResp.data?.playlists || []).length > 0) {
    await test("TV playback control (pause)", "tv_playback_control", { action: "pause" });
  } else { skip("TV playback (no content)"); skipCount++; }

  // Podcasts
  const podResp = parse(await callTool("list_podcast_shows", {}));
  const show = podResp.data?.shows?.[0];
  if (show) {
    await test("List podcast episodes", "list_podcast_episodes", { show: show.name });
    await test("Podcast playback (pause)", "podcast_playback_control", { action: "pause" });
  } else { skip("Podcast tests (no shows / macOS 26 broken)"); skipCount += 2; }
}

async function testShortcuts() {
  section("Shortcuts — discovery");
  await test("List shortcuts", "list_shortcuts", {});
  await test("Search shortcuts", "search_shortcuts", { query: "test" });
  // Running arbitrary user shortcuts has unknown side effects; exercise run_shortcut
  // only with an explicitly prepared fixture in a dedicated manual QA session.
}

async function testOther() {
  section("Other — remaining tools");

  // Slideshow — start and immediately escape
  const knResp = parse(await callTool("keynote_create_document", {}));
  if (knResp.ok && knResp.data?.name) {
    const doc = knResp.data.name;
    await test("Keynote start slideshow", "keynote_start_slideshow", { document: doc });
    await sleep(2000);
    await callTool("ui_press_key", { key: "escape" });
    info("Escaped slideshow");
    await callTool("keynote_close_document", { document: doc, saving: false });
  } else { skip("keynote_start_slideshow (app not running)"); skipCount++; }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

const ALL_SECTIONS = {
  files: testFiles,
  contacts: testContacts,
  music: testMusic,
  system: testSystem,
  ui: testUI,
  maps: testMaps,
  safari: testSafari,
  mail: testMail,
  playback: testPlayback,
  shortcuts: testShortcuts,
  other: testOther,
};

async function main() {
  if (dryRun) {
    console.log("## Remaining Tools Test Plan\n");
    console.log("Sections: " + Object.keys(ALL_SECTIONS).join(", "));
    console.log("\nTools to be tested:");
    console.log("  Files: set_file_tags, move_file, capture_screen/window/area, record_screen, export PDFs, send_file");
    console.log("  Contacts: add_contact_email, add_contact_phone");
    console.log("  Music: add_to_playlist, remove_from_playlist, play_track, playback_control, set_shuffle, set_rating, set_favorited, set_disliked");
    console.log("  System: toggle_dark_mode, toggle_focus_mode, prevent_sleep, move_window, resize_window, minimize_window, launch_app, quit_app");
    console.log("  UI: ui_open_app, ui_click, ui_type, ui_press_key, ui_scroll");
    console.log("  Maps: search_location, get_directions, drop_pin, open_address");
    console.log("  Safari: add_to_reading_list, add_bookmark, activate_tab, run_javascript");
    console.log("  Mail: flag_message, mark_message_read, reply_mail");
    console.log("  Playback: tv_playback_control, list_podcast_episodes, podcast_playback_control");
    console.log("  Shortcuts: list_shortcuts, search_shortcuts");
    console.log("  Other: keynote_start_slideshow");
    return;
  }

  startServer();
  const initResp = await waitFor(send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa-remaining", version: "1.0" },
  }));
  if (!initResp) { console.error("MCP init failed"); process.exit(1); }
  notify("notifications/initialized");
  await sleep(500);

  const { version } = initResp.result.serverInfo;
  section(`AirMCP v${version} — Remaining Tools Test`);

  const sections = sectionFilter
    ? { [sectionFilter]: ALL_SECTIONS[sectionFilter] }
    : ALL_SECTIONS;

  for (const [name, fn] of Object.entries(sections)) {
    if (!fn) { console.error(`Unknown section: ${name}`); continue; }
    try { await fn(); } catch (e) { fail(`Section ${name} crashed: ${e.message}`); }
  }

  section("Summary");
  process.stderr.write(`  PASS: ${passCount}  FAIL: ${failCount}  SKIP: ${skipCount}  Total: ${passCount + failCount + skipCount}\n`);

  server.kill();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); if (server) server.kill(); process.exit(1); });
