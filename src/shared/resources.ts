import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJxa } from "./jxa.js";
import { listEventsScript, getUpcomingEventsScript } from "../calendar/scripts.js";
import { listRemindersScript } from "../reminders/scripts.js";
import { nowPlayingScript } from "../music/scripts.js";
import { getClipboardScript, getFrontmostAppScript } from "../system/scripts.js";
import { getUnreadCountScript } from "../mail/scripts.js";
import { AirMcpConfig, isModuleEnabled } from "./config.js";

// ── Resource registration factory ──

/**
 * Register a static JSON resource with the standard pattern:
 * fetcher is called on each read, result is JSON-stringified.
 */
function jsonResource(
  server: McpServer,
  name: string,
  uri: string,
  description: string,
  fetcher: () => Promise<unknown>,
): void {
  server.registerResource(name, uri, { description, mimeType: "application/json" }, async (resourceUri) => ({
    contents: [{
      uri: resourceUri.href,
      mimeType: "application/json" as const,
      text: JSON.stringify(await fetcher(), null, 2),
    }],
  }));
}

// ── Context snapshot depth configs ──
interface DepthConfig {
  notes: number;
  events: number;
  reminders: number;
  previewLen: number;
}

const DEPTH: Record<string, DepthConfig> = {
  brief: { notes: 3, events: 5, reminders: 3, previewLen: 80 },
  standard: { notes: 5, events: 10, reminders: 5, previewLen: 200 },
  full: { notes: 15, events: 30, reminders: 15, previewLen: 500 },
};

// ── Reminder fetcher helpers ──

type ReminderRecord = { completed: boolean; dueDate: string | null; [k: string]: unknown };

async function fetchDueReminders(): Promise<ReminderRecord[]> {
  const { reminders: all } = await runJxa<{ reminders: ReminderRecord[] }>(listRemindersScript(10000, 0, undefined, false));
  const now = new Date();
  return all
    .filter((r) => r.dueDate && new Date(r.dueDate) <= now)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
}

async function fetchTodayReminders(): Promise<ReminderRecord[]> {
  const { reminders: all } = await runJxa<{ reminders: ReminderRecord[] }>(listRemindersScript(10000, 0, undefined, false));
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  return all.filter((r) => {
    if (!r.dueDate) return false;
    const t = new Date(r.dueDate).getTime();
    return t >= startOfDay && t < endOfDay;
  });
}

// ── Calendar fetcher helpers ──

async function fetchTodayEvents(): Promise<unknown[]> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  const result = await runJxa<{ events: unknown[] }>(listEventsScript(start, end, 999, 0));
  return result.events;
}

async function fetchUpcomingEvents(): Promise<unknown[]> {
  const result = await runJxa<{ events: unknown[] }>(getUpcomingEventsScript(50));
  return result.events;
}

/**
 * Register MCP resources that expose live Apple data for direct client reads.
 */
export function registerResources(server: McpServer, config?: AirMcpConfig): void {
  const enabled = (mod: string) => !config || isModuleEnabled(config, mod);

  // ── Notes ──
  if (enabled("notes")) {
    jsonResource(server, "recent-notes", "notes://recent",
      "10 most recently modified Apple Notes",
      () => fetchRecentNotes(10));

    server.registerResource(
      "recent-notes-count",
      new ResourceTemplate("notes://recent/{count}", { list: undefined }),
      { description: "Recently modified Apple Notes (max 50)", mimeType: "application/json" },
      async (uri, variables) => {
        const raw = Array.isArray(variables.count) ? variables.count[0] : variables.count;
        const count = Math.max(1, Math.min(Number(raw) || 10, 50));
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await fetchRecentNotes(count), null, 2) }],
        };
      },
    );
  }

  // ── Calendar ──
  if (enabled("calendar")) {
    jsonResource(server, "today-events", "calendar://today",
      "Today's Apple Calendar events, sorted by start time",
      fetchTodayEvents);

    jsonResource(server, "upcoming-events", "calendar://upcoming",
      "Upcoming Apple Calendar events for the next 7 days",
      fetchUpcomingEvents);
  }

  // ── Reminders ──
  if (enabled("reminders")) {
    jsonResource(server, "due-reminders", "reminders://due",
      "Apple Reminders that are currently due or overdue",
      fetchDueReminders);

    jsonResource(server, "today-reminders", "reminders://today",
      "Apple Reminders due today (incomplete only)",
      fetchTodayReminders);
  }

  // ── Music ──
  if (enabled("music")) {
    jsonResource(server, "now-playing", "music://now-playing",
      "Currently playing track in Apple Music",
      () => runJxa<unknown>(nowPlayingScript()));
  }

  // ── System ──
  if (enabled("system")) {
    jsonResource(server, "clipboard", "system://clipboard",
      "Current macOS clipboard contents",
      () => runJxa<unknown>(getClipboardScript()));
  }

  // ── Mail ──
  if (enabled("mail")) {
    jsonResource(server, "unread-mail", "mail://unread",
      "Unread email count across all mailboxes",
      () => runJxa<unknown>(getUnreadCountScript()));
  }

  // ── Context Snapshot ──
  jsonResource(server, "context-snapshot", "context://snapshot",
    "Unified context from all enabled Apple apps — calendar, reminders, notes, mail, music, system — in a single read. Default depth: standard.",
    async () => JSON.parse(await buildSnapshot(enabled, DEPTH.standard)));

  server.registerResource(
    "context-snapshot-depth",
    new ResourceTemplate("context://snapshot/{depth}", { list: undefined }),
    {
      description:
        "Unified context snapshot with configurable depth: brief (~500 tokens), standard (~2-4k), full (~5k+).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = (Array.isArray(variables.depth) ? variables.depth[0] : variables.depth) as string;
      const dc = DEPTH[raw] ?? DEPTH.standard;
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: await buildSnapshot(enabled, dc) }],
      };
    },
  );
}

