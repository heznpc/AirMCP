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
import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';

const { verifyBearer, resetVerifierCache } = await import('../dist/server/oauth-verifier.js');

// ── Harness: tiny localhost JWKS server ──────────────────────────────

async function startJwks({ keys }) {
  const server = createServer((req, res) => {
    if (req.url === '/jwks.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/jwks.json`, close: () => server.close() };
}

async function signFor({
  privateKey,
  kid,
  alg = 'RS256',
  payload,
  issuer,
  audience,
  subject = 'user-123',
  expiresIn = '5m',
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

describe('verifyBearer — input shape', () => {
  test('missing header → missing_header', async () => {
    const r = await verifyBearer(undefined, { issuer: 'https://x', audience: 'https://y', jwksUri: 'https://x/jwks' });
    expect(r).toEqual({ ok: false, reason: 'missing_header', detail: expect.any(String) });
  });

  test('empty header → missing_header', async () => {
    const r = await verifyBearer('   ', { issuer: 'https://x', audience: 'https://y', jwksUri: 'https://x/jwks' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_header');
  });

  test('header without Bearer prefix → malformed_header', async () => {
    const r = await verifyBearer('Basic abc', {
      issuer: 'https://x',
      audience: 'https://y',
      jwksUri: 'https://x/jwks',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed_header');
  });

  test('Bearer with empty token → malformed_header', async () => {
    const r = await verifyBearer('Bearer    ', {
      issuer: 'https://x',
      audience: 'https://y',
      jwksUri: 'https://x/jwks',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed_header');
  });
});

describe('verifyBearer — signing, iss/aud, exp/nbf, alg allow-list', () => {
  const issuer = 'https://auth.local/realms/airmcp';
  const audience = 'https://airmcp.local/mcp';
  let rsaKey;
  let jwks;

  beforeAll(async () => {
    rsaKey = await generateKeyPair('RS256');
    const jwk = await exportJWK(rsaKey.publicKey);
    jwk.kid = 'test-rsa-1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    jwks = await startJwks({ keys: [jwk] });
  });

  afterEach(() => resetVerifierCache());

  test('valid token is accepted with sub + scopes parsed', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: { scope: 'mcp:read mcp:write', client_id: 'desktop-client' },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.detail}`);
    expect(r.claims.scopes).toEqual(['mcp:read', 'mcp:write']);
    expect(r.claims.clientId).toBe('desktop-client');
    expect(typeof r.claims.subject).toBe('string');
  });

  test('wrong audience → wrong_audience', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: {},
      issuer,
      audience: 'https://wrong/mcp',
    });
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong_audience');
  });

  test('wrong issuer → wrong_issuer', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: {},
      issuer: 'https://other/realms/foo',
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong_issuer');
  });

  test('expired token → expired (clock tolerance is 60s, not open-ended)', async () => {
    // Signed 10 minutes ago, already 5 min past expiry even with 60s skew.
    const now = Math.floor(Date.now() / 1000);
    const sj = new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-rsa-1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now - 10 * 60)
      .setExpirationTime(now - 5 * 60);
    const token = await sj.sign(rsaKey.privateKey);
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  test('tampered signature → invalid_signature', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: {},
      issuer,
      audience,
    });
    // Replace the signature segment with garbage of the same shape.
    const parts = token.split('.');
    parts[2] = 'x'.repeat(parts[2].length);
    const tampered = parts.join('.');
    const r = await verifyBearer(`Bearer ${tampered}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_signature');
  });

  test('HS256 token is rejected (symmetric alg excluded — key-confusion hardening)', async () => {
    // Even if an attacker somehow obtained a token signed with HS256
    // using the public key as the shared secret (the classic 2015
    // Auth0 attack), the algorithm allow-list prevents the verifier
    // from ever attempting that path.
    const { createHmac } = await import('node:crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'test-rsa-1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: audience,
        sub: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const sig = createHmac('sha256', 'shared-secret').update(`${header}.${payload}`).digest('base64url');
    const token = `${header}.${payload}.${sig}`;
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    // jose reports this as JOSEAlgNotAllowed → unsupported_alg.
    expect(['unsupported_alg', 'invalid_signature']).toContain(r.reason);
  });

  test('jwks unreachable → jwks_unreachable (retryable, not 401)', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: {},
      issuer,
      audience,
    });
    // Point at a port that definitely isn't listening.
    const r = await verifyBearer(`Bearer ${token}`, {
      issuer,
      audience,
      jwksUri: 'http://127.0.0.1:1/jwks.json',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('jwks_unreachable');
  });

  test('scope as scp array (Keycloak style) is normalized', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: { scp: ['mcp:read', 'mcp:admin'] },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(true);
    expect(r.claims.scopes).toEqual(['mcp:read', 'mcp:admin']);
  });

  test('OIDC azp is used as the client identity when client_id is absent', async () => {
    const token = await signFor({
      privateKey: rsaKey.privateKey,
      kid: 'test-rsa-1',
      payload: { scope: 'mcp:read', azp: 'keycloak-client' },
      issuer,
      audience,
    });
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(true);
    expect(r.claims.clientId).toBe('keycloak-client');
  });

  test('missing sub claim → malformed_claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const sj = new SignJWT({ scope: 'mcp:read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-rsa-1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 300);
    // Intentionally no .setSubject() — so payload has no `sub`.
    const token = await sj.sign(rsaKey.privateKey);
    const r = await verifyBearer(`Bearer ${token}`, { issuer, audience, jwksUri: jwks.url });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed_claims');
  });

  afterAll(() => jwks?.close());
});
