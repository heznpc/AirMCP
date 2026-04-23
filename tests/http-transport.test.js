import { describe, test, expect, jest, beforeAll } from '@jest/globals';

// Mock all heavy dependencies that would fail in test environment
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn(),
}));
jest.unstable_mockModule('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/config.js', () => ({
  NPM_PACKAGE_NAME: 'airmcp',
  parseConfig: jest.fn(() => ({
    hitl: { level: 'off' },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  })),
  getOsVersion: jest.fn(() => 26),
  isModuleEnabled: jest.fn(() => false),
}));
jest.unstable_mockModule('../dist/shared/constants.js', () => ({
  LIMITS: { HTTP_SESSIONS: 10 },
  TIMEOUT: { SESSION_IDLE: 300000, SESSION_CLEANUP: 60000, KILL_GRACE: 5000 },
}));
jest.unstable_mockModule('../dist/shared/banner.js', () => ({
  printBanner: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/audit.js', () => ({
  auditLog: jest.fn(),
}));
jest.unstable_mockModule('../dist/server/mcp-setup.js', () => ({
  createServer: jest.fn(async () => ({
    server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
    bannerInfo: { transport: 'http', version: '2.6.0', modulesEnabled: [] },
  })),
}));
// tool-registry's transitive deps (usage-tracker, audit) touch
// PATHS + FS — not relevant to http-transport's surface tests, so
// stub the only two methods the .well-known handler reads at request
// time.
jest.unstable_mockModule('../dist/shared/tool-registry.js', () => ({
  toolRegistry: {
    getToolCount: () => 0,
    getToolNames: () => [],
  },
}));

describe('HTTP transport module', () => {
  test('module exports startHttpServer function', async () => {
    const mod = await import('../dist/server/http-transport.js');
    expect(typeof mod.startHttpServer).toBe('function');
  });

  test('startHttpServer is an async function', async () => {
    const mod = await import('../dist/server/http-transport.js');
    // AsyncFunction constructor name check
    expect(mod.startHttpServer.constructor.name).toBe('AsyncFunction');
  });
});

describe('resolveAllowNetwork', () => {
  let resolveAllowNetwork;
  beforeAll(async () => {
    ({ resolveAllowNetwork } = await import('../dist/server/http-transport.js'));
  });

  test('defaults to loopback-only with no signals', () => {
    const p = resolveAllowNetwork({ bindAll: false, httpToken: '', allowedOriginsCount: 0 });
    expect(p).toBe('loopback-only');
  });

  test('--bind-all without origins maps to with-token', () => {
    const p = resolveAllowNetwork({ bindAll: true, httpToken: 't', allowedOriginsCount: 0 });
    expect(p).toBe('with-token');
  });

  test('--bind-all + origins maps to with-token+origin', () => {
    const p = resolveAllowNetwork({ bindAll: true, httpToken: 't', allowedOriginsCount: 1 });
    expect(p).toBe('with-token+origin');
  });

  test('unsafeNoAuth wins over bindAll but not over explicit', () => {
    expect(resolveAllowNetwork({ bindAll: true, httpToken: '', allowedOriginsCount: 0, unsafeNoAuth: true }))
      .toBe('unauthenticated');
    expect(
      resolveAllowNetwork({
        bindAll: true,
        httpToken: '',
        allowedOriginsCount: 0,
        unsafeNoAuth: true,
        explicit: 'loopback-only',
      }),
    ).toBe('loopback-only');
  });

  test('explicit overrides everything', () => {
    const p = resolveAllowNetwork({
      explicit: 'with-token',
      bindAll: false,
      httpToken: 't',
      allowedOriginsCount: 0,
    });
    expect(p).toBe('with-token');
  });

  test('rejects unknown explicit values', () => {
    expect(() =>
      resolveAllowNetwork({
        explicit: 'wide-open',
        bindAll: false,
        httpToken: '',
        allowedOriginsCount: 0,
      }),
    ).toThrow(/Invalid allowNetwork/);
  });
});

