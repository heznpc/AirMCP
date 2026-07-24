/**
 * RFC 0005 Step 2 — OAuth 2.1 JWT verifier with lazy JWKS cache.
 *
 * Responsibility boundary: this module converts a `Authorization: Bearer
 * <jwt>` header into verified OAuth claims (subject + scopes) OR a typed
 * rejection reason. It does NOT talk to Express, audit, or the tool
 * registry — callers wire those.
 *
 * Key contract
 *   • Accepts RS256 / ES256 only (symmetric + none excluded — RFC 0005 R4
 *     key-confusion hardening).
 *   • Verifies iss / aud / exp / nbf with a 60s clock tolerance (RFC 0005
 *     R2 — Mac clock drift is common enough that zero tolerance would
 *     produce 401 storms).
 *   • JWKS fetched lazily via `jose.createRemoteJWKSet`, which owns key
 *     selection, cache expiry, and on-demand rotation. This module adds only
 *     bounded metadata discovery, outage backoff, and URI-rotation handling;
 *     it does not duplicate jose's cryptographic key cache.
 *   • Audience check: jose's built-in `audience` option matches the
 *     token's `aud` claim — accepting either a string `aud` equal to the
 *     target OR (per JWT spec) an array `aud` that includes it. The RFC
 *     8707 `resource` claim is NOT consulted for this decision; a token
 *     whose `resource` matches but whose `aud` does not is still rejected
 *     (`wrong_audience`). When present, `resource` rides along untouched
 *     in `claims.raw` for downstream inspection.
 */
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, errors as joseErrors } from "jose";
import type { JWK, JWTPayload } from "jose";
import type { OAuthClaims } from "../shared/request-context.js";

const ALLOWED_ALGS = ["RS256", "ES256"] as const;
const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const MAX_BEARER_TOKEN_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const METADATA_CACHE_MAX_AGE_MS = 10 * 60_000;
const OUTAGE_BACKOFF_MS = 10_000;
const UNKNOWN_KID_REDISCOVERY_COOLDOWN_MS = 10_000;
/** Tolerance in seconds for exp / nbf checks. 60s matches RFC 0005
 *  R2 — wider than this starts eroding the expiry guarantee. */
const CLOCK_TOLERANCE_S = 60;

export type VerifyFailureReason =
  | "missing_header"
  | "malformed_header"
  | "invalid_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_issuer"
  | "wrong_audience"
  | "unsupported_alg"
  | "jwks_unreachable"
  | "malformed_claims";

export interface VerifyOk {
  ok: true;
  claims: OAuthClaims;
}

export interface VerifyErr {
  ok: false;
  reason: VerifyFailureReason;
  /** Human-readable detail safe for server logs / audit. NEVER surface
   *  this directly to HTTP response bodies — it can leak configuration
   *  hints. Callers map `reason` → a generic 401/503 message. */
  detail: string;
}

export type VerifyResult = VerifyOk | VerifyErr;

export interface VerifierConfig {
  issuer: string;
  /** RFC 8707 — the MCP resource the token must be audienced for. */
  audience: string;
  /** Explicit operator/test override. Production normally discovers this
   *  from the issuer's RFC 8414/OIDC metadata instead. */
  jwksUri?: string;
  /** Test-only opt-in for loopback HTTP metadata/JWKS fixtures. The HTTP
   *  transport never enables this from environment configuration. */
  allowInsecureHttp?: boolean;
}

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

interface BuiltVerifier {
  jwks: RemoteJwks;
  jwksUri: string;
}

interface VerifierIdentity {
  issuer: string;
  audience: string;
  explicitJwksUri?: string;
  allowInsecureHttp: boolean;
}

interface CachedVerifier extends VerifierIdentity {
  createdAt: number;
  promise?: Promise<BuiltVerifier>;
  resolved?: BuiltVerifier;
  lastForcedRediscoveryAt?: number;
  rediscoveryPromise?: Promise<BuiltVerifier | null>;
}

interface NegativeVerifierCache extends VerifierIdentity {
  retryAt: number;
  result: VerifyErr;
}

let cached: CachedVerifier | null = null;
let negativeCached: NegativeVerifierCache | null = null;

/** Exposed for tests that need to drop the cached JWKS between cases.
 *  Not destructive to running servers — the next verify() call rebuilds
 *  the JWKS client lazily. */
export function resetVerifierCache(): void {
  cached = null;
  negativeCached = null;
}

