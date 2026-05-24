import { describe, test, expect, jest, beforeAll, afterEach } from '@jest/globals';

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

describe('validateNetworkPolicy — OAuth branches (RFC 0005 Step 1)', () => {
  let validateNetworkPolicy;
  beforeAll(async () => {
    ({ validateNetworkPolicy } = await import('../dist/server/http-transport.js'));
  });

  const base = { policy: 'with-oauth', bindAll: true, httpToken: '', allowedOriginsCount: 0 };

  test('with-oauth requires AIRMCP_OAUTH_ISSUER', () => {
    expect(() =>
      validateNetworkPolicy({ ...base, oauthIssuer: '', oauthAudience: 'https://a/mcp' }),
    ).toThrow(/requires AIRMCP_OAUTH_ISSUER/);
  });

  test('with-oauth requires AIRMCP_OAUTH_AUDIENCE', () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: 'https://auth.example.com',
        oauthAudience: '',
      }),
    ).toThrow(/requires AIRMCP_OAUTH_AUDIENCE/);
  });

  test('with-oauth rejects http:// issuer (requires https)', () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: 'http://auth.example.com',
        oauthAudience: 'https://a/mcp',
      }),
    ).toThrow(/must be an https:\/\//);
  });

  test('with-oauth+origin requires allowed origins on top of OAuth env', () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        policy: 'with-oauth+origin',
        oauthIssuer: 'https://auth.example.com',
        oauthAudience: 'https://a/mcp',
        allowedOriginsCount: 0,
      }),
    ).toThrow(/AIRMCP_ALLOWED_ORIGINS/);
  });

  test('with-oauth passes when issuer + audience are both set correctly', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: 'https://auth.example.com/realms/airmcp',
        oauthAudience: 'https://airmcp.local/mcp',
      }),
    ).not.toThrow();
    err.mockRestore();
  });

  test('with-oauth prints Step-1 advisory (discovery-only) on startup', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    validateNetworkPolicy({
      ...base,
      oauthIssuer: 'https://auth.example.com',
      oauthAudience: 'https://a/mcp',
    });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('discovery-only mode (step 1)'));
    err.mockRestore();
  });
});

describe('readOAuthContext', () => {
  let readOAuthContext;
  beforeAll(async () => {
    ({ readOAuthContext } = await import('../dist/server/http-transport.js'));
  });

  afterEach(() => {
    delete process.env.AIRMCP_OAUTH_ISSUER;
    delete process.env.AIRMCP_OAUTH_AUDIENCE;
  });

  test('returns null when both env vars are unset', () => {
    expect(readOAuthContext()).toBeNull();
  });

  test('returns the trimmed pair when both are set', () => {
    process.env.AIRMCP_OAUTH_ISSUER = '  https://auth.example.com  ';
    process.env.AIRMCP_OAUTH_AUDIENCE = 'https://a/mcp';
    expect(readOAuthContext()).toEqual({
      issuer: 'https://auth.example.com',
      audience: 'https://a/mcp',
    });
  });

  test('returns partial object when only one is set (caller surfaces the validation error)', () => {
    process.env.AIRMCP_OAUTH_ISSUER = 'https://auth.example.com';
    expect(readOAuthContext()).toEqual({ issuer: 'https://auth.example.com', audience: '' });
  });
});
