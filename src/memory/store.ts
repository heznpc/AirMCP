/**
 * Context-Memory Index — on-disk store for small, user-scoped facts, entities,
 * and episodic records. Scaffold (no embeddings, no external DB).
 *
 * Design goals:
 *   • Zero runtime dependencies: plain JSON on disk, in-memory cache.
 *   • Three kinds share one record shape so tooling stays symmetric.
 *       - fact     → durable key→value (e.g. "favorite_editor" = "VSCode")
 *       - entity   → named thing with attributes (person, project, place …)
 *       - episode  → time-anchored record ("met with X about Y on 2026-04-01")
 *   • TTL-aware: expired rows are filtered out on read *and* physically
 *     swept on the next write.
 *   • Stable IDs: caller may supply `id`, otherwise we mint one from
 *     `${kind}:${key}` (idempotent upsert). Random IDs only as a last resort
 *     so writes remain reproducible.
 *
 * This is deliberately a scaffold: future phases can swap the JSON store for
 * SQLite or layer semantic search on top without changing the tool surface.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PATHS } from "../shared/constants.js";

export type MemoryKind = "fact" | "entity" | "episode";

export interface MemoryEntry {
  /** Stable identifier. `${kind}:${key}` unless caller overrides. */
  id: string;
  kind: MemoryKind;
  /** Searchable label (e.g. "favorite_editor", "person:Ada", "2026-04-19_standup"). */
  key: string;
  /** Opaque payload. Free-form string — JSON-encode structured data upstream. */
  value: string;
  /** Optional categorization tags (lowercased, deduped, sorted on write). */
  tags: string[];
  /** Who wrote this — tool name, skill id, "user", etc. */
  source?: string;
  /** ISO timestamp. Set on first insert. */
  createdAt: string;
  /** ISO timestamp. Bumped on every upsert. */
  updatedAt: string;
  /** ISO timestamp. Omitted for non-expiring entries. */
  expiresAt?: string;
}

interface MemoryStoreData {
  version: number;
  entries: Record<string, MemoryEntry>;
}

export interface MemoryQueryOpts {
  kind?: MemoryKind;
  /** Case-insensitive substring match against key OR value. */
  contains?: string;
  /** AND match on any subset of tags. */
  tags?: string[];
  /** Max rows to return. Defaults to 50. */
  limit?: number;
  /** Order by updatedAt desc (default) or asc. */
  order?: "desc" | "asc";
}

export interface MemoryStats {
  total: number;
  byKind: Record<MemoryKind, number>;
  oldest?: string;
  newest?: string;
  expiredSwept: number;
  path: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Deterministic id derivation. */
export function deriveId(kind: MemoryKind, key: string): string {
  return `${kind}:${key}`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    const v = String(t).trim().toLowerCase();
    if (v.length > 0) seen.add(v);
  }
  return [...seen].sort();
}