/** Lazy construction — first verification pays metadata/JWKS I/O on behalf of
 *  concurrent callers; subsequent calls reuse jose's pooled key resolver until
 *  metadata TTL, configuration change, or a bounded URI rediscovery replaces it. */
class JwksDiscoveryError extends Error {}

function assertRemoteUrl(value: string, label: string, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new JwksDiscoveryError(`${label} is not an absolute URL`);
  }
  const protocolAllowed = url.protocol === "https:" || (allowInsecureHttp && url.protocol === "http:");
  if (!protocolAllowed || url.username || url.password || url.hash) {
    throw new JwksDiscoveryError(`${label} must use HTTPS and contain no userinfo or fragment`);
  }
  return url;
}

/** RFC 8414 uses path insertion for issuers with a path. Keycloak exposes
 *  the equivalent metadata at the OIDC discovery suffix, so a 404 on the
 *  normative RFC endpoint falls back to that interoperable location. */
function issuerMetadataUrls(issuer: URL): URL[] {
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const rfc8414 = new URL(issuer.origin);
  rfc8414.pathname = `/.well-known/oauth-authorization-server${issuerPath}`;
  const oidc = new URL(issuer.origin);
  // Assign pathname instead of resolving a string against the origin. An
  // issuer path beginning with `//` is a valid path; passing that string to
  // `new URL(value, origin)` would reinterpret it as a network-path reference
  // and silently pivot metadata discovery to another host.
  oidc.pathname = `${issuerPath}/.well-known/openid-configuration`;
  return [rfc8414, oidc];
}

async function readLimitedMetadata(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
    throw new JwksDiscoveryError("issuer metadata response is too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_METADATA_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new JwksDiscoveryError("issuer metadata response is too large");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function discoverJwksUri(cfg: VerifierConfig): Promise<string> {
  const allowInsecureHttp = cfg.allowInsecureHttp === true;
  const issuer = assertRemoteUrl(cfg.issuer, "issuer", allowInsecureHttp);
  if (issuer.search) throw new JwksDiscoveryError("issuer metadata URL cannot be derived from an issuer with a query");
  if (cfg.jwksUri) return assertRemoteUrl(cfg.jwksUri, "jwks_uri", allowInsecureHttp).href;

  const candidates = issuerMetadataUrls(issuer);
  for (let index = 0; index < candidates.length; index += 1) {
    let response: Response;
    try {
      response = await fetch(candidates[index]!, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new JwksDiscoveryError(error instanceof Error ? error.message : "issuer metadata fetch failed");
    }
    if (response.status === 404 && index === 0) continue;
    if (!response.ok) throw new JwksDiscoveryError(`issuer metadata returned HTTP ${response.status}`);
    let text: string;
    try {
      text = await readLimitedMetadata(response);
    } catch (error) {
      if (error instanceof JwksDiscoveryError) throw error;
      throw new JwksDiscoveryError(error instanceof Error ? error.message : "issuer metadata body read failed");
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(text);
    } catch {
      throw new JwksDiscoveryError("issuer metadata is not valid JSON");
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new JwksDiscoveryError("issuer metadata must be a JSON object");
    }
    const document = metadata as Record<string, unknown>;
    if (document.issuer !== cfg.issuer) {
      throw new JwksDiscoveryError("issuer metadata does not exactly match configured issuer");
    }
    if (typeof document.jwks_uri !== "string" || document.jwks_uri === "") {
      throw new JwksDiscoveryError("issuer metadata does not contain jwks_uri");
    }
    return assertRemoteUrl(document.jwks_uri, "jwks_uri", allowInsecureHttp).href;
  }
  throw new JwksDiscoveryError("issuer metadata was not found");
}

function createVerifier(jwksUri: string): BuiltVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    // Keep cooldown short so a single malformed request doesn't stall
    // downstream callers behind a long jose backoff. jose's default is
    // 30s which is fine for production but painful in incident recovery.
    cooldownDuration: 5_000,
    cacheMaxAge: 10 * 60_000, // 10 minutes
  });
  return { jwks, jwksUri };
}

async function buildVerifier(cfg: VerifierConfig): Promise<BuiltVerifier> {
  return createVerifier(await discoverJwksUri(cfg));
}

function identityFor(cfg: VerifierConfig): VerifierIdentity {
  return {
    issuer: cfg.issuer,
    audience: cfg.audience,
    explicitJwksUri: cfg.jwksUri,
    allowInsecureHttp: cfg.allowInsecureHttp === true,
  };
}

