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

  // RFC 0001: legacy toolError() now delegates to toolErr() and carries
  // structuredContent.error automatically. Wire format must stay identical.
  test('text output starts with [not_found] for not-found errors', () => {
    const result = toolError('delete note', new Error('Note not found'));
    expect(result.content[0].text.startsWith('[not_found] Failed to delete note:')).toBe(true);
  });

  test('text output starts with [internal_error] for unclassified errors', () => {
    const result = toolError('do thing', new Error('unexpected boom'));
    expect(result.content[0].text.startsWith('[internal_error] Failed to do thing:')).toBe(true);
  });

  test('classifies permission denied errors', () => {
    const result = toolError('read file', new Error('Permission denied'));
    expect(result.content[0].text.startsWith('[permission_denied] ')).toBe(true);
    expect(result.structuredContent.error.category).toBe('permission_denied');
    expect(result.structuredContent.error.retryable).toBe(false);
  });

  test('classifies timeout errors', () => {
    const result = toolError('fetch', new Error('request timed out'));
    expect(result.structuredContent.error.category).toBe('upstream_timeout');
    expect(result.structuredContent.error.retryable).toBe(true);
  });

  test('classifies rate-limited errors', () => {
    const result = toolError('call api', new Error('HTTP 429 too many requests'));
    expect(result.structuredContent.error.category).toBe('rate_limited');
    expect(result.structuredContent.error.retryable).toBe(true);
  });

  test('populates structuredContent.error for not_found', () => {
    const result = toolError('delete note', new Error('not found'));
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.error).toEqual(
      expect.objectContaining({
        category: 'not_found',
        message: expect.stringContaining('Failed to delete note'),
        retryable: false,
      }),
    );
  });

  test('populates structuredContent.error for internal_error (default)', () => {
    const result = toolError('do thing', 'generic boom');
    expect(result.structuredContent.error.category).toBe('internal_error');
    expect(result.structuredContent.error.retryable).toBe(false);
  });
});
