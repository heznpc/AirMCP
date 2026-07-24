/**
 * OAuth JWT verifier contract tests (RFC 0005 Step 2).
 *
 * Unlike the pure scope tests, these go through `jose` end-to-end:
 * generate a real RSA keypair, sign a JWT locally, publish it via a
 * stubbed JWKS endpoint, and run verifyBearer against it. This pins the
 * RFC 8707 audience check, iss check, exp/nbf with the 60s clock
 * tolerance, and the RS256/ES256-only algorithm allow-list — i.e. the
 * parts that matter for spec compliance and that a snapshot test would
 * give false confidence about.
 *
 * Memory note: checking only that "it doesn't throw" on a valid token
 * is a tautology. These tests deliberately include the rejection
 * paths (expired, wrong aud, wrong iss, tampered sig, alg=HS256) so a
 * future jose upgrade that loosens defaults fails the suite.
 */
import { describe, test, expect, jest, beforeAll, afterAll, afterEach } from "@jest/globals";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPair, SignJWT, exportJWK } from "jose";

const { verifyBearer, resetVerifierCache } = await import("../dist/server/oauth-verifier.js");

// ── Harness: tiny localhost JWKS server ──────────────────────────────

async function startJwks({ keys }) {
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/jwks.json") {
      hits += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/jwks.json`, hits: () => hits, close: () => server.close() };
}

async function startKeycloakLike({ keys, metadataIssuer, malformedMetadata = false, serveRfcMetadata = false }) {
  let baseUrl = "";
  let metadataHits = 0;
  let jwksHits = 0;
  const server = createServer((req, res) => {
    // RFC 8414 path insertion is attempted first. Keycloak commonly exposes
    // the equivalent document only through its OIDC discovery suffix.
    if (req.url === "/.well-known/oauth-authorization-server/realms/airmcp") {
      if (!serveRfcMetadata) {
        res.statusCode = 404;
        res.end();
        return;
      }
      metadataHits += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          issuer: metadataIssuer ?? `${baseUrl}/realms/airmcp`,
          jwks_uri: `${baseUrl}/realms/airmcp/protocol/openid-connect/certs`,
        }),
      );
      return;
    }
    if (req.url === "/realms/airmcp/.well-known/openid-configuration") {
      metadataHits += 1;
      res.setHeader("Content-Type", "application/json");
      if (malformedMetadata) {
        res.end("{not-json");
      } else {
        res.end(
          JSON.stringify({
            issuer: metadataIssuer ?? `${baseUrl}/realms/airmcp`,
            jwks_uri: `${baseUrl}/realms/airmcp/protocol/openid-connect/certs`,
          }),
        );
      }
      return;
    }
    if (req.url === "/realms/airmcp/protocol/openid-connect/certs") {
      jwksHits += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  return {
    issuer: `${baseUrl}/realms/airmcp`,
    counts: () => ({ metadataHits, jwksHits }),
    close: () => server.close(),
  };
}

async function startRotatingIssuer({ keysByName, initial = "a" }) {
  let baseUrl = "";
  let target = initial;
  let metadataHits = 0;
  const jwksHits = Object.fromEntries(Object.keys(keysByName).map((name) => [name, 0]));
  const server = createServer((req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server/realm") {
      metadataHits += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ issuer: `${baseUrl}/realm`, jwks_uri: `${baseUrl}/jwks-${target}` }));
      return;
    }
    const match = /^\/jwks-([A-Za-z0-9_-]+)$/.exec(req.url ?? "");
    if (match && keysByName[match[1]]) {
      jwksHits[match[1]] += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: keysByName[match[1]] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  return {
    issuer: `${baseUrl}/realm`,
    setTarget: (name) => {
      target = name;
    },
    counts: () => ({ metadataHits, jwksHits: { ...jwksHits } }),
    close: () => server.close(),
  };
}

async function signFor({
  privateKey,
  kid,
  alg = "RS256",
  payload,
  issuer,
  audience,
  subject = "user-123",
  expiresIn = "5m",
  notBefore,
}) {
  const sj = new SignJWT(payload)
    .setProtectedHeader({ alg, kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiresIn);
  if (notBefore) sj.setNotBefore(notBefore);
  return sj.sign(privateKey);
}

describe("verifyBearer — input shape", () => {
  test("missing header → missing_header", async () => {
    const r = await verifyBearer(undefined, { issuer: "https://x", audience: "https://y", jwksUri: "https://x/jwks" });
    expect(r).toEqual({ ok: false, reason: "missing_header", detail: expect.any(String) });
  });

  test("empty header → missing_header", async () => {
    const r = await verifyBearer("   ", { issuer: "https://x", audience: "https://y", jwksUri: "https://x/jwks" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_header");
  });

  test("header without Bearer prefix → malformed_header", async () => {
    const r = await verifyBearer("Basic abc", {
      issuer: "https://x",
      audience: "https://y",
      jwksUri: "https://x/jwks",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed_header");
  });

  test("Bearer with empty token → malformed_header", async () => {
    const r = await verifyBearer("Bearer    ", {
      issuer: "https://x",
      audience: "https://y",
      jwksUri: "https://x/jwks",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed_header");
  });

  test("oversized, non-compact, undecodable, and unsupported JWTs fail before any JWKS network access", async () => {
    const jwks = await startJwks({ keys: [] });
    const cfg = { issuer: "https://x", audience: "https://y", jwksUri: jwks.url, allowInsecureHttp: true };
    const encodedHeader = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url");
    try {
      const cases = [
        ["Bearer x", "malformed_header"],
        [`Bearer ${encodedHeader({ alg: "RS256" })}.not-json.x`, "malformed_header"],
        [`Bearer ${encodedHeader({ alg: "HS256" })}.${encodedPayload}.x`, "unsupported_alg"],
        [`Bearer ${encodedHeader({ alg: "RS256" })}.${encodedPayload}.${"x".repeat(70 * 1024)}`, "malformed_header"],
      ];
      for (const [header, reason] of cases) {
        const result = await verifyBearer(header, cfg);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe(reason);
      }
      expect(jwks.hits()).toBe(0);
    } finally {
      resetVerifierCache();
      jwks.close();
    }
  });
});

describe("verifyBearer — signing, iss/aud, exp/nbf, alg allow-list", () => {
  const issuer = "https://auth.local/realms/airmcp";
  const audience = "https://airmcp.local/mcp";
  let rsaKey;
  let jwks;

  beforeAll(async () => {
    rsaKey = await generateKeyPair("RS256");
    const jwk = await exportJWK(rsaKey.publicKey);
    jwk.kid = "test-rsa-1";
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwks = await startJwks({ keys: [jwk] });
  });

  afterEach(() => resetVerifierCache());

  test("valid token is accepted with sub + scopes parsed", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: { scope: "mcp:read mcp:write", client_id: "desktop-client" },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.detail}`);
    expect(r.claims.scopes).toEqual(["mcp:read", "mcp:write"]);
    expect(r.claims.clientId).toBe("desktop-client");
    expect(typeof r.claims.subject).toBe("string");
  });

  test("wrong audience → wrong_audience", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: {},
      issuer,
      audience: "https://wrong/mcp",
    });
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wrong_audience");
  });

  test("wrong issuer → wrong_issuer", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: {},
      issuer: "https://other/realms/foo",
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wrong_issuer");
  });

  test("expired token → expired (clock tolerance is 60s, not open-ended)", async () => {
    // Signed 10 minutes ago, already 5 min past expiry even with 60s skew.
    const now = Math.floor(Date.now() / 1000);
    const sj = new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-rsa-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("expired-user")
      .setIssuedAt(now - 10 * 60)
      .setExpirationTime(now - 5 * 60);
    const token = await sj.sign(rsaKey.privateKey);
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("expired");
  });

  test("missing exp claim → malformed_claims instead of an indefinitely valid token", async () => {
    const token = await new SignJWT({ scope: "mcp:read" })
      .setProtectedHeader({ alg: "RS256", kid: "test-rsa-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-without-expiry")
      .setIssuedAt()
      // Intentionally no .setExpirationTime().
      .sign(rsaKey.privateKey);
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed_claims");
  });

  test("tampered signature → invalid_signature", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: {},
      issuer,
      audience,
    });
    // Replace the signature segment with garbage of the same shape.
    const parts = token.split(".");
    parts[2] = "x".repeat(parts[2].length);
    const tampered = parts.join(".");
    const r = await verifyBearer(`Bearer ${tampered}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_signature");
  });

  test("HS256 token is rejected (symmetric alg excluded — key-confusion hardening)", async () => {
    // Even if an attacker somehow obtained a token signed with HS256
    // using the public key as the shared secret (the classic 2015
    // Auth0 attack), the algorithm allow-list prevents the verifier
    // from ever attempting that path.
    const { createHmac } = await import("node:crypto");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: "test-rsa-1", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: audience,
        sub: "attacker",
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const sig = createHmac("sha256", "shared-secret").update(`${header}.${payload}`).digest("base64url");
    const token = `${header}.${payload}.${sig}`;
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported_alg");
  });

  test("jwks unreachable → jwks_unreachable (retryable, not 401)", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: {},
      issuer,
      audience,
    });
    // Point at a port that definitely isn't listening.
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: "http://127.0.0.1:1/jwks.json",
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("jwks_unreachable");
  });

  test("scope as scp array (Keycloak style) is normalized", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: { scp: ["mcp:read", "mcp:admin"] },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(true);
    expect(r.claims.scopes).toEqual(["mcp:read", "mcp:admin"]);
  });

  test("OIDC azp is used as the client identity when client_id is absent", async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "test-rsa-1",
      payload: { scope: "mcp:read", azp: "keycloak-client" },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(true);
    expect(r.claims.clientId).toBe("keycloak-client");
  });

  test("missing sub claim → malformed_claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const sj = new SignJWT({ scope: "mcp:read" })
      .setProtectedHeader({ alg: "RS256", kid: "test-rsa-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 300);
    // Intentionally no .setSubject() — so payload has no `sub`.
    const token = await sj.sign(rsaKey.privateKey);
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: jwks.url,
      allowInsecureHttp: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed_claims");
  });

  afterAll(() => jwks?.close());
});

describe("verifyBearer — RFC 8414/OIDC jwks_uri discovery", () => {
  const audience = "https://airmcp.local/mcp";
  let rsaKey;
  let jwk;
  const servers = [];

  beforeAll(async () => {
    rsaKey = await generateKeyPair("RS256");
    jwk = await exportJWK(rsaKey.publicKey);
    jwk.kid = "keycloak-rsa-1";
    jwk.alg = "RS256";
    jwk.use = "sig";
  });

  afterEach(() => resetVerifierCache());
  afterAll(() => {
    for (const server of servers) server.close();
  });

  test("Keycloak-compatible metadata → protocol certs → real JWT, cached end-to-end", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk] });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: { scope: "mcp:read", azp: "browser-client" },
      issuer: fixture.issuer,
      audience,
    });
    const config = { issuer: fixture.issuer, audience, allowInsecureHttp: true };

    const first = await verifyBearer(`Bearer ${token}`, config);
    const second = await verifyBearer(`Bearer ${token}`, config);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.claims.clientId).toBe("browser-client");
    expect(fixture.counts()).toEqual({ metadataHits: 1, jwksHits: 1 });
  });

  test("uses RFC 8414 path-insertion metadata without falling through to OIDC", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk], serveRfcMetadata: true });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: { scope: "mcp:read" },
      issuer: fixture.issuer,
      audience,
    });
    const result = await verifyBearer(`Bearer ${token}`, {
      issuer: fixture.issuer,
      audience,
      allowInsecureHttp: true,
    });
    expect(result.ok).toBe(true);
    expect(fixture.counts()).toEqual({ metadataHits: 1, jwksHits: 1 });
  });

  test("metadata issuer must exactly match configured issuer", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk], metadataIssuer: "http://issuer.example/other" });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const result = await verifyBearer(`Bearer ${token}`, {
      issuer: fixture.issuer,
      audience,
      allowInsecureHttp: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("jwks_unreachable");
    expect(fixture.counts()).toEqual({ metadataHits: 1, jwksHits: 0 });
  });

  test("metadata parse failure is fail-closed as jwks_unreachable", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk], malformedMetadata: true });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const result = await verifyBearer(`Bearer ${token}`, {
      issuer: fixture.issuer,
      audience,
      allowInsecureHttp: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("jwks_unreachable");
  });

  test("HTTP metadata/JWKS requires the explicit test-only opt-in", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk] });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const result = await verifyBearer(`Bearer ${token}`, { issuer: fixture.issuer, audience });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("jwks_unreachable");
    expect(fixture.counts()).toEqual({ metadataHits: 0, jwksHits: 0 });
  });

  test("metadata outage is single-flight and negatively cached for the advertised retry window", async () => {
    let metadataHits = 0;
    const server = createServer((_req, res) => {
      metadataHits += 1;
      res.statusCode = 503;
      res.end("down");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    const issuer = `http://127.0.0.1:${server.address().port}/realm`;
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer,
      audience,
    });
    const cfg = { issuer, audience, allowInsecureHttp: true };
    const realNow = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(realNow);
    try {
      const firstWave = await Promise.all(Array.from({ length: 8 }, () => verifyBearer(`Bearer ${token}`, cfg)));
      expect(firstWave.every((result) => !result.ok && result.reason === "jwks_unreachable")).toBe(true);
      expect(metadataHits).toBe(1);

      const cachedFailure = await verifyBearer(`Bearer ${token}`, cfg);
      expect(cachedFailure.ok).toBe(false);
      expect(cachedFailure.reason).toBe("jwks_unreachable");
      expect(metadataHits).toBe(1);

      clock.mockReturnValue(realNow + 10_001);
      const retried = await verifyBearer(`Bearer ${token}`, cfg);
      expect(retried.ok).toBe(false);
      expect(retried.reason).toBe("jwks_unreachable");
      expect(metadataHits).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  test("JWKS outage is single-flight and negatively cached without refetching per invalid request", async () => {
    let jwksHits = 0;
    const server = createServer((_req, res) => {
      jwksHits += 1;
      res.statusCode = 503;
      res.end("down");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    const issuer = "https://issuer.example/realm";
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer,
      audience,
    });
    const cfg = {
      issuer,
      audience,
      jwksUri: `http://127.0.0.1:${server.address().port}/jwks`,
      allowInsecureHttp: true,
    };
    const realNow = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(realNow);
    try {
      const firstWave = await Promise.all(Array.from({ length: 8 }, () => verifyBearer(`Bearer ${token}`, cfg)));
      expect(firstWave.every((result) => !result.ok && result.reason === "jwks_unreachable")).toBe(true);
      expect(jwksHits).toBe(1);

      const cachedFailure = await verifyBearer(`Bearer ${token}`, cfg);
      expect(cachedFailure.ok).toBe(false);
      expect(cachedFailure.reason).toBe("jwks_unreachable");
      expect(jwksHits).toBe(1);

      clock.mockReturnValue(realNow + 10_001);
      const retried = await verifyBearer(`Bearer ${token}`, cfg);
      expect(retried.ok).toBe(false);
      expect(retried.reason).toBe("jwks_unreachable");
      expect(jwksHits).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  test("discovered metadata expires and is fetched again instead of pinning jwks_uri for process lifetime", async () => {
    const fixture = await startKeycloakLike({ keys: [jwk] });
    servers.push(fixture);
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
      expiresIn: "1h",
    });
    const cfg = { issuer: fixture.issuer, audience, allowInsecureHttp: true };
    const realNow = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(realNow);
    try {
      expect((await verifyBearer(`Bearer ${token}`, cfg)).ok).toBe(true);
      expect(fixture.counts()).toEqual({ metadataHits: 1, jwksHits: 1 });

      clock.mockReturnValue(realNow + 10 * 60_000 + 1);
      expect((await verifyBearer(`Bearer ${token}`, cfg)).ok).toBe(true);
      expect(fixture.counts()).toEqual({ metadataHits: 2, jwksHits: 2 });
    } finally {
      clock.mockRestore();
    }
  });

  test("unknown kid performs one shared rediscovery and accepts a genuinely rotated jwks_uri", async () => {
    const rotatedKey = await generateKeyPair("RS256");
    const rotatedJwk = await exportJWK(rotatedKey.publicKey);
    Object.assign(rotatedJwk, { kid: "rotated-rsa-2", alg: "RS256", use: "sig" });
    const fixture = await startRotatingIssuer({ keysByName: { a: [jwk], b: [rotatedJwk] } });
    servers.push(fixture);
    const firstToken = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const rotatedToken = await signFor({
      privateKey: rotatedKey.privateKey,
      kid: "rotated-rsa-2",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const cfg = { issuer: fixture.issuer, audience, allowInsecureHttp: true };

    expect((await verifyBearer(`Bearer ${firstToken}`, cfg)).ok).toBe(true);
    fixture.setTarget("b");
    const rotatedWave = await Promise.all(Array.from({ length: 6 }, () => verifyBearer(`Bearer ${rotatedToken}`, cfg)));
    expect(rotatedWave.every((result) => result.ok)).toBe(true);
    expect(fixture.counts()).toEqual({ metadataHits: 2, jwksHits: { a: 1, b: 1 } });
  });

  test("same-URI unknown kid is terminal and does not trigger unbounded rediscovery", async () => {
    const unknownKey = await generateKeyPair("RS256");
    const unknownJwk = await exportJWK(unknownKey.publicKey);
    Object.assign(unknownJwk, { kid: "unknown-rsa-2", alg: "RS256", use: "sig" });
    const fixture = await startRotatingIssuer({ keysByName: { a: [jwk], b: [unknownJwk] } });
    servers.push(fixture);
    const firstToken = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const unknownToken = await signFor({
      privateKey: unknownKey.privateKey,
      kid: "unknown-rsa-2",
      payload: {},
      issuer: fixture.issuer,
      audience,
    });
    const cfg = { issuer: fixture.issuer, audience, allowInsecureHttp: true };

    expect((await verifyBearer(`Bearer ${firstToken}`, cfg)).ok).toBe(true);
    const first = await verifyBearer(`Bearer ${unknownToken}`, cfg);
    const second = await verifyBearer(`Bearer ${unknownToken}`, cfg);
    expect(first.ok).toBe(false);
    expect(first.reason).toBe("invalid_signature");
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("invalid_signature");
    expect(fixture.counts()).toEqual({ metadataHits: 2, jwksHits: { a: 1, b: 0 } });
  });

  test("OIDC fallback preserves the configured issuer origin even when its path starts with //", async () => {
    let pivotHits = 0;
    const pivot = createServer((_req, res) => {
      pivotHits += 1;
      res.statusCode = 500;
      res.end();
    });
    pivot.listen(0, "127.0.0.1");
    await once(pivot, "listening");
    servers.push(pivot);

    let issuerBase = "";
    let issuer = "";
    const metadataHost = createServer((req, res) => {
      if (req.url?.startsWith("/.well-known/oauth-authorization-server/")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (req.url === `//127.0.0.1:${pivot.address().port}/realm/.well-known/openid-configuration`) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ issuer, jwks_uri: `${issuerBase}/jwks` }));
        return;
      }
      if (req.url === "/jwks") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    metadataHost.listen(0, "127.0.0.1");
    await once(metadataHost, "listening");
    servers.push(metadataHost);
    issuerBase = `http://127.0.0.1:${metadataHost.address().port}`;
    issuer = `${issuerBase}//127.0.0.1:${pivot.address().port}/realm`;
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer,
      audience,
    });

    const result = await verifyBearer(`Bearer ${token}`, { issuer, audience, allowInsecureHttp: true });
    expect(result.ok).toBe(true);
    expect(pivotHits).toBe(0);
  });

  test("issuer metadata and JWKS redirects are not followed", async () => {
    let redirectTargetHits = 0;
    const redirectTarget = createServer((_req, res) => {
      redirectTargetHits += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    redirectTarget.listen(0, "127.0.0.1");
    await once(redirectTarget, "listening");
    servers.push(redirectTarget);
    const targetUrl = `http://127.0.0.1:${redirectTarget.address().port}/target`;

    let metadataHits = 0;
    const metadataRedirect = createServer((_req, res) => {
      metadataHits += 1;
      res.statusCode = 302;
      res.setHeader("Location", targetUrl);
      res.end();
    });
    metadataRedirect.listen(0, "127.0.0.1");
    await once(metadataRedirect, "listening");
    servers.push(metadataRedirect);
    const redirectingIssuer = `http://127.0.0.1:${metadataRedirect.address().port}/realm`;
    const metadataToken = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: redirectingIssuer,
      audience,
    });
    const metadataResult = await verifyBearer(`Bearer ${metadataToken}`, {
      issuer: redirectingIssuer,
      audience,
      allowInsecureHttp: true,
    });
    expect(metadataResult.ok).toBe(false);
    expect(metadataResult.reason).toBe("jwks_unreachable");
    expect(metadataHits).toBe(1);
    expect(redirectTargetHits).toBe(0);

    resetVerifierCache();
    let jwksRedirectHits = 0;
    const jwksRedirect = createServer((_req, res) => {
      jwksRedirectHits += 1;
      res.statusCode = 302;
      res.setHeader("Location", targetUrl);
      res.end();
    });
    jwksRedirect.listen(0, "127.0.0.1");
    await once(jwksRedirect, "listening");
    servers.push(jwksRedirect);
    const explicitIssuer = "https://issuer.example/realm";
    const jwksToken = await signFor({
      privateKey: rsaKey.privateKey,
      kid: "keycloak-rsa-1",
      payload: {},
      issuer: explicitIssuer,
      audience,
    });
    const jwksResult = await verifyBearer(`Bearer ${jwksToken}`, {
      issuer: explicitIssuer,
      audience,
      jwksUri: `http://127.0.0.1:${jwksRedirect.address().port}/jwks`,
      allowInsecureHttp: true,
    });
    expect(jwksResult.ok).toBe(false);
    expect(jwksResult.reason).toBe("jwks_unreachable");
    expect(jwksRedirectHits).toBe(1);
    expect(redirectTargetHits).toBe(0);
  });
});
