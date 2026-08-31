import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { EventEmitter } from 'node:events';

// ── Helpers ─────────────────────────────────────────────────────────

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.killed = false;
  proc.exitCode = null;
  proc.pid = 12345;
  proc.kill = jest.fn(() => { proc.killed = true; });
  proc.stdout.setEncoding = jest.fn();
  return proc;
}

function tick(ms = 15) {
  return new Promise(r => setTimeout(r, ms));
}

function mute(p) { p.catch(() => {}); return p; }

// ── Mock setup ──────────────────────────────────────────────────────

const mockSpawn = jest.fn();
const mockAccess = jest.fn();
const mockRandomUUID = jest.fn(() => 'default-uuid');

jest.unstable_mockModule('node:child_process', () => ({ spawn: mockSpawn }));
jest.unstable_mockModule('node:fs/promises', () => ({ access: mockAccess }));
jest.unstable_mockModule('node:crypto', () => ({ randomUUID: mockRandomUUID }));
jest.unstable_mockModule('../dist/shared/constants.js', () => ({
  TIMEOUT: { SWIFT: 5000 },
  BUFFER: { SWIFT: 1024, SWIFT_LINE_MAX: 512 },
}));

const TEST_APP_BRIDGE_PATH = '/Applications/AirMCP.app/Contents/Resources/airmcp/bin/AirMcpBridge';
const originalBridgePath = process.env.AIRMCP_BRIDGE_PATH;
process.env.AIRMCP_BRIDGE_PATH = TEST_APP_BRIDGE_PATH;
const {
  checkSwiftBridge,
  runSwift,
  closeSwiftBridge,
  hasSwiftCommand,
  isSwiftObserverRunning,
  resolveSwiftBridgePath,
} = await import('../dist/shared/swift.js');
const { eventBus } = await import('../dist/shared/event-bus.js');
if (originalBridgePath === undefined) delete process.env.AIRMCP_BRIDGE_PATH;
else process.env.AIRMCP_BRIDGE_PATH = originalBridgePath;

// ── Test helpers ────────────────────────────────────────────────────

/** Spawn persistent proc, make it ready. Returns { promise }. */
async function ready(proc, uuid, command = 'cmd', input = '{}') {
  mockRandomUUID.mockReturnValue(uuid);
  const promise = mute(runSwift(command, input));
  await tick();
  proc.stdout.emit('data', '{"id":"__ready__"}\n');
  await tick();
  return { promise };
}

/**
 * Force module into single-shot mode by failing persistent + single-shot.
 * After this, launchFailed=true.
 */
async function enterSingleShotMode() {
  const p1 = createMockProcess();
  const p2 = createMockProcess();
  let n = 0;
  mockSpawn.mockImplementation(() => (++n === 1 ? p1 : p2));
  const p = mute(runSwift('_fail_', '{}'));
  await tick(50);
  p1.emit('close', 1);
  await tick(50);
  p2.emit('close', 1, null);
  await tick(50);
  await p.catch(() => {});
  mockSpawn.mockReset();
}

// ════════════════════════════════════════════════════════════════════

