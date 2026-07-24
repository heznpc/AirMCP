import { describe, test, expect, jest, beforeAll, beforeEach, afterEach } from "@jest/globals";

// Mock all heavy dependencies that would fail in test environment
jest.unstable_mockModule("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: jest.fn(),
}));
jest.unstable_mockModule("@modelcontextprotocol/sdk/types.js", () => ({
  isInitializeRequest: jest.fn(),
}));
jest.unstable_mockModule("../dist/shared/config.js", () => ({
  NPM_PACKAGE_NAME: "airmcp",
  parseConfig: jest.fn(() => ({
    hitl: { level: "off" },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  })),
  getOsVersion: jest.fn(() => 26),
  isModuleEnabled: jest.fn(() => false),
}));
jest.unstable_mockModule("../dist/shared/constants.js", () => ({
  HOME: process.env.HOME ?? "",
  LIMITS: { HTTP_SESSIONS: 10 },
  TIMEOUT: { SESSION_IDLE: 300000, SESSION_CLEANUP: 60000, KILL_GRACE: 5000 },
}));
jest.unstable_mockModule("../dist/shared/banner.js", () => ({
  printBanner: jest.fn(),
}));
jest.unstable_mockModule("../dist/shared/audit.js", () => ({
  auditLog: jest.fn(),
}));
jest.unstable_mockModule("../dist/server/mcp-setup.js", () => ({
  createServer: jest.fn(async () => ({
    server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
    toolRegistry: {
      getExposedToolCount: () => 0,
      getExposedToolNames: () => [],
      getToolDetails: () => undefined,
    },
    bannerInfo: { transport: "http", version: "2.6.0", modulesEnabled: ["calendar", "reminders"] },
    runtimeModuleState: {
      enabledModules: ["calendar", "reminders"],
      unavailableModules: [{ module: "intelligence", reason: "host_unavailable", detail: "requires macOS 26" }],
    },
    cleanupEventListeners: jest.fn(),
  })),
}));
jest.unstable_mockModule("../dist/server/shutdown.js", () => ({
  registerShutdownHook: jest.fn(),
  unregisterShutdownHook: jest.fn(),
}));
// tool-registry's transitive deps (usage-tracker, audit) touch
// PATHS + FS — not relevant to http-transport's surface tests, so
// stub the methods the .well-known handler reads at request
// time.
jest.unstable_mockModule("../dist/shared/tool-registry.js", () => ({
  toolRegistry: {
    getExposedToolCount: () => 0,
    getExposedToolNames: () => [],
  },
}));

describe("HTTP transport module", () => {
  test("module exports startHttpServer function", async () => {
    const mod = await import("../dist/server/http-transport.js");
    expect(typeof mod.startHttpServer).toBe("function");
  });

  test("startHttpServer is an async function", async () => {
    const mod = await import("../dist/server/http-transport.js");
    // AsyncFunction constructor name check
    expect(mod.startHttpServer.constructor.name).toBe("AsyncFunction");
  });
});

describe("HTTP governed-run correlation header", () => {
  let parseRunCorrelationId;

  beforeAll(async () => {
    ({ parseRunCorrelationId } = await import("../dist/server/http-transport.js"));
  });

  test("accepts UUID run ids and normalizes their case", () => {
    expect(parseRunCorrelationId("A9E26E70-52A9-4FC5-9A91-7CE5D3291C68")).toBe("a9e26e70-52a9-4fc5-9a91-7ce5d3291c68");
  });

  test("ignores arbitrary labels, arrays, and oversized input", () => {
    expect(parseRunCorrelationId("daily-briefing-owner-name")).toBeUndefined();
    expect(parseRunCorrelationId(["a9e26e70-52a9-4fc5-9a91-7ce5d3291c68"])).toBeUndefined();
    expect(parseRunCorrelationId("x".repeat(512))).toBeUndefined();
  });
});

describe("native runtime owner identity", () => {
  let runtimeOwnerFingerprint;

  beforeAll(async () => {
    ({ runtimeOwnerFingerprint } = await import("../dist/server/http-transport.js"));
  });

  test("fingerprints only canonical app owner credentials", () => {
    expect(runtimeOwnerFingerprint("a".repeat(43))).toMatch(/^[0-9a-f]{64}$/);
    expect(runtimeOwnerFingerprint("short")).toBeUndefined();
    expect(runtimeOwnerFingerprint(undefined)).toBeUndefined();
  });
});

