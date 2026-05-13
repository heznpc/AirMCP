/**
 * Regression test for the atomic-write fix in `src/semantic/store.ts`.
 *
 * Before the fix, `VectorStore.save()` did `writeFile(STORE_PATH, ...)` in
 * place. A SIGKILL / power loss / OOM-kill mid-write would leave the
 * embedding index as half-written JSON. The next `load()` would silently
 * fall back to `{ version: 1, entries: {} }` — hours of indexing time
 * gone with zero warning to the user.
 *
 * The fix writes to a sibling temp file then renames onto STORE_PATH (a
 * single inode swap on APFS/ext4, atomic by POSIX). If anything fails
 * before rename, the original file is untouched.
 *
 * Strategy: write a non-trivial store (3 entries), then inject a
 * `writeFile` failure on the next save attempt. Assert that:
 *   1. The save() call rejects (caller sees the real error).
 *   2. The on-disk file STILL contains the original 3 entries — proof
 *      that no half-written state landed on STORE_PATH.
 *   3. The temp file is unlinked on failure (no dangling debris).
 *
 * Implementation note: we drive a real on-disk store inside a per-test
 * tmpdir via constants override. Since the file path constants are
 * captured at module load, we set the airmcp data dir env BEFORE
 * importing `../dist/semantic/store.js`. This pattern mirrors what
 * `tests/audit-recovery.test.js` does for AUDIT_PATH.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm, writeFile as realWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const realFs = await import('node:fs/promises');

// Intercept writeFile selectively so individual tests can flip the next
// call to a failure. All other fs ops pass through to the real
// implementation.
let writeFileShouldFail = false;
const writeFileSpy = jest.fn(async (path, data, opts) => {
  if (writeFileShouldFail) {
    writeFileShouldFail = false;
    const err = new Error('Simulated ENOSPC during atomic write');
    err.code = 'ENOSPC';
    throw err;
  }
  return realFs.writeFile(path, data, opts);
});

jest.unstable_mockModule('node:fs/promises', () => ({
  ...realFs,
  writeFile: writeFileSpy,
}));

// Override the data dir so the test never touches ~/.airmcp/vectors.json
// on the developer's machine. AIRMCP_VECTOR_STORE_DIR is read at constants
// module load time, so this MUST be set before the late import of
// `../dist/semantic/store.js` below.
let workDir;
workDir = await mkdtemp(join(tmpdir(), 'airmcp-vec-'));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

// Late import — after the env override and the fs mock are wired.
const { VectorStore } = await import('../dist/semantic/store.js');

describe('VectorStore atomic save', () => {
  test('failed save preserves the previous on-disk file intact', async () => {
    const store = new VectorStore();
    // Seed three entries — the "previous good state".
    await store.upsertEntries([
      { id: 'note:1', source: 'notes', title: 'A', text: 'a', vector: [0.1, 0.2], updatedAt: '2026-01-01' },
      { id: 'note:2', source: 'notes', title: 'B', text: 'b', vector: [0.3, 0.4], updatedAt: '2026-01-02' },
      { id: 'note:3', source: 'notes', title: 'C', text: 'c', vector: [0.5, 0.6], updatedAt: '2026-01-03' },
    ]);

    // Snapshot the disk state before the failure injection.
    const beforePath = join(workDir, 'vectors.json');
    const before = JSON.parse(await readFile(beforePath, 'utf-8'));
    expect(Object.keys(before.entries)).toHaveLength(3);

    // Arm the failure for the NEXT writeFile call (the upcoming upsert's
    // save()). The atomic fix writes to `*.tmp` first, so a writeFile
    // failure should never touch STORE_PATH itself.
    writeFileShouldFail = true;

    await expect(
      store.upsertEntries([
        { id: 'note:4', source: 'notes', title: 'D', text: 'd', vector: [0.7, 0.8], updatedAt: '2026-01-04' },
      ]),
    ).rejects.toThrow(/Simulated ENOSPC/);

    // Critical assertion: the original file is byte-for-byte unchanged.
    // If save() had written in place, this would now be a 0-byte or
    // half-written JSON.
    const after = JSON.parse(await readFile(beforePath, 'utf-8'));
    expect(Object.keys(after.entries).sort()).toEqual(['note:1', 'note:2', 'note:3']);

    // No dangling *.tmp file should remain in the directory — the catch
    // path in save() unlinks the temp before rethrowing. A test failure
    // here means future power-loss scenarios will leak tmp debris.
    const files = await readdir(workDir);
    const dangling = files.filter((f) => f.endsWith('.tmp'));
    expect(dangling).toEqual([]);
  });

  test('happy-path save still updates the file', async () => {
    const store = new VectorStore();
    writeFileShouldFail = false;
    await store.upsertEntries([
      { id: 'note:5', source: 'notes', title: 'E', text: 'e', vector: [0.9, 0.1], updatedAt: '2026-01-05' },
    ]);
    const after = JSON.parse(await readFile(join(workDir, 'vectors.json'), 'utf-8'));
    expect(after.entries['note:5']).toBeDefined();
  });
});
