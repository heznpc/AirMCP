import { describe, test, expect } from '@jest/globals';
import { ok, okLinked, okUntrusted, err, toolError } from '../dist/shared/result.js';

describe('ok', () => {
  test('returns MCP tool response format', () => {
    const result = ok({ foo: 'bar' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: 'bar' });
  });
});

describe('okLinked', () => {
  test('includes _links for known tool', () => {
    const result = okLinked('today_events', { events: [] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('_links');
  });

  test('no _links for unknown tool', () => {
    const result = okLinked('nonexistent', { data: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).not.toHaveProperty('_links');
  });
});

describe('okUntrusted', () => {
  test('wraps with untrusted markers', () => {
    const result = okUntrusted({ email: 'test' });
    expect(result.content[0].text).toContain('UNTRUSTED EXTERNAL CONTENT');
    expect(result.content[0].text).toContain('END UNTRUSTED EXTERNAL CONTENT');
  });
});

describe('err', () => {
  test('returns isError true', () => {
    const result = err('something failed');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('something failed');
  });
});

describe('toolError', () => {
  test('formats Error instances', () => {
    const result = toolError('delete note', new Error('not found'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to delete note');
    expect(result.content[0].text).toContain('not found');
  });

  test('formats string errors', () => {
    const result = toolError('read file', 'permission denied');
    expect(result.content[0].text).toContain('permission denied');
  });
});
