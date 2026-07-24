/**
 * airmcp://trust — trust-attestation resource.
 *
 * The attestation is the falsifiable proof of the "governed runtime, not an
 * agent" identity claim: a single read composes the tamper-evident audit
 * verdict, HITL level, rate-limit/emergency-stop state, and audit key grade
 * into one `governed` boolean. These tests exercise the flagship path — a
 * clean chain attests `governed:true`, and a single tampered byte on disk
 * flips it to `governed:false` with the break located.
 *
 * Setup mirrors tests/audit-tamper-detection.test.js: point the audit dir at
 * a temp dir via AIRMCP_VECTOR_STORE_DIR and set an operator HMAC key BEFORE
 * importing the audit module (the key grade is captured at module load).
 */
import { describe, test, expect, afterAll, beforeEach } from '@jest/globals';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-trust-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = 'trust-test-fixture-key';
process.env.AIRMCP_AUDIT_LOG = 'true';

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush } = await import('../dist/shared/audit.js');
const { buildTrustAttestation, deriveAssurance } = await import('../dist/shared/resources.js');
const { SERVER_INSTRUCTIONS } = await import('../dist/shared/icons.js');

const AUDIT_PATH = join(workDir, 'audit.jsonl');
const CONFIG = { hitl: { level: 'sensitive-only', whitelist: new Set(['read_note']) } };

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) await rm(join(workDir, f), { force: true }).catch(() => {});
}

async function seedChain() {
  _testReset();
  await wipeDir();
  for (let i = 0; i < 4; i++) {
    auditLog({ timestamp: `2026-07-20T00:00:0${i}Z`, tool: `tool_${i}`, args: { i }, status: 'ok' });
  }
  await _testFlush();
}

describe('airmcp://trust attestation', () => {
  beforeEach(seedChain);

  test('clean chain → governed:true, verified:true, identity mirrors SERVER_INSTRUCTIONS', async () => {
    const t = await buildTrustAttestation(CONFIG);

    expect(t.audit.verified).toBe(true);
    expect(t.audit.firstBreak).toBeNull();
    expect(t.audit.auditDisabled).toBe(false);
    expect(t.governed).toBe(true);

    // Claim and proof live at one URI.
    expect(t.identity).toBe(SERVER_INSTRUCTIONS);

    // Composed governance dimensions are present and shaped.
    expect(t.approval.level).toBe('sensitive-only');
    expect(t.approval.whitelistSize).toBe(1);
    expect(['operator-key', 'host-fallback']).toContain(t.audit.keyGrade);
    expect(typeof t.rateLimit.enabled).toBe('boolean');
    expect(typeof t.rateLimit.emergencyStop).toBe('boolean');
    expect(typeof t.rateLimit.emergencyStopPath).toBe('string');
    expect(typeof t.posture).toBe('string');
    expect(t.posture).toMatch(/audit verified/);
    expect(typeof t.checkedAt).toBe('string');

    // This suite sets an operator HMAC key at module load, so the honest
    // assurance grade must be the strongest tier — distinct from the weaker
    // host-fallback grade that the same `governed:true` boolean would mask.
    expect(t.audit.keyGrade).toBe('operator-key');
    expect(t.assurance).toBe('operator-attested');
  });

  test('tampered chain → governed:false, verified:false, break located', async () => {
    // Flip a byte under the signed envelope of the second sealed line.
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    const mutated = JSON.parse(lines[1]);
    mutated.tool = 'tampered_tool';
    lines[1] = JSON.stringify(mutated);
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const t = await buildTrustAttestation(CONFIG);

    expect(t.audit.verified).toBe(false);
    expect(t.governed).toBe(false);
    expect(t.audit.firstBreak).not.toBeNull();
    expect(t.audit.firstBreak.lineIndex).toBe(1);
    expect(t.posture).toMatch(/TAMPER DETECTED/);
  });

  test('no config → approval defaults to sensitive-only, empty whitelist', async () => {
    const t = await buildTrustAttestation();
    expect(t.approval.level).toBe('sensitive-only');
    expect(t.approval.whitelistSize).toBe(0);
    expect(t.governed).toBe(true);
  });
});

describe('deriveAssurance — honest, key-grade-aware verdict', () => {
  // The whole point of `assurance`: a host-fallback key must NOT read the same
  // as an operator key, even though both leave `governed:true`. A one-line
  // trust readout that keyed on `governed` would over-trust the host key; this
  // pure function is the honest grade such surfaces must read instead.
  test('verified + not halted + operator key → operator-attested (strongest)', () => {
    expect(deriveAssurance(true, false, 'operator-key')).toBe('operator-attested');
  });

  test('verified + not halted + host-fallback key → tamper-evident (honest downgrade, NOT operator-attested)', () => {
    const a = deriveAssurance(true, false, 'host-fallback');
    expect(a).toBe('tamper-evident');
    expect(a).not.toBe('operator-attested');
  });

  test('verified but audit halted → audit-halted regardless of key grade', () => {
    expect(deriveAssurance(true, true, 'operator-key')).toBe('audit-halted');
    expect(deriveAssurance(true, true, 'host-fallback')).toBe('audit-halted');
  });

  test('chain broken → tampered regardless of key grade or halt', () => {
    expect(deriveAssurance(false, false, 'operator-key')).toBe('tampered');
    expect(deriveAssurance(false, true, 'host-fallback')).toBe('tampered');
  });
});
