import { describe, test, expect, jest, beforeAll, afterAll } from "@jest/globals";

const transportRequests = [];

jest.unstable_mockModule("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    constructor(options) {
      this.options = options;
    }

    async handleRequest(req, res, body) {
      transportRequests.push(body);
      if (body?.method === "initialize") {
        this.options.onsessioninitialized("oauth-session-1");
        res.setHeader("Mcp-Session-Id", "oauth-session-1");
      }
      res.status(200).json({ jsonrpc: "2.0", id: body?.id ?? null, result: {} });
    }

    close() {}
  },
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/types.js", () => ({
  isInitializeRequest: (body) => body?.method === "initialize",
}));

jest.unstable_mockModule("../dist/shared/config.js", () => ({
  NPM_PACKAGE_NAME: "airmcp",
}));

jest.unstable_mockModule("../dist/shared/constants.js", () => ({
  LIMITS: { HTTP_SESSIONS: 10 },
  TIMEOUT: { SESSION_IDLE: 300_000, SESSION_CLEANUP: 60_000, KILL_GRACE: 5_000 },
}));

jest.unstable_mockModule("../dist/shared/banner.js", () => ({ printBanner: jest.fn() }));
jest.unstable_mockModule("../dist/shared/audit.js", () => ({ auditLog: jest.fn() }));
jest.unstable_mockModule("../dist/server/shutdown.js", () => ({ registerShutdownHook: jest.fn() }));

const toolRegistry = {
  getExposedToolCount: () => 2,
  getExposedToolNames: () => ["read_note", "create_note"],
  getToolDetails(name) {
    if (name === "read_note") return { readOnly: true, destructive: false };
    if (name === "create_note") return { readOnly: false, destructive: false };
    return undefined;
  },
};

jest.unstable_mockModule("../dist/server/mcp-setup.js", () => ({
  createServer: jest.fn(async () => ({
    server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
    toolRegistry,
    bannerInfo: { transport: "http", version: "2.16.0", modulesEnabled: [] },
    cleanupEventListeners: jest.fn(),
  })),
}));

jest.unstable_mockModule("../dist/server/oauth-verifier.js", () => ({
  verifyBearer: jest.fn(async (header) => {
    if (!header?.startsWith("Bearer ")) {
      return { ok: false, reason: "missing_header", detail: "missing" };
    }
    if (header === "Bearer invalid") {
      return { ok: false, reason: "invalid_signature", detail: "invalid" };
    }
    const [subject, clientId, scopeList = ""] = header.slice("Bearer ".length).split("|");
    return {
      ok: true,
      claims: {
        subject,
        clientId,
        scopes: scopeList.split(",").filter(Boolean),
        raw: {},
      },
    };
  }),
}));

describe("OAuth Streamable HTTP session authorization", () => {
  let startHttpServer;
  let server;
  let baseUrl;

  beforeAll(async () => {
    process.env.AIRMCP_OAUTH_ISSUER = "https://auth.example";
    process.env.AIRMCP_OAUTH_AUDIENCE = "https://mcp.example/mcp";
    ({ startHttpServer } = await import("../dist/server/http-transport.js"));
    server = await startHttpServer({
      port: 0,
      bindAll: true,
      httpToken: "",
      allowNetwork: "with-oauth",
      pkg: { version: "2.16.0" },
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP test server");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const initialized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer alice|desktop|mcp:read" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("mcp-session-id")).toBe("oauth-session-1");
  });

  afterAll(async () => {
    delete process.env.AIRMCP_OAUTH_ISSUER;
    delete process.env.AIRMCP_OAUTH_AUDIENCE;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  async function callTool(token, name) {
    return fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Mcp-Session-Id": "oauth-session-1",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } }),
    });
  }

  test("keeps invalid-token authentication failures on 401", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("rejects session reuse by another subject", async () => {
    const response = await callTool("bob|desktop|mcp:write", "create_note");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden", code: "session_principal_mismatch" });
  });

  test("rejects session reuse by another OAuth client for the same subject", async () => {
    const response = await callTool("alice|browser|mcp:write", "create_note");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden", code: "session_principal_mismatch" });
  });

  test("returns a 403 Bearer scope challenge before dispatch", async () => {
    const before = transportRequests.length;
    const response = await callTool("alice|desktop|mcp:read", "create_note");
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer error="insufficient_scope", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp", scope="mcp:write", error_description="Additional permission required for this operation"',
    );
    expect(await response.json()).toMatchObject({ code: "insufficient_scope", required_scope: "mcp:write" });
    expect(transportRequests).toHaveLength(before);
  });

  test("allows a refreshed token with the same subject/client and sufficient scope", async () => {
    const response = await callTool("alice|desktop|mcp:write", "create_note");
    expect(response.status).toBe(200);
  });
});
