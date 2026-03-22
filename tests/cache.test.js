import { describe, test, expect } from '@jest/globals';
import { TtlCache } from '../dist/shared/cache.js';

describe('TtlCache', () => {
  test('get returns undefined for missing keys', () => {
    const cache = new TtlCache();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  test('get returns undefined for expired keys', async () => {
    const cache = new TtlCache();
    cache.set('key', 'value', 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('key')).toBeUndefined();
  });

  test('set + get works for valid TTL', () => {
    const cache = new TtlCache();
    cache.set('key', 'hello', 5000);
    expect(cache.get('key')).toBe('hello');
  });

  test('getOrSet computes on cache miss', async () => {
    const cache = new TtlCache();
    const result = await cache.getOrSet('k', 5000, async () => 42);
    expect(result).toBe(42);
    // value should now be cached
    expect(cache.get('k')).toBe(42);
  });

  test('getOrSet returns cached value on cache hit (does NOT re-compute)', async () => {
    const cache = new TtlCache();
    cache.set('k', 'original', 5000);
    let called = false;
    const result = await cache.getOrSet('k', 5000, async () => {
      called = true;
      return 'recomputed';
    });
    expect(result).toBe('original');
    expect(called).toBe(false);
  });

  test('getOrSet deduplicates concurrent calls for the same key', async () => {
    const cache = new TtlCache();
    let computeCount = 0;
    const compute = () =>
      new Promise((resolve) => {
        computeCount++;
        setTimeout(() => resolve(`result-${computeCount}`), 50);
      });

    const [a, b, c] = await Promise.all([
      cache.getOrSet('dup', 5000, compute),
      cache.getOrSet('dup', 5000, compute),
      cache.getOrSet('dup', 5000, compute),
    ]);

    expect(computeCount).toBe(1);
    expect(a).toBe('result-1');
    expect(b).toBe('result-1');
    expect(c).toBe('result-1');
  });

  test('delete removes a key', () => {
    const cache = new TtlCache();
    cache.set('key', 'value', 5000);
    expect(cache.get('key')).toBe('value');
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });

  test('prune removes expired entries', async () => {
    const cache = new TtlCache();
    cache.set('short', 'a', 10);
    cache.set('long', 'b', 5000);
    await new Promise((r) => setTimeout(r, 20));

    const pruned = cache.prune();
    expect(pruned).toBe(1);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe('b');
  });

  test('clear removes everything', () => {
    const cache = new TtlCache();
    cache.set('a', 1, 5000);
    cache.set('b', 2, 5000);
    cache.set('c', 3, 5000);
    expect(cache.size).toBe(3);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  test('size is correct', () => {
    const cache = new TtlCache();
    expect(cache.size).toBe(0);
    cache.set('a', 1, 5000);
    expect(cache.size).toBe(1);
    cache.set('b', 2, 5000);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });
});
