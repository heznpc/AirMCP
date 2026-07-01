import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EVENTKIT_SERVICE = fileURLToPath(
  new URL('../swift/Sources/AirMCPKit/EventKitService.swift', import.meta.url),
);

describe('EventKit authorization regressions', () => {
  test('fresh permission grants reset the shared store before caching authorization', () => {
    const source = readFileSync(EVENTKIT_SERVICE, 'utf8');
    const authorizeMatch = source.match(/private func authorize\([\s\S]*?\n    \}/);

    expect(authorizeMatch).toBeTruthy();
    expect(source).toContain('Issue #145');
    const body = authorizeMatch[0];
    expect(body).toMatch(
      /let granted = try await request\(store\)[\s\S]*guard granted[\s\S]*store\.reset\(\)[\s\S]*flag\.withLock \{ \$0 = true \}/,
    );
  });
});
