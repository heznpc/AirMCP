import { describe, test, expect } from "@jest/globals";
import {
  buildBearerChallenge,
  isSameOAuthSessionPrincipal,
  missingScopesForMcpRequest,
  toOAuthSessionPrincipal,
  wellKnownPath,
  wellKnownUrl,
} from "../dist/server/oauth-http.js";

describe("OAuth HTTP challenge helpers", () => {
  test("builds the MCP insufficient-scope challenge with required scope and resource metadata", () => {
    expect(
      buildBearerChallenge({
        resourceMetadata: "https://mcp.example/.well-known/oauth-protected-resource/mcp",
        error: "insufficient_scope",
        scopes: ["mcp:write"],
        errorDescription: "Additional permission required for this operation",
      }),
    ).toBe(
      'Bearer error="insufficient_scope", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp", scope="mcp:write", error_description="Additional permission required for this operation"',
    );
  });

  test("strips response-splitting characters from auth params", () => {
    const challenge = buildBearerChallenge({ resourceMetadata: "https://mcp.example/\r\nInjected: yes" });
    expect(challenge).not.toContain("\r");
    expect(challenge).not.toContain("\n");
  });
});

describe("RFC 8414 / RFC 9728 well-known path insertion", () => {
  test("uses the root well-known path for an origin identifier", () => {
    expect(wellKnownPath("https://auth.example", "oauth-authorization-server")).toBe(
      "/.well-known/oauth-authorization-server",
    );
  });

  test("inserts the well-known suffix before an issuer path", () => {
    expect(wellKnownPath("https://auth.example/realms/airmcp", "oauth-authorization-server")).toBe(
      "/.well-known/oauth-authorization-server/realms/airmcp",
    );
  });

  test("derives the protected-resource metadata URL from a path-bearing audience", () => {
    expect(wellKnownUrl("https://mcp.example/mcp", "oauth-protected-resource")).toBe(
      "https://mcp.example/.well-known/oauth-protected-resource/mcp",
    );
  });
});

describe("OAuth MCP session binding", () => {
  test("keeps refreshed tokens from the same subject and client on the same session", () => {
    const bound = toOAuthSessionPrincipal({
      subject: "user-1",
      clientId: "client-a",
      scopes: ["mcp:read"],
      raw: { jti: "old-token" },
    });
    const refreshed = toOAuthSessionPrincipal({
      subject: "user-1",
      clientId: "client-a",
      scopes: ["mcp:write"],
      raw: { jti: "new-token" },
    });
    expect(isSameOAuthSessionPrincipal(bound, refreshed)).toBe(true);
  });

  test("rejects session reuse by a different subject or OAuth client", () => {
    const bound = { subject: "user-1", clientId: "client-a" };
    expect(isSameOAuthSessionPrincipal(bound, { subject: "user-2", clientId: "client-a" })).toBe(false);
    expect(isSameOAuthSessionPrincipal(bound, { subject: "user-1", clientId: "client-b" })).toBe(false);
    expect(isSameOAuthSessionPrincipal(bound, undefined)).toBe(false);
  });
});

describe("HTTP tools/call scope preflight", () => {
  const registry = {
    getToolDetails(name) {
      return {
        read_note: { readOnly: true, destructive: false },
        create_note: { readOnly: false, destructive: false },
        delete_note: { readOnly: false, destructive: true },
        audit_log: { readOnly: true, destructive: false },
      }[name];
    },
  };

  test("returns the operation's missing scope before MCP dispatch", () => {
    const missing = missingScopesForMcpRequest(
      { method: "tools/call", params: { name: "create_note", arguments: {} } },
      registry,
      { subject: "user-1", clientId: "client-a", scopes: ["mcp:read"], raw: {} },
    );
    expect(missing).toEqual(["mcp:write"]);
  });

  test("collects all missing scopes in a JSON-RPC batch", () => {
    const missing = missingScopesForMcpRequest(
      [
        { method: "tools/call", params: { name: "create_note", arguments: {} } },
        { method: "tools/call", params: { name: "delete_note", arguments: {} } },
        { method: "tools/call", params: { name: "audit_log", arguments: {} } },
      ],
      registry,
      { subject: "user-1", clientId: "client-a", scopes: ["mcp:read"], raw: {} },
    );
    expect(missing).toEqual(["mcp:write", "mcp:destructive", "mcp:admin"]);
  });

  test("leaves unknown tools and non-tool requests to the MCP dispatcher", () => {
    expect(
      missingScopesForMcpRequest({ method: "tools/call", params: { name: "missing_tool" } }, registry, {
        subject: "user-1",
        scopes: [],
        raw: {},
      }),
    ).toEqual([]);
    expect(
      missingScopesForMcpRequest({ method: "tools/list" }, registry, { subject: "user-1", scopes: [], raw: {} }),
    ).toEqual([]);
  });
});
