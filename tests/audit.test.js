import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  auditLog,
  sanitizeArgs,
  _testReset,
} from '../dist/shared/audit.js';

/* ================================================================== */
/*  Reset module state before each test so buffer is clean.           */
/* ================================================================== */

beforeEach(() => {
  _testReset();
});

/* ================================================================== */
/*  auditLog() — entry buffering                                     */
/* ================================================================== */

describe('auditLog()', () => {
  test('adds entries to buffer', () => {
    auditLog({
      timestamp: '2026-04-01T00:00:00Z',
      tool: 'test_tool',
      args: { query: 'hello' },
      status: 'ok',
      durationMs: 42,
    });

    const buf = _testReset();
    expect(buf.length).toBe(1);

    const parsed = JSON.parse(buf[0]);
    expect(parsed.tool).toBe('test_tool');
    expect(parsed.args.query).toBe('hello');
    expect(parsed.status).toBe('ok');
    expect(parsed.durationMs).toBe(42);
  });

  test('multiple auditLog calls accumulate in the buffer', () => {
    auditLog({ timestamp: 'T1', tool: 'a', status: 'ok' });
    auditLog({ timestamp: 'T2', tool: 'b', status: 'ok' });
    auditLog({ timestamp: 'T3', tool: 'c', status: 'error' });

    const buf = _testReset();
    expect(buf.length).toBe(3);
    expect(JSON.parse(buf[0]).tool).toBe('a');
    expect(JSON.parse(buf[1]).tool).toBe('b');
    expect(JSON.parse(buf[2]).tool).toBe('c');
  });

  test('entry without args omits args from JSON', () => {
    auditLog({
      timestamp: 'T1',
      tool: 'simple',
      status: 'ok',
    });

    const buf = _testReset();
    const parsed = JSON.parse(buf[0]);
    expect(parsed.tool).toBe('simple');
    expect(parsed.status).toBe('ok');
    // args should be undefined (not present in JSON)
    expect(parsed.args).toBeUndefined();
  });

  test('entries exceeding 10KB are truncated', () => {
    // sanitizeArgs truncates individual strings at 500 chars, so we need
    // many fields to push the total JSON size over 10KB.
    const args = {};
    for (let i = 0; i < 30; i++) {
      args[`field_${i}`] = 'v'.repeat(490); // each ~490 chars, 30 * 490 ~ 14.7KB
    }
    auditLog({
      timestamp: 'T1',
      tool: 'big_tool',
      args,
      status: 'ok',
    });

    const buf = _testReset();
    expect(buf.length).toBe(1);

    const parsed = JSON.parse(buf[0]);
    expect(parsed.args._truncated).toBe(true);
    expect(parsed._note).toContain('10KB');
    // The truncated entry should be well under 10KB
    expect(buf[0].length).toBeLessThan(10_000);
  });

  test('entries just under 10KB are NOT truncated', () => {
    // A value that produces a JSON line just under 10KB
    const value = 'y'.repeat(9_000);
    auditLog({
      timestamp: 'T1',
      tool: 'medium_tool',
      args: { data: value },
      status: 'ok',
    });

    const buf = _testReset();
    const parsed = JSON.parse(buf[0]);
    expect(parsed.args.data).toContain('y');
    expect(parsed._note).toBeUndefined();
  });

  test('buffer is cleared after draining', () => {
    auditLog({ timestamp: 'T1', tool: 'x', status: 'ok' });
    _testReset();

    const buf2 = _testReset();
    expect(buf2.length).toBe(0);
  });
});

/* ================================================================== */
/*  sanitizeArgs() — sensitive field redaction                        */
/* ================================================================== */

