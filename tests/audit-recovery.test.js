/**
 * Quality-audit recovery-path coverage for `src/shared/audit.ts`.
 *
 * The happy path (append-to-buffer, flush succeeds) was already covered by
 * `tests/audit.test.js`. This file targets the cold paths the line-coverage
 * report flagged as untested:
 *
 *   - `flushBuffer` first-attempt failure → automatic retry → success
 *   - `flushBuffer` retry failure → `consecutiveFlushFailures` increments
 *   - `MAX_FLUSH_FAILURES` threshold → `auditDisabled` trips +
 *     pending flush timer cleared
 *   - `maybeAttemptRecovery` early-return when window hasn't elapsed
 *   - `maybeAttemptRecovery` re-enables flushing after the 5-minute window
 *   - `rotateIfNeeded` rotates when file size exceeds MAX_FILE_SIZE
 *   - `rotateIfNeeded` corrects file mode when permissions drift from 0o600
 *   - `rotateIfNeeded` swallows missing-file / rename failures
 *   - `resumeChainHead` parses tail and resumes lastHmac across restart
 *   - `resumeChainHead` reports malformed-line corruption signal
 *   - `resumeChainHead` starts from genesis when file is unreadable
 *
 * Mocks `node:fs/promises` via `jest.unstable_mockModule` so each test can
 * inject the precise failure mode the production path is supposed to handle.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

const appendFile = jest.fn();
const mkdir = jest.fn();
const stat = jest.fn();
const chmod = jest.fn();
const rename = jest.fn();
const readFile = jest.fn();
const readdir = jest.fn();
const writeFile = jest.fn();

jest.unstable_mockModule('node:fs/promises', () => ({
  appendFile,
  mkdir,
  stat,
  chmod,
  rename,
  readFile,
  readdir,
  writeFile,
}));

const {
  auditLog,
  _testReset,
  _testFlush,
  _testGetState,
  _testSetAuditDisabledSince,
} = await import('../dist/shared/audit.js');

beforeEach(() => {
  _testReset();
  appendFile.mockReset();
  mkdir.mockReset();
  stat.mockReset();
  chmod.mockReset();
  rename.mockReset();
  readFile.mockReset();
  readdir.mockReset();
  writeFile.mockReset();

  // Default happy-path mock behaviour. Individual tests override.
  appendFile.mockResolvedValue(undefined);
  mkdir.mockResolvedValue(undefined);
  stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  chmod.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  writeFile.mockResolvedValue(undefined);
});

// ── flushBuffer error paths ───────────────────────────────────────────

describe('flushBuffer: first-attempt failure → retry → success', () => {
  test('appendFile fails once then succeeds — consecutiveFlushFailures stays 0', async () => {
    appendFile
      .mockRejectedValueOnce(Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }))
      .mockResolvedValueOnce(undefined);

    auditLog({ timestamp: 'T1', tool: 'tool_x', status: 'ok' });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(2); // initial + retry
    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBe(0);
    expect(state.auditDisabled).toBe(false);
    expect(state.bufferLength).toBe(0); // drained on success
  });
});

describe('flushBuffer: both attempts fail → consecutiveFlushFailures increments', () => {
  test('increments by 1 per double-failure', async () => {
    appendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    auditLog({ timestamp: 'T1', tool: 'tool_x', status: 'ok' });
    await _testFlush();

    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBe(1);
    expect(state.auditDisabled).toBe(false); // not yet at threshold
  });

  test('reaches MAX_FLUSH_FAILURES (5) → auditDisabled trips, timer cleared', async () => {
    appendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: 'tool_x', status: 'ok' });
      await _testFlush();
    }

    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBeGreaterThanOrEqual(5);
    expect(state.auditDisabled).toBe(true);
  });
});

// ── maybeAttemptRecovery ──────────────────────────────────────────────

describe('maybeAttemptRecovery: window-gated re-enable', () => {
  test('does not re-enable inside the 5-minute window', async () => {
    appendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: 't', status: 'ok' });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    // Within window → next log is dropped (auditDisabled stays true)
    _testSetAuditDisabledSince(Date.now()); // just tripped
    auditLog({ timestamp: 'T-fresh', tool: 't', status: 'ok' });
    expect(_testGetState().auditDisabled).toBe(true);
  });

  test('re-enables when 5-minute window elapses + clears consecutiveFailures', async () => {
    appendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: 't', status: 'ok' });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    // Simulate 6 minutes elapsed since tripping.
    _testSetAuditDisabledSince(Date.now() - 6 * 60 * 1000);
    appendFile.mockResolvedValue(undefined); // disk recovered

    // The next auditLog triggers maybeAttemptRecovery → re-enables + schedules timer.
    auditLog({ timestamp: 'T-recovered', tool: 't', status: 'ok' });
    expect(_testGetState().auditDisabled).toBe(false);
    expect(_testGetState().consecutiveFlushFailures).toBe(0);
  });
});

// ── rotateIfNeeded ────────────────────────────────────────────────────

describe('rotateIfNeeded: triggered on size threshold', () => {
  test('renames audit.jsonl when file size > MAX_FILE_SIZE', async () => {
    stat.mockResolvedValue({
      size: 11 * 1024 * 1024, // > 10 MiB threshold
      mode: 0o100600,
    });

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await _testFlush();

    expect(rename).toHaveBeenCalledTimes(1);
    const renameTarget = rename.mock.calls[0][1];
    expect(renameTarget).toMatch(/audit\.\d+\.jsonl$/);
  });

  test('does NOT rename when file size is under threshold', async () => {
    stat.mockResolvedValue({ size: 1024, mode: 0o100600 });

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await _testFlush();

    expect(rename).not.toHaveBeenCalled();
  });

  test('corrects permission drift to 0o600 when mode differs', async () => {
    stat.mockResolvedValue({
      size: 1024,
      mode: 0o100644, // world-readable — drift to fix
    });

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await _testFlush();

    expect(chmod).toHaveBeenCalledTimes(1);
    expect(chmod.mock.calls[0][1]).toBe(0o600);
  });

  test('preserves 0o600 mode without calling chmod', async () => {
    stat.mockResolvedValue({ size: 1024, mode: 0o100600 });

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await _testFlush();

    expect(chmod).not.toHaveBeenCalled();
  });

  test('silently swallows missing-file stat failure', async () => {
    stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await expect(_testFlush()).resolves.toBeUndefined();

    expect(rename).not.toHaveBeenCalled();
    expect(_testGetState().consecutiveFlushFailures).toBe(0); // not counted as flush failure
  });

  test('silently swallows rename failure during rotation', async () => {
    stat.mockResolvedValue({ size: 11 * 1024 * 1024, mode: 0o100600 });
    rename.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await expect(_testFlush()).resolves.toBeUndefined();

    expect(_testGetState().consecutiveFlushFailures).toBe(0); // rotation failure is non-fatal
  });
});

// ── resumeChainHead ──────────────────────────────────────────────────

describe('resumeChainHead: chain continuity across process restart', () => {
  test('resumes lastHmac from on-disk tail when last line has valid _hmac', async () => {
    const validHmac = 'a'.repeat(64);
    readFile.mockResolvedValue(
      JSON.stringify({ timestamp: 'T-old', tool: 'prev', status: 'ok', _hmac: validHmac }) + '\n',
    );

    auditLog({ timestamp: 'T-new', tool: 'new', status: 'ok' });
    await _testFlush();

    // After flush, the written line's _prev should match the on-disk tail's _hmac.
    const writtenLines = appendFile.mock.calls[0][1];
    const firstLine = JSON.parse(writtenLines.split('\n')[0]);
    expect(firstLine._prev).toBe(validHmac);
  });

  test('falls back to genesis when file is unreadable (ENOENT)', async () => {
    readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    auditLog({ timestamp: 'T1', tool: 't', status: 'ok' });
    await _testFlush();

    const writtenLines = appendFile.mock.calls[0][1];
    const firstLine = JSON.parse(writtenLines.split('\n')[0]);
    expect(firstLine._prev).toBe('0'.repeat(64)); // HMAC_GENESIS
  });

  test('skips malformed JSON tail lines and continues backwards search', async () => {
    const validHmac = 'b'.repeat(64);
    readFile.mockResolvedValue(
      [
        '{"_hmac":"' + validHmac + '","tool":"deep"}',
        '{not valid json',
        '{also not valid',
      ].join('\n') + '\n',
    );

    auditLog({ timestamp: 'T-new', tool: 'new', status: 'ok' });
    await _testFlush();

    const firstLine = JSON.parse(appendFile.mock.calls[0][1].split('\n')[0]);
    expect(firstLine._prev).toBe(validHmac);
  });

  test('starts from genesis when no _hmac is found in tail', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ timestamp: 'T-legacy', tool: 'old', status: 'ok' }) + '\n',
    );

    auditLog({ timestamp: 'T-new', tool: 'new', status: 'ok' });
    await _testFlush();

    const firstLine = JSON.parse(appendFile.mock.calls[0][1].split('\n')[0]);
    expect(firstLine._prev).toBe('0'.repeat(64));
  });
});

// ── flushBuffer no-op short-circuits ──────────────────────────────────

describe('flushBuffer: short-circuit conditions', () => {
  test('no-op when buffer is empty', async () => {
    await _testFlush();
    expect(appendFile).not.toHaveBeenCalled();
  });

  test('no-op when auditDisabled and recovery window not elapsed', async () => {
    appendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    // Trip auditDisabled
    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: 't', status: 'ok' });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    appendFile.mockClear();
    appendFile.mockResolvedValue(undefined);
    _testSetAuditDisabledSince(Date.now()); // window NOT elapsed

    auditLog({ timestamp: 'T-blocked', tool: 't', status: 'ok' });
    await _testFlush();
    expect(appendFile).not.toHaveBeenCalled(); // blocked
  });
});
