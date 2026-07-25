/**
 * `npx airmcp verify` — the reference consumer of the assurance honesty
 * contract. The one-line verdict must be the key-grade-aware `assurance`
 * tier (never bare `governed`), and the exit code must make tampering
 * scriptable: 0 verified, 1 tampered.
 *
 * Setup mirrors tests/trust-resource.test.js: temp store dir + operator env
 * key BEFORE imports (key captured at audit module load).
 */
import { describe, test, expect, afterAll, beforeEach, jest } from '@jest/globals';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-verify-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = 'verify-test-fixture-key';
process.env.AIRMCP_AUDIT_LOG = 'true';

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { auditLog, _testReset, _testFlush } = await import('../dist/shared/audit.js');
const { runVerify } = await import('../dist/cli/verify.js');

const AUDIT_PATH = join(workDir, 'audit.jsonl');

async function seedChain() {
  _testReset();
  const files = await readdir(workDir).catch(() => []);
  for (const f of files) {
    if (f !== 'audit-hmac.key') await rm(join(workDir, f), { force: true }).catch(() => {});
  }
  for (let i = 0; i < 3; i++) {
    auditLog({ timestamp: `2026-07-22T00:00:0${i}Z`, tool: `tool_${i}`, args: { i }, status: 'ok' });
  }
  await _testFlush();
}

async function captureVerify() {
  const lines = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.join(' '));
  });
  try {
    const code = await runVerify();
    return { code, out: lines.join('\n') };
  } finally {
    spy.mockRestore();
  }
}

describe('airmcp verify', () => {
  beforeEach(seedChain);

  test('clean chain → exit 0, leads with assurance, never bare governed', async () => {
    const { code, out } = await captureVerify();

    expect(code).toBe(0);
    expect(out).toMatch(/assurance/);
    expect(out).toMatch(/operator-attested/);
    expect(out).toMatch(/verified/);
    // The demoted boolean is labelled as ignoring the key grade, so a reader
    // cannot quote it as the verdict.
    expect(out).toMatch(/governed/);
    expect(out).toMatch(/ignores key grade/);
  });

  test('tampered chain → exit 1, reports tampered with break location', async () => {
    const lines = (await readFile(AUDIT_PATH, 'utf-8')).trimEnd().split('\n');
    const mutated = JSON.parse(lines[1]);
    mutated.tool = 'tampered_tool';
    lines[1] = JSON.stringify(mutated);
    await writeFile(AUDIT_PATH, lines.join('\n') + '\n', 'utf-8');

    const { code, out } = await captureVerify();

    expect(code).toBe(1);
    expect(out).toMatch(/tampered/);
    expect(out).toMatch(/BROKEN/);
  });
});
