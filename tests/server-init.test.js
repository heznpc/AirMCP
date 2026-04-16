import { describe, test, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../dist/shared/config.js', () => ({
  parseConfig: jest.fn(() => ({
    hitl: { level: 'off' },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  })),
  getOsVersion: jest.fn(() => 26),
}));
jest.unstable_mockModule('../dist/shared/hitl.js', () => ({
  HitlClient: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/share-guard.js', () => ({
  setShareGuardHitlClient: jest.fn(),
}));
jest.unstable_mockModule('../dist/skills/index.js', () => ({
  closeSkillsWatcher: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  closeSwiftBridge: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/usage-tracker.js', () => ({
  usageTracker: { stop: jest.fn(), flushSync: jest.fn() },
}));

describe('Server init', () => {
  test('initializeServer returns ServerContext', async () => {
    const { initializeServer } = await import('../dist/server/init.js');
    const ctx = initializeServer();
    expect(ctx).toHaveProperty('config');
    expect(ctx).toHaveProperty('osVersion');
    expect(ctx).toHaveProperty('pkg');
    expect(ctx).toHaveProperty('hitlClient');
    expect(ctx.osVersion).toBe(26);
    expect(ctx.hitlClient).toBeNull(); // hitl level is 'off'
  });

  test('initializeServer loads package.json version', async () => {
    const { initializeServer } = await import('../dist/server/init.js');
    const ctx = initializeServer();
    expect(typeof ctx.pkg.version).toBe('string');
  });

  test('initializeServer pkg version matches semver format', async () => {
    const { initializeServer } = await import('../dist/server/init.js');
    const ctx = initializeServer();
    expect(ctx.pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
