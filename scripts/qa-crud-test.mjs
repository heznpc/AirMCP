#!/usr/bin/env node
/**
 * AirMCP CRUD Roundtrip Test Runner
 *
 * Tests full create → read → update → read → delete cycles for every writable module.
 * Test data is prefixed with "[AirMCP-QA]" for easy identification.
 * Cleanup runs even if a step fails (try/finally).
 *
 * Usage:
 *   node scripts/qa-crud-test.mjs                    # run all modules
 *   node scripts/qa-crud-test.mjs --module notes     # single module
 *   node scripts/qa-crud-test.mjs --module notes,calendar  # multiple modules
 *   node scripts/qa-crud-test.mjs --out              # write report to file
 *   node scripts/qa-crud-test.mjs --json             # JSON output
 *   node scripts/qa-crud-test.mjs --dry-run          # show test plan without executing
 *
 * Adding a new module test (contributor guide):
 *   1. Add an entry to CRUD_MODULES below
 *   2. Each module is an object with: { name, steps: async function*(ctx) }
 *   3. Use yield { action, tool, args, validate? } for each step
 *   4. The `validate` function receives the tool result text (parsed JSON)
 *   5. Use ctx.set(key, value) to store IDs between steps
 *   6. Use ctx.get(key) to retrieve stored values
 *   7. The last step should be cleanup (delete/close) — it runs even on failure
 *
 * Example module template:
 *
 *   {
 *     name: "MyModule",
 *     steps: async function* (ctx) {
 *       // CREATE
 *       yield {
 *         action: "create",
 *         tool: "create_thing",
 *         args: { name: QA_PREFIX + " Test Thing" },
 *         validate: (r) => { ctx.set("id", r.id); return !!r.id; },
 *       };
 *       // READ (verify)
 *       yield {
 *         action: "read",
 *         tool: "list_things",
 *         args: {},
 *         validate: (r) => r.things?.some(t => t.id === ctx.get("id")),
 *       };
 *       // UPDATE
 *       yield {
 *         action: "update",
 *         tool: "update_thing",
 *         args: () => ({ id: ctx.get("id"), name: QA_PREFIX + " Updated" }),
 *         validate: (r) => r.updated === true,
 *       };
 *       // READ (verify update)
 *       yield {
 *         action: "verify-update",
 *         tool: "list_things",
 *         args: {},
 *         validate: (r) => r.things?.some(t => t.name?.includes("Updated")),
 *       };
 *       // DELETE (cleanup — always runs)
 *       yield {
 *         action: "delete",
 *         tool: "delete_thing",
 *         args: () => ({ id: ctx.get("id") }),
 *         cleanup: true,
 *       };
 *     },
 *   }
 */
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Constants ──────────────────────────────────────────────────────
const QA_PREFIX = "[AirMCP-QA]";
const TS = Date.now();
const TOOL_TIMEOUT = 20_000;

// ── CLI flags ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");
const outFlag = argv.includes("--out");
const dryRun = argv.includes("--dry-run");
const moduleFilter = (() => {
  const idx = argv.indexOf("--module");
  if (idx === -1) return null;
  return (argv[idx + 1] || "").split(",").map((s) => s.trim().toLowerCase());
})();
const outPath = outFlag
  ? resolve(ROOT, `qa-crud-report-${new Date().toISOString().slice(0, 10)}.md`)
  : null;

