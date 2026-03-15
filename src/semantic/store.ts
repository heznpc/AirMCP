import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cosineSimilarity } from "./embeddings.js";
import { PATHS, TIMEOUT } from "../shared/constants.js";

export interface VectorEntry {
  id: string;        // e.g. "note:x-coredata://..." or "event:ABC123"
  source: string;    // module name: "notes", "calendar", "reminders", "mail"
  title: string;
  text: string;      // concatenated searchable text
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

  private async load(): Promise<VectorStoreData> {
    if (this.cache) return this.cache;
    try {
      const data = await readFile(STORE_PATH, "utf-8");
      this.cache = JSON.parse(data) as VectorStoreData;
    } catch {
      this.cache = { version: 1, entries: {} };
    }
    return this.cache;
  }

  private async save(store: VectorStoreData): Promise<void> {
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(store), "utf-8");
    this.cache = store;
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

  /** Get all entries (for Spotlight sync). */
  async getAllEntries(): Promise<Record<string, VectorEntry>> {
    const store = await this.load();
    return store.entries;
  }

  /** Clear entire store (for privacy / fresh re-index). */
  async clear(): Promise<void> {
    this.cache = { version: 1, entries: {} };
    await this.save(this.cache);
  }
}
