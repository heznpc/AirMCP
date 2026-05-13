/**
 * Singleton accessor for the shared MemoryStore.
 *
 * Why this exists: tools.ts (memory_put / memory_query / memory_forget /
 * memory_stats) and resources.ts (memory://recent) both used to instantiate
 * their own `new MemoryStore()`. Each instance owned an independent in-memory
 * cache layered on top of the same on-disk JSON file. A `memory_put` against
 * instance A would invalidate A's cache on write but leave B's cache stale
 * for the resource read — the user's just-written entry would not appear in
 * `memory://recent` until B's cache happened to be flushed.
 *
 * The store handles its own load deduplication, atomic write (temp+rename),
 * and TTL sweep — none of that requires multiple instances. One singleton,
 * imported wherever needed, keeps cache and disk monotonically in sync.
 */
import { MemoryStore } from "./store.js";

let instance: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
  if (!instance) instance = new MemoryStore();
  return instance;
}

/** Test-only reset so unit tests can swap stores between cases. */
export function _resetMemoryStore(): void {
  instance = null;
}