describe("resolveAllowNetwork", () => {
  let resolveAllowNetwork;
  beforeAll(async () => {
    ({ resolveAllowNetwork } = await import("../dist/server/http-transport.js"));
  });

  test("defaults to loopback-only with no signals", () => {
    const p = resolveAllowNetwork({ bindAll: false, httpToken: "", allowedOriginsCount: 0 });
    expect(p).toBe("loopback-only");
  });

  test("--bind-all without origins maps to with-token", () => {
    const p = resolveAllowNetwork({ bindAll: true, httpToken: "t", allowedOriginsCount: 0 });
    expect(p).toBe("with-token");
  });

  test("--bind-all + origins maps to with-token+origin", () => {
    const p = resolveAllowNetwork({ bindAll: true, httpToken: "t", allowedOriginsCount: 1 });
    expect(p).toBe("with-token+origin");
  });

  test("unsafeNoAuth wins over bindAll but not over explicit", () => {
    expect(resolveAllowNetwork({ bindAll: true, httpToken: "", allowedOriginsCount: 0, unsafeNoAuth: true })).toBe(
      "unauthenticated",
    );
    expect(
      resolveAllowNetwork({
        bindAll: true,
        httpToken: "",
        allowedOriginsCount: 0,
        unsafeNoAuth: true,
        explicit: "loopback-only",
      }),
    ).toBe("loopback-only");
  });

  test("explicit overrides everything", () => {
    const p = resolveAllowNetwork({
      explicit: "with-token",
      bindAll: false,
      httpToken: "t",
      allowedOriginsCount: 0,
    });
    expect(p).toBe("with-token");
  });

  test("rejects unknown explicit values", () => {
    expect(() =>
      resolveAllowNetwork({
        explicit: "wide-open",
        bindAll: false,
        httpToken: "",
        allowedOriginsCount: 0,
      }),
    ).toThrow(/Invalid allowNetwork/);
  });
});

describe("HTTP Origin allow-list helpers", () => {
  let parseAllowedOrigins;
  let isOriginAllowed;
  beforeAll(async () => {
    ({ parseAllowedOrigins, isOriginAllowed } = await import("../dist/server/http-transport.js"));
  });

  test("normalizes configured origins and ignores invalid entries", () => {
    expect([...parseAllowedOrigins(" https://claude.ai/ ,not a url,http://localhost:5173 ")]).toEqual([
      "https://claude.ai",
      "http://localhost:5173",
    ]);
  });

  test("accepts only canonical Chrome extension origins", () => {
    const extensionId = "abcdefghijklmnopabcdefghijklmnop";
    expect([...parseAllowedOrigins(`chrome-extension://${extensionId}`)]).toEqual([
      `chrome-extension://${extensionId}`,
    ]);
    for (const invalid of [
      `chrome-extension://${extensionId}/`,
      `chrome-extension://${extensionId}:443`,
      `chrome-extension://${extensionId}?x=1`,
      `chrome-extension://${extensionId}#fragment`,
      "chrome-extension://abcdefghijklmnopabcdefghijklmnopq",
      "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
      `https://chrome-extension://${extensionId}`,
    ]) {
      expect(parseAllowedOrigins(invalid).size).toBe(0);
    }
  });

  test("+origin policies require the explicit allow-list, even for localhost", () => {
    const allowedOrigins = parseAllowedOrigins("https://claude.ai");
    expect(
      isOriginAllowed("https://claude.ai", {
        policy: "with-token+origin",
        bindAll: true,
        allowedOrigins,
      }),
    ).toBe(true);
    expect(
      isOriginAllowed("http://localhost:5173", {
        policy: "with-token+origin",
        bindAll: true,
        allowedOrigins,
      }),
    ).toBe(false);
  });

  test("loopback-only rejects browser origins by default and allows only explicit entries", () => {
    expect(
      isOriginAllowed("http://localhost:5173", {
        policy: "loopback-only",
        bindAll: false,
        allowedOrigins: new Set(),
      }),
    ).toBe(false);
    expect(
      isOriginAllowed("http://localhost:5173", {
        policy: "loopback-only",
        bindAll: false,
        allowedOrigins: parseAllowedOrigins("http://localhost:5173"),
      }),
    ).toBe(true);
    expect(
      isOriginAllowed(undefined, {
        policy: "loopback-only",
        bindAll: false,
        allowedOrigins: new Set(),
      }),
    ).toBe(true);
  });

  test("rejects opaque or path-bearing Origin values defensively", () => {
    const allowedOrigins = parseAllowedOrigins("https://claude.ai");
    for (const origin of [
      "null",
      "file://local",
      "https://user@claude.ai",
      "https://claude.ai/path",
      "https://claude.ai?x=1",
    ]) {
      expect(
        isOriginAllowed(origin, {
          policy: "with-token+origin",
          bindAll: true,
          allowedOrigins,
        }),
      ).toBe(false);
    }
  });

  test("non +origin bind-all policy keeps legacy token-only behavior", () => {
    expect(
      isOriginAllowed("https://any-client.example", {
        policy: "with-token",
        bindAll: true,
        allowedOrigins: new Set(),
      }),
    ).toBe(true);
  });

  test("a missing Origin is allowed by default (non-browser client, token-gated)", () => {
    // A browser always sends Origin on a cross-origin request, so no Origin is
    // a non-browser client the token / OAuth policy already gates. True across
    // policies — denying it by default would break curl / native MCP clients.
    for (const policy of ["with-token", "with-token+origin", "with-oauth+origin"]) {
      expect(
        isOriginAllowed(undefined, {
          policy,
          bindAll: true,
          allowedOrigins: parseAllowedOrigins("https://claude.ai"),
        }),
      ).toBe(true);
    }
  });

  test("denyNoOrigin (AIRMCP_DENY_NO_ORIGIN) strict mode rejects a missing Origin", () => {
    const allowedOrigins = parseAllowedOrigins("https://claude.ai");
    expect(
      isOriginAllowed(undefined, {
        policy: "with-token+origin",
        bindAll: true,
        allowedOrigins,
        denyNoOrigin: true,
      }),
    ).toBe(false);
    // A real allow-listed Origin still passes under strict mode.
    expect(
      isOriginAllowed("https://claude.ai", {
        policy: "with-token+origin",
        bindAll: true,
        allowedOrigins,
        denyNoOrigin: true,
      }),
    ).toBe(true);
  });
});

