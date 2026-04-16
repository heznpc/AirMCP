import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock executor before importing triggers ────────────────────────────
const mockExecuteSkill = jest.fn();
jest.unstable_mockModule('../dist/skills/executor.js', () => ({
  executeSkill: mockExecuteSkill,
}));

// ─── Mock event-bus with a controllable emitter ─────────────────────────
import { EventEmitter } from 'node:events';
const mockEventBus = new EventEmitter();
jest.unstable_mockModule('../dist/shared/event-bus.js', () => ({
  eventBus: mockEventBus,
}));

const { resetTriggers, registerTrigger, startTriggerListener, getRegisteredTriggers } =
  await import('../dist/skills/triggers.js');

// ─── Helpers ────────────────────────────────────────────────────────────
function makeSkill(overrides = {}) {
  return {
    name: 'test-trigger-skill',
    title: 'Test Trigger',
    description: 'A trigger test',
    expose_as: 'tool',
    steps: [{ id: 'step1', tool: 'some_tool' }],
    ...overrides,
  };
}

const fakeServer = {};

// ═══════════════════════════════════════════════════════════════════════════
// registerTrigger / getRegisteredTriggers / resetTriggers
// ═══════════════════════════════════════════════════════════════════════════

describe('trigger registration', () => {
  beforeEach(() => {
    resetTriggers();
  });

  test('registerTrigger does nothing for skills without trigger', () => {
    const skill = makeSkill(); // no trigger field
    registerTrigger(skill);

    expect(getRegisteredTriggers()).toHaveLength(0);
  });

  test('registerTrigger adds trigger with default debounce (5000ms)', () => {
    const skill = makeSkill({
      name: 'cal-trigger',
      trigger: { event: 'calendar_changed' },
    });

    registerTrigger(skill);

    const triggers = getRegisteredTriggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual({
      skill: 'cal-trigger',
      event: 'calendar_changed',
      debounceMs: 5000,
    });
  });

  test('registerTrigger uses explicit debounce_ms', () => {
    const skill = makeSkill({
      name: 'rem-trigger',
      trigger: { event: 'reminders_changed', debounce_ms: 2000 },
    });

    registerTrigger(skill);

    const triggers = getRegisteredTriggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0].debounceMs).toBe(2000);
  });

  test('multiple triggers can be registered for the same event', () => {
    const skill1 = makeSkill({
      name: 'skill-a',
      trigger: { event: 'calendar_changed' },
    });
    const skill2 = makeSkill({
      name: 'skill-b',
      trigger: { event: 'calendar_changed', debounce_ms: 1000 },
    });

    registerTrigger(skill1);
    registerTrigger(skill2);

    const triggers = getRegisteredTriggers();
    expect(triggers).toHaveLength(2);
    expect(triggers[0].skill).toBe('skill-a');
    expect(triggers[1].skill).toBe('skill-b');
  });

  test('resetTriggers clears all bindings', () => {
    const skill = makeSkill({
      name: 'to-clear',
      trigger: { event: 'pasteboard_changed' },
    });

    registerTrigger(skill);
    expect(getRegisteredTriggers()).toHaveLength(1);

    resetTriggers();
    expect(getRegisteredTriggers()).toHaveLength(0);
  });

  test('getRegisteredTriggers returns triggers across multiple events', () => {
    registerTrigger(makeSkill({ name: 'cal', trigger: { event: 'calendar_changed' } }));
    registerTrigger(makeSkill({ name: 'rem', trigger: { event: 'reminders_changed' } }));
    registerTrigger(makeSkill({ name: 'paste', trigger: { event: 'pasteboard_changed', debounce_ms: 100 } }));

    const triggers = getRegisteredTriggers();
    expect(triggers).toHaveLength(3);
    expect(triggers.map((t) => t.event)).toEqual(
      expect.arrayContaining(['calendar_changed', 'reminders_changed', 'pasteboard_changed']),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// startTriggerListener / dispatch
//
// NOTE: resetTriggers() now also resets listenerInstalled and activeServer,
// so each test that needs dispatch must call startTriggerListener() again.
// We remove stale listeners in beforeEach to keep the test environment clean.
// ═══════════════════════════════════════════════════════════════════════════

describe('startTriggerListener and event dispatch', () => {
  beforeEach(() => {
    mockEventBus.removeAllListeners();
    resetTriggers();
    mockExecuteSkill.mockReset();
    mockExecuteSkill.mockResolvedValue({ success: true, steps: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('startTriggerListener attaches listener to eventBus', () => {
    startTriggerListener(fakeServer);

    expect(mockEventBus.listenerCount('event')).toBeGreaterThanOrEqual(1);
  });

  test('dispatches skill execution when matching event fires', async () => {
    const skill = makeSkill({
      name: 'dispatch-test',
      trigger: { event: 'calendar_changed', debounce_ms: 0 },
    });

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'calendar_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    // executeSkill is called async (fire-and-forget), give it a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(mockExecuteSkill).toHaveBeenCalledWith(fakeServer, skill);
  });

  test('does not dispatch for non-matching event type', async () => {
    const skill = makeSkill({
      name: 'cal-only',
      trigger: { event: 'calendar_changed', debounce_ms: 0 },
    });

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'reminders_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockExecuteSkill).not.toHaveBeenCalled();
  });

  test('dispatch does nothing when no server is active (no bindings match)', async () => {
    // No triggers registered, no bindings for this event type
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'pasteboard_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockExecuteSkill).not.toHaveBeenCalled();
  });

  test('debounce prevents rapid re-firing', async () => {
    const skill = makeSkill({
      name: 'debounce-test',
      trigger: { event: 'calendar_changed', debounce_ms: 60_000 },
    });

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    const event = { type: 'calendar_changed', data: {}, timestamp: new Date().toISOString() };

    // First emission fires
    mockEventBus.emit('event', event);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);

    // Second emission is debounced (within 60s window)
    mockEventBus.emit('event', event);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1); // still 1
  });

  test('logs error and retries once on skill execution failure', async () => {
    jest.useFakeTimers();

    const skill = makeSkill({
      name: 'retry-test',
      trigger: { event: 'reminders_changed', debounce_ms: 0 },
    });

    mockExecuteSkill
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce({ success: true, steps: [] });

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'reminders_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    // Let the first promise reject
    await jest.advanceTimersByTimeAsync(10);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed (attempt 1)'),
    );

    // Advance past the 2000ms retry delay
    await jest.advanceTimersByTimeAsync(2100);

    expect(mockExecuteSkill).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('logs error on retry failure with non-Error', async () => {
    jest.useFakeTimers();

    const skill = makeSkill({
      name: 'retry-fail-test',
      trigger: { event: 'pasteboard_changed', debounce_ms: 0 },
    });

    mockExecuteSkill
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce('second fail string');

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'pasteboard_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    await jest.advanceTimersByTimeAsync(10);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed (attempt 1)'),
    );

    await jest.advanceTimersByTimeAsync(2100);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed (attempt 2)'),
    );

    jest.useRealTimers();
  });

  test('logs error on first attempt with non-Error thrown value', async () => {
    jest.useFakeTimers();

    const skill = makeSkill({
      name: 'non-error-test',
      // Use a unique event type to avoid debounce from earlier tests
      trigger: { event: 'reminders_changed', debounce_ms: 0 },
    });

    mockExecuteSkill
      .mockRejectedValueOnce('string error on first attempt')
      .mockResolvedValueOnce({ success: true, steps: [] });

    registerTrigger(skill);
    startTriggerListener(fakeServer);

    mockEventBus.emit('event', {
      type: 'reminders_changed',
      data: {},
      timestamp: new Date().toISOString(),
    });

    await jest.advanceTimersByTimeAsync(10);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('string error on first attempt'),
    );

    await jest.advanceTimersByTimeAsync(2100);

    jest.useRealTimers();
  });
});
