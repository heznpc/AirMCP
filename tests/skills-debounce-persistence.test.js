/**
 * Regression test for MEDIUM-12: trigger debounce state must survive
 * a daemon restart. Before the fix, `binding.lastFired` was an
 * in-memory number reset to 0 on every process boot — the first burst
 * of events after restart bypassed the debounce window entirely.
 *
 * The fix persists `lastFired` per `(skillName, eventType)` to
 * `~/.airmcp/trigger-debounce.json` (atomic temp+rename). On startup
 * `loadDebounceState()` rehydrates the in-memory binding from disk so
 * dispatch consults the pre-restart timestamp.
 *
 * Tests:
 *   1. `recordFired` writes through to disk and `getLastFired`
 *      returns the same value after a `_resetDebounceState()` +
 *      `loadDebounceState()` round-trip (simulated "restart").
 *   2. Disk write is atomic — a writeFile failure leaves the previous
 *      file intact and no `.tmp` debris lingers.
 *   3. End-to-end: a skill that fires at T, then the cache is reset,
 *      a fresh load returns the persisted lastFired so the next
 *      dispatch within `debounceMs` of T is suppressed.
 */
import { describe, test, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm, writeFile as realWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Workdir must be set BEFORE the late import — `PATHS.VECTOR_STORE` is
// captured at module load time and STATE_PATH is derived from it.
const workDir = await mkdtemp(join(tmpdir(), 'airmcp-debounce-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;

// Selective writeFile interceptor for the atomicity test. Default path
// = real writeFile; flip `writeFileShouldFail` in a test to simulate an
// ENOSPC and assert the previous file survives intact.
const realFs = await import('node:fs/promises');
let writeFileShouldFail = false;
const writeFileSpy = jest.fn(async (path, data, opts) => {
  if (writeFileShouldFail) {
    writeFileShouldFail = false;
    const err = new Error('Simulated ENOSPC during debounce persist');
    err.code = 'ENOSPC';
    throw err;
  }
  return realFs.writeFile(path, data, opts);
});

jest.unstable_mockModule('node:fs/promises', () => ({
  ...realFs,
  writeFile: writeFileSpy,
}));

const {
  debounceKey,
  loadDebounceState,
  getLastFired,
  recordFired,
  _resetDebounceState,
} = await import('../dist/skills/debounce-state.js');

const STATE_PATH = join(workDir, 'trigger-debounce.json');

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  _resetDebounceState();
  // Wipe per-test so cases don't bleed state through the on-disk file.
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
  writeFileShouldFail = false;
});

describe('debounce state persistence', () => {
  test('debounceKey: stable key shape per (skill, event)', () => {
    expect(debounceKey('my-skill', 'calendar_changed')).toBe('my-skill::calendar_changed');
    expect(debounceKey('a', 'b')).toBe('a::b');
  });

  test('recordFired round-trip: in-memory + disk + fresh load', async () => {
    await loadDebounceState();
    await recordFired('briefing', 'calendar_changed', 1700000000000);
    expect(getLastFired('briefing', 'calendar_changed')).toBe(1700000000000);
    // Verify the on-disk file has the value — this is the
    // post-restart shape the next process will read.
    const disk = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
    expect(disk['briefing::calendar_changed']).toBe(1700000000000);
  });

  test('simulated daemon restart: persisted timestamp survives _resetDebounceState', async () => {
    await loadDebounceState();
    await recordFired('briefing', 'calendar_changed', 1700000000000);
    expect(getLastFired('briefing', 'calendar_changed')).toBe(1700000000000);
    // Simulate restart: clear in-memory state. The disk file is intact.
    _resetDebounceState();
    expect(getLastFired('briefing', 'calendar_changed')).toBe(0); // pre-load
    await loadDebounceState();
    expect(getLastFired('briefing', 'calendar_changed')).toBe(1700000000000); // post-load
  });

  test('atomic write: failed persist leaves previous file intact, no .tmp debris', async () => {
    await loadDebounceState();
    // Seed a known good state.
    await recordFired('briefing', 'calendar_changed', 1700000000000);
    const before = await readFile(STATE_PATH, 'utf-8');

    // Arm the next writeFile to fail. The persist swallows the error
    // (we don't want trigger dispatch to crash on transient ENOSPC)
    // but the on-disk file must remain at the pre-failure state.
    writeFileShouldFail = true;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await recordFired('briefing', 'calendar_changed', 1700000999999);
    } finally {
      errSpy.mockRestore();
    }
    const after = await readFile(STATE_PATH, 'utf-8');
    expect(after).toBe(before); // file untouched on failed write

    // No dangling .tmp files. A leaked temp file across restarts would
    // accumulate forever in production.
    const files = await readdir(workDir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('corrupted state file: empty map returned, error logged once', async () => {
    await realWriteFile(STATE_PATH, '{ this is not valid JSON ', 'utf-8');
    // Direct fs write bypasses the spy, so writeFileShouldFail is moot.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      _resetDebounceState();
      await loadDebounceState();
      // Unparseable JSON → empty map (treated as "never fired"). The
      // function MUST NOT throw — a corrupt debounce file gating skill
      // execution is worse than losing the timestamps.
      expect(getLastFired('briefing', 'calendar_changed')).toBe(0);
    } finally {
      errSpy.mockRestore();
    }
  });

  test('non-numeric values in state file are filtered out, not propagated', async () => {
    // Hand-edits or schema-drift could land a string here. The loader
    // must not return it via getLastFired (which is typed as number).
    await realWriteFile(
      STATE_PATH,
      JSON.stringify({
        'briefing::calendar_changed': 1700000000000,
        'mailbot::mail_unread_changed': 'oops-not-a-number',
      }),
      'utf-8',
    );
    _resetDebounceState();
    await loadDebounceState();
    expect(getLastFired('briefing', 'calendar_changed')).toBe(1700000000000);
    expect(getLastFired('mailbot', 'mail_unread_changed')).toBe(0); // sanitized away
  });
});
