import { describe, test, expect, jest, beforeAll, afterEach } from "@jest/globals";

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
    bannerInfo: { transport: "http", version: "2.6.0", modulesEnabled: [] },
    cleanupEventListeners: jest.fn(),
  })),
}));
jest.unstable_mockModule("../dist/server/shutdown.js", () => ({
  registerShutdownHook: jest.fn(),
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

  test("rejects opaque or path-bearing Origin values defensively", () => {
    const allowedOrigins = parseAllowedOrigins("https://claude.ai");
    for (const origin of ["null", "file://local", "https://claude.ai/path", "https://claude.ai?x=1"]) {
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
      }),
    ).not.toThrow();
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
  let errorSpy;

  beforeAll(async () => {
    ({ startHttpServer } = await import("../dist/server/http-transport.js"));
  });

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env.AIRMCP_ALLOWED_ORIGINS;
    delete process.env.AIRMCP_OAUTH_ISSUER;
    delete process.env.AIRMCP_OAUTH_AUDIENCE;
    delete process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT;
    delete process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT;
  });

  function options(overrides = {}) {
    return {
      port: 0,
      bindAll: true,
      httpToken: "secret",
      allowNetwork: "with-token",
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

  test("health stays public while /mcp requires the bearer token", async () => {
    const server = await startHttpServer(options());
    try {
      const health = await fetch(serverUrl(server, "/health"));
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", version: "9.9.9-test" });

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
      expect(await response.json()).toEqual({ error: "Forbidden: Origin not allowed" });
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
    expect(readOAuthContext()).toEqual({
      issuer: "https://auth.example.com/tenant",
      audience: "https://a/mcp",
      authorizationEndpoint: "https://auth.example.com/tenant/authorize",
      tokenEndpoint: "https://auth.example.com/tenant/token",
    });
  });
});
