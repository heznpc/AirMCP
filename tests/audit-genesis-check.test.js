/**
 * Regression test for MEDIUM #7 in the 2026-05-13 audit:
 *
 *   "First chained line is unverified against HMAC_GENESIS. The first
 *    chained line is accepted regardless of its `_prev` value because
 *    `chainStarted` is false on entry. An attacker with the HMAC key
 *    could replace the entire file with a new chain that internally
 *    verifies, and the audit would still report verified: true."
 *
 * The fix folds the genesis check into the existing prev-mismatch path:
 * the first chained line in the entire on-disk walk must have
 * `_prev === HMAC_GENESIS`; every subsequent line uses the running prev.
 *
 * This test is split from `audit-tamper-detection.test.js` because it
 * exercises a pristine-file-but-rooted-elsewhere scenario rather than
 * mutating a properly-rooted chain. Keeping the two suites separate
 * makes the failure modes legible when one fires.
 */
import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-genesis-'));
const HMAC_KEY = 'genesis-test-fixture-key';
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = HMAC_KEY;
process.env.AIRMCP_AUDIT_LOG = 'true';

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { _testReset, summarizeAuditEntries } = await import('../dist/shared/audit.js');

const AUDIT_PATH = join(workDir, 'audit.jsonl');
const HMAC_GENESIS = '0'.repeat(64);

/** Reproduce production audit.ts:68 — `HMAC(key, prev || \0 || body)`. */
function signLine(prev, body) {
  return createHmac('sha256', HMAC_KEY)
    .update(prev)
    .update('\0')
    .update(JSON.stringify(body))
    .digest('hex');
}

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
}

async function writeRootedChain(rootedAt) {
  // Build a 3-line chain whose first line claims `_prev = rootedAt`.
  // Each line carries a valid hmac for its body, so per-line tamper
  // detection passes — only the genesis anchor catches the forgery.
  const lines = [];
  let prev = rootedAt;
  for (let i = 0; i < 3; i++) {
    const body = {
      timestamp: `2026-05-13T01:00:0${i}Z`,
      tool: `tool_${i}`,
      args: { i },
      status: 'ok',
    };
    const hmac = signLine(prev, body);
    lines.push(JSON.stringify({ ...body, _prev: prev, _hmac: hmac }));
    prev = hmac;
  }
  await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');
}

describe('audit chain genesis anchor', () => {
  beforeEach(async () => {
    _testReset();
    await wipeDir();
  });

  test('genuine chain rooted at HMAC_GENESIS verifies', async () => {
    await writeRootedChain(HMAC_GENESIS);
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(true);
    expect(summary.verifiedFirstBreak).toBeUndefined();
  });

  test('forged chain rooted at attacker-chosen prev fails verification', async () => {
    // Simulate: attacker has the HMAC key (e.g. read the env var on a
    // compromised host) and replaces the entire file with a chain that
    // verifies internally — but is rooted at `'f'*64` instead of genesis.
    // Pre-fix the verifier returned verified:true because the first
    // line's _prev was not compared to anything.
    await writeRootedChain('f'.repeat(64));
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe('prev_mismatch');
    expect(summary.verifiedFirstBreak.lineIndex).toBe(0);
  });

  test('forged chain rooted at silly value (all zeros padded to wrong length is malformed; arbitrary hex is prev_mismatch)', async () => {
    // Distinct attacker hex (not genesis, not f-filled) — proves the
    // check isn't accidentally allowing one specific non-genesis seed.
    await writeRootedChain('a1b2c3d4'.repeat(8));
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe('prev_mismatch');
    expect(summary.verifiedFirstBreak.lineIndex).toBe(0);
  });
});