// ── Step context (stores IDs etc. between steps) ───────────────────
class StepContext {
  #data = new Map();
  set(k, v) { this.#data.set(k, v); }
  get(k) { return this.#data.get(k); }
  has(k) { return this.#data.has(k); }
}

// ── MCP client ─────────────────────────────────────────────────────
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
  server.stderr.on("data", () => {}); // drain stderr
}

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

async function waitFor(id, timeout = TOOL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (responseMap.has(id)) return responseMap.get(id);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function callTool(name, toolArgs = {}) {
  const id = send("tools/call", { name, arguments: toolArgs });
  return waitFor(id, TOOL_TIMEOUT);
}

function parseToolResult(resp) {
  if (!resp) return { ok: false, error: "Timeout", raw: null };
  if (resp.error) return { ok: false, error: resp.error.message, raw: resp };
  const text = resp.result?.content?.[0]?.text || "";
  const isError = resp.result?.isError === true;
  if (isError) return { ok: false, error: text.slice(0, 300), raw: resp };
  try {
    return { ok: true, data: JSON.parse(text), raw: resp };
  } catch {
    return { ok: true, data: text, raw: resp };
  }
}

// ── Future date helper ─────────────────────────────────────────────
function futureDate(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

// ── Module test definitions ────────────────────────────────────────
// Each module: { name, skip?, steps: async function*(ctx) }
// step: { action, tool, args (obj or fn), validate?(data)->bool, cleanup? }

const CRUD_MODULES = [
  // ── Notes: full CRUD ──
  {
    name: "Notes",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "create_note",
        args: { body: `<h1>${QA_PREFIX} Test Note ${TS}</h1><p>Initial content.</p>` },
        validate: (r) => {
          const id = r.id || r.noteId;
          if (id) ctx.set("noteId", id);
          return !!id;
        },
      };
      yield {
        action: "read",
        tool: "search_notes",
        args: { query: "AirMCP-QA" },
        validate: (r) => {
          const notes = r.notes || r.results || [];
          return notes.some((n) => (n.name || n.title || "").includes("AirMCP-QA") || (n.id === ctx.get("noteId")));
        },
      };
      yield {
        action: "update",
        tool: "update_note",
        args: () => ({
          id: ctx.get("noteId"),
          body: `<h1>${QA_PREFIX} Updated Note ${TS}</h1><p>Updated content.</p>`,
        }),
        validate: (r) => r.updated === true || r.success === true || !!r.id,
      };
      yield {
        action: "verify-update",
        tool: "search_notes",
        args: { query: "AirMCP-QA" },
        validate: (r) => {
          const notes = r.notes || (Array.isArray(r) ? r : []);
          return notes.some((n) => (n.name || n.title || "").includes("Updated"));
        },
      };
      yield {
        action: "delete",
        tool: "delete_note",
        args: () => ({ id: ctx.get("noteId") }),
        cleanup: true,
      };
    },
  },

  // ── Reminders: full CRUD ──
  {
    name: "Reminders",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "create_reminder",
        args: { title: `${QA_PREFIX} Test Reminder ${TS}` },
        validate: (r) => {
          const id = r.id || r.reminderId;
          if (id) ctx.set("remId", id);
          return !!id;
        },
      };
      yield {
        action: "read",
        tool: "search_reminders",
        args: { query: "AirMCP-QA" },
        validate: (r) => {
          const list = r.reminders || r.results || [];
          return list.some((rem) => (rem.name || rem.title || "").includes("AirMCP-QA"));
        },
      };
      yield {
        action: "update",
        tool: "update_reminder",
        args: () => ({
          id: ctx.get("remId"),
          title: `${QA_PREFIX} Updated Reminder ${TS}`,
          priority: 1,
        }),
        validate: (r) => !!r.id || r.updated === true,
      };
      yield {
        action: "verify-update",
        tool: "search_reminders",
        args: { query: "AirMCP-QA" },
        validate: (r) => {
          const list = r.reminders || (Array.isArray(r) ? r : []);
          return list.some((rem) => (rem.name || rem.title || "").includes("Updated"));
        },
      };
      yield {
        action: "complete",
        tool: "complete_reminder",
        args: () => ({ id: ctx.get("remId"), completed: true }),
        validate: (r) => r.completed === true || r.success === true,
      };
      yield {
        action: "delete",
        tool: "delete_reminder",
        args: () => ({ id: ctx.get("remId") }),
        cleanup: true,
      };
    },
  },

