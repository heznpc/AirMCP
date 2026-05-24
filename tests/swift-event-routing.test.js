/**
 * Regression test for the BLOCKER fix in `src/shared/swift.ts`.
 *
 * The Swift bridge writes RPC responses AND native observer events on
 * the same stdout stream. Events are tagged with `id: "__event__"`:
 *
 *   {"id":"__event__","event":"calendar_changed","data":{...},"timestamp":"..."}
 *
 * Before the fix, the persistent-mode read loop did `pending.get(msg.id)`
 * and `if (!entry) continue;` — `pending` never contains `__event__`,
 * so every native event was silently dropped. Six of nine documented
 * triggers (calendar_changed, reminders_changed, pasteboard_changed,
 * focus_mode_changed, file_modified, screen_locked/unlocked) and four
 * built-in skills (calendar-alert, evening-winddown, focus-guardian,
 * clipboard-url-to-reading) were thus demo-only despite being shipped.
 *
 * The fix routes `__event__` lines to `eventBus.processLine` so the
 * existing parser + emitter chain delivers the typed event to any
 * registered trigger.
 *
 * This test installs a fake `child_process.spawn` that produces a
 * controllable stdout stream, drives `runSwift` to attempt persistent
 * mode, injects a fake `__ready__` then an `__event__` line, and
 * asserts the event bus actually received the line. If the BLOCKER
 * regresses, this test fails on the bus assertion.
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock node:fs/promises.access so checkSwiftBridge succeeds without a
// real Swift binary on disk. All other fs ops pass through.
const realFs = await import('node:fs/promises');
jest.unstable_mockModule('node:fs/promises', () => ({
  ...realFs,
  access: jest.fn(async () => undefined),
}));

// Build a synthetic child every time spawn() is called. The child
// publishes its stdout via a PassThrough so the test can push the
// readiness + event payload at the right moment.
let lastChild = null;
const mockSpawn = jest.fn((bin, argv) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = (sig) => {
    child.killed = true;
    child.emit('close', 0, sig ?? null);
  };
  lastChild = child;
  // Asynchronously declare readiness, then push the __event__ line. The
  // setImmediate yields the event loop so `runSwift` registers its data
  // listener before we push the first chunk.
  setImmediate(() => {
    child.stdout.write(JSON.stringify({ id: '__ready__' }) + '\n');
    setImmediate(() => {
      child.stdout.write(
        JSON.stringify({
          id: '__event__',
          event: 'calendar_changed',
          data: { source: 'eventkit' },
          timestamp: '2026-05-13T00:00:00Z',
        }) + '\n',
      );
    });
  });
  return child;
});

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
}));

// Late imports — eventBus must be imported AFTER the child_process mock
// is in place because swift.ts top-level imports include it.
const { eventBus } = await import('../dist/shared/event-bus.js');
const swiftMod = await import('../dist/shared/swift.js');

beforeAll(() => {
  eventBus.stop();
});

afterAll(() => {
  swiftMod.closeSwiftBridge();
  eventBus.stop();
});

describe('Swift bridge event routing (BLOCKER regression)', () => {
  test('__event__ stdout line is routed to eventBus.processLine', async () => {
    // Subscribe BEFORE driving the bridge — the fake child pushes the
    // event almost immediately after stdout becomes wired.
    const received = new Promise((resolve) => {
      eventBus.once('calendar_changed', (evt) => resolve(evt));
    });

    // runSwift will attempt persistent mode, our fake spawn yields a
    // child, the fake child sends __ready__ → persistent mode resolves,
    // then pushes __event__. We don't actually care what runSwift
    // returns — it'll time out / hang for the missing list-commands
    // response, but the event has already been dispatched by then.
    // Use a short race so the test exits even though no RPC response
    // ever comes back.
    swiftMod.runSwift('noop', '{}').catch(() => {});

    // The whole point: the event bus must observe the calendar_changed
    // event within a reasonable window. Before the fix, this `await`
    // would hang forever — the line was silently dropped.
    // Race against a 2s budget. We clearTimeout the loser explicitly so
    // jest --detectOpenHandles doesn't flag a dangling timer after the
    // test passes — unref alone is not enough because jest's handle
    // tracker observes the timer before the event loop drains.
    let raceTimer;
    const timeoutPromise = new Promise((_, reject) => {
      raceTimer = setTimeout(
        () => reject(new Error('event never reached eventBus — BLOCKER regression')),
        2000,
      );
    });
    const evt = await Promise.race([received, timeoutPromise]).finally(() => {
      if (raceTimer) clearTimeout(raceTimer);
    });

    expect(evt.type).toBe('calendar_changed');
    expect(evt.data).toEqual({ source: 'eventkit' });
    expect(evt.timestamp).toBe('2026-05-13T00:00:00Z');
  });
});
