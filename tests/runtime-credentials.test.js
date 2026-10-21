import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPrivateRuntimeCredential, runtimeHttpToken, runtimeOwnerSecret } from '../dist/shared/runtime-credentials.js';

describe('private app runtime credentials', () => {
  let directory;
  let path;
  const secret = 'a'.repeat(43);
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'airmcp-credential-'));
    path = join(directory, 'secret');
    writeFileSync(path, secret + '\n', { mode: 0o600 });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  test('reads app-generated credentials and prioritizes files over legacy environment values', () => {
    expect(readPrivateRuntimeCredential(path)).toBe(secret);
    expect(runtimeHttpToken({ AIRMCP_APP_RUNTIME_TOKEN_PATH: path, AIRMCP_HTTP_TOKEN: 'legacy' })).toBe(secret);
    expect(runtimeOwnerSecret({ AIRMCP_APP_RUNTIME_OWNER_PATH: path, AIRMCP_APP_RUNTIME_OWNER_SECRET: 'legacy' })).toBe(secret);
  });

  test('preserves standalone CLI environment authentication', () => {
    expect(runtimeHttpToken({ AIRMCP_HTTP_TOKEN: 'legacy' })).toBe('legacy');
    expect(runtimeOwnerSecret({ AIRMCP_APP_RUNTIME_OWNER_SECRET: secret })).toBe(secret);
    expect(runtimeHttpToken({})).toBe('');
    expect(runtimeOwnerSecret({})).toBeUndefined();
  });

  test.each([0o644, 0o640, 0o666])('rejects permissive mode %s', (mode) => {
    chmodSync(path, mode);
    expect(() => readPrivateRuntimeCredential(path)).toThrow(/0600/);
  });

  test('rejects another owner', () => {
    expect(() => readPrivateRuntimeCredential(path, process.getuid() + 1)).toThrow(/current user/);
  });

  test.each(['', 'short', 'x'.repeat(45), '!'.repeat(43)])('rejects malformed credential %j', (value) => {
    writeFileSync(path, value);
    expect(() => readPrivateRuntimeCredential(path)).toThrow();
  });

  test('rejects symlinks and directories', () => {
    const link = join(directory, 'link');
    symlinkSync(path, link);
    expect(() => readPrivateRuntimeCredential(link)).toThrow();
    expect(() => readPrivateRuntimeCredential(directory)).toThrow(/regular/);
  });

  test('rejects a FIFO without waiting for a writer', () => {
    const fifo = join(directory, 'fifo');
    execFileSync('/usr/bin/mkfifo', [fifo]);
    expect(() => readPrivateRuntimeCredential(fifo)).toThrow(/regular/);
  });

  test('fails closed when an explicit credential path is invalid', () => {
    for (const invalid of ['', join(directory, 'missing')]) {
      expect(() => runtimeHttpToken({ AIRMCP_APP_RUNTIME_TOKEN_PATH: invalid, AIRMCP_HTTP_TOKEN: 'fallback' })).toThrow();
      expect(() => runtimeOwnerSecret({ AIRMCP_APP_RUNTIME_OWNER_PATH: invalid, AIRMCP_APP_RUNTIME_OWNER_SECRET: 'fallback' })).toThrow();
    }
  });
});
