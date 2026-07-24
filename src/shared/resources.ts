import type { McpServer } from "./mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJxa } from "./jxa.js";
import { listEventsScript, getUpcomingEventsScript } from "../calendar/scripts.js";
import { listRemindersScript } from "../reminders/scripts.js";
import { nowPlayingScript } from "../music/scripts.js";
import { getClipboardScript, getFrontmostAppScript } from "../system/scripts.js";
import { getUnreadCountScript } from "../mail/scripts.js";
import { AirMcpConfig, isModuleEnabled } from "./config.js";
import { LIMITS } from "./constants.js";
import { resourceCache } from "./cache.js";
import { getMemoryStore } from "../memory/instance.js";
import { UNTRUSTED_CONTENT_META } from "./untrusted.js";
import { summarizeAuditEntries, getAuditKeyGrade } from "./audit.js";
import { getRateLimitStatus } from "./rate-limit.js";
import { SERVER_INSTRUCTIONS } from "./icons.js";
// Memory reads are cheap (JSON file + in-memory cache) — resolved at
// call site (not at module load) so the singleton is shared with the
// memory_* tools and remains substitutable in tests via _resetMemoryStore.

const CACHE_TTL = {
  NOTES: 120_000, // 2min — notes change infrequently; event_subscribe invalidates on change
  CALENDAR: 180_000, // 3min — events rarely change; event_subscribe invalidates on change
  REMINDERS: 120_000, // 2min — event_subscribe invalidates on change
  MUSIC: 5_000, // 5s — now-playing changes often
  MAIL: 120_000, // 2min — inbox changes infrequently within a conversation
  CLIPBOARD: 2_000, // 2s — clipboard changes frequently
  SNAPSHOT: 60_000, // 60s — composite; event_subscribe invalidates relevant keys
} as const;

// ── Resource registration factory ──

function untrustedJsonResourceResult(uri: string, text: string) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json" as const,
        text,
        _meta: UNTRUSTED_CONTENT_META,
      },
    ],
    _meta: UNTRUSTED_CONTENT_META,
  };
}

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
  server.registerResource(name, uri, { description, mimeType: "application/json" }, async (resourceUri) =>
    untrustedJsonResourceResult(resourceUri.href, JSON.stringify(await fetcher(), null, 2)),
  );
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
  return runJxa<ReminderRecord[]>(`
    const Reminders = Application('Reminders');
    const now = new Date();
    const lists = Reminders.lists();
    const result = [];
    for (const l of lists) {
      const src = l.reminders.whose({completed: false});
      const count = src.length;
      if (count === 0) continue;
      const names = src.name();
      const ids = src.id();
      const dues = src.dueDate();
      const priorities = src.priority();
      const flags = src.flagged();
      const listName = l.name();
      for (let i = 0; i < count; i++) {
        if (dues[i] && dues[i] <= now) {
          result.push({
            id: ids[i], name: names[i], completed: false,
            dueDate: dues[i].toISOString(), priority: priorities[i],
            flagged: flags[i], list: listName
          });
        }
      }
    }
    result.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    JSON.stringify(result);
  `);
}

