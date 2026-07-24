/**
 * RFC 0012 Phase 1 prep — HITL queue for daemon-fired destructive actions.
 *
 * When an autonomous skill (scheduled or event-driven) wants to call a
 * destructive tool while the user is detected absent, the call buffers
 * here instead of firing. The menu-bar app surfaces the queue; on user
 * return (`screen_unlocked` event) the daemon flushes a notification
 * pointing at the queue UI.
 *
 * Storage: append-only JSONL at `~/.config/airmcp/hitl-queue.jsonl`.
 * Append is O(1) and survives a daemon crash mid-write (each line is
 * self-contained; a partial trailing line is ignored on read). Resolve
 * + rotate operations rewrite atomically (temp+rename) since they need
 * to mutate existing entries — the JSONL append-only invariant only
 * applies to enqueue.
 *
 * The `MAX_ENTRIES` cap prevents unbounded growth from a misconfigured
 * always-fire skill. When the cap is hit, the oldest *resolved* entries
 * are spilled to a sibling archive file so audit trails remain
 * queryable. Pending entries are never dropped — if there are more
 * than `MAX_ENTRIES` pending entries, that's a separate alert
 * condition the daemon health probe (RFC 0012 §3.5) will surface.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HOME } from "../../shared/constants.js";

export interface HitlQueueEntry {
  /** Stable opaque ID for resolve / archive tracking. */
  id: string;
  /** ISO timestamp when the autonomous skill enqueued this. */
  enqueuedAt: string;
  /** Skill name that triggered the enqueue. */
  skill: string;
  /** Tool the skill wants to call once approved. */
  tool: string;
  /** Args to pass to the tool on approval. */
  args: Record<string, unknown>;
  /** User-visible reason — what + why. Surface verbatim in the menu-bar UI. */
  reason: string;
  /** ISO timestamp at which the entry auto-marks `expired` if still pending. */
  expiresAt: string;
  /** Correlation ID from the originating skill run (RFC 0001 PR #190). */
  correlationId?: string;
  /** ISO timestamp of resolution (set by `resolveQueueEntry`). */
  resolvedAt?: string;
  /** Pending until the user approves/rejects, or the daemon expires it. */
  status: "pending" | "approved" | "rejected" | "expired";
}

export const DEFAULT_QUEUE_PATH = path.join(HOME, ".config", "airmcp", "hitl-queue.jsonl");
export const DEFAULT_ARCHIVE_PATH = path.join(HOME, ".config", "airmcp", "hitl-queue-archive.jsonl");
export const MAX_ENTRIES = 10_000;

/** Append a fresh pending entry. Generates `id` + `enqueuedAt` + `status: "pending"`. */
export async function appendToQueue(
  entry: Omit<HitlQueueEntry, "id" | "enqueuedAt" | "status">,
  filePath: string = DEFAULT_QUEUE_PATH,
): Promise<HitlQueueEntry> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const full: HitlQueueEntry = {
    id: crypto.randomBytes(8).toString("hex"),
    enqueuedAt: new Date().toISOString(),
    status: "pending",
    ...entry,
  };

  await fs.appendFile(filePath, JSON.stringify(full) + "\n", "utf8");
  return full;
}

/** Read all entries, tolerant to a partial trailing line (mid-write crash). */
export async function readQueue(filePath: string = DEFAULT_QUEUE_PATH): Promise<HitlQueueEntry[]> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const out: HitlQueueEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as HitlQueueEntry);
      } catch {
        // Partial line from a mid-write crash — drop and continue.
      }
    }
    return out;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw e;
  }
}

/** Filter the readable view to pending entries with non-expired TTL. */
export async function readPending(
  filePath: string = DEFAULT_QUEUE_PATH,
  now: Date = new Date(),
): Promise<HitlQueueEntry[]> {
  const entries = await readQueue(filePath);
  const cutoff = now.toISOString();
  return entries.filter((e) => e.status === "pending" && e.expiresAt > cutoff);
}

