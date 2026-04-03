/**
 * Generic TTL cache — stores values with per-key expiration.
 * Uses Map insertion order as LRU: accessed keys are moved to the end.
 * Eviction is O(1) — removes the oldest (first) entry in the Map.
 *
 * Optional memory cap: when `maxMemoryBytes` is set, the cache tracks
 * approximate memory usage (JSON-serialized size × 2 for UTF-16) and
 * evicts oldest entries when the cap is exceeded.
 */
export class TtlCache {
  private store = new Map<string, { value: unknown; expiresAt: number; sizeBytes: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly maxMemoryBytes: number;
  private currentMemoryBytes = 0;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxEntries?: number; autoPruneMs?: number; maxMemoryBytes?: number }) {
    this.maxEntries = options?.maxEntries ?? 500;
    this.maxMemoryBytes = options?.maxMemoryBytes ?? 0; // 0 = no memory limit
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
      this.currentMemoryBytes -= entry.sizeBytes;
      this.store.delete(key);
      return undefined;
    }
    // Re-insert to move to end of Map (LRU touch) — sizeBytes unchanged
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  /** Store a value with TTL in milliseconds. */
  set(key: string, value: unknown, ttlMs: number): void {
    const existing = this.store.get(key);
    if (existing) {
      this.currentMemoryBytes -= existing.sizeBytes;
      this.store.delete(key);
    }
    const sizeBytes = this.maxMemoryBytes > 0 ? estimateSize(value) : 0;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, sizeBytes });
    this.currentMemoryBytes += sizeBytes;
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
    const entry = this.store.get(key);
    if (entry) {
      this.currentMemoryBytes -= entry.sizeBytes;
      this.store.delete(key);
    }
  }

  /** Remove all expired entries. */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.currentMemoryBytes -= entry.sizeBytes;
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
    this.currentMemoryBytes = 0;
  }

  /** Stop the auto-prune timer. */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /** Current approximate memory usage in bytes (0 when maxMemoryBytes is not set). */
  getMemoryUsage(): number {
    return this.currentMemoryBytes;
  }

  /** Evict LRU entries when cache exceeds maxEntries or maxMemoryBytes. O(1) per eviction. */
  private evictIfNeeded(): void {
    if (
      this.store.size <= this.maxEntries &&
      (this.maxMemoryBytes <= 0 || this.currentMemoryBytes <= this.maxMemoryBytes)
    )
      return;
    this.prune();
    // Re-check after prune — expired entries may have freed enough space
    if (
      this.store.size <= this.maxEntries &&
      (this.maxMemoryBytes <= 0 || this.currentMemoryBytes <= this.maxMemoryBytes)
    )
      return;
    // Evict oldest entries (Map iteration order = insertion order = LRU)
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (
        this.store.size <= this.maxEntries &&
        (this.maxMemoryBytes <= 0 || this.currentMemoryBytes <= this.maxMemoryBytes)
      )
        break;
      this.currentMemoryBytes -= entry.sizeBytes;
      this.store.delete(key);
      evicted++;
      if (evicted > this.maxEntries) break;
    }
  }
}

/**
 * Estimate the in-memory size of a value in bytes.
 * Uses JSON.stringify length × 2 (UTF-16 char width) as a practical approximation.
 * Falls back to a minimal estimate for values that cannot be serialized.
 */
function estimateSize(value: unknown): number {
  // Fast path for numeric arrays (embeddings): 8 bytes per float64 + overhead
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "number") {
    return value.length * 8 + 64;
  }
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 64;
  }
}

/** Singleton cache instance for resource data. */
export const resourceCache = new TtlCache();