async function fetchTodayReminders(): Promise<ReminderRecord[]> {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  return runJxa<ReminderRecord[]>(`
    const Reminders = Application('Reminders');
    const dayStart = new Date('${startOfDay}');
    const dayEnd = new Date('${endOfDay}');
    const lists = Reminders.lists();
    const result = [];
    for (const l of lists) {
      const src = l.reminders.whose({completed: false});
      const count = src.length;
      if (count === 0) continue;
      const names = src.name();
      const ids = src.id();
      const dues = src.dueDate();
      const priorities = src.priority();
      const flags = src.flagged();
      const listName = l.name();
      for (let i = 0; i < count; i++) {
        if (dues[i] && dues[i] >= dayStart && dues[i] < dayEnd) {
          result.push({
            id: ids[i], name: names[i], completed: false,
            dueDate: dues[i].toISOString(), priority: priorities[i],
            flagged: flags[i], list: listName
          });
        }
      }
    }
    JSON.stringify(result);
  `);
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

  // ── Trust attestation (first-party, ALWAYS listed) ──
  //
  // Registered unconditionally — no module gate, no progressive-exposure
  // front door — because the whole point is that a cautious client can read
  // the governance posture BEFORE it decides to widen tool access. It composes
  // the live tamper-evident audit verdict, HITL approval level, rate-limit +
  // emergency-stop state, and audit key grade into one `governed` verdict, and
  // mirrors the identity string sent in SERVER_INSTRUCTIONS so the claim and
  // its proof live at one URI. Returned as plain first-party JSON — NOT wrapped
  // in UNTRUSTED_CONTENT_META, which is reserved for Apple-app user data.
  server.registerResource(
    "trust-attestation",
    "airmcp://trust",
    {
      description:
        "Live governance/trust attestation: whole-chain audit verification (tamper-evident), HITL approval level, " +
        "rate-limit budget + emergency-stop state, and audit key grade — composed into one `governed` verdict. " +
        "First-party server attestation; read it to verify the 'governed runtime, not an agent' claim before widening tool access.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify(await buildTrustAttestation(config), null, 2),
        },
      ],
    }),
  );

  // ── Notes ──
  if (enabled("notes")) {
    jsonResource(server, "recent-notes", "notes://recent", "10 most recently modified Apple Notes", () =>
      resourceCache.getOrSet("notes:recent:10", CACHE_TTL.NOTES, () => fetchRecentNotes(10)),
    );

    server.registerResource(
      "recent-notes-count",
      new ResourceTemplate("notes://recent/{count}", { list: undefined }),
      { description: "Recently modified Apple Notes (max 50)", mimeType: "application/json" },
      async (uri, variables) => {
        const raw = Array.isArray(variables.count) ? variables.count[0] : variables.count;
        const count = Math.max(1, Math.min(Number(raw) || 10, 50));
        const notes = await resourceCache.getOrSet(`notes:recent:${count}`, CACHE_TTL.NOTES, () =>
          fetchRecentNotes(count),
        );
        return untrustedJsonResourceResult(uri.href, JSON.stringify(notes, null, 2));
      },
    );
  }

  // ── Calendar ──
  if (enabled("calendar")) {
    jsonResource(
      server,
      "today-events",
      "calendar://today",
      "Today's Apple Calendar events, sorted by start time",
      () => resourceCache.getOrSet("calendar:today", CACHE_TTL.CALENDAR, fetchTodayEvents),
    );

    jsonResource(
      server,
      "upcoming-events",
      "calendar://upcoming",
      "Upcoming Apple Calendar events for the next 7 days",
      () => resourceCache.getOrSet("calendar:upcoming", CACHE_TTL.CALENDAR, fetchUpcomingEvents),
    );
  }

  // ── Reminders ──
  if (enabled("reminders")) {
    jsonResource(server, "due-reminders", "reminders://due", "Apple Reminders that are currently due or overdue", () =>
      resourceCache.getOrSet("reminders:due", CACHE_TTL.REMINDERS, fetchDueReminders),
    );

    jsonResource(server, "today-reminders", "reminders://today", "Apple Reminders due today (incomplete only)", () =>
      resourceCache.getOrSet("reminders:today", CACHE_TTL.REMINDERS, fetchTodayReminders),
    );
  }

  // ── Music ──
  if (enabled("music")) {
    jsonResource(server, "now-playing", "music://now-playing", "Currently playing track in Apple Music", () =>
      resourceCache.getOrSet("music:now", CACHE_TTL.MUSIC, () => runJxa<unknown>(nowPlayingScript())),
    );
  }

  // ── System ──
  if (enabled("system")) {
    jsonResource(server, "clipboard", "system://clipboard", "Current macOS clipboard contents", () =>
      resourceCache.getOrSet("system:clipboard", CACHE_TTL.CLIPBOARD, () => runJxa<unknown>(getClipboardScript())),
    );
  }

  // ── Mail ──
  if (enabled("mail")) {
    jsonResource(server, "unread-mail", "mail://unread", "Unread email count across all mailboxes", () =>
      resourceCache.getOrSet("mail:unread", CACHE_TTL.MAIL, () => runJxa<unknown>(getUnreadCountScript())),
    );
  }

  // ── Context Memory ──
  //
  // Expose the most recently updated memory entries as a pollable
  // resource so AI clients can pull recent user context without
  // explicitly calling `memory_query`. Kept deliberately lean
  // (default 20 entries, no expiresAt filtering beyond the store's
  // own sweep) so the payload stays well under any prompt budget.
  if (enabled("memory")) {
    jsonResource(server, "recent-memory", "memory://recent", "20 most recently updated context-memory entries", () =>
      resourceCache.getOrSet("memory:recent", CACHE_TTL.MAIL, async () => {
        // Resolve at call site so put-then-read in the same process always
        // sees the singleton's freshest cache.
        const entries = await getMemoryStore().query({ limit: 20, order: "desc" });
        return { total: entries.length, entries };
      }),
    );
  }

  // ── Context Snapshot ──
  jsonResource(
    server,
    "context-snapshot",
    "context://snapshot",
    "Unified context from all enabled Apple apps — calendar, reminders, notes, mail, music, system — in a single read. Default depth: brief (~500 tokens). Use context://snapshot/{depth} for standard or full.",
    () =>
      resourceCache.getOrSet("snapshot:brief", CACHE_TTL.SNAPSHOT, async () =>
        JSON.parse(await buildSnapshot(enabled, DEPTH.brief!)),
      ),
  );

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
      const dc = (DEPTH[raw] ?? DEPTH.standard)!;
      const depthKey = raw in DEPTH ? raw : "standard";
      const text = await resourceCache.getOrSet(`snapshot:${depthKey}`, CACHE_TTL.SNAPSHOT, () =>
        buildSnapshot(enabled, dc),
      );
      return untrustedJsonResourceResult(uri.href, text);
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