describe('swift bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  // ── Basics ────────────────────────────────────────────────────────

  test('exports all functions', () => {
    expect(typeof checkSwiftBridge).toBe('function');
    expect(typeof runSwift).toBe('function');
    expect(typeof closeSwiftBridge).toBe('function');
    expect(typeof hasSwiftCommand).toBe('function');
    expect(typeof isSwiftObserverRunning).toBe('function');
    expect(typeof resolveSwiftBridgePath).toBe('function');
  });

  test('prefers the app-bundled bridge path from AIRMCP_BRIDGE_PATH', () => {
    expect(resolveSwiftBridgePath({
      AIRMCP_BRIDGE_PATH: '  /Applications/AirMCP.app/Contents/Resources/airmcp/bin/AirMcpBridge  ',
    })).toBe('/Applications/AirMCP.app/Contents/Resources/airmcp/bin/AirMcpBridge');
  });

  test('falls back to the package-local development bridge', () => {
    expect(resolveSwiftBridgePath({})).toMatch(/\/swift\/\.build\/release\/AirMcpBridge$/);
  });

  test('checks the app-provided bridge path captured at module load', async () => {
    await checkSwiftBridge();
    expect(mockAccess).toHaveBeenCalledWith(TEST_APP_BRIDGE_PATH);
  });

  test('checkSwiftBridge caches result', async () => {
    const r1 = await checkSwiftBridge();
    const cnt = mockAccess.mock.calls.length;
    expect(await checkSwiftBridge()).toBe(r1);
    expect(mockAccess.mock.calls.length).toBe(cnt);
  });

  test('hasSwiftCommand returns false when bridge unavailable', async () => {
    if ((await checkSwiftBridge()) !== null) {
      expect(await hasSwiftCommand('x')).toBe(false);
    }
  });

  test('closeSwiftBridge is safe to call repeatedly', () => {
    closeSwiftBridge();
    expect(() => closeSwiftBridge()).not.toThrow();
  });

  test('throws when bridge missing', async () => {
    if ((await checkSwiftBridge()) !== null) {
      await expect(runSwift('cmd', '{}')).rejects.toThrow();
    }
  });

  // ── closeSwiftBridge with active process ──────────────────────────

  test('closeSwiftBridge calls stdin.end and SIGTERM', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'cl-1');
    proc.stdout.emit('data', '{"id":"cl-1","result":"ok"}\n');
    await p;
    closeSwiftBridge();
    expect(proc.stdin.end).toHaveBeenCalled();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('closeSwiftBridge rejects pending', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'cl-2');
    closeSwiftBridge();
    await expect(p).rejects.toThrow('Swift bridge closed');
  });

  test('close during startup does not spawn fallback or accept a stale ready signal', async () => {
    closeSwiftBridge();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const startingProc = createMockProcess();
    const replacementProc = createMockProcess();
    mockSpawn.mockReturnValueOnce(startingProc).mockReturnValueOnce(replacementProc);

    const closingRequest = mute(runSwift('cmd', '{}'));
    await tick();
    closeSwiftBridge();

    await expect(closingRequest).rejects.toThrow('Swift bridge closed');
    expect(startingProc.stdin.end).toHaveBeenCalled();
    expect(startingProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    mockRandomUUID.mockReturnValue('replacement-1');
    const replacement = mute(runSwift('cmd', '{}'));
    await tick();
    replacementProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();

    // The closed startup process must not overwrite the live replacement.
    startingProc.stdout.emit('data', '{"id":"__ready__"}\n');
    replacementProc.stdout.emit('data', '{"id":"replacement-1","result":"ok"}\n');
    await expect(replacement).resolves.toBe('ok');

    mockRandomUUID.mockReturnValue('replacement-2');
    const reused = mute(runSwift('cmd', '{}'));
    await tick();
    replacementProc.stdout.emit('data', '{"id":"replacement-2","result":"reused"}\n');
    await expect(reused).resolves.toBe('reused');
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    clearTimeoutSpy.mockRestore();
  });

  test('late close from an exited generation cannot orphan its replacement launch', async () => {
    closeSwiftBridge();
    const oldProc = createMockProcess();
    const replacementProc = createMockProcess();
    const unexpectedProc = createMockProcess();
    mockSpawn
      .mockReturnValueOnce(oldProc)
      .mockReturnValueOnce(replacementProc)
      .mockReturnValue(unexpectedProc);

    const { promise: initial } = await ready(oldProc, 'generation-1');
    oldProc.stdout.emit('data', '{"id":"generation-1","result":"initial"}\n');
    await expect(initial).resolves.toBe('initial');

    // Node exposes exitCode before all stdio closes. A new request can begin
    // launching the replacement in that exit -> close window.
    oldProc.exitCode = 1;
    mockRandomUUID
      .mockReturnValueOnce('generation-2-a')
      .mockReturnValueOnce('generation-2-b');
    const first = mute(runSwift('cmd', '{}'));
    await tick();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // This close belongs only to oldProc. It must not clear replacementProc's
    // launching promise, reject callback, or readiness timer.
    oldProc.emit('close', 1);
    const second = mute(runSwift('cmd', '{}'));
    await tick();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    replacementProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    replacementProc.stdout.emit(
      'data',
      '{"id":"generation-2-a","result":"first"}\n' +
        '{"id":"generation-2-b","result":"second"}\n',
    );

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(unexpectedProc.stdin.write).not.toHaveBeenCalled();
  });

  test('keeps default commands responsive while an embedding request is pending', async () => {
    closeSwiftBridge();
    const embeddingProc = createMockProcess();
    const defaultProc = createMockProcess();
    mockSpawn.mockReturnValueOnce(embeddingProc).mockReturnValueOnce(defaultProc);

    mockRandomUUID.mockReturnValueOnce('embed-1');
    const embedding = mute(runSwift('embed-batch', '{"texts":["slow"]}'));
    await tick();
    embeddingProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();

    mockRandomUUID.mockReturnValueOnce('speech-1');
    const speech = mute(runSwift('speech-availability', '{}'));
    await tick();
    defaultProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    defaultProc.stdout.emit('data', '{"id":"speech-1","result":{"available":true}}\n');

    await expect(speech).resolves.toEqual({ available: true });
    expect(embeddingProc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"command":"embed-batch"'));
    expect(defaultProc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"command":"speech-availability"'));
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    embeddingProc.stdout.emit('data', '{"id":"embed-1","result":[[0.1]]}\n');
    await expect(embedding).resolves.toEqual([[0.1]]);
  });

  test('keeps native observers alive across default timeout and embedding exit', async () => {
    closeSwiftBridge();
    const observerProc = createMockProcess();
    const defaultProc = createMockProcess();
    const embeddingProc = createMockProcess();
    mockSpawn.mockReturnValueOnce(observerProc).mockReturnValueOnce(defaultProc).mockReturnValueOnce(embeddingProc);

    mockRandomUUID.mockReturnValueOnce('observer-start');
    const observer = mute(runSwift('start-observer', '{}'));
    await tick();
    observerProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    observerProc.stdout.emit('data', '{"id":"observer-start","result":{"status":"observer_started"}}\n');
    await expect(observer).resolves.toEqual({ status: 'observer_started' });

    mockRandomUUID.mockReturnValueOnce('default-timeout');
    const timedOut = mute(runSwift('speech-availability', '{}'));
    await tick();
    defaultProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await expect(timedOut).rejects.toThrow(/timed out after/);
    expect(defaultProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(observerProc.kill).not.toHaveBeenCalled();

    mockRandomUUID.mockReturnValueOnce('embedding-exit');
    const embedding = mute(runSwift('embed-text', '{"text":"hello"}'));
    await tick();
    embeddingProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    embeddingProc.emit('close', 1);
    await expect(embedding).rejects.toThrow('Swift bridge exited with code 1');
    expect(observerProc.kill).not.toHaveBeenCalled();

    const event = new Promise(resolve => eventBus.once('calendar_changed', resolve));
    observerProc.stdout.emit('data', '{"id":"__event__","event":"calendar_changed","data":{"source":"eventkit"}}\n');
    await expect(event).resolves.toMatchObject({ type: 'calendar_changed', data: { source: 'eventkit' } });

    closeSwiftBridge();
  }, 10_000);

  test('closeSwiftBridge closes all persistent lanes', async () => {
    closeSwiftBridge();
    const embeddingProc = createMockProcess();
    const defaultProc = createMockProcess();
    const observerProc = createMockProcess();
    mockSpawn.mockReturnValueOnce(embeddingProc).mockReturnValueOnce(defaultProc).mockReturnValueOnce(observerProc);

    mockRandomUUID.mockReturnValueOnce('embed-close');
    const embedding = mute(runSwift('embed-text', '{"text":"hello"}'));
    await tick();
    embeddingProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    embeddingProc.stdout.emit('data', '{"id":"embed-close","result":[0.1]}\n');
    await embedding;

    mockRandomUUID.mockReturnValueOnce('default-close');
    const command = mute(runSwift('speech-availability', '{}'));
    await tick();
    defaultProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    defaultProc.stdout.emit('data', '{"id":"default-close","result":true}\n');
    await command;

    mockRandomUUID.mockReturnValueOnce('observer-close');
    const observer = mute(runSwift('start-observer', '{}'));
    await tick();
    observerProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    observerProc.stdout.emit('data', '{"id":"observer-close","result":{"status":"observer_started"}}\n');
    await observer;

    closeSwiftBridge();
    for (const proc of [embeddingProc, defaultProc, observerProc]) {
      expect(proc.stdin.end).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    }
  });

  test.each(['close', 'error'])('observer %s clears liveness and a later start launches a replacement', async event => {
    closeSwiftBridge();
    const crashedProc = createMockProcess();
    const replacementProc = createMockProcess();
    mockSpawn.mockReturnValueOnce(crashedProc).mockReturnValueOnce(replacementProc);

    mockRandomUUID.mockReturnValueOnce(`observer-${event}-initial`);
    const initial = mute(runSwift('start-observer', '{}'));
    await tick();
    crashedProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    crashedProc.stdout.emit(
      'data',
      `{"id":"observer-${event}-initial","result":{"status":"observer_started"}}\n`,
    );
    await expect(initial).resolves.toEqual({ status: 'observer_started' });
    expect(isSwiftObserverRunning()).toBe(true);

    if (event === 'error') crashedProc.emit('error', new Error('observer crashed'));
    else crashedProc.emit('close', 1);
    expect(isSwiftObserverRunning()).toBe(false);
    if (event === 'error') {
      expect(crashedProc.stdin.end).toHaveBeenCalled();
      expect(crashedProc.kill).toHaveBeenCalledWith('SIGTERM');
    }

    mockRandomUUID.mockReturnValueOnce(`observer-${event}-replacement`);
    const restarted = mute(runSwift('start-observer', '{}'));
    await tick();
    replacementProc.stdout.emit('data', '{"id":"__ready__"}\n');
    await tick();
    replacementProc.stdout.emit(
      'data',
      `{"id":"observer-${event}-replacement","result":{"status":"observer_started"}}\n`,
    );

    await expect(restarted).resolves.toEqual({ status: 'observer_started' });
    expect(isSwiftObserverRunning()).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    closeSwiftBridge();
  });

  test('observer startup failure never falls back to a single-shot process', async () => {
    closeSwiftBridge();
    const persistentProc = createMockProcess();
    const forbiddenSingleShotProc = createMockProcess();
    mockSpawn.mockReturnValue(forbiddenSingleShotProc).mockReturnValueOnce(persistentProc);

    const initial = mute(runSwift('start-observer', '{}'));
    await tick();
    persistentProc.emit('close', 1);

    await expect(initial).rejects.toThrow(/requires persistent bridge mode/);
    expect(isSwiftObserverRunning()).toBe(false);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const cooldownAttempt = mute(runSwift('stop-observer', '{}'));
    await expect(cooldownAttempt).rejects.toThrow(/requires persistent bridge mode/);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(forbiddenSingleShotProc.stdin.write).not.toHaveBeenCalled();
  });

  // ── Persistent happy path ─────────────────────────────────────────

  describe('persistent happy path', () => {
    let proc;
    beforeEach(() => {
      closeSwiftBridge();
      proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
    });

    test('resolves NDJSON result', async () => {
      const { promise: p } = await ready(proc, 'h-1', 'get-data', '{"k":"v"}');
      proc.stdout.emit('data', '{"id":"h-1","result":{"hello":"world"}}\n');
      expect(await p).toEqual({ hello: 'world' });
    });

    test('partial lines across chunks', async () => {
      const { promise: p } = await ready(proc, 'b-1');
      proc.stdout.emit('data', '{"id":"b-1","res');
      await tick();
      proc.stdout.emit('data', 'ult":"buffered"}\n');
      expect(await p).toBe('buffered');
    });

    test('multiple lines in one chunk', async () => {
      mockRandomUUID.mockReturnValue('m-1');
      const p1 = mute(runSwift('c1', '{}'));
      await tick();
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      mockRandomUUID.mockReturnValue('m-2');
      const p2 = mute(runSwift('c2', '{}'));
      await tick();
      proc.stdout.emit('data', '{"id":"m-1","result":"r1"}\n{"id":"m-2","result":"r2"}\n');
      expect(await p1).toBe('r1');
      expect(await p2).toBe('r2');
    });

    test('skips empty lines', async () => {
      const { promise: p } = await ready(proc, 'e-1');
      proc.stdout.emit('data', '\n\n  \n{"id":"e-1","result":"ok"}\n');
      expect(await p).toBe('ok');
    });

    test('non-string error field treated as no error', async () => {
      const { promise: p } = await ready(proc, 'ne-1');
      proc.stdout.emit('data', '{"id":"ne-1","result":"data","error":42}\n');
      expect(await p).toBe('data');
    });

    test('reuses existing process', async () => {
      mockRandomUUID.mockReturnValue('r-1');
      const p1 = mute(runSwift('c1', '{}'));
      await tick();
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      proc.stdout.emit('data', '{"id":"r-1","result":"a"}\n');
      await p1;
      const cnt = mockSpawn.mock.calls.length;
      mockRandomUUID.mockReturnValue('r-2');
      const p2 = mute(runSwift('c2', '{}'));
      await tick();
      proc.stdout.emit('data', '{"id":"r-2","result":"b"}\n');
      expect(await p2).toBe('b');
      expect(mockSpawn.mock.calls.length).toBe(cnt);
    });

    test('ignores unknown id', async () => {
      const { promise: p } = await ready(proc, 'k-1');
      proc.stdout.emit('data', '{"id":"xxx"}\n{"id":"k-1","result":"found"}\n');
      expect(await p).toBe('found');
    });

    test('stderr logged to console.error', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockRandomUUID.mockReturnValue('se-1');
      const p = mute(runSwift('c', '{}'));
      await tick();
      proc.stderr.emit('data', Buffer.from('warning'));
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      proc.stdout.emit('data', '{"id":"se-1","result":"ok"}\n');
      expect(await p).toBe('ok');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('warning'));
      spy.mockRestore();
    });

    test('concurrent runSwift calls share ensureProcess launch', async () => {
      mockRandomUUID
        .mockReturnValueOnce('cc-1')
        .mockReturnValueOnce('cc-2');
      const p1 = mute(runSwift('c1', '{}'));
      const p2 = mute(runSwift('c2', '{}'));
      await tick();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      proc.stdout.emit('data', '{"id":"cc-1","result":"r1"}\n{"id":"cc-2","result":"r2"}\n');
      expect(await p1).toBe('r1');
      expect(await p2).toBe('r2');
    });

    test('queued request receives a fresh timeout only when it is dispatched', async () => {
      closeSwiftBridge();
      jest.useFakeTimers();
      try {
        const serialProc = createMockProcess();
        mockSpawn.mockReturnValue(serialProc);
        mockRandomUUID
          .mockReturnValueOnce('serial-active')
          .mockReturnValueOnce('serial-queued');

        const active = mute(runSwift('embed-batch', '{}'));
        await jest.advanceTimersByTimeAsync(0);
        serialProc.stdout.emit('data', '{"id":"__ready__"}\n');
        await jest.advanceTimersByTimeAsync(0);

        const queued = mute(runSwift('embed-text', '{}'));
        await jest.advanceTimersByTimeAsync(0);
        expect(serialProc.stdin.write).toHaveBeenCalledTimes(1);
        expect(serialProc.stdin.write).toHaveBeenLastCalledWith(expect.stringContaining('"id":"serial-active"'));

        // Finish the first command just before its 5s timeout. The second
        // command has spent that time queued and must now receive a fresh 5s.
        await jest.advanceTimersByTimeAsync(4_900);
        serialProc.stdout.emit('data', '{"id":"serial-active","result":"done"}\n');
        await expect(active).resolves.toBe('done');
        expect(serialProc.stdin.write).toHaveBeenCalledTimes(2);
        expect(serialProc.stdin.write).toHaveBeenLastCalledWith(expect.stringContaining('"id":"serial-queued"'));

        // This crosses five seconds since enqueue. The old implementation
        // timed out here and killed the otherwise healthy serial process.
        await jest.advanceTimersByTimeAsync(200);
        expect(serialProc.kill).not.toHaveBeenCalled();
        serialProc.stdout.emit('data', '{"id":"serial-queued","result":"survived"}\n');
        await expect(queued).resolves.toBe('survived');
      } finally {
        closeSwiftBridge();
        jest.useRealTimers();
      }
    });

    test('rejectAll clears all pending requests on process close', async () => {
      mockRandomUUID.mockReturnValue('ra-1');
      const p1 = mute(runSwift('c1', '{}'));
      await tick();
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      mockRandomUUID.mockReturnValue('ra-2');
      const p2 = mute(runSwift('c2', '{}'));
      await tick();
      mockRandomUUID.mockReturnValue('ra-3');
      const p3 = mute(runSwift('c3', '{}'));
      await tick();
      proc.emit('close', 1);
      await expect(p1).rejects.toThrow('Swift bridge exited with code');
      await expect(p2).rejects.toThrow('Swift bridge exited with code');
      await expect(p3).rejects.toThrow('Swift bridge exited with code');
    });

    test('response with empty string id is valid but unmatched', async () => {
      const { promise: p } = await ready(proc, 'eid-1');
      proc.stdout.emit('data', '{"id":""}\n{"id":"eid-1","result":"found"}\n');
      expect(await p).toBe('found');
    });

    test('response with no result field resolves undefined', async () => {
      const { promise: p } = await ready(proc, 'nr-1');
      proc.stdout.emit('data', '{"id":"nr-1"}\n');
      expect(await p).toBeUndefined();
    });

    test('response with null result resolves null', async () => {
      const { promise: p } = await ready(proc, 'nl-1');
      proc.stdout.emit('data', '{"id":"nl-1","result":null}\n');
      expect(await p).toBeNull();
    });

    test('boolean false result resolved correctly', async () => {
      const { promise: p } = await ready(proc, 'bool-1');
      proc.stdout.emit('data', '{"id":"bool-1","result":false}\n');
      expect(await p).toBe(false);
    });

    test('per-request timeout fires and rejects', async () => {
      // TIMEOUT.SWIFT is 5000ms in mock constants
      mockRandomUUID.mockReturnValue('to-1');
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      expect(mockSpawn.mock.results[0]?.value).toBe(proc);
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();

      // Request is now pending with a 5000ms timer (lines 206-207)
      // Don't resolve it -- wait for the real timeout to fire
      await expect(p).rejects.toThrow(/timed out after/);
      expect(proc.stdin.end).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      // A timed-out serial process must not poison the lane permanently.
      const retryProc = createMockProcess();
      mockSpawn.mockReturnValue(retryProc);
      mockRandomUUID.mockReturnValue('to-2');
      const retry = mute(runSwift('cmd', '{}'));
      await tick();
      expect(mockSpawn.mock.results[1]?.value).toBe(retryProc);
      retryProc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();
      expect(retryProc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"id":"to-2"'));
      // The timed-out process may report its close after the replacement is
      // ready; that stale lifecycle event must not reject the new request.
      proc.emit('close', 0);
      expect(retryProc.kill).not.toHaveBeenCalled();
      retryProc.stdout.emit('data', '{"id":"to-2","result":"recovered"}\n');
      await expect(retry).resolves.toBe('recovered');
    }, 10_000);
  });

  // ── Prototype pollution ───────────────────────────────────────────

  describe('prototype pollution defense', () => {
    let proc, spy;
    beforeEach(() => {
      closeSwiftBridge();
      proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    test.each([
      ['__proto__', '{"id":"pp","__proto__":{}}'],
      ['constructor', '{"id":"pp","constructor":{}}'],
      ['prototype', '{"id":"pp","prototype":{}}'],
      ['nested __proto__', '{"id":"pp","result":{"a":{"__proto__":{}}}}'],
      ['nested constructor', '{"id":"pp","result":{"a":{"constructor":{}}}}'],
      ['nested prototype', '{"id":"pp","result":{"a":{"prototype":{}}}}'],
    ])('rejects %s key', async (_name, poisoned) => {
      const { promise: p } = await ready(proc, 'pp');
      proc.stdout.emit('data', poisoned + '\n');
      await tick();
      proc.stdout.emit('data', '{"id":"pp","result":"clean"}\n');
      expect(await p).toBe('clean');
      spy.mockRestore();
    });

    test.each(['__proto__', 'constructor', 'prototype'])('allows %s as a normal string value', async value => {
      const { promise: p } = await ready(proc, 'pp-value');
      proc.stdout.emit(
        'data',
        JSON.stringify({ id: 'pp-value', result: { label: value } }) +
          '\n' +
          '{"id":"pp-value","result":"fallback"}\n',
      );
      await expect(p).resolves.toEqual({ label: value });
      spy.mockRestore();
    });
  });

  // ── Invalid shapes ────────────────────────────────────────────────

  describe('invalid response shapes', () => {
    let proc, spy;
    beforeEach(() => {
      closeSwiftBridge();
      proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    test.each([
      ['array', '[1,2]'],
      ['non-string id', '{"id":1}'],
      ['null', 'null'],
      ['string', '"s"'],
      ['number', '42'],
    ])('rejects %s', async (_name, bad) => {
      const { promise: p } = await ready(proc, 'sh');
      proc.stdout.emit('data', bad + '\n{"id":"sh","result":"ok"}\n');
      expect(await p).toBe('ok');
      spy.mockRestore();
    });

    test('invalid JSON logged', async () => {
      const { promise: p } = await ready(proc, 'sh-j');
      proc.stdout.emit('data', 'BAD\n{"id":"sh-j","result":"ok"}\n');
      expect(await p).toBe('ok');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('invalid response'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('BAD'));
      spy.mockRestore();
    });

    test('oversized lines dropped', async () => {
      const { promise: p } = await ready(proc, 'sh-o');
      proc.stdout.emit('data', 'x'.repeat(600) + '\n{"id":"sh-o","result":"s"}\n');
      expect(await p).toBe('s');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('dropping oversized'));
      spy.mockRestore();
    });
  });

  // ── Persistent error paths ────────────────────────────────────────

  test('error response rejects with error message', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'er-1', 'bad');
    proc.stdout.emit('data', '{"id":"er-1","error":"cmd failed"}\n');
    await expect(p).rejects.toThrow('cmd failed');
  });

  test('process close after ready rejects pending', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'lc-1');
    proc.exitCode = 1;
    proc.emit('close', 1);
    await expect(p).rejects.toThrow('Swift bridge exited with code');
  });

  test('process error after ready rejects pending', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'lc-2');
    proc.emit('error', new Error('SIGKILL'));
    await expect(p).rejects.toThrow('Swift bridge error:');
  });

  test('buffer overflow kills with SIGKILL', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: p } = await ready(proc, 'lc-3');
    proc.stdout.emit('data', 'x'.repeat(2000));
    await expect(p).rejects.toThrow('buffer exceeded');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('stdin.write failure rejects and sets launchFailed', async () => {
    closeSwiftBridge();
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const { promise: setup } = await ready(proc, 'lc-s');
    proc.stdout.emit('data', '{"id":"lc-s","result":"ok"}\n');
    await setup;
    proc.stdin.write.mockImplementation(() => { throw new Error('EPIPE'); });
    mockRandomUUID.mockReturnValue('lc-4');
    await expect(runSwift('cmd', '{}')).rejects.toThrow('Failed to write to Swift bridge');
  });

  // This test MUST run while launchFailed=false. stdin.write failure above
  // does set launchFailed=true, but it also does a successful ready() first
  // which resets launchRetryCount=0 via ensureProcess success. However,
  // the EPIPE catch block sets launchFailed=true. So we need a successful
  // persistent launch to reset launchFailed. We achieve this by the fact
  // that closeSwiftBridge() + ready() at the start of the test creates
  // a new ensureProcess... BUT launchFailed is already true.
  //
  // Actually: stdin.write failure sets launchFailed=true and child=null.
  // closeSwiftBridge doesn't reset launchFailed. So we need a workaround.
  // We exploit the cooldown: launchRetryCount is still < LAUNCH_MAX_RETRIES
  // after stdin.write failure (it's 0), and cooldown is 30s. So the module
  // stays in single-shot mode. We use Date.now hack to expire cooldown,
  // forcing a retry of persistent mode.
  test('error before ready triggers fallback to single-shot', async () => {
    closeSwiftBridge();

    // Expire the launch cooldown so the module retries persistent mode
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 31_000;

    try {
      const persistProc = createMockProcess();
      const ssProc = createMockProcess();
      let n = 0;
      mockSpawn.mockImplementation(() => (++n === 1 ? persistProc : ssProc));
      const p = mute(runSwift('cmd', '{}'));
      await tick(50);
      // Error before __ready__ (exercises lines 130-138)
      persistProc.emit('error', new Error('spawn ENOENT'));
      await tick(100);
      // Single-shot fallback succeeds
      ssProc.stdout.emit('data', Buffer.from('"after-error"'));
      ssProc.emit('close', 0, null);
      await tick(50);
      expect(await p).toBe('after-error');
    } finally {
      Date.now = realDateNow;
    }
  });

  // ── Startup failures ─────────────────────────────────────────────

  describe('startup failures', () => {
    test('close before ready triggers fallback to single-shot (via enterSingleShotMode)', async () => {
      closeSwiftBridge();
      await enterSingleShotMode();

      // Now launchFailed=true; next call goes directly to single-shot
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('"ok"'));
      ss.emit('close', 0, null);
      expect(await p).toBe('ok');
    });

    test('after startup close, next call goes to single-shot directly', async () => {
      closeSwiftBridge();
      await enterSingleShotMode();

      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('{"val":"ok"}'));
      ss.emit('close', 0, null);
      expect(await p).toEqual({ val: 'ok' });
    });
  });

  // Per-request timeout is tested inside 'persistent happy path' describe
  // block where the module is guaranteed to be in persistent mode.

  // ── Launch retry logic ───────────────────────────────────────────

  describe('launch retry logic', () => {
    test('max retries exceeded goes directly to single-shot', async () => {
      closeSwiftBridge();
      for (let i = 0; i < 5; i++) await enterSingleShotMode();

      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('"max-retry"'));
      ss.emit('close', 0, null);
      expect(await p).toBe('max-retry');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    test('cooldown not expired goes to single-shot', async () => {
      closeSwiftBridge();
      await enterSingleShotMode();

      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('"cooldown-ok"'));
      ss.emit('close', 0, null);
      expect(await p).toBe('cooldown-ok');
    });

    test('cooldown expired retries persistent mode successfully', async () => {
      closeSwiftBridge();
      // enterSingleShotMode in this context may go straight to single-shot
      // since launchFailed is already true from prior tests
      await enterSingleShotMode();

      const realDateNow = Date.now;
      // Use a large offset to guarantee cooldown is expired regardless
      // of what launchFailedAt was set to by prior tests
      Date.now = () => realDateNow() + 120_000;

      try {
        // Cooldown expired -> module retries persistent mode
        const retryProc = createMockProcess();
        mockSpawn.mockReturnValue(retryProc);
        mockRandomUUID.mockReturnValue('retry-1');
        const p2 = mute(runSwift('cmd', '{}'));
        await tick(100);
        // Make persistent process ready
        retryProc.stdout.emit('data', '{"id":"__ready__"}\n');
        await tick(100);
        // Respond to the request
        retryProc.stdout.emit('data', '{"id":"retry-1","result":"persistent-again"}\n');
        await tick(50);
        expect(await p2).toBe('persistent-again');
      } finally {
        Date.now = realDateNow;
      }
    }, 10_000);
  });

  // ── hasSwiftCommand ──────────────────────────────────────────────

  describe('hasSwiftCommand', () => {
    test('loads commands and returns true for known command', async () => {
      closeSwiftBridge();
      await enterSingleShotMode();

      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);

      const commandPromise = hasSwiftCommand('test-cmd');
      await tick(50);
      ss.stdout.emit('data', Buffer.from('["test-cmd","other-cmd"]'));
      ss.emit('close', 0, null);
      await tick(50);

      expect(await commandPromise).toBe(true);
    });

    test('returns false for unknown command (cached)', async () => {
      expect(await hasSwiftCommand('nonexistent-cmd')).toBe(false);
    });

    test('caches commands - no spawn on second call', async () => {
      const spawnCountBefore = mockSpawn.mock.calls.length;
      expect(await hasSwiftCommand('test-cmd')).toBe(true);
      expect(mockSpawn.mock.calls.length).toBe(spawnCountBefore);
    });
  });

  // ── Single-shot fallback ──────────────────────────────────────────

  describe('single-shot', () => {
    beforeEach(async () => {
      closeSwiftBridge();
      await enterSingleShotMode();
    });

    test('valid JSON', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{"q":"t"}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('{"s":"ok","v":42}'));
      ss.emit('close', 0, null);
      expect(await p).toEqual({ s: 'ok', v: 42 });
    });

    test.each(['__proto__', 'constructor', 'prototype'])('allows %s as a normal string value', async value => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from(JSON.stringify({ label: value })));
      ss.emit('close', 0, null);
      await expect(p).resolves.toEqual({ label: value });
    });

    test('stdin write + end', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{"i":"d"}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('"ok"'));
      ss.emit('close', 0, null);
      await p;
      expect(ss.stdin.write).toHaveBeenCalledWith('{"i":"d"}');
      expect(ss.stdin.end).toHaveBeenCalled();
    });

    test('non-zero exit with stderr', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stderr.emit('data', Buffer.from('fail'));
      ss.emit('close', 1, null);
      await expect(p).rejects.toThrow('exited with code 1: fail');
    });

    test('non-zero exit with stdout only', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('out'));
      ss.emit('close', 2, null);
      await expect(p).rejects.toThrow('out');
    });

    test('empty output', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.emit('close', 0, null);
      await expect(p).rejects.toThrow('empty output');
    });

    test('invalid JSON', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('BAD'));
      ss.emit('close', 0, null);
      await expect(p).rejects.toThrow('invalid JSON');
    });

    test.each([
      ['__proto__', '{"__proto__":{}}'],
      ['constructor', '{"constructor":{}}'],
      ['prototype', '{"prototype":{}}'],
      ['nested __proto__', '{"a":{"__proto__":{}}}'],
      ['nested constructor', '{"a":{"constructor":{}}}'],
      ['nested prototype', '{"a":{"prototype":{}}}'],
    ])('%s poisoned payload rejected', async (_label, payload) => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from(payload));
      ss.emit('close', 0, null);
      await expect(p).rejects.toThrow('suspicious payload');
    });

    test('SIGTERM signal means timeout', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.emit('close', null, 'SIGTERM');
      await expect(p).rejects.toThrow('timed out');
    });

    test('spawn error propagated', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.emit('error', new Error('EACCES'));
      await expect(p).rejects.toThrow('EACCES');
    });

    test('buffer overflow kills with SIGTERM', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.alloc(2000));
      await expect(p).rejects.toThrow('output exceeded');
      expect(ss.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('stdout accumulation across chunks', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('{"p'));
      ss.stdout.emit('data', Buffer.from('":"d"}'));
      ss.emit('close', 0, null);
      expect(await p).toEqual({ p: 'd' });
    });

    test('stderr collection across chunks', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stderr.emit('data', Buffer.from('e1'));
      ss.stderr.emit('data', Buffer.from('e2'));
      ss.emit('close', 1, null);
      await expect(p).rejects.toThrow('e1e2');
    });

    test('whitespace-only output treated as empty', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stdout.emit('data', Buffer.from('   \n  \t '));
      ss.emit('close', 0, null);
      await expect(p).rejects.toThrow('empty output');
    });

    test('exit code 0 with no stdout returns empty error', async () => {
      const ss = createMockProcess();
      mockSpawn.mockReturnValueOnce(ss);
      const p = mute(runSwift('cmd', '{}'));
      await tick();
      ss.stderr.emit('data', Buffer.from('some warning'));
      ss.emit('close', 0, null);
      await expect(p).rejects.toThrow('empty output');
    });
  });

  // ── Launch retry integration ──────────────────────────────────────

  test('single-shot after persistent failure', async () => {
    closeSwiftBridge();
    await enterSingleShotMode();
    const ss = createMockProcess();
    mockSpawn.mockReturnValueOnce(ss);
    const p = mute(runSwift('cmd', '{}'));
    await tick();
    ss.stdout.emit('data', Buffer.from('"ok"'));
    ss.emit('close', 0, null);
    expect(await p).toBe('ok');
  });

  test('many failures still works via single-shot', async () => {
    closeSwiftBridge();
    for (let i = 0; i < 5; i++) await enterSingleShotMode();
    const ss = createMockProcess();
    mockSpawn.mockReturnValueOnce(ss);
    const p = mute(runSwift('cmd', '{}'));
    await tick();
    ss.stdout.emit('data', Buffer.from('"ok"'));
    ss.emit('close', 0, null);
    expect(await p).toBe('ok');
  });
});
