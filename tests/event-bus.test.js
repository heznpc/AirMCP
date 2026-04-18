import { describe, test, expect, beforeEach } from '@jest/globals';
import { eventBus } from '../dist/shared/event-bus.js';

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.stop(); // clears listeners and sets running = false
  });

  test('starts and stops correctly', () => {
    expect(eventBus.isRunning).toBe(false);
    eventBus.start();
    expect(eventBus.isRunning).toBe(true);
    eventBus.stop();
    expect(eventBus.isRunning).toBe(false);
  });

  test('processLine emits valid calendar_changed event', (done) => {
    eventBus.on('calendar_changed', (event) => {
      expect(event.type).toBe('calendar_changed');
      expect(event.data).toEqual({ id: '123' });
      expect(event.timestamp).toBe('2026-03-25T00:00:00Z');
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'calendar_changed',
      data: { id: '123' },
      timestamp: '2026-03-25T00:00:00Z',
    }));
  });

  test('processLine emits valid reminders_changed event', (done) => {
    eventBus.on('reminders_changed', (event) => {
      expect(event.type).toBe('reminders_changed');
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'reminders_changed',
      data: {},
      timestamp: '2026-03-25T00:00:00Z',
    }));
  });

  test('processLine emits valid pasteboard_changed event', (done) => {
    eventBus.on('pasteboard_changed', (event) => {
      expect(event.type).toBe('pasteboard_changed');
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'pasteboard_changed',
    }));
  });

  test('processLine also emits generic "event"', (done) => {
    eventBus.on('event', (event) => {
      expect(event.type).toBe('calendar_changed');
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'calendar_changed',
      data: {},
      timestamp: '2026-03-25T00:00:00Z',
    }));
  });

  test('processLine provides default timestamp if missing', (done) => {
    eventBus.on('event', (event) => {
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('string');
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'calendar_changed',
    }));
  });

  test('processLine provides default data if missing', (done) => {
    eventBus.on('event', (event) => {
      expect(event.data).toEqual({});
      done();
    });

    eventBus.processLine(JSON.stringify({
      event: 'reminders_changed',
    }));
  });

  test('processLine ignores invalid event types', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });

    eventBus.processLine(JSON.stringify({
      event: 'invalid_event_type',
      data: {},
    }));

    expect(emitted).toBe(false);
  });

  test('processLine ignores non-JSON lines', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });

    eventBus.processLine('this is not json');
    eventBus.processLine('');
    eventBus.processLine('{broken json');

    expect(emitted).toBe(false);
  });

  test('processLine ignores lines without event field', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });

    eventBus.processLine(JSON.stringify({ data: 'no event field' }));

    expect(emitted).toBe(false);
  });

  test('stop removes all listeners', () => {
    eventBus.on('event', () => {});
    eventBus.on('calendar_changed', () => {});
    eventBus.start();
    eventBus.stop();

    expect(eventBus.isRunning).toBe(false);
    expect(eventBus.listenerCount('event')).toBe(0);
    expect(eventBus.listenerCount('calendar_changed')).toBe(0);
  });

  // ── Data validation edge cases ──────────────────────────────────

  test('processLine defaults data to {} when data is an array', (done) => {
    eventBus.on('calendar_changed', (evt) => {
      expect(evt.data).toEqual({});
      done();
    });
    eventBus.processLine(JSON.stringify({ event: 'calendar_changed', data: [1, 2] }));
  });

  test('processLine defaults data to {} when data is null', (done) => {
    eventBus.on('calendar_changed', (evt) => {
      expect(evt.data).toEqual({});
      done();
    });
    eventBus.processLine(JSON.stringify({ event: 'calendar_changed', data: null }));
  });

  test('processLine defaults data to {} when data is a string', (done) => {
    eventBus.on('reminders_changed', (evt) => {
      expect(evt.data).toEqual({});
      done();
    });
    eventBus.processLine(JSON.stringify({ event: 'reminders_changed', data: 'string' }));
  });

  test('processLine generates ISO timestamp when timestamp is non-string', (done) => {
    eventBus.on('calendar_changed', (evt) => {
      expect(typeof evt.timestamp).toBe('string');
      expect(evt.timestamp).toContain('T'); // ISO format
      done();
    });
    eventBus.processLine(JSON.stringify({ event: 'calendar_changed', timestamp: 12345 }));
  });

  test('processLine ignores JSON null', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });
    eventBus.processLine('null');
    expect(emitted).toBe(false);
  });

  test('processLine ignores JSON array at top level', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });
    eventBus.processLine('[1, 2, 3]');
    expect(emitted).toBe(false);
  });

  test('processLine ignores JSON string at top level', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });
    eventBus.processLine('"hello"');
    expect(emitted).toBe(false);
  });

  test('processLine ignores event field that is not a string', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });
    eventBus.processLine(JSON.stringify({ event: 123 }));
    expect(emitted).toBe(false);
  });

  // ── Listener management ─────────────────────────────────────────

  test('off() removes a specific listener without affecting others', () => {
    const callsA = [];
    const callsB = [];
    const listenerA = () => callsA.push(1);
    const listenerB = () => callsB.push(1);

    eventBus.on('calendar_changed', listenerA);
    eventBus.on('calendar_changed', listenerB);

    eventBus.processLine(JSON.stringify({ event: 'calendar_changed' }));
    expect(callsA).toHaveLength(1);
    expect(callsB).toHaveLength(1);

    eventBus.off('calendar_changed', listenerA);
    eventBus.processLine(JSON.stringify({ event: 'calendar_changed' }));
    expect(callsA).toHaveLength(1); // not called again
    expect(callsB).toHaveLength(2); // still called
  });

  test('different event types do not cross-fire', () => {
    const calCalls = [];
    const remCalls = [];
    eventBus.on('calendar_changed', () => calCalls.push(1));
    eventBus.on('reminders_changed', () => remCalls.push(1));

    eventBus.processLine(JSON.stringify({ event: 'calendar_changed' }));
    expect(calCalls).toHaveLength(1);
    expect(remCalls).toHaveLength(0);

    eventBus.processLine(JSON.stringify({ event: 'reminders_changed' }));
    expect(calCalls).toHaveLength(1);
    expect(remCalls).toHaveLength(1);
  });

  // ── Expanded event types (v2.8+) ────────────────────────────────
  // 4 new event types: mail_unread_changed, focus_mode_changed,
  // now_playing_changed, file_modified — bringing the bus from 3 → 7.

  test('processLine emits mail_unread_changed', (done) => {
    eventBus.on('mail_unread_changed', (evt) => {
      expect(evt.type).toBe('mail_unread_changed');
      expect(evt.data.totalUnread).toBe(12);
      done();
    });
    eventBus.processLine(JSON.stringify({
      event: 'mail_unread_changed',
      data: { totalUnread: 12, delta: 3 },
      timestamp: '2026-04-19T10:00:00Z',
    }));
  });

  test('processLine emits focus_mode_changed', (done) => {
    eventBus.on('focus_mode_changed', (evt) => {
      expect(evt.type).toBe('focus_mode_changed');
      expect(evt.data.state).toBe('work');
      done();
    });
    eventBus.processLine(JSON.stringify({
      event: 'focus_mode_changed',
      data: { source: 'distributed_notification', state: 'work' },
    }));
  });

  test('processLine emits now_playing_changed', (done) => {
    eventBus.on('now_playing_changed', (evt) => {
      expect(evt.type).toBe('now_playing_changed');
      expect(evt.data.playerState).toBe('playing');
      done();
    });
    eventBus.processLine(JSON.stringify({
      event: 'now_playing_changed',
      data: { playerState: 'playing', trackChanged: true },
    }));
  });

  test('processLine emits file_modified', (done) => {
    eventBus.on('file_modified', (evt) => {
      expect(evt.type).toBe('file_modified');
      expect(evt.data.path).toBe('/Users/test/Downloads');
      expect(evt.data.kind).toBe('write');
      done();
    });
    eventBus.processLine(JSON.stringify({
      event: 'file_modified',
      data: { source: 'dispatch_source', path: '/Users/test/Downloads', kind: 'write' },
    }));
  });

  test('emitNodeEvent fires the type listener and generic event listener', () => {
    const typeCalls = [];
    const genericCalls = [];
    eventBus.on('mail_unread_changed', (e) => typeCalls.push(e));
    eventBus.on('event', (e) => genericCalls.push(e));

    eventBus.emitNodeEvent('mail_unread_changed', { totalUnread: 5, delta: -2 });

    expect(typeCalls).toHaveLength(1);
    expect(genericCalls).toHaveLength(1);
    expect(typeCalls[0].data.totalUnread).toBe(5);
    expect(typeCalls[0].timestamp).toBeDefined();
    expect(typeof typeCalls[0].timestamp).toBe('string');
  });

  test('emitNodeEvent is a no-op for invalid event types', () => {
    let emitted = false;
    eventBus.on('event', () => { emitted = true; });
    eventBus.emitNodeEvent('not_a_real_event', { foo: 'bar' });
    expect(emitted).toBe(false);
  });

  test('emitNodeEvent accepts empty data and stamps a timestamp', (done) => {
    eventBus.on('now_playing_changed', (evt) => {
      expect(evt.data).toEqual({});
      expect(evt.timestamp).toBeDefined();
      done();
    });
    eventBus.emitNodeEvent('now_playing_changed');
  });
});
