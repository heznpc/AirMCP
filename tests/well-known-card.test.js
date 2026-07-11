// `.well-known/mcp.json` discovery card shape tests.
//
// The card is how registry crawlers (Anthropic MCP Registry, Smithery,
// PulseMCP, Glama) build their catalog without connecting. A silent
// shape regression breaks crawler parsing upstream — pin the contract.

import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import {
  buildServerCard,
  buildOAuthProtectedResourceCard,
  buildOAuthAuthorizationServerMetadata,
  SCHEMA_VERSION,
  SCOPES_SUPPORTED,
} from "../dist/server/well-known-card.js";

const baseInput = () => ({
  name: "airmcp",
  version: "2.11.0",
  description: "MCP server for the entire Apple ecosystem",
  license: "MIT",
  homepage: "https://github.com/heznpc/AirMCP",
  websiteUrl: "https://github.com/heznpc/AirMCP",
  icon: "https://example.com/icon.png",
  allowNetwork: "loopback-only",
  allowedOrigins: [],
  tools: { count: 270, names: ["list_events", "read_note", "search_contacts"] },
  modules: ["calendar", "notes", "contacts"],
});

describe("buildServerCard — required fields", () => {
  test("always emits name / version / schema_version / transport / capabilities", () => {
    const card = buildServerCard(baseInput());
    expect(card.name).toBe("airmcp");
    expect(card.version).toBe("2.11.0");
    expect(card.schema_version).toBe(SCHEMA_VERSION);
    expect(card.transport).toEqual({ type: "streamable-http", url: "/mcp" });
    expect(card.capabilities).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true },
    });
  });

  test("SCHEMA_VERSION matches MCP spec 2025-11-25", () => {
    // Const-assertion pinning — if the spec date changes, update here
    // intentionally so crawlers know we re-audited the card shape.
    expect(SCHEMA_VERSION).toBe("2025-11-25");
  });

  test("network_policy is always present (RFC 0002 contract)", () => {
    const card = buildServerCard(baseInput());
    expect(card.network_policy).toBe("loopback-only");
  });
});

describe("buildServerCard — tool + module inventory (registry discovery)", () => {
  test("tools object carries count + full name list", () => {
    const card = buildServerCard(baseInput());
    expect(card.tools).toEqual({
      count: 270,
      names: ["list_events", "read_note", "search_contacts"],
    });
  });

  test("modules array is verbatim", () => {
    const card = buildServerCard(baseInput());
    expect(card.modules).toEqual(["calendar", "notes", "contacts"]);
  });

  test("empty inventory still renders a well-formed card (fresh install edge case)", () => {
    const card = buildServerCard({
      ...baseInput(),
      tools: { count: 0, names: [] },
      modules: [],
    });
    expect(card.tools).toEqual({ count: 0, names: [] });
    expect(card.modules).toEqual([]);
  });
});

describe("buildServerCard — icons", () => {
  test("accepts a string icon URL", () => {
    const card = buildServerCard(baseInput());
    expect(card.icons).toEqual(["https://example.com/icon.png"]);
  });

  test("accepts an MCP-spec icon descriptor object", () => {
    const card = buildServerCard({
      ...baseInput(),
      icon: { src: "data:image/svg+xml;base64,abc", mimeType: "image/svg+xml", sizes: ["any"] },
    });
    expect(card.icons).toEqual([{ src: "data:image/svg+xml;base64,abc", mimeType: "image/svg+xml", sizes: ["any"] }]);
  });
});

describe("buildServerCard — optional field emission", () => {
  test("omits description when absent", () => {
    const card = buildServerCard({ ...baseInput(), description: undefined });
    expect("description" in card).toBe(false);
  });

  test("omits license / homepage when absent", () => {
    const card = buildServerCard({ ...baseInput(), license: undefined, homepage: undefined });
    expect("license" in card).toBe(false);
    expect("homepage" in card).toBe(false);
  });

  test("emits authorization bearer when httpToken present", () => {
    const card = buildServerCard({ ...baseInput(), httpToken: "secret" });
    expect(card.authorization).toEqual({ type: "bearer" });
  });

  test("omits authorization when no token (stdio/loopback)", () => {
    const card = buildServerCard(baseInput());
    expect("authorization" in card).toBe(false);
  });

  test("emits allowed_origins when non-empty", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowedOrigins: ["https://claude.ai", "https://cursor.com"],
    });
    expect(card.allowed_origins).toEqual(["https://claude.ai", "https://cursor.com"]);
  });

  test("omits allowed_origins when empty (default loopback)", () => {
    const card = buildServerCard(baseInput());
    expect("allowed_origins" in card).toBe(false);
  });
});

describe("buildServerCard — network policy flags", () => {
  test("loopback-only: no auth flag, no security flag", () => {
    const card = buildServerCard(baseInput());
    expect(card.network_policy).toBe("loopback-only");
    expect("authorization" in card).toBe(false);
    expect("security" in card).toBe(false);
  });

  test("with-token: emits authorization when token is set", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowNetwork: "with-token",
      httpToken: "secret",
    });
    expect(card.network_policy).toBe("with-token");
    expect(card.authorization).toEqual({ type: "bearer" });
  });

  test("unauthenticated: adds security: insecure flag", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowNetwork: "unauthenticated",
    });
    expect(card.network_policy).toBe("unauthenticated");
    expect(card.security).toBe("insecure");
  });
});

describe("buildServerCard — JSON round-trip", () => {
  test("full card serializes cleanly (no circular refs, no undefined leaves)", () => {
    const card = buildServerCard({
      ...baseInput(),
      httpToken: "x",
      allowedOrigins: ["https://claude.ai"],
      allowNetwork: "with-token+origin",
    });
    const serialized = JSON.stringify(card);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized);
    expect(parsed.name).toBe("airmcp");
    expect(parsed.tools.count).toBe(270);
  });
});

