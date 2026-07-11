/**
 * Regression test for the audit HMAC-chain rotation cross-process fix.
 *
 * Before the fix, `resumeChainHead()` only read AUDIT_PATH (audit.jsonl).
 * If a process exited inside the window "rotateIfNeeded just renamed
 * audit.jsonl → audit.<ts>.jsonl, but no flush has appended to the new
 * audit.jsonl yet", a restart would land with:
 *   - audit.jsonl missing → readFile catches → `lastHmac` stays at
 *     HMAC_GENESIS
 *   - next flush seals new entries with `_prev = HMAC_GENESIS`
 *   - the audit-chain scanner walks files in lex order; reaches the rotated
 *     file's tail (hmac=X), then reads the new audit.jsonl whose first
 *     line has `_prev = HMAC_GENESIS ≠ X` → reports `verified: false`
 *
 * That single false-positive corrodes the strongest trust signal in
 * the codebase. The writer now replays every log file oldest→newest under
 * its cross-process lock, so the recovered tail naturally comes from the
 * newest rotated file when `audit.jsonl` is absent.
 *
 * Strategy: build a tmpdir-rooted audit directory with one rotated file
 * containing a valid chained entry, NO audit.jsonl, then drive a real flush
 * and assert the new row links to the rotated file's tail.
 *
 * We use `_testReset()` to clear module state between cases.
 */
import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

// AUDIT_DIR / AUDIT_PATH and the HMAC key are read at module load — we
// MUST set the env vars before the dynamic import below, otherwise the
// audit module captures the developer's real ~/.airmcp path and writes
// real audit lines onto their machine.
const workDir = await mkdtemp(join(tmpdir(), 'airmcp-audit-resume-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = 'test-key-for-resume-fixture';
process.env.AIRMCP_AUDIT_LOG = 'true';

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const auditMod = await import('../dist/shared/audit.js');
const { auditLog, _testReset, _testFlush } = auditMod;

// Helper to build a chained line just like the production seal step. Keeps
// this test self-contained — we don't shell out to the production flush
// path because the whole point is to simulate a state that the production
// path doesn't naturally produce within a single test process.
const HMAC_GENESIS = '0'.repeat(64);
function seal(prev, body) {
  const hmac = createHmac('sha256', 'test-key-for-resume-fixture')
    .update(prev)
    .update('\0')
    .update(JSON.stringify(body))
    .digest('hex');
  return { sealed: JSON.stringify({ ...body, _prev: prev, _hmac: hmac }), hmac };
}

describe('audit chain resume across rotation', () => {
  beforeEach(async () => {
    // Wipe the audit dir contents so each test starts clean. We keep the
    // tmpdir itself so AIRMCP_VECTOR_STORE_DIR stays valid.
    const files = await readdir(workDir).catch(() => []);
    for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
    _testReset();
  });

  test('falls back to most-recent rotated file when audit.jsonl is missing', async () => {
    // Simulate the post-rotation pre-flush window:
    //   - audit.123.jsonl exists with two chained entries (hmac chain: X → Y)
    //   - audit.jsonl does NOT exist (just rotated, nothing flushed yet)
    const { sealed: l1, hmac: h1 } = seal(HMAC_GENESIS, {
      timestamp: 'T1', tool: 't1', status: 'ok',
    });
    const { sealed: l2, hmac: h2 } = seal(h1, {
      timestamp: 'T2', tool: 't2', status: 'ok',
    });
    await writeFile(join(workDir, 'audit.1700000000000.jsonl'), `${l1}\n${l2}\n`, 'utf-8');

    // Drive a new entry through the production flush path. After flush,
    // the FIRST line of the new audit.jsonl should have `_prev = h2`
    // (resumed from the rotated file), not HMAC_GENESIS.
    auditLog({ timestamp: 'T3', tool: 't3', status: 'ok' });
    await _testFlush();

    const newFile = await readFile(join(workDir, 'audit.jsonl'), 'utf-8');
    const firstNewLine = JSON.parse(newFile.trimEnd().split('\n')[0]);
    expect(firstNewLine._prev).toBe(h2); // chain continuity preserved
    expect(firstNewLine._prev).not.toBe(HMAC_GENESIS); // not the bug behavior
    expect(firstNewLine.tool).toBe('t3');
  });

  test('falls back through multiple rotated files newest-first', async () => {
    // Two rotated files: ...111 (older, ends at hash A), ...222 (newer,
    // chains from A to B). audit.jsonl missing.
    const { sealed: o1, hmac: a } = seal(HMAC_GENESIS, {
      timestamp: 'O1', tool: 'old', status: 'ok',
    });
    await writeFile(join(workDir, 'audit.1700000000111.jsonl'), `${o1}\n`, 'utf-8');

    const { sealed: n1, hmac: b } = seal(a, {
      timestamp: 'N1', tool: 'newer', status: 'ok',
    });
    await writeFile(join(workDir, 'audit.1700000000222.jsonl'), `${n1}\n`, 'utf-8');

    auditLog({ timestamp: 'NEW', tool: 'fresh', status: 'ok' });
    await _testFlush();

    const newFile = await readFile(join(workDir, 'audit.jsonl'), 'utf-8');
    const firstNewLine = JSON.parse(newFile.trimEnd().split('\n')[0]);
    // Must resume from `b` (newest rotated tail), not from `a` (older).
    // If the fallback walked oldest-first or read all rotated files in
    // the wrong order, this would assert against `a`.
    expect(firstNewLine._prev).toBe(b);
  });

  test('orders historical and collision-safe rotation filenames by embedded timestamp', async () => {
    const { sealed: oldLine, hmac: oldHmac } = seal(HMAC_GENESIS, {
      timestamp: 'O1', tool: 'legacy_rotation_name', status: 'ok',
    });
    const { sealed: newLine, hmac: newHmac } = seal(oldHmac, {
      timestamp: 'N1', tool: 'collision_safe_rotation_name', status: 'ok',
    });
    await writeFile(join(workDir, 'audit.1700000000111.jsonl'), `${oldLine}\n`, 'utf-8');
    await writeFile(
      join(workDir, 'audit.1700000000222.0.11111111-1111-4111-8111-111111111111.jsonl'),
      `${newLine}\n`,
      'utf-8',
    );

    auditLog({ timestamp: 'NEW', tool: 'fresh_after_mixed_names', status: 'ok' });
    await _testFlush();

    const firstNewLine = JSON.parse((await readFile(join(workDir, 'audit.jsonl'), 'utf-8')).trim());
    expect(firstNewLine._prev).toBe(newHmac);
  });

  test('starts from genesis when neither audit.jsonl nor rotated files exist', async () => {
    // Cold-start scenario: brand new install, no audit history at all.
    // Should NOT crash and should NOT mistakenly read /etc/passwd or
    // similar — just start a fresh chain.
    auditLog({ timestamp: 'COLD', tool: 'cold', status: 'ok' });
    await _testFlush();

    const newFile = await readFile(join(workDir, 'audit.jsonl'), 'utf-8');
    const firstNewLine = JSON.parse(newFile.trimEnd().split('\n')[0]);
    expect(firstNewLine._prev).toBe(HMAC_GENESIS);
  });
});
