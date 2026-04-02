/**
 * Generic TTL cache — stores values with per-key expiration.
 * Uses Map insertion order as LRU: accessed keys are moved to the end.
 * Eviction is O(1) — removes the oldest (first) entry in the Map.
 */
export class TtlCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxEntries?: number; autoPruneMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 500;
    const autoPruneMs = options?.autoPruneMs ?? 5 * 60_000; // default: 5 min
    if (autoPruneMs > 0) {
      this.pruneTimer = setInterval(() => this.prune(), autoPruneMs);
      if (this.pruneTimer.unref) this.pruneTimer.unref();
    }
  }

  /** Get a cached value, or undefined if missing/expired. Touches the entry for LRU. */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  /** Store a value with TTL in milliseconds. */
  set(key: string, value: unknown, ttlMs: number): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.evictIfNeeded();
  }

  /** Get cached value or compute it, caching the result. Coalesces concurrent calls for the same key. */
  async getOrSet<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = compute()
      .then((value) => {
        this.set(key, value, ttlMs);
        this.inflight.delete(key);
        return value;
      })
      .catch((err) => {
        this.inflight.delete(key);
        throw err;
      });
    this.inflight.set(key, promise);
    // Safety: clean up inflight entry if promise never settles (prevents memory leak)
    const safetyTimeout = setTimeout(() => this.inflight.delete(key), Math.max(ttlMs, 60_000));
    if (safetyTimeout.unref) safetyTimeout.unref();
    promise.then(
      () => clearTimeout(safetyTimeout),
      () => clearTimeout(safetyTimeout),
    );
    return promise;
  }

  /** Remove a specific key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Remove all expired entries. */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /** Number of entries (including expired). */
  get size(): number {
    return this.store.size;
  }

  /** Clear all entries and pending inflight promises. Does not stop the prune timer — call destroy() for full teardown. */
  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /** Stop the auto-prune timer. */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /** Evict LRU entries when cache exceeds maxEntries. O(1) per eviction. */
  private evictIfNeeded(): void {
    if (this.store.size <= this.maxEntries) return;
    // First pass: remove expired (may free enough space)
    this.prune();
    // Second pass: evict oldest (first in Map = least recently used)
    // Use a snapshot of keys to avoid iterator invalidation issues
    const keys = [...this.store.keys()];
    let evicted = 0;
    for (const key of keys) {
      if (this.store.size <= this.maxEntries) break;
      this.store.delete(key);
      evicted++;
      if (evicted > this.maxEntries) break; // safety guard against infinite loop
    }
  }
}

/** Singleton cache instance for resource data. */
export const resourceCache = new TtlCache();