describe("buildServerCard — OAuth authorization block (RFC 0005 Step 1)", () => {
  const oauthInput = () => ({
    ...baseInput(),
    allowNetwork: "with-oauth",
    oauth: {
      issuer: "https://auth.example.com/realms/airmcp",
      audience: "https://airmcp.local/mcp",
    },
  });

  test("with-oauth policy + full oauth context → OAuth authorization block", () => {
    const card = buildServerCard(oauthInput());
    expect(card.authorization).toEqual({
      type: "oauth2",
      resource: "https://airmcp.local/mcp",
      authorization_servers: ["https://auth.example.com/realms/airmcp"],
      scopes_supported: [...SCOPES_SUPPORTED],
    });
  });

  test("with-oauth+origin policy also emits OAuth block", () => {
    const card = buildServerCard({
      ...oauthInput(),
      allowNetwork: "with-oauth+origin",
      allowedOrigins: ["https://claude.ai"],
    });
    expect(card.authorization).toMatchObject({ type: "oauth2" });
    expect(card.allowed_origins).toEqual(["https://claude.ai"]);
  });

  test("OAuth policy WITHOUT oauth context → no authorization block (discovery-only state)", () => {
    const card = buildServerCard({ ...oauthInput(), oauth: undefined });
    expect("authorization" in card).toBe(false);
  });

  test("OAuth takes precedence over bearer token when both are present", () => {
    const card = buildServerCard({ ...oauthInput(), httpToken: "legacy-token" });
    expect(card.authorization).toMatchObject({ type: "oauth2" });
    expect(card.authorization).not.toMatchObject({ type: "bearer" });
  });

  test("SCOPES_SUPPORTED declares the 4 scope tiers from RFC 0005 §3.4", () => {
    expect(SCOPES_SUPPORTED).toEqual(["mcp:read", "mcp:write", "mcp:destructive", "mcp:admin"]);
  });
});

describe("buildOAuthProtectedResourceCard (RFC 9728)", () => {
  // Wipe optional env knobs so the default-shape assertions don't see
  // accidental values from a dev shell.
  const ENV_KEYS = ["AIRMCP_OAUTH_RESOURCE_DOCS", "AIRMCP_OAUTH_RESOURCE_POLICY", "AIRMCP_OAUTH_RESOURCE_TOS"];
  const originals = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originals[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originals[k] === undefined) delete process.env[k];
      else process.env[k] = originals[k];
    }
  });

  test("emits the RFC 9728 baseline shape", () => {
    const card = buildOAuthProtectedResourceCard("https://airmcp.local/mcp", "https://auth.example.com/realms/airmcp");
    expect(card).toEqual({
      resource: "https://airmcp.local/mcp",
      authorization_servers: ["https://auth.example.com/realms/airmcp"],
      bearer_methods_supported: ["header"],
      resource_signing_alg_values_supported: ["RS256", "ES256"],
      scopes_supported: [...SCOPES_SUPPORTED],
    });
  });

  test("signing alg list excludes symmetric (HS*) algorithms", () => {
    // Key-confusion attacks (using the AS public key as HMAC secret)
    // are blocked at the discovery layer by not advertising HS* — any
    // future change here needs to be deliberate.
    const card = buildOAuthProtectedResourceCard("https://a/mcp", "https://b");
    expect(card.resource_signing_alg_values_supported).not.toContain("HS256");
    expect(card.resource_signing_alg_values_supported).not.toContain("none");
  });

  test("does not advertise DPoP without proof validation", () => {
    const card = buildOAuthProtectedResourceCard("https://a/mcp", "https://b");
    expect(card.dpop_signing_alg_values_supported).toBeUndefined();
    expect(card.dpop_bound_access_tokens_required).toBeUndefined();
  });

  test("resource_documentation / policy / tos env knobs surface when set", () => {
    process.env.AIRMCP_OAUTH_RESOURCE_DOCS = "https://airmcp.example/docs";
    process.env.AIRMCP_OAUTH_RESOURCE_POLICY = "https://airmcp.example/privacy";
    process.env.AIRMCP_OAUTH_RESOURCE_TOS = "https://airmcp.example/tos";
    const card = buildOAuthProtectedResourceCard("https://a/mcp", "https://b");
    expect(card.resource_documentation).toBe("https://airmcp.example/docs");
    expect(card.resource_policy_uri).toBe("https://airmcp.example/privacy");
    expect(card.resource_tos_uri).toBe("https://airmcp.example/tos");
  });

  test("optional fields are omitted when env knobs are unset", () => {
    const card = buildOAuthProtectedResourceCard("https://a/mcp", "https://b");
    expect(card.resource_documentation).toBeUndefined();
    expect(card.resource_policy_uri).toBeUndefined();
    expect(card.resource_tos_uri).toBeUndefined();
  });
});

describe("buildOAuthAuthorizationServerMetadata (RFC 8414)", () => {
  test("publishes configured authorization-code + PKCE endpoints and scopes", () => {
    expect(
      buildOAuthAuthorizationServerMetadata({
        issuer: "https://auth.example/realms/airmcp",
        authorizationEndpoint: "https://auth.example/realms/airmcp/authorize",
        tokenEndpoint: "https://auth.example/realms/airmcp/token",
        tokenEndpointAuthMethodsSupported: ["none"],
      }),
    ).toEqual({
      issuer: "https://auth.example/realms/airmcp",
      authorization_endpoint: "https://auth.example/realms/airmcp/authorize",
      token_endpoint: "https://auth.example/realms/airmcp/token",
      token_endpoint_auth_methods_supported: ["none"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...SCOPES_SUPPORTED],
    });
  });
});
