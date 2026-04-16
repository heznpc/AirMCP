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

const { checkSwiftBridge, runSwift, closeSwiftBridge, hasSwiftCommand } =
  await import('../dist/shared/swift.js');

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
      proc.stdout.emit('data', '{"id":"__ready__"}\n');
      await tick();

      // Request is now pending with a 5000ms timer (lines 206-207)
      // Don't resolve it -- wait for the real timeout to fire
      await expect(p).rejects.toThrow(/timed out after/);
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
    ])('rejects %s key', async (_name, poisoned) => {
      const { promise: p } = await ready(proc, 'pp');
      proc.stdout.emit('data', poisoned + '\n');
      await tick();
      proc.stdout.emit('data', '{"id":"pp","result":"clean"}\n');
      expect(await p).toBe('clean');
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
      expect(spy).toHaveBeenCalledWith('[AirMCP Swift] Invalid response:', expect.stringContaining('BAD'));
      spy.mockRestore();
    });

    test('oversized lines dropped', async () => {
      const { promise: p } = await ready(proc, 'sh-o');
      proc.stdout.emit('data', 'x'.repeat(600) + '\n{"id":"sh-o","result":"s"}\n');
      expect(await p).toBe('s');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Dropping oversized'));
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