function identityMatches(identity: VerifierIdentity, cfg: VerifierConfig): boolean {
  return (
    identity.issuer === cfg.issuer &&
    identity.audience === cfg.audience &&
    identity.explicitJwksUri === cfg.jwksUri &&
    identity.allowInsecureHttp === (cfg.allowInsecureHttp === true)
  );
}

/** Cache both issuer metadata resolution and jose's remote key resolver.
 *  Discovered metadata expires with the JWKS cache instead of pinning a stale
 *  `jwks_uri` for the lifetime of the process. Explicit operator overrides do
 *  not need metadata refresh and keep jose's resolver cache intact. */
function getOrBuild(cfg: VerifierConfig): Promise<BuiltVerifier> {
  const metadataExpired = cached && !cfg.jwksUri && Date.now() - cached.createdAt >= METADATA_CACHE_MAX_AGE_MS;
  if (cached && identityMatches(cached, cfg) && !metadataExpired && cached.promise) {
    return cached.promise;
  }
  const entry: CachedVerifier = {
    ...identityFor(cfg),
    createdAt: Date.now(),
  };
  entry.promise = buildVerifier(cfg)
    .then((built) => {
      entry.resolved = built;
      return built;
    })
    .catch((error) => {
      if (cached === entry) cached = null;
      throw error;
    });
  cached = entry;
  return entry.promise;
}

function getNegativeCache(cfg: VerifierConfig): VerifyErr | null {
  if (!negativeCached || !identityMatches(negativeCached, cfg)) return null;
  if (Date.now() >= negativeCached.retryAt) {
    negativeCached = null;
    return null;
  }
  return negativeCached.result;
}

function rememberOutage(cfg: VerifierConfig, result: VerifyErr): VerifyErr {
  negativeCached = {
    ...identityFor(cfg),
    retryAt: Date.now() + OUTAGE_BACKOFF_MS,
    result,
  };
  return result;
}

function jwkMatchesHeader(jwk: JWK, header: { alg: string; kid?: string }): boolean {
  if (header.kid && jwk.kid !== header.kid) return false;
  if (jwk.alg && jwk.alg !== header.alg) return false;
  if (jwk.use && jwk.use !== "sig") return false;
  if (jwk.key_ops && !jwk.key_ops.includes("verify")) return false;
  if (header.alg === "RS256" && jwk.kty !== "RSA") return false;
  if (header.alg === "ES256" && (jwk.kty !== "EC" || (jwk.crv && jwk.crv !== "P-256"))) return false;
  return true;
}

/** During AS backoff, cached known keys may keep serving valid sessions. Only
 *  an unknown/stale key is denied immediately; otherwise an attacker could
 *  turn one failed refresh into a ten-second outage for every cached token. */
function canUseFreshCachedKey(cfg: VerifierConfig, header: { alg: string; kid?: string }): boolean {
  if (!cached || !identityMatches(cached, cfg) || !cached.resolved?.jwks.fresh) return false;
  const candidates = cached.resolved.jwks.jwks()?.keys.filter((jwk) => jwkMatchesHeader(jwk, header)) ?? [];
  return header.kid ? candidates.length > 0 : candidates.length === 1;
}

/** One bounded metadata re-check after jose has exhausted the current JWKS for
 *  an unknown `kid`. Concurrent callers share it, and the cooldown prevents a
 *  stream of attacker-chosen kids from turning discovery into an SSRF/DoS
 *  primitive. A same-URI result is terminal for this verification attempt. */
async function rediscoverAfterUnknownKid(cfg: VerifierConfig, current: BuiltVerifier): Promise<BuiltVerifier | null> {
  if (cfg.jwksUri || !cached || !identityMatches(cached, cfg)) return null;
  if (cached.resolved !== current) {
    // A concurrent caller may already have completed the one permitted
    // rediscovery. Reuse its genuinely different resolver without issuing a
    // second metadata request; a same-URI replacement cannot help this kid.
    return cached.resolved && cached.resolved.jwksUri !== current.jwksUri ? cached.resolved : null;
  }
  const entry = cached;
  if (entry.rediscoveryPromise) return entry.rediscoveryPromise;
  if (
    entry.lastForcedRediscoveryAt !== undefined &&
    Date.now() - entry.lastForcedRediscoveryAt < UNKNOWN_KID_REDISCOVERY_COOLDOWN_MS
  ) {
    return null;
  }

  entry.lastForcedRediscoveryAt = Date.now();
  const promise = (async (): Promise<BuiltVerifier | null> => {
    const refreshedUri = await discoverJwksUri(cfg);
    if (refreshedUri === current.jwksUri) return null;
    const replacement = createVerifier(refreshedUri);
    if (cached === entry) {
      cached = {
        ...identityFor(cfg),
        createdAt: Date.now(),
        promise: Promise.resolve(replacement),
        resolved: replacement,
        lastForcedRediscoveryAt: entry.lastForcedRediscoveryAt,
      };
    }
    return replacement;
  })();
  entry.rediscoveryPromise = promise;
  try {
    return await promise;
  } finally {
    if (entry.rediscoveryPromise === promise) entry.rediscoveryPromise = undefined;
  }
}

