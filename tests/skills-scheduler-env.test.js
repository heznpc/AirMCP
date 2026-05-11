/**
 * RFC 0012 Phase 1 prep — environment opt-in tests.
 *
 * Verifies default-off behaviour for every flag and accepted /
 * rejected value parsing. The Phase 1 implementation PR will read
 * these in its own integration tests; this file only covers the
 * accessor contract.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';

const {
  isDaemonMode,
  isAutonomousDestructiveAllowed,
  getAbsentThresholdSec,
  getDefaultQueueTtl,
  getDaemonRateBudgetPct,
} = await import('../dist/skills/scheduler/env.js');

beforeEach(() => {
  delete process.env.AIRMCP_DAEMON_MODE;
  delete process.env.AIRMCP_AUTONOMOUS_DESTRUCTIVE;
  delete process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC;
  delete process.env.AIRMCP_HITL_QUEUE_TTL;
  delete process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT;
});

describe('isDaemonMode', () => {
  test('false by default', () => {
    expect(isDaemonMode()).toBe(false);
  });

  test('true only on exact "true" string', () => {
    process.env.AIRMCP_DAEMON_MODE = 'true';
    expect(isDaemonMode()).toBe(true);
  });

  test('false on truthy-but-not-"true" values', () => {
    process.env.AIRMCP_DAEMON_MODE = '1';
    expect(isDaemonMode()).toBe(false);
    process.env.AIRMCP_DAEMON_MODE = 'TRUE';
    expect(isDaemonMode()).toBe(false);
    process.env.AIRMCP_DAEMON_MODE = 'yes';
    expect(isDaemonMode()).toBe(false);
  });
});

describe('isAutonomousDestructiveAllowed', () => {
  test('false by default — opt-in required', () => {
    expect(isAutonomousDestructiveAllowed()).toBe(false);
  });

  test('true on "true"', () => {
    process.env.AIRMCP_AUTONOMOUS_DESTRUCTIVE = 'true';
    expect(isAutonomousDestructiveAllowed()).toBe(true);
  });
});

describe('getAbsentThresholdSec', () => {
  test('60s default', () => {
    expect(getAbsentThresholdSec()).toBe(60);
  });

  test('reads positive integer from env', () => {
    process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC = '120';
    expect(getAbsentThresholdSec()).toBe(120);
  });

  test('falls back to default on non-numeric', () => {
    process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC = 'banana';
    expect(getAbsentThresholdSec()).toBe(60);
  });

  test('falls back to default on zero / negative', () => {
    process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC = '0';
    expect(getAbsentThresholdSec()).toBe(60);
    process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC = '-5';
    expect(getAbsentThresholdSec()).toBe(60);
  });
});

describe('getDefaultQueueTtl', () => {
  test('"4h" default', () => {
    expect(getDefaultQueueTtl()).toBe('4h');
  });

  test('reads override verbatim (validation deferred to parseTtl)', () => {
    process.env.AIRMCP_HITL_QUEUE_TTL = '30m';
    expect(getDefaultQueueTtl()).toBe('30m');
  });
});

describe('getDaemonRateBudgetPct', () => {
  test('0.5 default', () => {
    expect(getDaemonRateBudgetPct()).toBe(0.5);
  });

  test('reads valid float in [0, 1]', () => {
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = '0.25';
    expect(getDaemonRateBudgetPct()).toBe(0.25);
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = '1';
    expect(getDaemonRateBudgetPct()).toBe(1);
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = '0';
    expect(getDaemonRateBudgetPct()).toBe(0);
  });

  test('falls back on out-of-range', () => {
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = '1.5';
    expect(getDaemonRateBudgetPct()).toBe(0.5);
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = '-0.1';
    expect(getDaemonRateBudgetPct()).toBe(0.5);
  });

  test('falls back on non-numeric', () => {
    process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT = 'half';
    expect(getDaemonRateBudgetPct()).toBe(0.5);
  });
});
