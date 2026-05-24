import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { cosineSimilarity } from "./embeddings.js";
import { PATHS, TIMEOUT } from "../shared/constants.js";

export interface VectorEntry {
  id: string; // e.g. "note:x-coredata://..." or "event:ABC123"
  source: string; // module name: "notes", "calendar", "reminders", "mail"
  title: string;
  text: string; // concatenated searchable text
  vector: number[];
  updatedAt: string; // ISO 8601
}

interface VectorStoreData {
  version: number;
  indexedAt?: string; // ISO 8601 -- last full index time
  entries: Record<string, VectorEntry>;
}

export interface SearchResult {
  id: string;
  source: string;
  title: string;
  similarity: number;
}

const STORE_DIR = PATHS.VECTOR_STORE;
const STORE_PATH = join(STORE_DIR, "vectors.json");

/** Search a store data object by cosine similarity to a query vector. */
export function search(
  store: VectorStoreData,
  queryVector: number[],
  opts: { topK?: number; threshold?: number; sources?: string[] } = {},
): SearchResult[] {
  const { topK = 10, threshold = 0.5, sources } = opts;
  const results: SearchResult[] = [];

  for (const entry of Object.values(store.entries)) {
    if (sources && !sources.includes(entry.source)) continue;
    if (entry.vector.length !== queryVector.length) continue;

    const sim = cosineSimilarity(queryVector, entry.vector);
    if (sim >= threshold) {
      results.push({
        id: entry.id,
        source: entry.source,
        title: entry.title,
        similarity: Math.round(sim * 1000) / 1000,
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * Manages the on-disk vector store with an in-memory cache.
 * Encapsulates all mutable state that was previously module-level.
 */
export class VectorStore {
  private cache: VectorStoreData | null = null;
  private loadPromise: Promise<VectorStoreData> | null = null;

  private async load(): Promise<VectorStoreData> {
    if (this.cache) return this.cache;
    // Deduplicate concurrent load calls — only the first actually reads disk
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const data = await readFile(STORE_PATH, "utf-8");
          this.cache = JSON.parse(data) as VectorStoreData;
        } catch {
          this.cache = { version: 1, entries: {} };
        }
        return this.cache;
      })();
    }
    return this.loadPromise;
  }

  private async save(store: VectorStoreData): Promise<void> {
    // Atomic write: writing the embedding index in place is fatal if the
    // process dies (SIGKILL, power loss, OOM-kill) midway — the half-written
    // JSON fails to parse on next load(), which silently catches and resets
    // to an empty index. That's hours of indexing time gone with no warning.
    //
    // Write to a sibling temp file in the same directory (so rename is a
    // single inode swap on APFS / ext4 — atomic by POSIX guarantee), then
    // rename onto STORE_PATH. If anything fails before rename, the old file
    // is intact; if rename succeeds, the new file is intact. There is no
    // observable mid-state.
    await mkdir(STORE_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(store), { encoding: "utf-8", mode: 0o600 });
      await rename(tmp, STORE_PATH);
    } catch (err) {
      // Best-effort cleanup of the dangling temp file. Swallow ENOENT (the
      // write may have failed before the file appeared) but rethrow the
      // original error so the caller surfaces the real failure.
      try {
        await unlink(tmp);
      } catch {
        /* temp file never made it to disk */
      }
      throw err;
    }
    this.cache = store;
    this.loadPromise = null; // Reset so next load reads fresh data if cache is cleared
  }

  /** Upsert one or more entries into the vector store. */
  async upsertEntries(entries: VectorEntry[]): Promise<number> {
    const store = await this.load();
    for (const entry of entries) {
      store.entries[entry.id] = entry;
    }
    store.indexedAt = new Date().toISOString();
    await this.save(store);
    return entries.length;
  }

  /** Check if the index is empty or stale (older than STALE_MS). */
  async isIndexStale(): Promise<boolean> {
    const store = await this.load();
    if (Object.keys(store.entries).length === 0) return true;
    if (!store.indexedAt) return true;
    return Date.now() - new Date(store.indexedAt).getTime() > TIMEOUT.VECTOR_STALE;
  }

  /** Remove entries by ID prefix (e.g. "note:" removes all notes). */
  async removeByPrefix(prefix: string): Promise<number> {
    const store = await this.load();
    let removed = 0;
    for (const key of Object.keys(store.entries)) {
      if (key.startsWith(prefix)) {
        delete store.entries[key];
        removed++;
      }
    }
    if (removed > 0) await this.save(store);
    return removed;
  }

  /** Search the store by cosine similarity to a query vector. */
  async search(
    queryVector: number[],
    opts?: { topK?: number; threshold?: number; sources?: string[] },
  ): Promise<SearchResult[]> {
    const store = await this.load();
    return search(store, queryVector, opts);
  }

  /** Get store stats. */
  async getStats(): Promise<{
    total: number;
    bySource: Record<string, number>;
    indexedAt: string | null;
    stale: boolean;
  }> {
    const store = await this.load();
    const bySource: Record<string, number> = {};
    for (const entry of Object.values(store.entries)) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }
    const stale = await this.isIndexStale();
    return { total: Object.keys(store.entries).length, bySource, indexedAt: store.indexedAt ?? null, stale };
  }

  /** Find entry by ID. */
  async getEntry(id: string): Promise<VectorEntry | null> {
    const store = await this.load();
    return store.entries[id] ?? null;
  }

  /** Get all entries (for Spotlight sync). Returns a shallow copy to prevent cache mutation. */
  async getAllEntries(): Promise<Record<string, VectorEntry>> {
    const store = await this.load();
    return { ...store.entries };
  }

  /** Clear entire store (for privacy / fresh re-index). */
  async clear(): Promise<void> {
    this.loadPromise = null; // Cancel any in-flight load before overwriting cache
    this.cache = { version: 1, entries: {} };
    await this.save(this.cache);
  }
}