function parseScopes(payload: JWTPayload): string[] {
  // OAuth 2.0 RFC 6749 §3.3 — `scope` is a space-separated string.
  // Keycloak and some others emit `scp` as an array; accept both.
  const raw = payload.scope ?? (payload as Record<string, unknown>).scp;
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return [];
}

function claimsFromPayload(payload: JWTPayload): OAuthClaims | null {
  if (typeof payload.sub !== "string" || payload.sub === "") return null;
  const rawClientId = (payload as Record<string, unknown>).client_id;
  const rawAuthorizedParty = (payload as Record<string, unknown>).azp;
  const clientId =
    typeof rawClientId === "string" && rawClientId !== ""
      ? rawClientId
      : typeof rawAuthorizedParty === "string" && rawAuthorizedParty !== ""
        ? rawAuthorizedParty
        : undefined;
  // The RFC 8707 `resource` claim is intentionally NOT used for the
  // audience decision — jose already enforced `aud` above (a token whose
  // `resource` matched but `aud` did not was rejected as wrong_audience
  // before we reach here). When present, `resource` rides along untouched
  // in `raw` for downstream inspection.
  return {
    subject: payload.sub,
    ...(clientId ? { clientId } : {}),
    scopes: parseScopes(payload),
    raw: payload as Record<string, unknown>,
  };
}

interface PrevalidatedToken {
  token: string;
  header: { alg: string; kid?: string };
}

function prevalidateToken(token: string): PrevalidatedToken | VerifyErr {
  if (Buffer.byteLength(token, "utf8") > MAX_BEARER_TOKEN_BYTES) {
    return { ok: false, reason: "malformed_header", detail: "Bearer token exceeds the size limit" };
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !BASE64URL_SEGMENT_RE.test(segment))) {
    return { ok: false, reason: "malformed_header", detail: "Bearer token is not compact JWT serialization" };
  }

  let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
  try {
    protectedHeader = decodeProtectedHeader(token);
    // Decode the claims object before any discovery/JWKS access. Signature and
    // registered-claim validation still happen only in jwtVerify below.
    decodeJwt(token);
  } catch {
    return { ok: false, reason: "malformed_header", detail: "Bearer token is not a decodable JWT" };
  }
  if (
    typeof protectedHeader.alg !== "string" ||
    !ALLOWED_ALGS.includes(protectedHeader.alg as (typeof ALLOWED_ALGS)[number])
  ) {
    return { ok: false, reason: "unsupported_alg", detail: "JWT signing algorithm is not permitted" };
  }
  return {
    token,
    header: {
      alg: protectedHeader.alg,
      ...(typeof protectedHeader.kid === "string" && protectedHeader.kid ? { kid: protectedHeader.kid } : {}),
    },
  };
}

async function verifyWithResolver(token: string, cfg: VerifierConfig, verifier: BuiltVerifier): Promise<VerifyResult> {
  const { payload, protectedHeader } = await jwtVerify(token, verifier.jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    algorithms: [...ALLOWED_ALGS],
    clockTolerance: CLOCK_TOLERANCE_S,
    // `jose` validates exp/sub only when they are present unless the resource
    // server declares them required. An otherwise valid signed JWT without
    // `exp` would therefore remain usable indefinitely. AirMCP accepts JWT
    // access tokens only when both the subject and finite lifetime claims are
    // present; `claimsFromPayload` below additionally rejects an empty/non-
    // string subject.
    requiredClaims: ["exp", "sub"],
  });
  if (!ALLOWED_ALGS.includes(protectedHeader.alg as (typeof ALLOWED_ALGS)[number])) {
    // jose already enforced this via `algorithms`; retain the independent
    // post-verification guard so a future dependency change cannot widen it.
    return { ok: false, reason: "unsupported_alg", detail: "JWT signing algorithm is not permitted" };
  }
  const claims = claimsFromPayload(payload);
  if (!claims) return { ok: false, reason: "malformed_claims", detail: "missing sub claim" };
  return { ok: true, claims };
}

