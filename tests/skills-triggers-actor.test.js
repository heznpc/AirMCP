/**
 * Regression test for the actor-stamping fix in `src/skills/triggers.ts`.
 *
 * Before the fix, autonomous skill executions (event-bus → trigger → skill)
 * called `executeSkill(server, skill)` directly. The tool-registry's audit
 * pre-handler read the current AsyncLocalStorage context to attach an
 * `actor` field to each audit line — but the trigger path never opened a
 * context, so every autonomous tool call landed in the audit log
 * indistinguishable from a human-initiated one. Reviewers couldn't ask
 * "what did the daemon do overnight?" because there was no way to tell.
 *
 * The fix wraps `executeSkill` in `runWithRequestContext({ actor: "daemon-skill:<name>", ... })`
 * inside `runWithRetry`. This test asserts:
 *   1. When the trigger path fires a skill, the active request context's
 *      `actor` is set to `daemon-skill:<skill.name>` for the duration of
 *      the skill execution.
 *   2. A correlation ID is also stamped so downstream audit lines can be
 *      threaded together.
 *
 * We don't need a real event-bus dispatch — we drive the synchronous
 * fire path by registering a trigger and then emitting the event.
 */
import { describe, test, expect, jest } from '@jest/globals';

let capturedContext = null;
const mockExecuteSkill = jest.fn(async () => {
  // Read the active context AT the moment executeSkill is invoked. This
  // is the exact spot where the tool-registry's audit hook would also
  // read it — so if it's set here, audit lines will see it too.
  const { getRequestContext } = await import('../dist/shared/request-context.js');
  capturedContext = getRequestContext();
  return { skill: 'probe', steps: [], success: true };
});

jest.unstable_mockModule('../dist/skills/executor.js', () => ({
  executeSkill: mockExecuteSkill,
}));

const { registerTrigger, startTriggerListener, resetTriggers } = await import(
  '../dist/skills/triggers.js'
);
const { eventBus } = await import('../dist/shared/event-bus.js');

const fakeServer = { /* triggers.ts only forwards this to executeSkill */ };
const fakeRegistry = { identity: 'per-server-registry' };

describe('autonomous trigger actor stamping', () => {
  test('skill fired from event-bus runs inside an actor="daemon-skill:<name>" context', async () => {
    resetTriggers();
    mockExecuteSkill.mockClear();
    capturedContext = null;

    registerTrigger({
      name: 'probe-skill',
      steps: [],
      trigger: { event: 'calendar_changed', debounce_ms: 0 },
    });
    startTriggerListener(fakeServer, fakeRegistry);

    // Fire a synthetic event. dispatch() schedules executeSkill via
    // runWithRetry, which itself awaits executeSkill inside the
    // AsyncLocalStorage frame. We await a microtask cycle so the mock
    // has a chance to capture the context.
    eventBus.processLine(JSON.stringify({
      event: 'calendar_changed',
      data: {},
      timestamp: '2026-05-13T00:00:00Z',
    }));

    // Allow the fire-and-forget executeSkill().catch chain to land.
    await new Promise((r) => setTimeout(r, 30));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill).toHaveBeenCalledWith(
      fakeServer,
      expect.objectContaining({ name: 'probe-skill' }),
      {},
      fakeRegistry,
    );
    expect(capturedContext).not.toBeNull();
    expect(capturedContext.actor).toBe('daemon-skill:probe-skill');
    // Correlation ID must be present so any audit/trace lines emitted
    // inside the skill thread together.
    expect(typeof capturedContext.correlationId).toBe('string');
    expect(capturedContext.correlationId.length).toBeGreaterThan(0);

    resetTriggers();
    eventBus.stop();
  });
});
