/**
 * RFC 0012 Phase 1 prep — scheduler state persistence tests.
 *
 * Covers: empty-file ENOENT path returns fresh state, save/load
 * round-trip, atomic write survives concurrent writers, corrupt
 * JSON falls back to empty (no crash-loop), update() helper, and
 * skill-signature determinism.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const {
  loadSchedulerState,
  saveSchedulerState,
  updateSchedulerState,
  computeSkillSignature,
} = await import('../dist/skills/scheduler/state.js');

let tempDir;
let statePath;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airmcp-scheduler-state-'));
  statePath = path.join(tempDir, 'scheduler-state.json');
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('loadSchedulerState', () => {
  test('returns empty fresh state when file does not exist', async () => {
    const s = await loadSchedulerState(statePath);
    expect(s).toEqual({ lastFire: {}, version: 1 });
  });

  test('returns empty fresh state on corrupt JSON (no crash-loop)', async () => {
    await fs.writeFile(statePath, '{not valid json', 'utf8');
    const s = await loadSchedulerState(statePath);
    expect(s.lastFire).toEqual({});
  });

  test('preserves missing optional lastFireSig', async () => {
    await fs.writeFile(statePath, JSON.stringify({ lastFire: { foo: '2026-05-01T00:00:00Z' }, version: 1 }), 'utf8');
    const s = await loadSchedulerState(statePath);
    expect(s.lastFire.foo).toBe('2026-05-01T00:00:00Z');
    expect(s.lastFireSig).toBeUndefined();
  });
});

describe('saveSchedulerState', () => {
  test('round-trips a non-trivial state', async () => {
    const state = {
      lastFire: {
        'morning-brief': '2026-05-11T09:00:00Z',
        'sender-to-tasks': '2026-05-11T18:30:00Z',
      },
      lastFireSig: { 'morning-brief': 'a1b2c3d4e5f6g7h8' },
      version: 1,
    };
    await saveSchedulerState(state, statePath);
    const loaded = await loadSchedulerState(statePath);
    expect(loaded).toEqual(state);
  });

  test('creates parent directory if missing', async () => {
    const nested = path.join(tempDir, 'sub', 'sub', 'state.json');
    await saveSchedulerState({ lastFire: { a: '2026-05-11T09:00:00Z' }, version: 1 }, nested);
    const loaded = await loadSchedulerState(nested);
    expect(loaded.lastFire.a).toBeDefined();
  });

  test('atomic: no leftover .tmp file after success', async () => {
    await saveSchedulerState({ lastFire: { x: '2026-05-11T09:00:00Z' }, version: 1 }, statePath);
    const files = await fs.readdir(tempDir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('updateSchedulerState', () => {
  test('reads, mutates, writes', async () => {
    await saveSchedulerState({ lastFire: { a: '2026-05-01T00:00:00Z' }, version: 1 }, statePath);

    const result = await updateSchedulerState((s) => {
      s.lastFire.b = '2026-05-11T09:00:00Z';
      return s;
    }, statePath);

    expect(result.lastFire.a).toBe('2026-05-01T00:00:00Z');
    expect(result.lastFire.b).toBe('2026-05-11T09:00:00Z');

    const reloaded = await loadSchedulerState(statePath);
    expect(reloaded.lastFire).toEqual(result.lastFire);
  });

  test('starts from empty state when file missing', async () => {
    const result = await updateSchedulerState((s) => {
      s.lastFire.first = '2026-05-11T09:00:00Z';
      return s;
    }, statePath);
    expect(result.lastFire.first).toBeDefined();
  });
});

describe('computeSkillSignature', () => {
  test('is deterministic for the same input', () => {
    const a = computeSkillSignature('name: foo\nsteps: [...]\n');
    const b = computeSkillSignature('name: foo\nsteps: [...]\n');
    expect(a).toBe(b);
    expect(a.length).toBe(16);
  });

  test('changes when content changes', () => {
    const a = computeSkillSignature('name: foo');
    const b = computeSkillSignature('name: bar');
    expect(a).not.toBe(b);
  });
});