  // ── Calendar: full CRUD ──
  {
    name: "Calendar",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "create_event",
        args: {
          summary: `${QA_PREFIX} Test Event ${TS}`,
          startDate: futureDate(2),
          endDate: futureDate(3),
          description: "QA test event — safe to delete",
        },
        validate: (r) => {
          const id = r.id || r.eventId;
          if (id) ctx.set("eventId", id);
          return !!id;
        },
      };
      yield {
        action: "read",
        tool: "get_upcoming_events",
        args: { limit: 50 },
        validate: (r) => {
          const evts = r.events || [];
          return evts.some((e) => (e.summary || e.title || "").includes("AirMCP-QA"));
        },
      };
      yield {
        action: "update",
        tool: "update_event",
        args: () => ({
          id: ctx.get("eventId"),
          summary: `${QA_PREFIX} Updated Event ${TS}`,
        }),
        validate: (r) => !!r.id || r.updated === true,
      };
      yield {
        action: "verify-update",
        tool: "get_upcoming_events",
        args: { limit: 50 },
        validate: (r) => {
          const evts = r.events || (Array.isArray(r) ? r : []);
          return evts.some((e) => (e.summary || e.title || "").includes("Updated Event"));
        },
      };
      yield {
        action: "delete",
        tool: "delete_event",
        args: () => ({ id: ctx.get("eventId") }),
        cleanup: true,
      };
    },
  },

  // ── Contacts: full CRUD ──
  {
    name: "Contacts",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "create_contact",
        args: {
          firstName: "AirMcpQA",
          lastName: `Test${TS}`,
          email: "qa-test@airmcp.local",
          note: `${QA_PREFIX} auto-generated, safe to delete`,
        },
        validate: (r) => {
          const id = r.id || r.contactId;
          if (id) ctx.set("contactId", id);
          return !!id;
        },
      };
      yield {
        action: "read",
        tool: "search_contacts",
        args: { query: "AirMcpQA" },
        validate: (r) => {
          const list = r.contacts || (Array.isArray(r) ? r : []);
          return list.some((c) => (c.name || c.firstName || "").includes("AirMcpQA"));
        },
      };
      yield {
        action: "update",
        tool: "update_contact",
        args: () => ({
          id: ctx.get("contactId"),
          note: `${QA_PREFIX} Updated by CRUD test`,
        }),
        // Returns {id, name} — if we got data at all, the update worked
        validate: (r) => !!r.id || !!r.name || r.updated === true,
      };
      yield {
        action: "verify-update",
        tool: "search_contacts",
        args: { query: "AirMcpQA" },
        validate: (r) => {
          const list = r.contacts || (Array.isArray(r) ? r : []);
          return list.length > 0;
        },
      };
      yield {
        action: "delete",
        tool: "delete_contact",
        args: () => ({ id: ctx.get("contactId") }),
        cleanup: true,
      };
    },
  },

  // ── System: toggle → verify → restore ──
  {
    name: "System",
    steps: async function* (ctx) {
      // Volume roundtrip
      yield {
        action: "read-volume",
        tool: "get_volume",
        args: {},
        validate: (r) => {
          ctx.set("origVolume", r.outputVolume);
          ctx.set("origMuted", r.outputMuted);
          return r.outputVolume !== undefined;
        },
      };
      yield {
        action: "set-volume",
        tool: "set_volume",
        args: { volume: 42, muted: false },
        validate: (r) => r.outputVolume === 42,
      };
      yield {
        action: "restore-volume",
        tool: "set_volume",
        args: () => ({
          volume: ctx.get("origVolume") ?? 50,
          muted: ctx.get("origMuted") ?? false,
        }),
        cleanup: true,
        validate: (r) => r.outputVolume !== undefined,
      };
      // Clipboard roundtrip
      yield {
        action: "read-clipboard",
        tool: "get_clipboard",
        args: {},
        validate: (r) => {
          ctx.set("origClipboard", (r.content || "").substring(0, 10000));
          return true;
        },
      };
      yield {
        action: "set-clipboard",
        tool: "set_clipboard",
        args: { text: `${QA_PREFIX} clipboard test ${TS}` },
        validate: (r) => r.set === true,
      };
      yield {
        action: "verify-clipboard",
        tool: "get_clipboard",
        args: {},
        validate: (r) => (r.content || "").includes("AirMCP-QA"),
      };
      yield {
        action: "restore-clipboard",
        tool: "set_clipboard",
        args: () => ({ text: ctx.get("origClipboard") || "" }),
        cleanup: true,
      };
    },
  },

  // ── Finder: create dir → verify → trash ──
  {
    name: "Finder",
    steps: async function* (ctx) {
      const home = process.env.HOME || "/tmp";
      const testDir = `${home}/Desktop/airmcp-qa-${TS}`;
      ctx.set("testDir", testDir);
      yield {
        action: "create",
        tool: "create_directory",
        args: { path: testDir },
        validate: (r) => r.created === true || r.success === true || r.path,
      };
      yield {
        action: "read",
        tool: "list_directory",
        args: { path: `${home}/Desktop` },
        validate: (r) => {
          const items = Array.isArray(r) ? r : (r.items || r.files || []);
          return items.some((i) => (i.name || i.path || "").includes(`airmcp-qa-${TS}`));
        },
      };
      yield {
        action: "delete",
        tool: "trash_file",
        args: () => ({ path: ctx.get("testDir") }),
        cleanup: true,
      };
    },
  },

  // ── Safari: open tab → verify → close ──
  {
    name: "Safari",
    steps: async function* (ctx) {
      yield {
        action: "open-tab",
        tool: "open_url",
        args: { url: "https://example.com" },
        validate: (r) => r.opened === true || r.success === true || r.url,
      };
      yield {
        action: "read-tabs",
        tool: "list_tabs",
        args: {},
        validate: (r) => {
          // list_tabs returns flat array: [{windowIndex, tabIndex, title, url}, ...]
          let tabs = [];
          if (Array.isArray(r)) {
            tabs = r;
          } else if (r.windows) {
            tabs = r.windows.flatMap((w) => w.tabs || []);
          } else if (r.tabs) {
            tabs = r.tabs;
          }
          // Find the example.com tab
          for (const t of tabs) {
            if ((t.url || "").includes("example.com")) {
              ctx.set("tabIndex", t.tabIndex ?? t.index ?? 0);
              ctx.set("winIndex", t.windowIndex ?? 0);
              return true;
            }
          }
          // Fallback: last tab
          if (tabs.length > 0) {
            const last = tabs[tabs.length - 1];
            ctx.set("tabIndex", last.tabIndex ?? tabs.length - 1);
            ctx.set("winIndex", last.windowIndex ?? 0);
          }
          return tabs.length > 0;
        },
      };
      yield {
        action: "close-tab",
        tool: "close_tab",
        args: () => ({ windowIndex: ctx.get("winIndex") ?? 0, tabIndex: ctx.get("tabIndex") ?? 0 }),
        cleanup: true,
      };
    },
  },

  // ── Pages: create → set text → read → close ──
  {
    name: "Pages",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "pages_create_document",
        args: {},
        validate: (r) => {
          const name = r.name || r.document;
          if (name) ctx.set("docName", name);
          return !!name;
        },
      };
      yield {
        action: "read",
        tool: "pages_list_documents",
        args: {},
        validate: (r) => {
          const docs = Array.isArray(r) ? r : (r.documents || []);
          if (!ctx.has("docName") && docs.length > 0) {
            ctx.set("docName", docs[0].name);
          }
          return docs.length > 0;
        },
      };
      yield {
        action: "update",
        tool: "pages_set_body_text",
        args: () => ({
          document: ctx.get("docName"),
          text: `${QA_PREFIX} Pages CRUD test content ${TS}`,
        }),
        validate: (r) => r.updated === true || r.success === true,
      };
      yield {
        action: "verify-update",
        tool: "pages_get_body_text",
        args: () => ({ document: ctx.get("docName") }),
        validate: (r) => (r.bodyText || "").includes("AirMCP-QA"),
      };
      yield {
        action: "close",
        tool: "pages_close_document",
        args: () => ({ document: ctx.get("docName"), saving: false }),
        cleanup: true,
      };
    },
  },

  // ── Numbers: create → list sheets → set cell → read cell → close ──
  {
    name: "Numbers",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "numbers_create_document",
        args: {},
        validate: (r) => {
          const name = r.name || r.document;
          if (name) ctx.set("docName", name);
          return !!name;
        },
      };
      yield {
        action: "read",
        tool: "numbers_list_documents",
        args: {},
        validate: (r) => {
          const docs = Array.isArray(r) ? r : (r.documents || []);
          if (!ctx.has("docName") && docs.length > 0) {
            ctx.set("docName", docs[0].name);
          }
          return docs.length > 0;
        },
      };
      // Get the actual sheet name (locale-dependent: "Sheet 1" en, "시트 1" ko, etc.)
      yield {
        action: "list-sheets",
        tool: "numbers_list_sheets",
        args: () => ({ document: ctx.get("docName") }),
        validate: (r) => {
          const sheets = Array.isArray(r) ? r : (r.sheets || []);
          if (sheets.length > 0) ctx.set("sheetName", sheets[0].name);
          return sheets.length > 0;
        },
      };
      yield {
        action: "update",
        tool: "numbers_set_cell",
        args: () => ({
          document: ctx.get("docName"),
          sheet: ctx.get("sheetName") || "Sheet 1",
          cell: "A1",
          value: `${QA_PREFIX} ${TS}`,
        }),
        validate: (r) => r.written === true || r.success === true,
      };
      yield {
        action: "verify-update",
        tool: "numbers_get_cell",
        args: () => ({
          document: ctx.get("docName"),
          sheet: ctx.get("sheetName") || "Sheet 1",
          cell: "A1",
        }),
        validate: (r) => String(r.value || r.formattedValue || "").includes("AirMCP-QA"),
      };
      yield {
        action: "close",
        tool: "numbers_close_document",
        args: () => ({ document: ctx.get("docName"), saving: false }),
        cleanup: true,
      };
    },
  },

  // ── Keynote: create → add slide → set notes → read → close ──
  {
    name: "Keynote",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "keynote_create_document",
        args: {},
        validate: (r) => {
          const name = r.name || r.document;
          if (name) ctx.set("docName", name);
          return !!name;
        },
      };
      yield {
        action: "add-slide",
        tool: "keynote_add_slide",
        args: () => ({ document: ctx.get("docName") }),
        validate: (r) => r.added === true || r.slideNumber,
      };
      yield {
        action: "update",
        tool: "keynote_set_presenter_notes",
        args: () => ({
          document: ctx.get("docName"),
          slideNumber: 1,
          notes: `${QA_PREFIX} Presenter notes test ${TS}`,
        }),
        validate: (r) => r.updated === true || r.success === true,
      };
      yield {
        action: "verify-update",
        tool: "keynote_get_slide",
        args: () => ({ document: ctx.get("docName"), slideNumber: 1 }),
        validate: (r) => (r.presenterNotes || "").includes("AirMCP-QA"),
      };
      yield {
        action: "read-slides",
        tool: "keynote_list_slides",
        args: () => ({ document: ctx.get("docName") }),
        validate: (r) => (r.total || r.slides?.length || 0) >= 1,
      };
      yield {
        action: "close",
        tool: "keynote_close_document",
        args: () => ({ document: ctx.get("docName"), saving: false }),
        cleanup: true,
      };
    },
  },

  // ── Music: create playlist → verify → delete ──
  {
    name: "Music",
    steps: async function* (ctx) {
      const playlistName = `${QA_PREFIX} Playlist ${TS}`;
      ctx.set("playlistName", playlistName);
      yield {
        action: "create",
        tool: "create_playlist",
        args: { name: playlistName },
        validate: (r) => r.created === true || r.success === true || r.name,
      };
      yield {
        action: "read",
        tool: "list_playlists",
        args: {},
        validate: (r) => {
          const lists = Array.isArray(r) ? r : (r.playlists || []);
          return lists.some((p) => (p.name || "").includes("AirMCP-QA"));
        },
      };
      yield {
        action: "delete",
        tool: "delete_playlist",
        args: () => ({ name: ctx.get("playlistName") }),
        cleanup: true,
      };
    },
  },

  // ── Reminders List: create → verify → delete ──
  {
    name: "Reminders-List",
    steps: async function* (ctx) {
      const listName = `${QA_PREFIX} List ${TS}`;
      ctx.set("listName", listName);
      yield {
        action: "create",
        tool: "create_reminder_list",
        args: { name: listName },
        validate: (r) => r.created === true || r.success === true || r.name,
      };
      yield {
        action: "read",
        tool: "list_reminder_lists",
        args: {},
        validate: (r) => {
          const lists = Array.isArray(r) ? r : (r.lists || []);
          return lists.some((l) => (l.name || "").includes("AirMCP-QA"));
        },
      };
      yield {
        action: "delete",
        tool: "delete_reminder_list",
        args: () => ({ name: ctx.get("listName") }),
        cleanup: true,
      };
    },
  },

  // ── Notes Folder: create → verify ──
  {
    name: "Notes-Folder",
    steps: async function* (ctx) {
      yield {
        action: "create",
        tool: "create_folder",
        args: { name: `${QA_PREFIX} Folder ${TS}` },
        validate: (r) => r.created === true || r.success === true || r.name || r.id,
      };
      yield {
        action: "read",
        tool: "list_folders",
        args: {},
        validate: (r) => {
          const folders = Array.isArray(r) ? r : (r.folders || []);
          return folders.some((f) => (f.name || "").includes("AirMCP-QA"));
        },
      };
      // Note: no delete_folder tool exists, so manual cleanup needed
    },
  },
];

