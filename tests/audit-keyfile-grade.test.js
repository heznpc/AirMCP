/**
 * Key-file-backed audit chain — grade and attestation honesty.
 *
 * With NO env key but a valid `<store>/audit-hmac.key` present at module load,
 * the chain must grade `operator-key` (source `keyfile`) and a clean chain
 * must attest `assurance: operator-attested`. This is the init-generated
 * default path — the whole point of the key file is that a fresh `npx airmcp
 * init` install is non-derivable without env plumbing.
 *
 * Env/key state MUST be set before the import: audit.ts resolves the chain
 * key exactly once at module load (a mid-flight key change would break the
 * chain it is writing).
 */
import { describe, test, expect, afterAll } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-keyfile-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
delete process.env.AIRMCP_AUDIT_HMAC_KEY;
process.env.AIRMCP_AUDIT_LOG = 'true';

const KEYFILE_CONTENT = 'a1b2'.repeat(16); // 64 chars, valid
await writeFile(join(workDir, 'audit-hmac.key'), KEYFILE_CONTENT + '\n', { mode: 0o600 });

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush, getAuditKeyGrade, getAuditKeySource } = await import(
  '../dist/shared/audit.js'
);
const { buildTrustAttestation } = await import('../dist/shared/resources.js');

describe('audit chain keyed from the init-generated key file', () => {
  test('grade is operator-key with source keyfile', () => {
    expect(getAuditKeyGrade()).toBe('operator-key');
    expect(getAuditKeySource()).toBe('keyfile');
  });

  test('clean chain attests assurance: operator-attested with keySource keyfile', async () => {
    _testReset();
    for (let i = 0; i < 3; i++) {
      auditLog({ timestamp: `2026-07-21T00:00:0${i}Z`, tool: `tool_${i}`, args: { i }, status: 'ok' });
    }
    await _testFlush();

    const t = await buildTrustAttestation();
    expect(t.audit.verified).toBe(true);
    expect(t.governed).toBe(true);
    expect(t.audit.keyGrade).toBe('operator-key');
    expect(t.audit.keySource).toBe('keyfile');
    expect(t.assurance).toBe('operator-attested');
  });
});
