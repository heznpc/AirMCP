import { afterAll, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const scratch = mkdtempSync(join(tmpdir(), 'airmcp-emergency-no-rate-'));
const stopFile = join(scratch, 'emergency-stop');

process.env.NODE_ENV = 'test';
process.env.AIRMCP_RATE_LIMIT = 'false';
process.env.AIRMCP_EMERGENCY_STOP_PATH = stopFile;

const { RATE_LIMIT_ENABLED, checkRateLimit } = await import('../dist/shared/rate-limit.js');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('emergency stop with rate buckets disabled', () => {
  test('still blocks destructive calls while allowing reads', () => {
    expect(RATE_LIMIT_ENABLED).toBe(false);
    writeFileSync(stopFile, 'engaged\n');

    expect(checkRateLimit(false)).toEqual({ allowed: true });
    expect(checkRateLimit(true)).toMatchObject({
      allowed: false,
      gate: 'emergency_stop',
    });
  });
});