describe("validateNetworkPolicy", () => {
  let validateNetworkPolicy;
  beforeAll(async () => {
    ({ validateNetworkPolicy } = await import("../dist/server/http-transport.js"));
  });

  test("loopback-only accepts bindAll=false", () => {
    expect(() =>
      validateNetworkPolicy({ policy: "loopback-only", bindAll: false, httpToken: "", allowedOriginsCount: 0 }),
    ).not.toThrow();
  });

  test("loopback-only rejects bindAll=true", () => {
    expect(() =>
      validateNetworkPolicy({ policy: "loopback-only", bindAll: true, httpToken: "t", allowedOriginsCount: 0 }),
    ).toThrow(/conflicts with --bind-all/);
  });

  test("with-token requires token", () => {
    expect(() =>
      validateNetworkPolicy({ policy: "with-token", bindAll: true, httpToken: "", allowedOriginsCount: 0 }),
    ).toThrow(/requires AIRMCP_HTTP_TOKEN/);
  });

  test("with-token passes with token set", () => {
    expect(() =>
      validateNetworkPolicy({ policy: "with-token", bindAll: true, httpToken: "secret", allowedOriginsCount: 0 }),
    ).not.toThrow();
  });

  test("with-token+origin requires both token and origins", () => {
    expect(() =>
      validateNetworkPolicy({ policy: "with-token+origin", bindAll: true, httpToken: "", allowedOriginsCount: 1 }),
    ).toThrow(/AIRMCP_HTTP_TOKEN/);
    expect(() =>
      validateNetworkPolicy({ policy: "with-token+origin", bindAll: true, httpToken: "t", allowedOriginsCount: 0 }),
    ).toThrow(/AIRMCP_ALLOWED_ORIGINS/);
    expect(() =>
      validateNetworkPolicy({ policy: "with-token+origin", bindAll: true, httpToken: "t", allowedOriginsCount: 1 }),
    ).not.toThrow();
  });

  test("unauthenticated logs a warning but does not throw", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      validateNetworkPolicy({ policy: "unauthenticated", bindAll: true, httpToken: "", allowedOriginsCount: 0 }),
    ).not.toThrow();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("unauthenticated"));
    err.mockRestore();
  });
});

describe("resolveAllowNetwork integration with doctor", () => {
  // Doctor imports resolveAllowNetwork dynamically at runtime, so the
  // existing export surface is all that needs to stay stable. This
  // guards against accidental removal or rename.
  let mod;
  beforeAll(async () => {
    mod = await import("../dist/server/http-transport.js");
  });

  test("exports resolveAllowNetwork and validateNetworkPolicy as functions", () => {
    expect(typeof mod.resolveAllowNetwork).toBe("function");
    expect(typeof mod.validateNetworkPolicy).toBe("function");
  });

  test("network policy values roundtrip through resolve+validate cleanly", () => {
    // with-token+origin needs origins, with-token needs token, loopback-only
    // stands alone, unauthenticated is self-consistent.
    const cases = [
      { policy: "loopback-only", bindAll: false, httpToken: "", origins: 0 },
      { policy: "with-token", bindAll: true, httpToken: "t", origins: 0 },
      { policy: "with-token+origin", bindAll: true, httpToken: "t", origins: 1 },
      {
        policy: "with-oauth",
        bindAll: true,
        httpToken: "",
        origins: 0,
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "https://airmcp.example/mcp",
      },
      {
        policy: "with-oauth+origin",
        bindAll: true,
        httpToken: "",
        origins: 1,
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "https://airmcp.example/mcp",
      },
      { policy: "unauthenticated", bindAll: true, httpToken: "", origins: 0 },
    ];
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
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
          oauthIssuer: c.oauthIssuer,
          oauthAudience: c.oauthAudience,
        }),
      ).not.toThrow();
    }
    err.mockRestore();
  });
});