// ── Trust attestation builder — composes live governance posture ──

export interface TrustAttestation {
  /** Verbatim SERVER_INSTRUCTIONS — the identity claim this read makes falsifiable. */
  identity: string;
  audit: {
    /** Whole-chain HMAC verification from genesis (windowless). */
    verified: boolean;
    /** Audit logging currently halted (disk-full / permission / repeated flush failures). */
    auditDisabled: boolean;
    /** First integrity break when `verified` is false; null when the chain verifies. */
    firstBreak: { file: string; lineIndex: number; reason: string } | null;
    /** `operator-key` (external secret) vs `host-fallback` (tamper-evident only). */
    keyGrade: "operator-key" | "host-fallback";
  };
  /** Human-in-the-loop approval posture. */
  approval: { level: string; whitelistSize: number };
  /** Rate-limit budget and the emergency-stop kill switch. */
  rateLimit: {
    enabled: boolean;
    globalRemaining: number;
    destructiveRemaining: number;
    emergencyStop: boolean;
    emergencyStopPath: string;
  };
  /**
   * Rolled-up verdict. True when the audit trail verifies and is not halted.
   * A weak (host-fallback) key and an engaged emergency stop are surfaced in
   * `posture` as caveats/lockdown — they do NOT flip `governed` false, because
   * the record is still trustworthy (weak key) / the runtime is still governing
   * (locked down). Only tampering or a halted audit trail means governance
   * cannot be attested.
   */
  governed: boolean;
  /** One-line human-readable posture summary. */
  posture: string;
  /** ISO timestamp of this attestation (no caching — freshness is the feature). */
  checkedAt: string;
}

/**
 * Compose AirMCP's live governance posture into one attestation. All inputs
 * are already computed in-process — nothing here re-implements verification;
 * it reuses `summarizeAuditEntries` (whose HMAC-chain replay is windowless),
 * `getRateLimitStatus`, `getAuditKeyGrade`, and the configured HITL level.
 */
export async function buildTrustAttestation(config?: AirMcpConfig): Promise<TrustAttestation> {
  const summary = await summarizeAuditEntries();
  const rate = getRateLimitStatus();
  const keyGrade = getAuditKeyGrade();
  const level = config?.hitl?.level ?? "sensitive-only";
  const whitelistSize = config?.hitl?.whitelist?.size ?? 0;

  const governed = summary.verified && !summary.auditDisabled;

  const posture = [
    governed ? "governed" : summary.verified ? "audit halted" : "TAMPER DETECTED",
    `audit ${summary.verified ? "verified" : "BROKEN"}`,
    `approval: ${level}`,
    `emergency-stop: ${rate.emergencyStop ? "engaged" : "off"}`,
    keyGrade === "operator-key" ? null : "host-fallback key",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    identity: SERVER_INSTRUCTIONS,
    audit: {
      verified: summary.verified,
      auditDisabled: summary.auditDisabled,
      firstBreak: summary.verifiedFirstBreak ?? null,
      keyGrade,
    },
    approval: { level, whitelistSize },
    rateLimit: {
      enabled: rate.enabled,
      globalRemaining: rate.globalRemaining,
      destructiveRemaining: rate.destructiveRemaining,
      emergencyStop: rate.emergencyStop,
      emergencyStopPath: rate.emergencyStopPath,
    },
    governed,
    posture,
    checkedAt: new Date().toISOString(),
  };
}

// ── Context snapshot builder — parallel fetch across all enabled apps ──

interface ContextSnapshot {
  timestamp: string;
  depth: string;
  [key: string]: unknown;
}

export async function buildSnapshot(enabled: (mod: string) => boolean, depth: DepthConfig | string): Promise<string> {
  const dc: DepthConfig = typeof depth === "string" ? (DEPTH[depth] ?? DEPTH.standard!) : depth;
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
        const { reminders: all, total: totalIncomplete } = await runJxa<{
          reminders: Array<{ completed: boolean; dueDate: string | null; [k: string]: unknown }>;
          total: number;
        }>(listRemindersScript(LIMITS.SNAPSHOT_REMINDERS, 0, undefined, false));
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
    const r = results[i]!;
    snapshot[tasks[i]!.key] = r.status === "fulfilled" ? r.value : { error: "unavailable" };
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
        folder: note.container().name(),
        modificationDate: modDates[i].toISOString(),
        preview: note.plaintext().substring(0, 200)
      };
    });
    JSON.stringify(result);
  `);
}