function mapAndRememberVerificationError(cfg: VerifierConfig, error: unknown): VerifyErr {
  const result = mapJoseError(error);
  return result.reason === "jwks_unreachable" ? rememberOutage(cfg, result) : result;
}

/**
 * Verify a Bearer header value and return either populated claims or a
 * typed rejection reason. Safe to call with any string — malformed
 * inputs land in `malformed_header` instead of throwing.
 */
export async function verifyBearer(
  authorizationHeader: string | undefined,
  cfg: VerifierConfig,
): Promise<VerifyResult> {
  if (!authorizationHeader || authorizationHeader.trim() === "") {
    return { ok: false, reason: "missing_header", detail: "Authorization header absent" };
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    return { ok: false, reason: "malformed_header", detail: "Authorization must start with 'Bearer '" };
  }
  const token = match[1].trim();
  if (!token) {
    return { ok: false, reason: "malformed_header", detail: "Bearer token is empty" };
  }

  const prevalidated = prevalidateToken(token);
  if ("ok" in prevalidated) return prevalidated;

  const negative = getNegativeCache(cfg);
  if (negative && !canUseFreshCachedKey(cfg, prevalidated.header)) return negative;

  try {
    const verifier = await getOrBuild(cfg);
    try {
      return await verifyWithResolver(prevalidated.token, cfg, verifier);
    } catch (error) {
      if (error instanceof joseErrors.JWKSNoMatchingKey && !cfg.jwksUri) {
        let replacement: BuiltVerifier | null;
        try {
          replacement = await rediscoverAfterUnknownKid(cfg, verifier);
        } catch (rediscoveryError) {
          return mapAndRememberVerificationError(cfg, rediscoveryError);
        }
        if (replacement) {
          try {
            // Exactly one retry against a genuinely new jwks_uri. A second
            // unknown kid is terminal; never recurse into discovery again.
            return await verifyWithResolver(prevalidated.token, cfg, replacement);
          } catch (retryError) {
            return mapAndRememberVerificationError(cfg, retryError);
          }
        }
      }
      return mapAndRememberVerificationError(cfg, error);
    }
  } catch (error) {
    return mapAndRememberVerificationError(cfg, error);
  }
}

function mapJoseError(e: unknown): VerifyErr {
  if (e instanceof JwksDiscoveryError) {
    return { ok: false, reason: "jwks_unreachable", detail: e.message };
  }
  if (e instanceof joseErrors.JWTExpired) {
    return { ok: false, reason: "expired", detail: e.message };
  }
  if (e instanceof joseErrors.JWTClaimValidationFailed) {
    // `.claim` is set to the specific failing claim; map narrowly so
    // the caller can distinguish iss vs aud failure in logs.
    const claim = (e as unknown as { claim?: string }).claim;
    if (claim === "iss") return { ok: false, reason: "wrong_issuer", detail: e.message };
    if (claim === "aud") return { ok: false, reason: "wrong_audience", detail: e.message };
    if (claim === "nbf") return { ok: false, reason: "not_yet_valid", detail: e.message };
    return { ok: false, reason: "malformed_claims", detail: e.message };
  }
  if (e instanceof joseErrors.JOSEAlgNotAllowed) {
    return { ok: false, reason: "unsupported_alg", detail: e.message };
  }
  if (e instanceof joseErrors.JWSSignatureVerificationFailed) {
    return { ok: false, reason: "invalid_signature", detail: e.message };
  }
  if (e instanceof joseErrors.JWKSNoMatchingKey) {
    return { ok: false, reason: "invalid_signature", detail: e.message };
  }
  if (e instanceof joseErrors.JWKSInvalid || e instanceof joseErrors.JWKSTimeout) {
    return { ok: false, reason: "jwks_unreachable", detail: e.message };
  }
  // Network-level jose errors (timeout, 5xx from AS) all funnel here.
  // We treat them as `jwks_unreachable` so the caller can respond with
  // 503 (service unavailable — retry) instead of 401 (bad token — drop).
  const msg = e instanceof Error ? e.message : String(e);
  if (
    /fetch|network|ENOTFOUND|ECONNREFUSED|status code \d|Expected 200 OK|Failed to parse the JSON Web Key Set/i.test(
      msg,
    )
  ) {
    return { ok: false, reason: "jwks_unreachable", detail: msg };
  }
  return { ok: false, reason: "invalid_signature", detail: msg };
}

// Scope gate (RFC 0005 §3.4) lives in src/shared/oauth-scope.ts so
// the tool-registry pre-handler can import it without pulling jose +
// JWKS machinery into a shared-layer module.