describe('validateNetworkPolicy', () => {
  let validateNetworkPolicy;
  beforeAll(async () => {
    ({ validateNetworkPolicy } = await import('../dist/server/http-transport.js'));
  });

  test('loopback-only accepts bindAll=false', () => {
    expect(() =>
      validateNetworkPolicy({ policy: 'loopback-only', bindAll: false, httpToken: '', allowedOriginsCount: 0 }),
    ).not.toThrow();
  });

  test('loopback-only rejects bindAll=true', () => {
    expect(() =>
      validateNetworkPolicy({ policy: 'loopback-only', bindAll: true, httpToken: 't', allowedOriginsCount: 0 }),
    ).toThrow(/conflicts with --bind-all/);
  });

  test('with-token requires token', () => {
    expect(() =>
      validateNetworkPolicy({ policy: 'with-token', bindAll: true, httpToken: '', allowedOriginsCount: 0 }),
    ).toThrow(/requires AIRMCP_HTTP_TOKEN/);
  });

  test('with-token passes with token set', () => {
    expect(() =>
      validateNetworkPolicy({ policy: 'with-token', bindAll: true, httpToken: 'secret', allowedOriginsCount: 0 }),
    ).not.toThrow();
  });

  test('with-token+origin requires both token and origins', () => {
    expect(() =>
      validateNetworkPolicy({ policy: 'with-token+origin', bindAll: true, httpToken: '', allowedOriginsCount: 1 }),
    ).toThrow(/AIRMCP_HTTP_TOKEN/);
    expect(() =>
      validateNetworkPolicy({ policy: 'with-token+origin', bindAll: true, httpToken: 't', allowedOriginsCount: 0 }),
    ).toThrow(/AIRMCP_ALLOWED_ORIGINS/);
    expect(() =>
      validateNetworkPolicy({ policy: 'with-token+origin', bindAll: true, httpToken: 't', allowedOriginsCount: 1 }),
    ).not.toThrow();
  });

  test('unauthenticated logs a warning but does not throw', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      validateNetworkPolicy({ policy: 'unauthenticated', bindAll: true, httpToken: '', allowedOriginsCount: 0 }),
    ).not.toThrow();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unauthenticated'));
    err.mockRestore();
  });
});

describe('resolveAllowNetwork integration with doctor', () => {
  // Doctor imports resolveAllowNetwork dynamically at runtime, so the
  // existing export surface is all that needs to stay stable. This
  // guards against accidental removal or rename.
  let mod;
  beforeAll(async () => {
    mod = await import('../dist/server/http-transport.js');
  });

  test('exports resolveAllowNetwork and validateNetworkPolicy as functions', () => {
    expect(typeof mod.resolveAllowNetwork).toBe('function');
    expect(typeof mod.validateNetworkPolicy).toBe('function');
  });

  test('all four policy values roundtrip through resolve+validate cleanly', () => {
    // with-token+origin needs origins, with-token needs token, loopback-only
    // stands alone, unauthenticated is self-consistent.
    const cases = [
      { policy: 'loopback-only', bindAll: false, httpToken: '', origins: 0 },
      { policy: 'with-token', bindAll: true, httpToken: 't', origins: 0 },
      { policy: 'with-token+origin', bindAll: true, httpToken: 't', origins: 1 },
      { policy: 'unauthenticated', bindAll: true, httpToken: '', origins: 0 },
    ];
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (const c of cases) {
      const p = mod.resolveAllowNetwork({
        explicit: c.policy,
        bindAll: c.bindAll,
        httpToken: c.httpToken,
        allowedOriginsCount: c.origins,
      });
      expect(p).toBe(c.policy);
      expect(() =>
        mod.validateNetworkPolicy({
          policy: p,
          bindAll: c.bindAll,
          httpToken: c.httpToken,
          allowedOriginsCount: c.origins,
        }),
      ).not.toThrow();
    }
    err.mockRestore();
  });
});
