import { describe, test, expect } from '@jest/globals';
import { getToolLinks, withLinks } from '../dist/shared/tool-links.js';

describe('getToolLinks', () => {
  test('returns links for known tool', () => {
    const links = getToolLinks('today_events');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveProperty('tool');
    expect(links[0]).toHaveProperty('description');
  });

  test('returns empty array for unknown tool', () => {
    expect(getToolLinks('nonexistent_tool')).toEqual([]);
  });

  test('merges usage-based suggestions', () => {
    const usage = [{ tool: 'custom_tool', count: 10 }];
    const links = getToolLinks('today_events', usage);
    const customLink = links.find(l => l.tool === 'custom_tool');
    expect(customLink).toBeDefined();
  });

  test('returns health links for health tools', () => {
    const summaryLinks = getToolLinks('health_summary');
    expect(summaryLinks.length).toBeGreaterThan(0);
    const toolNames = summaryLinks.map(l => l.tool);
    expect(toolNames).toContain('health_today_steps');
    expect(toolNames).toContain('health_sleep');

    const sleepLinks = getToolLinks('health_sleep');
    expect(sleepLinks.some(l => l.tool === 'health_summary')).toBe(true);
  });

  test('does not duplicate existing static links', () => {
    // 'read_event' is already in today_events static links
    const usage = [{ tool: 'read_event', count: 10 }];
    const links = getToolLinks('today_events', usage);
    const readEventLinks = links.filter(l => l.tool === 'read_event');
    expect(readEventLinks.length).toBe(1);
  });
});

describe('withLinks', () => {
  test('appends _links to plain objects', () => {
    const data = { events: [{ id: '1' }] };
    const result = withLinks('today_events', data);
    expect(result).toHaveProperty('_links');
    expect(result).toHaveProperty('events');
  });

  test('wraps arrays in { items, _links }', () => {
    const data = [1, 2, 3];
    const result = withLinks('today_events', data);
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('_links');
    expect(result.items).toEqual([1, 2, 3]);
  });

  test('returns null/undefined unchanged', () => {
    expect(withLinks('today_events', null)).toBeNull();
    expect(withLinks('today_events', undefined)).toBeUndefined();
  });

  test('returns data unchanged when no links exist', () => {
    const data = { foo: 'bar' };
    const result = withLinks('nonexistent_tool', data);
    expect(result).toEqual(data);
  });
});