/** Is `entry` past its expiresAt at `now`? */
function isExpired(entry: MemoryEntry, now: number): boolean {
  if (!entry.expiresAt) return false;
  const t = Date.parse(entry.expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= now;
}

export class MemoryStore {
  private cache: MemoryStoreData | null = null;
  private loadPromise: Promise<MemoryStoreData> | null = null;
  private readonly path: string;

  constructor(path: string = PATHS.MEMORY_STORE) {
    this.path = path;
  }

  private async load(): Promise<MemoryStoreData> {
    if (this.cache) return this.cache;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await readFile(this.path, "utf-8");
          const parsed = JSON.parse(raw) as MemoryStoreData;
          if (parsed && typeof parsed === "object" && parsed.entries) {
            this.cache = parsed;
          } else {
            this.cache = { version: 1, entries: {} };
          }
        } catch {
          this.cache = { version: 1, entries: {} };
        }
        return this.cache;
      })();
    }
    return this.loadPromise;
  }

  private async save(data: MemoryStoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(data, null, 2), "utf-8");
    this.cache = data;
    this.loadPromise = null;
  }

  /** Sweep expired entries. Returns number removed (only writes if any removed). */
  private sweepExpired(data: MemoryStoreData, now: number): number {
    let removed = 0;
    for (const [id, entry] of Object.entries(data.entries)) {
      if (isExpired(entry, now)) {
        delete data.entries[id];
        removed++;
      }
    }
    return removed;
  }

  /** Insert or update. Returns the final stored entry. */
  async put(input: {
    kind: MemoryKind;
    key: string;
    value: string;
    id?: string;
    tags?: string[];
    source?: string;
    ttlMs?: number;
  }): Promise<MemoryEntry> {
    const data = await this.load();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    this.sweepExpired(data, now);

    const id = input.id?.trim() || deriveId(input.kind, input.key);
    const existing = data.entries[id];

    const expiresAt = input.ttlMs && input.ttlMs > 0 ? new Date(now + input.ttlMs).toISOString() : undefined;

    const entry: MemoryEntry = {
      id,
      kind: input.kind,
      key: input.key,
      value: input.value,
      tags: normalizeTags(input.tags),
      source: input.source?.trim() || existing?.source,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      ...(expiresAt ? { expiresAt } : {}),
    };

    data.entries[id] = entry;
    await this.save(data);
    return entry;
  }

  /** Query non-expired entries matching opts. */
  async query(opts: MemoryQueryOpts = {}): Promise<MemoryEntry[]> {
    const data = await this.load();
    const now = Date.now();
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const order = opts.order ?? "desc";
    const needle = opts.contains?.trim().toLowerCase();
    const tagFilter = normalizeTags(opts.tags);

    const matches: MemoryEntry[] = [];
    for (const entry of Object.values(data.entries)) {
      if (isExpired(entry, now)) continue;
      if (opts.kind && entry.kind !== opts.kind) continue;
      if (needle) {
        const hay = `${entry.key}\n${entry.value}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      if (tagFilter.length > 0 && !tagFilter.every((t) => entry.tags.includes(t))) continue;
      matches.push(entry);
    }

    matches.sort((a, b) => {
      const cmp = a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
      return order === "desc" ? -cmp : cmp;
    });

    return matches.slice(0, limit);
  }

  /**
   * Delete entries. Caller must supply exactly one of id / key / tag.
   * Returns the list of ids actually removed.
   */
  async forget(opts: { id?: string; key?: string; tag?: string; kind?: MemoryKind }): Promise<string[]> {
    const { id, key, tag, kind } = opts;
    const specifiers = [id, key, tag].filter(Boolean).length;
    if (specifiers !== 1) {
      throw new Error("memory.forget requires exactly one of: id, key, tag.");
    }

    const data = await this.load();
    const removed: string[] = [];

    if (id) {
      if (data.entries[id] && (!kind || data.entries[id]!.kind === kind)) {
        delete data.entries[id];
        removed.push(id);
      }
    } else if (key) {
      for (const [eid, entry] of Object.entries(data.entries)) {
        if (entry.key === key && (!kind || entry.kind === kind)) {
          delete data.entries[eid];
          removed.push(eid);
        }
      }
    } else if (tag) {
      const needle = tag.toLowerCase();
      for (const [eid, entry] of Object.entries(data.entries)) {
        if (entry.tags.includes(needle) && (!kind || entry.kind === kind)) {
          delete data.entries[eid];
          removed.push(eid);
        }
      }
    }

    if (removed.length > 0) await this.save(data);
    return removed;
  }

  /** Aggregate stats (sweeps expired as a side-effect). */
  async stats(): Promise<MemoryStats> {
    const data = await this.load();
    const now = Date.now();
    const expiredSwept = this.sweepExpired(data, now);
    if (expiredSwept > 0) await this.save(data);

    const byKind: Record<MemoryKind, number> = { fact: 0, entity: 0, episode: 0 };
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const entry of Object.values(data.entries)) {
      byKind[entry.kind]++;
      if (!oldest || entry.createdAt < oldest) oldest = entry.createdAt;
      if (!newest || entry.updatedAt > newest) newest = entry.updatedAt;
    }

    return {
      total: Object.keys(data.entries).length,
      byKind,
      oldest,
      newest,
      expiredSwept,
      path: this.path,
    };
  }

  /** Testing hook: wipe in-memory cache so the next read re-loads from disk. */
  resetCacheForTests(): void {
    this.cache = null;
    this.loadPromise = null;
  }
}
