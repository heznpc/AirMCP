/**
 * RFC 0012 Phase 1 prep — HITL queue persistence tests.
 *
 * Covers: append, read with partial-line tolerance (mid-write crash
 * simulation), resolve, expire-pending sweep, rotation when over cap,
 * TTL parsing, pending overflow surfacing.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const {
  appendToQueue,
  readQueue,
  readPending,
  resolveQueueEntry,
  expirePending,
  maybeRotate,
  parseTtl,
  MAX_ENTRIES,
} = await import('../dist/skills/scheduler/queue.js');

let tempDir;
let queuePath;
let archivePath;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airmcp-hitl-queue-'));
  queuePath = path.join(tempDir, 'hitl-queue.jsonl');
  archivePath = path.join(tempDir, 'hitl-queue-archive.jsonl');
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function entry(overrides = {}) {
  return {
    skill: 'morning-brief',
    tool: 'delete_note',
    args: { id: 'note-123' },
    reason: 'morning-brief tried to clean a stale draft note',
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h from now
    correlationId: 'abc-123',
    ...overrides,
  };
}

describe('appendToQueue', () => {
  test('writes a fresh pending entry with generated id + enqueuedAt', async () => {
    const e = await appendToQueue(entry(), queuePath);
    expect(e.id).toMatch(/^[a-f0-9]{16}$/);
    expect(e.status).toBe('pending');
    expect(e.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const all = await readQueue(queuePath);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(e.id);
  });

  test('appends multiple entries (newline-delimited JSONL)', async () => {
    await appendToQueue(entry({ skill: 'a' }), queuePath);
    await appendToQueue(entry({ skill: 'b' }), queuePath);
    await appendToQueue(entry({ skill: 'c' }), queuePath);

    const all = await readQueue(queuePath);
    expect(all.map((e) => e.skill)).toEqual(['a', 'b', 'c']);
  });
});

describe('readQueue', () => {
  test('returns empty array when file does not exist', async () => {
    const all = await readQueue(queuePath);
    expect(all).toEqual([]);
  });

  test('tolerates partial trailing line from mid-write crash', async () => {
    await appendToQueue(entry(), queuePath);
    // Simulate: a second writer crashed mid-line.
    await fs.appendFile(queuePath, '{"id":"abc","skill":"', 'utf8');
    const all = await readQueue(queuePath);
    expect(all).toHaveLength(1); // partial line dropped
    expect(all[0].skill).toBe('morning-brief');
  });

  test('skips blank lines', async () => {
    await appendToQueue(entry(), queuePath);
    await fs.appendFile(queuePath, '\n\n\n', 'utf8');
    await appendToQueue(entry({ skill: 'second' }), queuePath);
    const all = await readQueue(queuePath);
    expect(all).toHaveLength(2);
  });
});

describe('readPending', () => {
  test('filters out non-pending entries', async () => {
    const a = await appendToQueue(entry({ skill: 'a' }), queuePath);
    await appendToQueue(entry({ skill: 'b' }), queuePath);
    await resolveQueueEntry(a.id, 'approved', queuePath);

    const pending = await readPending(queuePath);
    expect(pending).toHaveLength(1);
    expect(pending[0].skill).toBe('b');
  });

  test('filters out expired entries', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await appendToQueue(entry({ skill: 'a', expiresAt: past }), queuePath);
    await appendToQueue(entry({ skill: 'b' }), queuePath); // future expiry

    const pending = await readPending(queuePath);
    expect(pending).toHaveLength(1);
    expect(pending[0].skill).toBe('b');
  });
});

describe('resolveQueueEntry', () => {
  test('marks pending entry approved with resolvedAt', async () => {
    const e = await appendToQueue(entry(), queuePath);
    const resolved = await resolveQueueEntry(e.id, 'approved', queuePath);
    expect(resolved.status).toBe('approved');
    expect(resolved.resolvedAt).toMatch(/^\d{4}-/);

    const all = await readQueue(queuePath);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('approved');
  });

  test('returns null for unknown id', async () => {
    await appendToQueue(entry(), queuePath);
    const resolved = await resolveQueueEntry('nonexistent', 'approved', queuePath);
    expect(resolved).toBeNull();
  });

  test('idempotent — re-resolving an already-resolved entry is a no-op', async () => {
    const e = await appendToQueue(entry(), queuePath);
    await resolveQueueEntry(e.id, 'approved', queuePath);
    const second = await resolveQueueEntry(e.id, 'rejected', queuePath);
    // Already-resolved returns the existing record without flipping status.
    expect(second.status).toBe('approved');
  });
});

describe('expirePending', () => {
  test('flips overdue entries to expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await appendToQueue(entry({ skill: 'old', expiresAt: past }), queuePath);
    await appendToQueue(entry({ skill: 'new', expiresAt: future }), queuePath);

    const flipped = await expirePending(queuePath);
    expect(flipped).toBe(1);

    const all = await readQueue(queuePath);
    expect(all.find((e) => e.skill === 'old').status).toBe('expired');
    expect(all.find((e) => e.skill === 'new').status).toBe('pending');
  });

  test('returns 0 when nothing overdue (no rewrite)', async () => {
    await appendToQueue(entry(), queuePath);
    const beforeStat = await fs.stat(queuePath);
    const flipped = await expirePending(queuePath);
    expect(flipped).toBe(0);
    const afterStat = await fs.stat(queuePath);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });
});

describe('maybeRotate', () => {
  test('no-op when under cap', async () => {
    await appendToQueue(entry(), queuePath);
    const result = await maybeRotate(queuePath, archivePath);
    expect(result).toEqual({ archived: 0, kept: 1, pendingOverflow: 0 });
  });

  test('archives oldest resolved when over cap', async () => {
    const ids = [];
    // Seed slightly above the cap with resolved entries.
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      const e = await appendToQueue(
        entry({ skill: `s-${i}`, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        queuePath,
      );
      ids.push(e.id);
    }
    // Resolve a chunk older than the overflow so they're eligible for archive.
    for (let i = 0; i < 10; i++) {
      await resolveQueueEntry(ids[i], 'approved', queuePath);
    }

    const result = await maybeRotate(queuePath, archivePath);
    expect(result.archived).toBe(5);
    expect(result.kept).toBe(MAX_ENTRIES);
    expect(result.pendingOverflow).toBe(0);

    const archive = await readQueue(archivePath);
    expect(archive).toHaveLength(5);
  }, 30_000); // bigger seed; allow extra time

  test('reports pendingOverflow when too many pending entries to archive', async () => {
    // Hand-write a queue with all-pending entries > MAX_ENTRIES via direct fs
    // to skip the slow appendToQueue loop above.
    const lines = [];
    const future = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < MAX_ENTRIES + 3; i++) {
      lines.push(
        JSON.stringify({
          id: `p-${i}`,
          enqueuedAt: '2026-05-11T00:00:00Z',
          skill: 'pending-only',
          tool: 't',
          args: {},
          reason: 'r',
          expiresAt: future,
          status: 'pending',
        }),
      );
    }
    await fs.writeFile(queuePath, lines.join('\n') + '\n', 'utf8');

    const result = await maybeRotate(queuePath, archivePath);
    expect(result.archived).toBe(0);
    expect(result.pendingOverflow).toBe(3);
  });
});

describe('parseTtl', () => {
  test('minutes', () => {
    expect(parseTtl('30m')).toBe(30 * 60 * 1000);
  });

  test('hours', () => {
    expect(parseTtl('4h')).toBe(4 * 60 * 60 * 1000);
  });

  test('days', () => {
    expect(parseTtl('2d')).toBe(2 * 24 * 60 * 60 * 1000);
  });

  test('rejects malformed', () => {
    expect(() => parseTtl('4 hours')).toThrow();
    expect(() => parseTtl('h4')).toThrow();
    expect(() => parseTtl('4y')).toThrow();
  });
});
