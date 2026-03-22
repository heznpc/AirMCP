import { describe, test, expect, beforeEach } from '@jest/globals';
import { usageTracker } from '../dist/shared/usage-tracker.js';

describe('UsageTracker', () => {
  test('record and getStats returns frequency data', () => {
    usageTracker.record('tool_a');
    usageTracker.record('tool_a');
    usageTracker.record('tool_b');

    const stats = usageTracker.getStats();
    expect(stats.totalCalls).toBeGreaterThanOrEqual(3);
    expect(stats.topTools.length).toBeGreaterThan(0);

    const toolA = stats.topTools.find((t) => t.tool === 'tool_a');
    expect(toolA).toBeDefined();
    expect(toolA.count).toBeGreaterThanOrEqual(2);
  });

  test('getNextTools returns sequential patterns', () => {
    usageTracker.record('today_events');
    usageTracker.record('create_note');
    usageTracker.record('today_events');
    usageTracker.record('create_note');
    usageTracker.record('today_events');
    usageTracker.record('create_note');

    const next = usageTracker.getNextTools('today_events');
    expect(next.length).toBeGreaterThan(0);
    expect(next[0].tool).toBe('create_note');
    expect(next[0].count).toBeGreaterThanOrEqual(3);
  });

  test('getNextTools returns empty array for unknown tool', () => {
    expect(usageTracker.getNextTools('nonexistent_tool_xyz')).toEqual([]);
  });

  test('getStats returns expected shape', () => {
    const stats = usageTracker.getStats();
    expect(stats).toHaveProperty('totalCalls');
    expect(stats).toHaveProperty('topTools');
    expect(stats).toHaveProperty('topSequences');
  });
});