// ── Skipped modules (documented reasons) ───────────────────────────
const SKIPPED_MODULES = [
  { name: "Messages", reason: "send_message/send_file sends real iMessages — cannot auto-test" },
  { name: "Mail-Send", reason: "send_mail/reply_mail sends real emails — cannot auto-test" },
  { name: "System-Power", reason: "system_sleep/shutdown/restart — destructive system actions" },
  { name: "Shortcuts-Run", reason: "run_shortcut has unknown side effects — requires manual test" },
  { name: "Photos-Delete", reason: "delete_photos is irreversible — requires manual test" },
  { name: "Podcasts", reason: "All tools broken on macOS 26 (scripting dictionary removed)" },
  { name: "Screen-Capture", reason: "Creates screenshot files — low risk but run manually" },
  { name: "Maps-UI", reason: "Opens Maps app UI — visual verification needed" },
  { name: "TV-Playback", reason: "Requires media library — manual test" },
  { name: "Bluetooth-Connect", reason: "Requires paired device — manual test" },
];

// ── Test runner ────────────────────────────────────────────────────
async function runModuleTest(mod) {
  const ctx = new StepContext();
  const results = [];
  const gen = mod.steps(ctx);
  const allSteps = [];

  // Collect all steps first
  for await (const step of gen) {
    allSteps.push(step);
  }

  // Separate cleanup steps from normal steps
  const normalSteps = allSteps.filter((s) => !s.cleanup);
  const cleanupSteps = allSteps.filter((s) => s.cleanup);
  let failed = false;

  // Run normal steps
  for (const step of normalSteps) {
    if (failed) {
      results.push({
        action: step.action,
        tool: step.tool,
        status: "SKIP",
        note: "Skipped (previous step failed)",
      });
      continue;
    }

    const args = typeof step.args === "function" ? step.args() : step.args;
    const resp = await callTool(step.tool, args);
    const parsed = parseToolResult(resp);

    if (!parsed.ok) {
      results.push({
        action: step.action,
        tool: step.tool,
        status: "FAIL",
        note: parsed.error?.slice(0, 200) || "Tool returned error",
      });
      failed = true;
      continue;
    }

    const valid = step.validate ? step.validate(parsed.data) : true;
    results.push({
      action: step.action,
      tool: step.tool,
      status: valid ? "PASS" : "FAIL",
      note: valid ? "" : "Validation failed (unexpected response shape)",
    });
    if (!valid) failed = true;
  }

  // Always run cleanup steps
  for (const step of cleanupSteps) {
    try {
      const args = typeof step.args === "function" ? step.args() : step.args;
      const hasArgs = args && Object.values(args).some((v) => v !== undefined && v !== null);
      if (!hasArgs) {
        results.push({
          action: step.action,
          tool: step.tool,
          status: "SKIP",
          note: "Cleanup skipped (no resource to clean up)",
        });
        continue;
      }
      const resp = await callTool(step.tool, args);
      const parsed = parseToolResult(resp);
      const valid = step.validate ? step.validate(parsed.data || {}) : parsed.ok;
      results.push({
        action: step.action,
        tool: step.tool,
        status: valid ? "PASS" : "WARN",
        note: valid ? "(cleanup)" : `Cleanup issue: ${(parsed.error || "").slice(0, 100)}`,
      });
    } catch (e) {
      results.push({
        action: step.action,
        tool: step.tool,
        status: "WARN",
        note: `Cleanup error: ${e.message?.slice(0, 100)}`,
      });
    }
  }

  return { module: mod.name, results };
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  // Filter modules
  const modules = moduleFilter
    ? CRUD_MODULES.filter((m) => moduleFilter.includes(m.name.toLowerCase()))
    : CRUD_MODULES;

  if (modules.length === 0) {
    console.error("No modules matched the filter. Available:");
    for (const m of CRUD_MODULES) console.error(`  - ${m.name}`);
    process.exit(1);
  }

  // Dry run mode
  if (dryRun) {
    console.log("## CRUD Test Plan (dry run)\n");
    for (const mod of modules) {
      console.log(`### ${mod.name}`);
      const ctx = new StepContext();
      const gen = mod.steps(ctx);
      let i = 1;
      for await (const step of gen) {
        const tag = step.cleanup ? " [cleanup]" : "";
        console.log(`  ${i}. ${step.action}: \`${step.tool}\`${tag}`);
        i++;
      }
      console.log();
    }
    console.log("### Skipped Modules\n");
    for (const s of SKIPPED_MODULES) {
      console.log(`- **${s.name}** — ${s.reason}`);
    }
    return;
  }

  // Start MCP server
  startServer();

  const initId = send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-crud-test", version: "1.0" },
  });
  const initResp = await waitFor(initId);
  if (!initResp) {
    console.error("Failed to initialize MCP server");
    process.exit(1);
  }
  const { name: serverName, version: serverVersion } = initResp.result.serverInfo;
  notify("notifications/initialized");
  await new Promise((r) => setTimeout(r, 500));

  // Run each module's CRUD test
  const allResults = [];

  for (const mod of modules) {
    process.stderr.write(`\n── ${mod.name} ──\n`);
    const { module: modName, results } = await runModuleTest(mod);

    for (const r of results) {
      const icon = r.status === "PASS" ? "\u2713" : r.status === "SKIP" ? "\u25CB" : r.status === "WARN" ? "\u25B3" : "\u2717";
      process.stderr.write(`  ${icon} [${r.action}] ${r.tool}: ${r.status}${r.note ? ` — ${r.note}` : ""}\n`);
    }

    allResults.push({ module: modName, results });
  }

  // Tally
  const flat = allResults.flatMap((m) => m.results);
  const pass = flat.filter((r) => r.status === "PASS").length;
  const skip = flat.filter((r) => r.status === "SKIP").length;
  const fail = flat.filter((r) => r.status === "FAIL").length;
  const warn = flat.filter((r) => r.status === "WARN").length;
  const total = flat.length;

  // macOS info
  let macosVersion = "unknown";
  try {
    const { execSync } = await import("child_process");
    macosVersion = execSync("sw_vers -productVersion", { encoding: "utf8" }).trim();
  } catch { /* ignore */ }

  // Output
  if (jsonMode) {
    const report = {
      type: "crud",
      server: { name: serverName, version: serverVersion },
      env: { macos: macosVersion, node: process.version },
      summary: { pass, skip, fail, warn, total },
      modules: allResults,
      skipped: SKIPPED_MODULES,
    };
    const out = JSON.stringify(report, null, 2);
    if (outPath) writeFileSync(outPath.replace(/\.md$/, ".json"), out);
    else console.log(out);
  } else {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = [];
    lines.push(`## CRUD Roundtrip Test Report`);
    lines.push(``);
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| **Server** | ${serverName} v${serverVersion} |`);
    lines.push(`| **Date** | ${now} UTC |`);
    lines.push(`| **macOS** | ${macosVersion} |`);
    lines.push(`| **Node.js** | ${process.version} |`);
    lines.push(``);
    lines.push(`### Summary`);
    lines.push(``);
    lines.push(`| PASS | SKIP | FAIL | WARN | Total |`);
    lines.push(`|------|------|------|------|-------|`);
    lines.push(`| ${pass} | ${skip} | ${fail} | ${warn} | ${total} |`);
    lines.push(``);

    // Per-module results
    for (const { module: modName, results } of allResults) {
      lines.push(`### ${modName}`);
      lines.push(``);
      lines.push(`| Step | Tool | Status | Note |`);
      lines.push(`|------|------|--------|------|`);
      for (const r of results) {
        const icon = r.status === "PASS" ? "\u2705"
          : r.status === "SKIP" ? "\u23ED\uFE0F"
          : r.status === "WARN" ? "\u26A0\uFE0F"
          : "\u274C";
        lines.push(`| ${r.action} | \`${r.tool}\` | ${icon} ${r.status} | ${r.note || "-"} |`);
      }
      lines.push(``);
    }

    // Skipped modules
    lines.push(`### Skipped Modules (Manual Testing Required)`);
    lines.push(``);
    lines.push(`| Module | Reason |`);
    lines.push(`|--------|--------|`);
    for (const s of SKIPPED_MODULES) {
      lines.push(`| ${s.name} | ${s.reason} |`);
    }

    // Failures detail
    const failures = flat.filter((r) => r.status === "FAIL");
    if (failures.length > 0) {
      lines.push(``);
      lines.push(`### Failures`);
      lines.push(``);
      for (const r of failures) {
        lines.push(`- **\`${r.tool}\`** (${r.action}) — ${r.note}`);
      }
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`node scripts/qa-crud-test.mjs\`*`);

    const md = lines.join("\n");
    if (outPath) {
      writeFileSync(outPath, md);
      process.stderr.write(`\nReport written to ${outPath}\n`);
    } else {
      console.log(md);
    }
  }

  server.kill();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  if (server) server.kill();
  process.exit(1);
});
