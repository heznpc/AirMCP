import { describe, test, expect, beforeEach } from '@jest/globals';

const { toolSessions } = await import('../dist/shared/tool-sessions.js');

describe('toolSessions', () => {
  beforeEach(() => {
    toolSessions.resetForTests();
  });

  test('creates a bounded allowlist session and enforces membership', () => {
    const session = toolSessions.start({
      tools: ['profile_status', 'list_notes', 'profile_status'],
      ttlSeconds: 60,
      label: 'starter check',
    });

    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.allowedTools).toEqual(['list_notes', 'profile_status']);
    expect(session.label).toBe('starter check');
    expect(toolSessions.activeCount()).toBe(1);
    expect(toolSessions.assertAllowed(session.sessionId, 'profile_status')).toEqual({ ok: true });
    expect(toolSessions.assertAllowed(session.sessionId, 'list_events')).toMatchObject({ ok: false });
  });

  test('ends a session explicitly', () => {
    const session = toolSessions.start({ tools: ['profile_status'], ttlSeconds: 60 });

    expect(toolSessions.end(session.sessionId)).toBe(true);
    expect(toolSessions.get(session.sessionId)).toBeNull();
    expect(toolSessions.assertAllowed(session.sessionId, 'profile_status')).toMatchObject({ ok: false });
  });

  test('clamps ttl into the supported range', () => {
    const short = toolSessions.start({ tools: ['a'], ttlSeconds: 1 });
    const long = toolSessions.start({ tools: ['b'], ttlSeconds: 999999 });

    expect(short.remainingSeconds).toBeGreaterThanOrEqual(29);
    expect(short.remainingSeconds).toBeLessThanOrEqual(30);
    expect(long.remainingSeconds).toBeGreaterThanOrEqual(3599);
    expect(long.remainingSeconds).toBeLessThanOrEqual(3600);
  });
});
