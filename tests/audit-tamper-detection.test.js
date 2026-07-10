/**
 * Tamper-detection test — verifies the HMAC chain ACTUALLY catches
 * audit log mutation. The audit team's 2026-05-13 review noted:
 *
 *   "HMAC chain tamper detection 테스트 0건. Audit chain이 그렇게
 *    자랑스러우면 '5 entries → flush → 가운데 line mutate →
 *    audit_summary 호출 → verified:false 단정' 테스트가 있어야 함.
 *    없음."
 *
 * The codebase ships `summarizeAuditEntries()` whose `verified` field
 * is one of the strongest trust signals — but nothing was asserting it
 * fires under real tampering. This test plugs that hole with four
 * mutation shapes:
 *   1. happy path — clean chain reports verified:true
 *   2. body mutation — change one entry's args, _hmac no longer matches
 *      → verified:false, reason:"hmac_mismatch"
 *   3. prev-link mutation — change _prev on the middle line, chain
 *      breaks at the seam → verified:false, reason:"prev_mismatch"
 *   4. _hmac field shape corruption — non-hex value → verified:false,
 *      reason:"malformed"
 *
 * If a future refactor weakens the chain scanner (e.g. silently tolerates
 * mismatches, or only checks the last line), this test fires.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-tamper-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = 'tamper-test-fixture-key';
process.env.AIRMCP_AUDIT_LOG = 'true';

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush, readAuditEntries, summarizeAuditEntries } = await import(
  '../dist/shared/audit.js'
);

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
}

async function seedFiveEntries() {
  _testReset();
  await wipeDir();
  for (let i = 0; i < 5; i++) {
    auditLog({
      timestamp: `2026-05-13T00:00:0${i}Z`,
      tool: `tool_${i}`,
      args: { i },
      status: 'ok',
    });
  }
  await _testFlush();
}

const AUDIT_PATH = join(workDir, 'audit.jsonl');

describe('audit chain tamper detection', () => {
  beforeEach(async () => {
    await seedFiveEntries();
  });

  test('1. clean chain — summary reports verified:true', async () => {
    const summary = await summarizeAuditEntries({
      since: '2020-01-01T00:00:00Z',
    });
    expect(summary.verified).toBe(true);
    expect(summary.verifiedFirstBreak).toBeUndefined();
  });

  test('2. body mutation — tool name changed mid-chain → verified:false, hmac_mismatch', async () => {
    // Read all 5 sealed lines, mutate the middle one's `tool` field, write
    // back. The _hmac is signed over the body — any body byte change
    // invalidates the signature.
    const raw = await readFile(AUDIT_PATH, 'utf-8');
    const lines = raw.trimEnd().split('\n');
    expect(lines).toHaveLength(5);

    const middle = JSON.parse(lines[2]);
    middle.tool = 'tampered_tool'; // mutation under signed envelope
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({
      since: '2020-01-01T00:00:00Z',
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe('hmac_mismatch');
    // Index 2 is the third entry (0-indexed) — the one we mutated.
    expect(summary.verifiedFirstBreak.lineIndex).toBe(2);
  });

  test('3. prev-link mutation — _prev flipped → verified:false, prev_mismatch', async () => {
    const raw = await readFile(AUDIT_PATH, 'utf-8');
    const lines = raw.trimEnd().split('\n');
    const middle = JSON.parse(lines[2]);
    // Recompute the _hmac for the mutated _prev so the body itself
    // verifies — this isolates the prev_mismatch detection path from
    // the body-mismatch path tested above.
    const { createHmac } = await import('node:crypto');
    middle._prev = 'f'.repeat(64);
    const { _hmac: _h, _prev: _p, ...body } = middle;
    middle._hmac = createHmac('sha256', 'tamper-test-fixture-key')
      .update(middle._prev)
      .update('\0')
      .update(JSON.stringify(body))
      .digest('hex');
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({
      since: '2020-01-01T00:00:00Z',
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe('prev_mismatch');
  });

  test('4. malformed _hmac — non-hex value → verified:false, malformed', async () => {
    const raw = await readFile(AUDIT_PATH, 'utf-8');
    const lines = raw.trimEnd().split('\n');
    const middle = JSON.parse(lines[2]);
    middle._hmac = 'not-a-valid-hex-hmac'; // wrong length AND wrong charset
    lines[2] = JSON.stringify(middle);
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({
      since: '2020-01-01T00:00:00Z',
    });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe('malformed');
  });

  test('5. appended unauthorized entry — verified:false', async () => {
    // Attacker who knows about the file but NOT the HMAC key tries to
    // smuggle in a fake "ok" entry. They can craft any JSON, but they
    // can't compute the right _hmac → verifier catches them.
    const raw = await readFile(AUDIT_PATH, 'utf-8');
    const fake = JSON.stringify({
      timestamp: '2026-05-13T00:00:99Z',
      tool: 'attacker_injected',
      status: 'ok',
      _prev: 'f'.repeat(64),
      _hmac: '0'.repeat(64), // bogus signature
    });
    await writeFile(AUDIT_PATH, raw + fake + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({
      since: '2020-01-01T00:00:00Z',
    });
    expect(summary.verified).toBe(false);
  });

  test('6. valid unsigned rows are accepted only as a pre-chain legacy prefix', async () => {
    const raw = await readFile(AUDIT_PATH, 'utf-8');
    const legacy = JSON.stringify({
      timestamp: '2026-05-12T23:59:59Z',
      tool: 'legacy_before_chain',
      status: 'ok',
    });
    await writeFile(AUDIT_PATH, `${legacy}\n${raw}`, 'utf-8');

    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(6);
    expect(summary.topTools.some((row) => row.tool === 'legacy_before_chain')).toBe(true);
  });

  test('7. unsigned insertion after chain start fails closed and is never counted', async () => {
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    lines.splice(
      2,
      0,
      JSON.stringify({
        timestamp: '2026-05-13T00:00:02.500Z',
        tool: 'unsigned_injected',
        status: 'ok',
      }),
    );
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toEqual({
      file: 'audit.jsonl',
      lineIndex: 2,
      reason: 'malformed',
    });
    // Fail closed at the insertion: neither the fake row nor later rows from
    // the compromised ordering contribute to the trusted aggregate.
    expect(summary.total).toBe(2);
    expect(summary.topTools.map((row) => row.tool).sort()).toEqual(['tool_0', 'tool_1']);

    const page = await readAuditEntries({ since: '2020-01-01T00:00:00Z', limit: 100 });
    expect(page.total).toBe(2);
    expect(page.entries.some((entry) => entry.tool === 'unsigned_injected')).toBe(false);
  });

  test('8. malformed insertion after chain start fails closed and is never counted', async () => {
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    lines.splice(2, 0, '{not valid json');
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toEqual({
      file: 'audit.jsonl',
      lineIndex: 2,
      reason: 'malformed',
    });
    expect(summary.total).toBe(2);
    expect(summary.topTools.map((row) => row.tool).sort()).toEqual(['tool_0', 'tool_1']);
  });
});

const CHECKPOINT_PATH = join(workDir, 'audit.checkpoint');

describe('audit chain tail-truncation detection (signed checkpoint)', () => {
  beforeEach(async () => {
    await seedFiveEntries();
  });

  test('flush writes a signed checkpoint and the clean chain verifies', async () => {
    // Seeding flushed 5 sealed lines + a checkpoint anchoring the highest seq.
    const ck = JSON.parse(await readFile(CHECKPOINT_PATH, 'utf-8'));
    expect(ck.seq).toBe(4);
    expect(ck.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(ck.mac).toMatch(/^[0-9a-f]{64}$/);
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(true);
    expect(summary.verifiedFirstBreak).toBeUndefined();
  });

  test('removing the last lines (valid shorter chain) → verified:false, truncated', async () => {
    // Drop the final 2 lines. The remaining chain (seq 0..2) still verifies
    // line-by-line — a plain replay would report verified:true. The checkpoint
    // (seq=4) is what catches the missing tail.
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    await writeFile(AUDIT_PATH, lines.slice(0, 3).join('\n') + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak).toBeDefined();
    expect(summary.verifiedFirstBreak.reason).toBe('truncated');
  });

  test('editing the checkpoint MAC without the key → verified:false, checkpoint_forged', async () => {
    const ck = JSON.parse(await readFile(CHECKPOINT_PATH, 'utf-8'));
    ck.mac = 'a'.repeat(64); // valid hex shape, wrong MAC — forging it needs the key
    await writeFile(CHECKPOINT_PATH, JSON.stringify(ck) + '\n', 'utf-8');

    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(false);
    expect(summary.verifiedFirstBreak.reason).toBe('checkpoint_forged');
  });

  test('a corrupt (unparseable) checkpoint degrades to chain-only (no false alarm)', async () => {
    // A torn/corrupt checkpoint is indistinguishable from a partial write, so
    // it's treated as absent rather than tampering — the moat must not cry
    // wolf. The clean chain still verifies; truncation detection is simply off
    // until the next flush rewrites the checkpoint.
    await writeFile(CHECKPOINT_PATH, '{not valid json', 'utf-8');
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(true);
  });

  test('deleting the checkpoint disables only truncation — clean chain still verifies', async () => {
    await rm(CHECKPOINT_PATH, { force: true });
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    // Back-compat: a missing checkpoint must not turn a clean chain red.
    expect(summary.verified).toBe(true);
  });

  test('truncation with the checkpoint also removed is NOT falsely flagged (documented limit)', async () => {
    // Honest boundary: an attacker who removes BOTH the tail lines AND the
    // checkpoint leaves a valid shorter chain with no anchor. The checkpoint
    // raises the bar against naive log-doctoring; it is not an absolute
    // guarantee against someone who can rewrite the whole directory. We assert
    // the real behaviour rather than over-claiming detection.
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    await writeFile(AUDIT_PATH, lines.slice(0, 3).join('\n') + '\n', 'utf-8');
    await rm(CHECKPOINT_PATH, { force: true });
    const summary = await summarizeAuditEntries({ since: '2020-01-01T00:00:00Z' });
    expect(summary.verified).toBe(true);
  });
});
