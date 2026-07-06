import { describe, test, expect } from '@jest/globals';
import { parseIntEnv } from '../dist/shared/env.js';

describe('parseIntEnv', () => {
  test('parses a valid integer and applies the floor', () => {
    expect(parseIntEnv('5000', { floor: 1000, fallback: 3000 })).toBe(5000);
    expect(parseIntEnv('100', { floor: 1000, fallback: 3000 })).toBe(1000); // below floor -> floored
  });

  test('a non-numeric or missing value falls back and is never NaN', () => {
    for (const bad of [undefined, '', 'abc', 'NaN']) {
      const v = parseIntEnv(bad, { floor: 1000, fallback: 3000 });
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(3000);
    }
    // Regression for the trigger/poller NaN class: a bad retry cap must not
    // become NaN (which makes `attempt >= 1 + NaN` always false → infinite loop).
    expect(parseIntEnv('abc', { floor: 0, fallback: 2 })).toBe(2);
    expect(parseIntEnv(undefined, { floor: 5000, fallback: 30_000 })).toBe(30_000);
  });

  test('the fallback is also floored', () => {
    expect(parseIntEnv('xyz', { floor: 5000, fallback: 1000 })).toBe(5000);
  });
});