describe("validateNetworkPolicy — OAuth branches (RFC 0005 Step 1)", () => {
  let validateNetworkPolicy;
  beforeAll(async () => {
    ({ validateNetworkPolicy } = await import("../dist/server/http-transport.js"));
  });

  const base = { policy: "with-oauth", bindAll: true, httpToken: "", allowedOriginsCount: 0 };

  test("with-oauth requires AIRMCP_OAUTH_ISSUER", () => {
    expect(() => validateNetworkPolicy({ ...base, oauthIssuer: "", oauthAudience: "https://a/mcp" })).toThrow(
      /requires AIRMCP_OAUTH_ISSUER/,
    );
  });

  test("with-oauth requires AIRMCP_OAUTH_AUDIENCE", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "",
      }),
    ).toThrow(/requires AIRMCP_OAUTH_AUDIENCE/);
  });

  test("with-oauth rejects http:// issuer (requires https)", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "http://auth.example.com",
        oauthAudience: "https://a/mcp",
      }),
    ).toThrow(/must be an https:\/\//);
  });

  test("with-oauth rejects a non-HTTPS resource audience", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "http://airmcp.example/mcp",
      }),
    ).toThrow(/AIRMCP_OAUTH_AUDIENCE must be a valid https:\/\//);
  });

  test("RFC 8414 publication requires authorization and token endpoints together", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "https://airmcp.example/mcp",
        oauthAuthorizationEndpoint: "https://auth.example.com/authorize",
      }),
    ).toThrow(/requires both AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT and AIRMCP_OAUTH_TOKEN_ENDPOINT/);
  });

  test("accepts a complete HTTPS RFC 8414 endpoint configuration", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthAuthorizationEndpoint: "https://auth.example.com/tenant/authorize",
        oauthTokenEndpoint: "https://auth.example.com/tenant/token",
        oauthTokenEndpointAuthMethods: ["none"],
      }),
    ).not.toThrow();
  });

  test("validates JWKS overrides and RFC 8414 token endpoint auth methods", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthJwksUri: "http://auth.example.com/tenant/certs",
      }),
    ).toThrow(/AIRMCP_OAUTH_JWKS_URI must be a valid https:\/\//);

    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthAuthorizationEndpoint: "https://auth.example.com/tenant/authorize",
        oauthTokenEndpoint: "https://auth.example.com/tenant/token",
      }),
    ).toThrow(/requires at least one token endpoint authentication method/);

    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthTokenEndpointAuthMethods: ["none"],
      }),
    ).toThrow(/requires RFC 8414 endpoint publication/);

    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthAuthorizationEndpoint: "https://auth.example.com/tenant/authorize",
        oauthTokenEndpoint: "https://auth.example.com/tenant/token",
        oauthTokenEndpointAuthMethods: ["client_secret_basic", "client_secret_jwt", "private_key_jwt"],
      }),
    ).not.toThrow();

    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/tenant",
        oauthAudience: "https://airmcp.example/mcp",
        oauthAuthorizationEndpoint: "https://auth.example.com/tenant/authorize",
        oauthTokenEndpoint: "https://auth.example.com/tenant/token",
        oauthTokenEndpointAuthMethods: ["made_up_method"],
      }),
    ).toThrow(/contains an unsupported method/);
  });

  test("with-oauth+origin requires allowed origins on top of OAuth env", () => {
    expect(() =>
      validateNetworkPolicy({
        ...base,
        policy: "with-oauth+origin",
        oauthIssuer: "https://auth.example.com",
        oauthAudience: "https://a/mcp",
        allowedOriginsCount: 0,
      }),
    ).toThrow(/AIRMCP_ALLOWED_ORIGINS/);
  });

  test("with-oauth passes when issuer + audience are both set correctly", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      validateNetworkPolicy({
        ...base,
        oauthIssuer: "https://auth.example.com/realms/airmcp",
        oauthAudience: "https://airmcp.local/mcp",
      }),
    ).not.toThrow();
    err.mockRestore();
  });

  test("with-oauth accepts issuer + audience without stale discovery-only advisory", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    validateNetworkPolicy({
      ...base,
      oauthIssuer: "https://auth.example.com",
      oauthAudience: "https://a/mcp",
    });
    expect(err).not.toHaveBeenCalledWith(expect.stringContaining("discovery-only"));
    err.mockRestore();
  });
});

