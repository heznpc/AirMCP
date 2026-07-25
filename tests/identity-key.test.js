/**
 * identity-key.ts — operator audit-key resolution and generation.
 *
 * The resolution order (env > keyfile > host-derived) is the honesty contract
 * behind `assurance`: a generated key file must upgrade the grade without ever
 * clobbering something it did not write, and env must always win so CI/daemon
 * deployments cannot be silently downgraded by a stray file.
 *
 * Setup mirrors the audit suites: point the store dir at a temp dir via
 * AIRMCP_VECTOR_STORE_DIR BEFORE importing (PATHS captures env at load).
 */
import { describe, test, expect, afterAll, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = await mkdtemp(join(tmpdir(), 'airmcp-idkey-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
delete process.env.AIRMCP_AUDIT_HMAC_KEY;

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const { resolveOperatorKeySync, ensureOperatorKeyFile, operatorKeyFilePath, hasExistingAuditChain, AUDIT_KEY_FILENAME } =
  await import('../dist/shared/identity-key.js');

const KEY_PATH = join(workDir, AUDIT_KEY_FILENAME);
const CHAIN_PATH = join(workDir, 'audit.jsonl');

beforeEach(async () => {
  delete process.env.AIRMCP_AUDIT_HMAC_KEY;
  await rm(KEY_PATH, { force: true }).catch(() => {});
  await rm(CHAIN_PATH, { force: true }).catch(() => {});
  await rm(join(workDir, 'audit.checkpoint'), { force: true }).catch(() => {});
});
afterEach(() => {
  delete process.env.AIRMCP_AUDIT_HMAC_KEY;
});

describe('resolveOperatorKeySync — env > keyfile > host-derived', () => {
  test('nothing configured → host-derived with null key', () => {
    expect(resolveOperatorKeySync()).toEqual({ key: null, source: 'host-derived' });
  });

  test('env set → env wins, key passed through verbatim', () => {
    process.env.AIRMCP_AUDIT_HMAC_KEY = 'env-secret';
    expect(resolveOperatorKeySync()).toEqual({ key: 'env-secret', source: 'env' });
  });

  test('valid keyfile → keyfile source, trailing newline trimmed', async () => {
    await writeFile(KEY_PATH, 'k'.repeat(64) + '\n');
    expect(resolveOperatorKeySync()).toEqual({ key: 'k'.repeat(64), source: 'keyfile' });
  });

  test('env wins over an existing keyfile', async () => {
    await writeFile(KEY_PATH, 'k'.repeat(64) + '\n');
    process.env.AIRMCP_AUDIT_HMAC_KEY = 'env-secret';
    expect(resolveOperatorKeySync()).toEqual({ key: 'env-secret', source: 'env' });
  });

  test('too-short keyfile is ignored → host-derived', async () => {
    await writeFile(KEY_PATH, 'short\n');
    expect(resolveOperatorKeySync()).toEqual({ key: null, source: 'host-derived' });
  });
});

describe('ensureOperatorKeyFile — generate once, never clobber', () => {
  test('generates a 64-hex key at 0600 in a 0700 dir', async () => {
    const state = ensureOperatorKeyFile();
    expect(state).toEqual({ source: 'keyfile', path: operatorKeyFilePath(), created: true });

    const content = (await readFile(KEY_PATH, 'utf-8')).trim();
    expect(content).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(KEY_PATH)).mode & 0o777).toBe(0o600);

    // Resolution now reports the generated key.
    expect(resolveOperatorKeySync()).toEqual({ key: content, source: 'keyfile' });
  });

  test('second call is a no-op preserving the existing key', async () => {
    const first = ensureOperatorKeyFile();
    const original = (await readFile(KEY_PATH, 'utf-8')).trim();

    const second = ensureOperatorKeyFile();
    expect(first.created).toBe(true);
    expect(second).toEqual({ source: 'keyfile', path: operatorKeyFilePath(), created: false });
    expect((await readFile(KEY_PATH, 'utf-8')).trim()).toBe(original);
  });

  test('env set → no file written, source env', async () => {
    process.env.AIRMCP_AUDIT_HMAC_KEY = 'env-secret';
    const state = ensureOperatorKeyFile();
    expect(state).toEqual({ source: 'env', path: operatorKeyFilePath(), created: false });
    await expect(readFile(KEY_PATH, 'utf-8')).rejects.toThrow();
  });

  test('existing invalid keyfile is NOT overwritten — reported as host-derived', async () => {
    await writeFile(KEY_PATH, 'short\n');
    const state = ensureOperatorKeyFile();
    expect(state).toEqual({ source: 'host-derived', path: operatorKeyFilePath(), created: false });
    // The file we did not write is untouched.
    expect(await readFile(KEY_PATH, 'utf-8')).toBe('short\n');
  });

  test('refuses to generate over an existing sealed chain (false-tamper guard)', async () => {
    // Rows sealed under the host-derived key would fail whole-chain
    // verification under a new key — generation must refuse, not brick trust.
    await writeFile(CHAIN_PATH, '{"seq":0}\n');
    expect(hasExistingAuditChain()).toBe(true);

    const state = ensureOperatorKeyFile();
    expect(state).toEqual({
      source: 'host-derived',
      path: operatorKeyFilePath(),
      created: false,
      blockedByExistingChain: true,
    });
    // No key was written.
    await expect(readFile(KEY_PATH, 'utf-8')).rejects.toThrow();

    // With the chain archived, generation proceeds.
    await rm(CHAIN_PATH, { force: true });
    expect(ensureOperatorKeyFile().created).toBe(true);
  });
});