// ── Notes helper (no existing reusable script for "recent sorted by modDate") ──

interface RecentNote {
  id: string;
  name: string;
  folder: string;
  modificationDate: string;
  preview: string;
}

// ── Context snapshot builder — parallel fetch across all enabled apps ──

interface ContextSnapshot {
  timestamp: string;
  depth: string;
  [key: string]: unknown;
}

export async function buildSnapshot(
  enabled: (mod: string) => boolean,
  depth: DepthConfig | string,
): Promise<string> {
  const dc: DepthConfig = typeof depth === "string" ? (DEPTH[depth] ?? DEPTH.standard) : depth;
  const depthName = dc === DEPTH.brief ? "brief" : dc === DEPTH.full ? "full" : "standard";

  // Build parallel fetchers for each enabled module
  const tasks: Array<{ key: string; promise: Promise<unknown> }> = [];

  if (enabled("calendar")) {
    tasks.push({
      key: "calendar",
      promise: (async () => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
        const result = await runJxa<{ events: unknown[] }>(listEventsScript(start, end, dc.events, 0));
        return { todayCount: result.events.length, events: result.events.slice(0, dc.events) };
      })(),
    });
  }

  if (enabled("reminders")) {
    tasks.push({
      key: "reminders",
      promise: (async () => {
        const { reminders: all, total: totalIncomplete } = await runJxa<{ reminders: Array<{ completed: boolean; dueDate: string | null; [k: string]: unknown }>; total: number }>(
          listRemindersScript(10000, 0, undefined, false),
        );
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today.getTime() + 86400000);
        const overdue = all.filter((r) => r.dueDate && new Date(r.dueDate) < today);
        const dueToday = all.filter((r) => {
          if (!r.dueDate) return false;
          const t = new Date(r.dueDate).getTime();
          return t >= today.getTime() && t < tomorrow.getTime();
        });
        return {
          overdueCount: overdue.length,
          dueTodayCount: dueToday.length,
          totalIncomplete,
          overdue: overdue.slice(0, dc.reminders),
          dueToday: dueToday.slice(0, dc.reminders),
        };
      })(),
    });
  }

  if (enabled("notes")) {
    tasks.push({
      key: "notes",
      promise: (async () => {
        const notes = await fetchRecentNotes(dc.notes);
        return {
          recentCount: notes.length,
          notes: notes.map((n) => ({ ...n, preview: n.preview.substring(0, dc.previewLen) })),
        };
      })(),
    });
  }

  if (enabled("mail")) {
    tasks.push({
      key: "mail",
      promise: runJxa(getUnreadCountScript()),
    });
  }

  if (enabled("music")) {
    tasks.push({
      key: "music",
      promise: runJxa(nowPlayingScript()).catch(() => ({ playerState: "unavailable" })),
    });
  }

  if (enabled("system")) {
    tasks.push({
      key: "system",
      promise: (async () => {
        const [clipboard, frontApp] = await Promise.all([
          runJxa<unknown>(getClipboardScript()).catch(() => null),
          runJxa<unknown>(getFrontmostAppScript()).catch(() => null),
        ]);
        return { clipboard, frontmostApp: frontApp };
      })(),
    });
  }

  // Execute all in parallel
  const results = await Promise.allSettled(tasks.map((t) => t.promise));

  const snapshot: ContextSnapshot = {
    timestamp: new Date().toISOString(),
    depth: depthName,
  };

  for (let i = 0; i < tasks.length; i++) {
    const r = results[i];
    snapshot[tasks[i].key] = r.status === "fulfilled" ? r.value : { error: "unavailable" };
  }

  return JSON.stringify(snapshot, null, 2);
}

async function fetchRecentNotes(count: number): Promise<RecentNote[]> {
  return runJxa<RecentNote[]>(`
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const modDates = Notes.notes.modificationDate();
    const indices = Array.from({length: names.length}, (_, i) => i);
    indices.sort((a, b) => modDates[b] - modDates[a]);
    const top = indices.slice(0, ${count});
    const result = top.map(i => {
      const note = Notes.notes[i];
      return {
        id: ids[i],
        name: names[i],
        folder: note.container.name(),
        modificationDate: modDates[i].toISOString(),
        preview: note.plaintext().substring(0, 200)
      };
    });
    JSON.stringify(result);
  `);
}
