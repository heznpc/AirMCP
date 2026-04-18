import { describe, test, expect } from '@jest/globals';
import { getCompatibilityEnv } from '../dist/shared/config.js';
import { HEALTHKIT_MIN_MACOS, resolveModuleCompatibility } from '../dist/shared/compatibility.js';

// Minimal compat manifest for the `intelligence` module — kept in sync with
// src/shared/modules.ts so that boundary cases below can be asserted
// deterministically without relying on the current host env.
const INTELLIGENCE_COMPAT = Object.freeze({
  minMacosVersion: 26,
  status: 'beta',
  requiresHardware: ['apple-silicon'],
});

describe('getCompatibilityEnv — live snapshot', () => {
  test('returns a plain serialisable snapshot', () => {
    const env = getCompatibilityEnv();
    // JSON round-trip should not drop any fields.
    const clone = JSON.parse(JSON.stringify(env));
    expect(clone).toEqual(env);
  });

  test('osVersion is a non-negative integer', () => {
    const { osVersion } = getCompatibilityEnv();
    expect(typeof osVersion).toBe('number');
    expect(Number.isInteger(osVersion)).toBe(true);
    expect(osVersion).toBeGreaterThanOrEqual(0);
  });

  test('cpu matches process.arch and is one of the known Node values', () => {
    const { cpu } = getCompatibilityEnv();
    expect(cpu).toBe(process.arch);
    // Catches an accidental type change (e.g. numeric "arm" codes).
    expect(typeof cpu).toBe('string');
    expect(cpu.length).toBeGreaterThan(0);
  });

  test('non-darwin hosts always report healthkit unavailable and osVersion=0', () => {
    if (process.platform === 'darwin') return; // only meaningful on non-darwin
    const env = getCompatibilityEnv();
    expect(env.osVersion).toBe(0);
    expect(env.healthkitAvailable).toBe(false);
  });

  test('healthkit snapshot agrees with live env on the expected formula', () => {
    // We duplicate the formula (arm64 + osVersion >= HEALTHKIT_MIN_MACOS)
    // against the current host only as a sanity check. The real boundary
    // cases are covered deterministically below via the env-driven tests.
    const { cpu, osVersion, healthkitAvailable } = getCompatibilityEnv();
    const expected = cpu === 'arm64' && osVersion >= HEALTHKIT_MIN_MACOS;
    expect(healthkitAvailable).toBe(expected);
  });

  test('threads cleanly into resolveModuleCompatibility', () => {
    const env = getCompatibilityEnv();
    const decision = resolveModuleCompatibility('notes', undefined, env);
    expect(decision.decision).toBe('register');
  });
});

describe('resolveModuleCompatibility — intelligence boundary cases (env-driven)', () => {
  test('Intel macOS 26 → skip-unsupported (hardware gate trips)', () => {
    const env = { osVersion: 26, cpu: 'x64', healthkitAvailable: false };
    const decision = resolveModuleCompatibility('intelligence', INTELLIGENCE_COMPAT, env);
    expect(decision.decision).toBe('skip-unsupported');
    expect(decision.reason).toMatch(/apple-silicon/i);
  });

  test('Apple Silicon macOS 15 → skip-unsupported (minMacosVersion gate trips)', () => {
    const env = { osVersion: 15, cpu: 'arm64', healthkitAvailable: true };
    const decision = resolveModuleCompatibility('intelligence', INTELLIGENCE_COMPAT, env);
    expect(decision.decision).toBe('skip-unsupported');
    expect(decision.reason).toMatch(/macOS/);
  });

  test('Apple Silicon macOS 26 → registers (all gates satisfied)', () => {
    const env = { osVersion: 26, cpu: 'arm64', healthkitAvailable: true };
    const decision = resolveModuleCompatibility('intelligence', INTELLIGENCE_COMPAT, env);
    // Beta status has no deprecation entry, so this must land on plain register.
    expect(decision.decision).toBe('register');
  });
});

describe('resolveModuleCompatibility — healthkit boundary cases (env-driven)', () => {
  const HEALTH_COMPAT = Object.freeze({
    status: 'stable',
    requiresHardware: ['apple-silicon', 'healthkit'],
  });

  test('Apple Silicon macOS at the exact minimum → register', () => {
    const env = {
      osVersion: HEALTHKIT_MIN_MACOS,
      cpu: 'arm64',
      healthkitAvailable: true,
    };
    const decision = resolveModuleCompatibility('health', HEALTH_COMPAT, env);
    expect(decision.decision).toBe('register');
  });

  test('Apple Silicon without healthkit flag → skip-unsupported', () => {
    const env = {
      osVersion: HEALTHKIT_MIN_MACOS,
      cpu: 'arm64',
      healthkitAvailable: false,
    };
    const decision = resolveModuleCompatibility('health', HEALTH_COMPAT, env);
    expect(decision.decision).toBe('skip-unsupported');
    expect(decision.reason).toMatch(/healthkit/i);
  });
});
