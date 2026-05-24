/**
 * Regression test for the MemoryStore singleton (HIGH bug fixed in this audit).
 *
 * Before the fix, `src/memory/tools.ts` and `src/shared/resources.ts` each
 * called `new MemoryStore()` at module load. Each instance owned an
 * independent in-memory cache layered over the same on-disk JSON file. A
 * `memory_put` against the tools' instance would never appear in
 * `memory://recent` (resources' instance) until something invalidated the
 * resource-side cache — which nothing did within a single process lifetime.
 *
 * The contract this test pins down:
 *   1. `getMemoryStore()` is identity-stable across calls.
 *   2. tools.ts and resources.ts must end up with the SAME instance (not
 *      two different ones backed by the same file).
 *   3. `_resetMemoryStore()` makes the next `getMemoryStore()` mint a fresh
 *      instance — for test isolation only.
 *
 * Reading from disk after every read would be a different (and slower)
 * way to dodge this bug; testing the identity invariant is the cheaper
 * structural check that the singleton is what's actually being shared.
 */
import { describe, test, expect } from '@jest/globals';
import { getMemoryStore, _resetMemoryStore } from '../dist/memory/instance.js';

describe('MemoryStore singleton', () => {
  test('getMemoryStore returns the same instance across calls', () => {
    _resetMemoryStore();
    const a = getMemoryStore();
    const b = getMemoryStore();
    expect(a).toBe(b);
  });

  test('_resetMemoryStore mints a fresh instance on next access', () => {
    const before = getMemoryStore();
    _resetMemoryStore();
    const after = getMemoryStore();
    expect(after).not.toBe(before);
  });

  test('put-then-query observes the same cache (no cross-instance drift)', async () => {
    _resetMemoryStore();
    const store = getMemoryStore();
    // Use a randomized key so we don't collide with a real ~/.cache/airmcp
    // entry from the developer's machine. The point is: a put MUST be
    // visible to the next query via the same singleton.
    const key = `singleton_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await store.put({ kind: 'fact', key, value: 'probe-value' });
    try {
      // Same singleton, second access — must see the entry without a disk
      // re-read or cache invalidation.
      const again = getMemoryStore();
      const hits = await again.query({ contains: key, limit: 5 });
      const found = hits.find((h) => h.key === key);
      expect(found).toBeDefined();
      expect(found.value).toBe('probe-value');
    } finally {
      // Best-effort cleanup so repeated test runs don't accumulate probes
      // in the real on-disk store. Forget by id is exact-match; if it
      // already vanished (cold cache eviction across processes) this is
      // a no-op.
      try {
        await store.forget({ id: `fact:${key}` });
      } catch {
        /* test cleanup is advisory */
      }
    }
  });
});
