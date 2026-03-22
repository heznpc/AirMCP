import { describe, test, expect } from '@jest/globals';
import { generateProactiveContext } from '../dist/shared/proactive.js';

describe('generateProactiveContext', () => {
  test('returns valid bundle shape', () => {
    const bundle = generateProactiveContext();
    expect(bundle).toHaveProperty('timeContext');
    expect(bundle).toHaveProperty('suggestedTools');
    expect(bundle).toHaveProperty('suggestedWorkflows');
  });

  test('timeContext has correct fields', () => {
    const { timeContext } = generateProactiveContext();
    expect(['morning', 'afternoon', 'evening', 'night']).toContain(timeContext.period);
    expect(timeContext.hour).toBeGreaterThanOrEqual(0);
    expect(timeContext.hour).toBeLessThan(24);
    expect(typeof timeContext.isWeekend).toBe('boolean');
  });

  test('suggestedTools are well-formed', () => {
    const { suggestedTools } = generateProactiveContext();
    expect(suggestedTools.length).toBeGreaterThan(0);
    for (const s of suggestedTools) {
      expect(s).toHaveProperty('tool');
      expect(s).toHaveProperty('reason');
      expect(typeof s.tool).toBe('string');
      expect(typeof s.reason).toBe('string');
    }
  });

  test('suggestedWorkflows is array', () => {
    const { suggestedWorkflows } = generateProactiveContext();
    expect(Array.isArray(suggestedWorkflows)).toBe(true);
  });

  test('suggestedTools are capped at 8', () => {
    const { suggestedTools } = generateProactiveContext();
    expect(suggestedTools.length).toBeLessThanOrEqual(8);
  });

  test('timeContext period matches hour', () => {
    const { timeContext } = generateProactiveContext();
    const { hour, period } = timeContext;
    if (hour >= 5 && hour < 12) expect(period).toBe('morning');
    else if (hour >= 12 && hour < 17) expect(period).toBe('afternoon');
    else if (hour >= 17 && hour < 21) expect(period).toBe('evening');
    else expect(period).toBe('night');
  });
});