/** Resolve a queue entry by id. Atomic rewrite — temp+rename. */
export async function resolveQueueEntry(
  id: string,
  status: "approved" | "rejected" | "expired",
  filePath: string = DEFAULT_QUEUE_PATH,
): Promise<HitlQueueEntry | null> {
  const entries = await readQueue(filePath);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const target = entries[idx]!;
  if (target.status !== "pending") return target;

  const updated: HitlQueueEntry = {
    ...target,
    status,
    resolvedAt: new Date().toISOString(),
  };
  entries[idx] = updated;

  await rewriteQueue(filePath, entries);
  return updated;
}

/** Sweep — mark every entry whose `expiresAt < now` as expired.
 *  Returns the count flipped to expired. Run on daemon boot + every tick. */
export async function expirePending(filePath: string = DEFAULT_QUEUE_PATH, now: Date = new Date()): Promise<number> {
  const entries = await readQueue(filePath);
  let flipped = 0;
  const cutoff = now.toISOString();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.status === "pending" && e.expiresAt < cutoff) {
      entries[i] = { ...e, status: "expired", resolvedAt: cutoff };
      flipped++;
    }
  }
  if (flipped > 0) {
    await rewriteQueue(filePath, entries);
  }
  return flipped;
}

/** When the queue exceeds MAX_ENTRIES, spill the oldest resolved entries
 *  to the sibling archive file. Pending entries are never moved out — if
 *  there are >= MAX_ENTRIES pending entries, that's an operator alert
 *  surfaced via `airmcp doctor --deep`. Returns counts for telemetry. */
export async function maybeRotate(
  filePath: string = DEFAULT_QUEUE_PATH,
  archivePath: string = DEFAULT_ARCHIVE_PATH,
  maxEntries: number = MAX_ENTRIES,
): Promise<{ archived: number; kept: number; pendingOverflow: number }> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`maxEntries must be a positive integer, got ${maxEntries}`);
  }
  const entries = await readQueue(filePath);
  if (entries.length <= maxEntries) {
    return { archived: 0, kept: entries.length, pendingOverflow: 0 };
  }

  const overage = entries.length - maxEntries;
  const candidates = entries.filter((e) => e.status !== "pending");
  const pendingCount = entries.length - candidates.length;

  // Sort resolved entries by enqueuedAt ascending — archive the oldest.
  candidates.sort((a, b) => (a.enqueuedAt < b.enqueuedAt ? -1 : 1));
  const toArchive = candidates.slice(0, Math.min(overage, candidates.length));

  if (toArchive.length === 0) {
    return { archived: 0, kept: entries.length, pendingOverflow: Math.max(0, pendingCount - maxEntries) };
  }

  // Append to archive (idempotent if archived twice — archive is append-only).
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.appendFile(archivePath, toArchive.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

  const archivedIds = new Set(toArchive.map((e) => e.id));
  const kept = entries.filter((e) => !archivedIds.has(e.id));
  await rewriteQueue(filePath, kept);

  return {
    archived: toArchive.length,
    kept: kept.length,
    pendingOverflow: Math.max(0, pendingCount - maxEntries),
  };
}

/** Atomic rewrite via temp+rename. Internal helper. */
async function rewriteQueue(filePath: string, entries: HitlQueueEntry[]): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempName = `${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const tempPath = path.join(dir, tempName);

  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
  try {
    await fs.writeFile(tempPath, text, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (e) {
    await fs.unlink(tempPath).catch(() => {
      /* already gone */
    });
    throw e;
  }
}

/** Convert "4h" / "30m" / "2d" → milliseconds. Used by the daemon to
 *  compute `expiresAt` from `hitl_policy.queue_ttl`. */
export function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`Invalid TTL "${ttl}" — expected format like '4h', '30m', '2d'`);
  }
  const value = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unreachable TTL unit: ${match[2]}`);
  }
}