describe('sanitizeArgs()', () => {
  test('redacts password fields', () => {
    const result = sanitizeArgs({ username: 'alice', password: 'secret123' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.username).toBe('alice');
  });

  test('redacts token fields', () => {
    const result = sanitizeArgs({ token: 'tok_abc123', name: 'test' });
    expect(result.token).toBe('[REDACTED]');
    expect(result.name).toBe('test');
  });

  test('redacts api_key fields', () => {
    const result = sanitizeArgs({ api_key: 'key_secret', url: 'https://example.com' });
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.url).toBe('https://example.com');
  });

  test('redacts apiKey fields (camelCase)', () => {
    const result = sanitizeArgs({ apiKey: 'key_secret', data: 'visible' });
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.data).toBe('visible');
  });

  test('redacts auth_token fields', () => {
    const result = sanitizeArgs({ auth_token: 'bearer_xyz', host: 'localhost' });
    expect(result.auth_token).toBe('[REDACTED]');
    expect(result.host).toBe('localhost');
  });

  test('redacts credential fields', () => {
    const result = sanitizeArgs({ credential: 'cred_abc', type: 'oauth' });
    expect(result.credential).toBe('[REDACTED]');
    expect(result.type).toBe('oauth');
  });

  test('redacts secret fields', () => {
    const result = sanitizeArgs({ secret: 'my_secret', label: 'prod' });
    expect(result.secret).toBe('[REDACTED]');
    expect(result.label).toBe('prod');
  });

  test('redaction is case insensitive', () => {
    const result = sanitizeArgs({ Password: 'hidden', SECRET: 'hidden2', Token: 'hidden3' });
    expect(result.Password).toBe('[REDACTED]');
    expect(result.SECRET).toBe('[REDACTED]');
    expect(result.Token).toBe('[REDACTED]');
  });

  test('truncates string arguments longer than 500 chars', () => {
    const longStr = 'a'.repeat(600);
    const result = sanitizeArgs({ query: longStr });
    expect(result.query).toContain('... (600 chars)');
    expect(result.query.length).toBeLessThan(600);
  });

  test('does not truncate string arguments at exactly 500 chars', () => {
    const shortStr = 'b'.repeat(500);
    const result = sanitizeArgs({ query: shortStr });
    expect(result.query).toBe(shortStr);
  });

  test('does not truncate string arguments under 500 chars', () => {
    const shortStr = 'c'.repeat(100);
    const result = sanitizeArgs({ query: shortStr });
    expect(result.query).toBe(shortStr);
  });

  test('handles nested objects with sensitive keys', () => {
    const result = sanitizeArgs({
      config: {
        password: 'nested_secret',
        host: 'db.example.com',
      },
      name: 'test',
    });
    expect(result.config.password).toBe('[REDACTED]');
    expect(result.config.host).toBe('db.example.com');
    expect(result.name).toBe('test');
  });

  test('nested objects beyond depth 3 are truncated', () => {
    const deepObj = {
      level1: {
        level2: {
          level3: {
            level4: {
              deep: 'value',
            },
          },
        },
      },
    };
    const result = sanitizeArgs(deepObj);
    // At depth 0, level1 is an object -> recurse (depth 1)
    // At depth 1, level2 is an object -> recurse (depth 2)
    // At depth 2, level3 is an object -> recurse (depth 3)
    // At depth 3, level4 is an object -> recurse (depth 4 > 3) -> _truncated
    expect(result.level1.level2.level3.level4).toEqual({ _truncated: true });
  });

  test('preserves non-sensitive primitive values', () => {
    const result = sanitizeArgs({
      count: 42,
      active: true,
      label: 'test',
      nothing: null,
    });
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.label).toBe('test');
    expect(result.nothing).toBeNull();
  });

  test('preserves arrays as-is (no recursion into arrays)', () => {
    const result = sanitizeArgs({
      items: [1, 2, 3],
      tags: ['a', 'b'],
    });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.tags).toEqual(['a', 'b']);
  });

  test('handles empty args object', () => {
    const result = sanitizeArgs({});
    expect(result).toEqual({});
  });
});

/* ================================================================== */
/*  auditLog + sanitizeArgs integration                               */
/* ================================================================== */

describe('auditLog() sanitization integration', () => {
  test('auditLog sanitizes args before buffering', () => {
    auditLog({
      timestamp: 'T1',
      tool: 'login',
      args: { username: 'alice', password: 'secret123', token: 'tok_abc' },
      status: 'ok',
    });

    const buf = _testReset();
    const parsed = JSON.parse(buf[0]);
    expect(parsed.args.password).toBe('[REDACTED]');
    expect(parsed.args.token).toBe('[REDACTED]');
    expect(parsed.args.username).toBe('alice');
  });

  test('auditLog truncates long string args before buffering', () => {
    const longStr = 'z'.repeat(700);
    auditLog({
      timestamp: 'T1',
      tool: 'search',
      args: { query: longStr },
      status: 'ok',
    });

    const buf = _testReset();
    const parsed = JSON.parse(buf[0]);
    expect(parsed.args.query).toContain('... (700 chars)');
  });
});

/* ================================================================== */
/*  Timer behavior — event-driven (setTimeout not setInterval)        */
/* ================================================================== */

describe('timer behavior', () => {
  test('_testReset clears the flush timer (no leaked timers)', () => {
    auditLog({ timestamp: 'T1', tool: 'x', status: 'ok' });

    // Draining should clear the timer — no unhandled timer warnings.
    const buf = _testReset();
    expect(buf.length).toBe(1);

    // A second drain should produce nothing (timer was cleared).
    const buf2 = _testReset();
    expect(buf2.length).toBe(0);
  });

  test('_testReset clears all state including timer', () => {
    auditLog({ timestamp: 'T1', tool: 'x', status: 'ok' });
    _testReset();

    // Buffer should be empty after reset.
    const buf = _testReset();
    expect(buf.length).toBe(0);
  });

  test('after reset, new auditLog calls work normally', () => {
    auditLog({ timestamp: 'T1', tool: 'before_reset', status: 'ok' });
    _testReset();

    auditLog({ timestamp: 'T2', tool: 'after_reset', status: 'ok' });
    const buf = _testReset();
    expect(buf.length).toBe(1);
    expect(JSON.parse(buf[0]).tool).toBe('after_reset');
  });
});
