import { describe, test, expect, jest } from '@jest/globals';

// Mock child_process
jest.unstable_mockModule('node:child_process', () => ({
  execFile: jest.fn(),
}));

// Mock constants with minimal values for testing
jest.unstable_mockModule('../dist/shared/constants.js', () => ({
  TIMEOUT: { JXA: 30000, KILL_GRACE: 5000 },
  BUFFER: { JXA: 10 * 1024 * 1024 },
  CONCURRENCY: { JXA_SLOTS: 3, JXA_RETRIES: 1, JXA_RETRY_DELAYS: [100], CB_THRESHOLD: 3, CB_OPEN_MS: 60000, CB_CACHE_SIZE: 50 },
}));
jest.unstable_mockModule('../dist/shared/semaphore.js', () => ({
  Semaphore: jest.fn().mockImplementation(() => ({
    acquire: jest.fn(async () => {}),
    release: jest.fn(),
  })),
}));

describe('JXA module', () => {
  test('exports runJxa and runAppleScript', async () => {
    const mod = await import('../dist/shared/jxa.js');
    expect(typeof mod.runJxa).toBe('function');
    expect(typeof mod.runAppleScript).toBe('function');
  });

  test('executes JXA with the fixed system osascript path', async () => {
    const { execFile } = await import('node:child_process');
    execFile.mockClear();
    execFile.mockImplementationOnce((_path, _args, _options, callback) => {
      const child = {
        on: jest.fn(),
        killed: false,
        exitCode: null,
        kill: jest.fn(),
      };
      queueMicrotask(() => callback(null, '{"ok":true}\n'));
      return child;
    });

    const mod = await import('../dist/shared/jxa.js');
    await expect(mod.runJxa('JSON.stringify({ ok: true })')).resolves.toEqual({ ok: true });
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', 'JSON.stringify({ ok: true })'],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      expect.any(Function),
    );
  });
});
