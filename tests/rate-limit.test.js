/**
 * Rate limit + emergency-stop unit tests.
 *
 * These exercise the bucket math and kill-switch probe directly; the
 * tool-registry integration (throwing on denial, auditing the denial)
 * is covered separately in tool-registry.test.js.
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a tmp emergency-stop path so tests don't collide with a real user file.
const SCRATCH = mkdtempSync(join(tmpdir(), 'airmcp-rl-'));
const STOP_FILE = join(SCRATCH, 'emergency-stop');
process.env.AIRMCP_EMERGENCY_STOP_PATH = STOP_FILE;
process.env.AIRMCP_MAX_TOOL_CALLS_PER_MINUTE = '3';
process.env.AIRMCP_MAX_DESTRUCTIVE_PER_HOUR = '2';
// Ensure the rate limiter is enabled for these tests (default, but be
// explicit so env-inheritance from a dev shell doesn't silently skip).
delete process.env.AIRMCP_RATE_LIMIT;
process.env.NODE_ENV = 'test';

const {
  checkRateLimit,
  isEmergencyStopActive,
  getRateLimitStatus,
  _resetRateLimitForTests,
} = await import('../dist/shared/rate-limit.js');

beforeEach(() => {
  // Re-create the scratch dir in case a prior `afterEach` wiped it,
  // then clear any stop-file from a previous test.
  mkdirSync(SCRATCH, { recursive: true });
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
  _resetRateLimitForTests();
});

afterEach(() => {
  if (existsSync(STOP_FILE)) {
    try {
      unlinkSync(STOP_FILE);
    } catch {
      // best-effort
    }
  }
});

describe('checkRateLimit — global bucket', () => {
  test('allows up to the capacity, then denies', () => {
    // Capacity = 3 (from env)
    expect(checkRateLimit(false).allowed).toBe(true);
    expect(checkRateLimit(false).allowed).toBe(true);
    expect(checkRateLimit(false).allowed).toBe(true);
    const denied = checkRateLimit(false);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/Global tool-call budget/);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('checkRateLimit — destructive bucket', () => {
  test('destructive calls consume both buckets; global denial reports global first', () => {
    // Capacity: global=3, destructive=2. First 2 destructive succeed
    // (take 1 from each bucket), 3rd destructive has 1 global + 0
    // destructive → destructive budget exhausted denial.
    expect(checkRateLimit(true).allowed).toBe(true);
    expect(checkRateLimit(true).allowed).toBe(true);
    const denied = checkRateLimit(true);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/Destructive-call budget/);
  });

  test('non-destructive calls do NOT consume the destructive bucket', () => {
    // After 3 non-destructive calls, global is empty but destructive is full (2).
    checkRateLimit(false);
    checkRateLimit(false);
    checkRateLimit(false);
    // Next non-destructive hits global
    expect(checkRateLimit(false).allowed).toBe(false);
    // And a destructive call hits global too (pre-check sees empty global)
    const denied = checkRateLimit(true);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/Global tool-call budget/);
  });
});

describe('emergency stop file', () => {
  test('isEmergencyStopActive is false when the file is absent', () => {
    expect(isEmergencyStopActive()).toBe(false);
  });

  test('existing emergency-stop blocks destructive calls but allows reads', () => {
    writeFileSync(STOP_FILE, '');
    // Bust the 1s TTL cache by resetting
    _resetRateLimitForTests();
    expect(isEmergencyStopActive()).toBe(true);
    const destructive = checkRateLimit(true);
    expect(destructive.allowed).toBe(false);
    expect(destructive.reason).toMatch(/Emergency stop engaged/);
    // Non-destructive still allowed (read-only tools aren't the concern).
    const readOnly = checkRateLimit(false);
    expect(readOnly.allowed).toBe(true);
  });
});

describe('getRateLimitStatus', () => {
  test('reports remaining tokens + emergency state', () => {
    const status = getRateLimitStatus();
    expect(status.enabled).toBe(true);
    expect(status.globalRemaining).toBeGreaterThanOrEqual(0);
    expect(status.destructiveRemaining).toBeGreaterThanOrEqual(0);
    expect(status.emergencyStop).toBe(false);
    expect(status.emergencyStopPath).toBe(STOP_FILE);
  });
});

describe('rate limit atomicity', () => {
  test('a destructive denial does not decrement the global bucket', () => {
    // Exhaust destructive bucket (2 calls)
    checkRateLimit(true);
    checkRateLimit(true);
    // Snapshot global before the denied 3rd call
    const before = getRateLimitStatus().globalRemaining;
    const denied = checkRateLimit(true);
    expect(denied.allowed).toBe(false);
    const after = getRateLimitStatus().globalRemaining;
    // Global should be unchanged — we must not have taken a token on
    // denial, otherwise retries erode an unrelated budget.
    expect(after).toBe(before);
  });
});

describe('per-tenant isolation', () => {
  test('one tenant exhausting its budget does not affect another tenant', () => {
    // Capacity = 3 (from env). Burn tenant A entirely.
    expect(checkRateLimit(false, 'tenant-a').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-a').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-a').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-a').allowed).toBe(false);

    // Tenant B starts with a fresh bucket — must still succeed.
    expect(checkRateLimit(false, 'tenant-b').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-b').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-b').allowed).toBe(true);
    expect(checkRateLimit(false, 'tenant-b').allowed).toBe(false);
  });

  test('omitting tenantKey shares a single default bucket', () => {
    // Calls without a key all hit the same DEFAULT_TENANT_KEY bucket.
    expect(checkRateLimit(false).allowed).toBe(true);
    expect(checkRateLimit(false).allowed).toBe(true);
    expect(checkRateLimit(false).allowed).toBe(true);
    expect(checkRateLimit(false).allowed).toBe(false);
  });

  test('emergency stop applies across all tenants', () => {
    writeFileSync(STOP_FILE, '');
    _resetRateLimitForTests();
    expect(checkRateLimit(true, 'tenant-a').allowed).toBe(false);
    expect(checkRateLimit(true, 'tenant-b').allowed).toBe(false);
  });

  test('getRateLimitStatus reports per-tenant state and the trackedTenants count', () => {
    checkRateLimit(false, 'tenant-a');
    checkRateLimit(false, 'tenant-a');
    checkRateLimit(false, 'tenant-b');

    const a = getRateLimitStatus('tenant-a');
    const b = getRateLimitStatus('tenant-b');
    expect(a.tenantKey).toBe('tenant-a');
    expect(b.tenantKey).toBe('tenant-b');
    // Tenant A consumed 2 of 3, tenant B consumed 1 of 3.
    expect(a.globalRemaining).toBe(1);
    expect(b.globalRemaining).toBe(2);
    expect(a.trackedTenants).toBeGreaterThanOrEqual(2);
  });

  test('status for an unknown tenant returns full capacity without creating one', () => {
    const before = getRateLimitStatus().trackedTenants;
    const status = getRateLimitStatus('never-seen');
    // Unseen tenants report their would-be starting capacity.
    expect(status.globalRemaining).toBe(3);
    expect(status.destructiveRemaining).toBe(2);
    // …and the inspection itself does not allocate a bucket.
    expect(getRateLimitStatus().trackedTenants).toBe(before);
  });
});