describe("startHttpServer live middleware", () => {
  let startHttpServer;
  let resetIpRateLimit;
  let registerShutdownHook;
  let unregisterShutdownHook;
  let errorSpy;

  beforeAll(async () => {
    ({ startHttpServer } = await import("../dist/server/http-transport.js"));
    ({ _resetIpRateLimitForTests: resetIpRateLimit } = await import("../dist/shared/rate-limit.js"));
    ({ registerShutdownHook, unregisterShutdownHook } = await import("../dist/server/shutdown.js"));
  });

  beforeEach(() => {
    resetIpRateLimit();
    delete process.env.AIRMCP_APP_OWNED_RUNTIME;
    delete process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env.AIRMCP_ALLOWED_ORIGINS;
    delete process.env.AIRMCP_OAUTH_ISSUER;
    delete process.env.AIRMCP_OAUTH_AUDIENCE;
    delete process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT;
    delete process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT;
    delete process.env.AIRMCP_OAUTH_JWKS_URI;
    delete process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS;
    delete process.env.AIRMCP_APP_OWNED_RUNTIME;
    delete process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET;
  });

  function options(overrides = {}) {
    return {
      port: 0,
      bindAll: true,
      httpToken: "secret",
      allowNetwork: "with-token",
      config: {
        disabledModules: new Set(["notes", "mail"]),
        hitl: {
          level: "sensitive-only",
          whitelist: new Set(["search_notes", "create_reminder"]),
        },
      },
      pkg: {
        version: "9.9.9-test",
        description: "AirMCP test server",
        license: "MIT",
        homepage: "https://example.test",
      },
      ...overrides,
    };
  }

  function serverUrl(server, path) {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP test server");
    return `http://127.0.0.1:${addr.port}${path}`;
  }

  async function closeServer(server) {
    await new Promise((resolve) => server.close(resolve));
  }

  test("repeated start/close restores exit listeners, cleanup timers, and shutdown hooks", async () => {
    const baselineExitListeners = process.listenerCount("exit");
    const activeShutdownHooks = new Set();
    registerShutdownHook.mockImplementation((hook) => {
      activeShutdownHooks.add(hook);
    });
    unregisterShutdownHook.mockImplementation((hook) => {
      activeShutdownHooks.delete(hook);
    });
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const cleanupTimers = [];

    try {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const timersBeforeStart = setIntervalSpy.mock.results.length;
        const server = await startHttpServer(options());
        const newTimers = setIntervalSpy.mock.results
          .slice(timersBeforeStart)
          .map((result) => result.value)
          .filter(Boolean);
        expect(newTimers).toHaveLength(1);
        cleanupTimers.push(newTimers[0]);
        expect(process.listenerCount("exit")).toBe(baselineExitListeners + 1);
        expect(activeShutdownHooks.size).toBe(1);

        await closeServer(server);

        expect(process.listenerCount("exit")).toBe(baselineExitListeners);
        expect(activeShutdownHooks.size).toBe(0);
      }

      for (const timer of cleanupTimers) {
        expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
      }
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      registerShutdownHook.mockReset();
      unregisterShutdownHook.mockReset();
    }
  });

  test("health stays public while /mcp requires the bearer token", async () => {
    const server = await startHttpServer(options());
    try {
      const health = await fetch(serverUrl(server, "/health"));
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", version: "9.9.9-test", appOwned: false });

      const protectedRoute = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(protectedRoute.status).toBe(401);
      expect(await protectedRoute.json()).toEqual({ error: "Unauthorized: invalid or missing Bearer token" });
    } finally {
      await closeServer(server);
    }
  });

  test("health exposes only the non-sensitive app-owned process bit", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET = "a".repeat(43);
    const server = await startHttpServer(options());
    try {
      const health = await fetch(serverUrl(server, "/health"));
      expect(await health.json()).toEqual({ status: "ok", version: "9.9.9-test", appOwned: true });
    } finally {
      await closeServer(server);
    }
  });

  test("loopback-only rejects unsolicited browser origins while preserving native clients", async () => {
    const server = await startHttpServer(options({ allowNetwork: "loopback-only", bindAll: false, httpToken: "" }));
    try {
      const browser = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(browser.status).toBe(403);
      expect(browser.headers.get("access-control-allow-origin")).toBeNull();

      const nativeClient = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" }),
      });
      expect(nativeClient.status).not.toBe(403);
    } finally {
      await closeServer(server);
    }
  });

  test("loopback-only permits an explicitly allow-listed browser origin", async () => {
    process.env.AIRMCP_ALLOWED_ORIGINS = "http://localhost:5173";
    const server = await startHttpServer(options({ allowNetwork: "loopback-only", bindAll: false, httpToken: "" }));
    try {
      const response = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(response.status).not.toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    } finally {
      await closeServer(server);
    }
  });

  test("authenticated app runtime-state proves the effective module scope", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET = "a".repeat(43);
    const server = await startHttpServer(options());
    try {
      const unauthenticated = await fetch(serverUrl(server, "/app/runtime-state"));
      expect(unauthenticated.status).toBe(401);

      const response = await fetch(serverUrl(server, "/app/runtime-state"), {
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(200);
      const state = await response.json();
      expect(state).toEqual({
        status: "ok",
        version: "9.9.9-test",
        appOwned: true,
        pid: process.pid,
        ownerFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        disabledModules: ["mail", "notes"],
        scopeFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        enabledModules: ["calendar", "reminders"],
        unavailableModules: [{ module: "intelligence", reason: "host_unavailable", detail: "requires macOS 26" }],
        effectiveHitlLevel: "sensitive-only",
        effectiveHitlWhitelist: ["create_reminder", "search_notes"],
      });
      expect(JSON.stringify(state)).not.toContain("a".repeat(43));
    } finally {
      await closeServer(server);
    }
  });

  test("runtime-state refuses false empty readiness until the effective module warmup completes", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET = "a".repeat(43);
    const { createServer } = await import("../dist/server/mcp-setup.js");
    let releaseWarmup;
    createServer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseWarmup = () =>
            resolve({
              server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
              toolRegistry: {
                getExposedToolCount: () => 0,
                getExposedToolNames: () => [],
                getToolDetails: () => undefined,
              },
              bannerInfo: { transport: "http", version: "2.6.0", modulesEnabled: ["calendar"] },
              runtimeModuleState: {
                enabledModules: ["calendar"],
                unavailableModules: [{ module: "mail", reason: "module_pack" }],
              },
              cleanupEventListeners: jest.fn(),
            });
        }),
    );

    const server = await startHttpServer(options());
    try {
      const warming = await fetch(serverUrl(server, "/app/runtime-state"), {
        headers: { Authorization: "Bearer secret" },
      });
      expect(warming.status).toBe(503);
      expect(warming.headers.get("retry-after")).toBe("1");
      expect(await warming.json()).toEqual({ error: "Runtime module surface is still warming" });

      releaseWarmup();
      let ready;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        ready = await fetch(serverUrl(server, "/app/runtime-state"), {
          headers: { Authorization: "Bearer secret" },
        });
        if (ready.status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual(
        expect.objectContaining({
          enabledModules: ["calendar"],
          unavailableModules: [{ module: "mail", reason: "module_pack" }],
        }),
      );
    } finally {
      await closeServer(server);
    }
  });

  test("runtime-state stays unavailable without the app-only owner credential", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    const server = await startHttpServer(options());
    try {
      const health = await fetch(serverUrl(server, "/health"));
      expect(await health.json()).toEqual({ status: "ok", version: "9.9.9-test", appOwned: false });
      const response = await fetch(serverUrl(server, "/app/runtime-state"), {
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    } finally {
      await closeServer(server);
    }
  });

  test("runtime-state stays unavailable with a malformed owner credential", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET = "not-a-generation-secret";
    const server = await startHttpServer(options());
    try {
      const response = await fetch(serverUrl(server, "/app/runtime-state"), {
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  test("runtime-state stays unavailable when the app runtime has no HTTP token", async () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET = "a".repeat(43);
    const server = await startHttpServer(options({ allowNetwork: "loopback-only", bindAll: false, httpToken: "" }));
    try {
      const response = await fetch(serverUrl(server, "/app/runtime-state"));
      expect(response.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  test("runtime-state stays unavailable on a non-app-owned server", async () => {
    const server = await startHttpServer(options());
    try {
      const response = await fetch(serverUrl(server, "/app/runtime-state"), {
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    } finally {
      await closeServer(server);
    }
  });

  test("discovery card never serves bare empty modules during the warmup window", async () => {
    // The card must be internally consistent at every instant after the socket
    // binds: either the live module list is published, or a `warming` marker is
    // set. It must never silently advertise `modules: []` with no warming flag,
    // which is what a registry crawler hitting the warmup window used to see.
    const { createServer } = await import("../dist/server/mcp-setup.js");
    createServer.mockResolvedValueOnce({
      server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
      toolRegistry: {
        getExposedToolCount: () => 0,
        getExposedToolNames: () => [],
        getToolDetails: () => undefined,
      },
      bannerInfo: { transport: "http", version: "2.6.0", modulesEnabled: ["calendar", "reminders"] },
      runtimeModuleState: { enabledModules: ["calendar", "reminders"], unavailableModules: [] },
      cleanupEventListeners: jest.fn(),
    });
    const server = await startHttpServer(options());
    try {
      // Immediately after bind: modules may not be resolved yet, but if they
      // aren't, `warming` must be true (no bare empty list).
      const early = await (await fetch(serverUrl(server, "/.well-known/mcp.json"))).json();
      if (!Array.isArray(early.modules) || early.modules.length === 0) {
        expect(early.warming).toBe(true);
      }
      // After warmup converges: the live module list is published and the
      // warming marker is dropped.
      let card;
      for (let i = 0; i < 50; i += 1) {
        card = await (await fetch(serverUrl(server, "/.well-known/mcp.json"))).json();
        if (!card.warming) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(card.warming).toBeUndefined();
      expect(card.modules).toEqual(["calendar", "reminders"]);
    } finally {
      await closeServer(server);
    }
  });

  test("with-token+origin rejects an unlisted Origin before MCP handling", async () => {
    process.env.AIRMCP_ALLOWED_ORIGINS = "https://allowed.example";
    const server = await startHttpServer(options({ allowNetwork: "with-token+origin" }));
    try {
      const response = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("ratelimit-limit")).toBe("120");
      expect(response.headers.get("ratelimit-remaining")).toBe("119");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.json()).toEqual({ error: "Forbidden: Origin not allowed" });

      const allowed = await fetch(serverUrl(server, "/.well-known/mcp.json"), {
        headers: { Origin: "https://allowed.example" },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("ratelimit-remaining")).toBe("118");
    } finally {
      await closeServer(server);
    }
  });

  test("authenticated malformed JSON is metered and returns a fixed CORS-safe error without a stack", async () => {
    process.env.AIRMCP_ALLOWED_ORIGINS = "https://allowed.example";
    const server = await startHttpServer(options({ allowNetwork: "with-token+origin" }));
    try {
      const response = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          Origin: "https://allowed.example",
          "Content-Type": "application/json",
        },
        body: "{",
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{16}$/);
      expect(response.headers.get("ratelimit-limit")).toBe("120");
      expect(response.headers.get("ratelimit-remaining")).toBe("119");
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ error: "Invalid JSON body" });
      expect(body).not.toContain(process.cwd());
      expect(body).not.toMatch(/SyntaxError|node_modules|\bat\s/);
      const serverLogs = errorSpy.mock.calls.flat().join("\n");
      expect(serverLogs).not.toContain(process.cwd());
      expect(serverLogs).not.toMatch(/SyntaxError|body-parser|raw-body/);
    } finally {
      await closeServer(server);
    }
  });

  test("OAuth CORS preflight succeeds before bearer auth and publishes the browser contract", async () => {
    process.env.AIRMCP_ALLOWED_ORIGINS = "https://allowed.example";
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://airmcp.example/mcp";
    const server = await startHttpServer(options({ allowNetwork: "with-oauth+origin", httpToken: "" }));
    try {
      const response = await fetch(serverUrl(server, "/mcp"), {
        method: "OPTIONS",
        headers: {
          Origin: "https://allowed.example/",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id, x-airmcp-run-id",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
      expect(response.headers.get("vary")).toContain("Origin");
      expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, DELETE, OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-AirMCP-Run-Id",
      );
      const exposed = response.headers.get("access-control-expose-headers");
      for (const header of [
        "Mcp-Session-Id",
        "MCP-Protocol-Version",
        "X-Request-ID",
        "WWW-Authenticate",
        "Retry-After",
        "RateLimit-Limit",
      ]) {
        expect(exposed).toContain(header);
      }
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{16}$/);
      expect(response.headers.get("ratelimit-limit")).toBeTruthy();
      expect(response.headers.get("ratelimit-remaining")).toBeTruthy();

      const protectedRequest = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: {
          Origin: "https://allowed.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(protectedRequest.status).toBe(401);
      expect(protectedRequest.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
      expect(protectedRequest.headers.get("www-authenticate")).toContain("Bearer");
      expect(protectedRequest.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    } finally {
      await closeServer(server);
    }
  });

  test("CORS rejects unlisted origins and non-contract request headers without bearer auth", async () => {
    process.env.AIRMCP_ALLOWED_ORIGINS = "https://allowed.example";
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://airmcp.example/mcp";
    const server = await startHttpServer(options({ allowNetwork: "with-oauth+origin", httpToken: "" }));
    try {
      const deniedOrigin = await fetch(serverUrl(server, "/mcp"), {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      });
      expect(deniedOrigin.status).toBe(403);
      expect(deniedOrigin.headers.get("access-control-allow-origin")).toBeNull();

      const deniedHeader = await fetch(serverUrl(server, "/mcp"), {
        method: "OPTIONS",
        headers: {
          Origin: "https://allowed.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Authorization, X-Not-Allowed",
        },
      });
      expect(deniedHeader.status).toBe(403);
    } finally {
      await closeServer(server);
    }
  });

  test("browser discovery GET carries CORS headers for an allowed Chrome extension", async () => {
    const extensionId = "abcdefghijklmnopabcdefghijklmnop";
    const origin = `chrome-extension://${extensionId}`;
    process.env.AIRMCP_ALLOWED_ORIGINS = origin;
    const server = await startHttpServer(options({ allowNetwork: "with-token+origin" }));
    try {
      const response = await fetch(serverUrl(server, "/.well-known/mcp.json"), { headers: { Origin: origin } });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
    } finally {
      await closeServer(server);
    }
  });

  test("with-oauth rejects protected requests without a bearer token", async () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://airmcp.example/mcp";
    const server = await startHttpServer(
      options({
        allowNetwork: "with-oauth",
        httpToken: "",
      }),
    );
    try {
      const metadata = await fetch(serverUrl(server, "/.well-known/oauth-protected-resource/mcp"));
      expect(metadata.status).toBe(200);
      const card = await metadata.json();
      expect(card.resource).toBe("https://airmcp.example/mcp");

      const protectedRoute = await fetch(serverUrl(server, "/mcp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(protectedRoute.status).toBe(401);
      expect(protectedRoute.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://airmcp.example/.well-known/oauth-protected-resource/mcp"',
      );
      expect(protectedRoute.headers.get("www-authenticate")).toContain('scope="mcp:read"');
      expect(await protectedRoute.json()).toEqual({ error: "Unauthorized", code: "authorization_required" });
    } finally {
      await closeServer(server);
    }
  });

  test("serves configured RFC 8414 metadata at the issuer path-insertion location", async () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com/realms/airmcp";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://airmcp.example/mcp";
    process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT = "https://auth.example.com/realms/airmcp/authorize";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT = "https://auth.example.com/realms/airmcp/token";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = "none";
    const server = await startHttpServer(options({ allowNetwork: "with-oauth", httpToken: "" }));
    try {
      const response = await fetch(serverUrl(server, "/.well-known/oauth-authorization-server/realms/airmcp"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        issuer: "https://auth.example.com/realms/airmcp",
        authorization_endpoint: "https://auth.example.com/realms/airmcp/authorize",
        token_endpoint: "https://auth.example.com/realms/airmcp/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    } finally {
      await closeServer(server);
    }
  });
});

describe("readOAuthContext", () => {
  let readOAuthContext;
  beforeAll(async () => {
    ({ readOAuthContext } = await import("../dist/server/http-transport.js"));
  });

  afterEach(() => {
    delete process.env.AIRMCP_OAUTH_ISSUER;
    delete process.env.AIRMCP_OAUTH_AUDIENCE;
    delete process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT;
    delete process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT;
    delete process.env.AIRMCP_OAUTH_JWKS_URI;
    delete process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS;
  });

  test("returns null when both env vars are unset", () => {
    expect(readOAuthContext()).toBeNull();
  });

  test("returns the trimmed pair when both are set", () => {
    process.env.AIRMCP_OAUTH_ISSUER = "  https://auth.example.com  ";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://a/mcp";
    expect(readOAuthContext()).toEqual({
      issuer: "https://auth.example.com",
      audience: "https://a/mcp",
    });
  });

  test("returns partial object when only one is set (caller surfaces the validation error)", () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com";
    expect(readOAuthContext()).toEqual({ issuer: "https://auth.example.com", audience: "" });
  });

  test("includes configured RFC 8414 authorization and token endpoints", () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com/tenant";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://a/mcp";
    process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT = "https://auth.example.com/tenant/authorize";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT = "https://auth.example.com/tenant/token";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = "none";
    expect(readOAuthContext()).toEqual({
      issuer: "https://auth.example.com/tenant",
      audience: "https://a/mcp",
      authorizationEndpoint: "https://auth.example.com/tenant/authorize",
      tokenEndpoint: "https://auth.example.com/tenant/token",
      tokenEndpointAuthMethods: ["none"],
    });
  });

  test("reads an explicit JWKS URI and truthful token endpoint auth method list", () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example.com/tenant";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://a/mcp";
    process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT = "https://auth.example.com/tenant/authorize";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT = "https://auth.example.com/tenant/token";
    process.env.AIRMCP_OAUTH_JWKS_URI = "https://auth.example.com/tenant/certs";
    process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = "client_secret_basic, private_key_jwt";
    expect(readOAuthContext()).toEqual({
      issuer: "https://auth.example.com/tenant",
      audience: "https://a/mcp",
      authorizationEndpoint: "https://auth.example.com/tenant/authorize",
      tokenEndpoint: "https://auth.example.com/tenant/token",
      jwksUri: "https://auth.example.com/tenant/certs",
      tokenEndpointAuthMethods: ["client_secret_basic", "private_key_jwt"],
    });
  });
});
