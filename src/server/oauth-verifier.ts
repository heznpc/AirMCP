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
 *   • JWKS fetched lazily via `jose.createRemoteJWKSet`, which handles
 *     the kid lookup, short-lived key caching, and background rotation
 *     internally. No bespoke cache layer — duplicating jose's
 *     battle-tested behaviour is a loss of investment.
 *   • Audience check: jose's built-in `audience` option matches the
 *     token's `aud` claim — accepting either a string `aud` equal to the
 *     target OR (per JWT spec) an array `aud` that includes it. The RFC
 *     8707 `resource` claim is NOT consulted for this decision; a token
 *     whose `resource` matches but whose `aud` does not is still rejected
 *     (`wrong_audience`). When present, `resource` rides along untouched
 *     in `claims.raw` for downstream inspection.
 */
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { JWTPayload } from "jose";
import type { OAuthClaims } from "../shared/request-context.js";

const ALLOWED_ALGS = ["RS256", "ES256"];
/** Tolerance in seconds for exp / nbf / iat checks. 60s matches RFC 0005
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
  /** Override for tests only — production always derives from
   *  `${issuer}/.well-known/jwks.json`. */
  jwksUri?: string;
}

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

interface CachedVerifier {
  jwks: RemoteJwks;
  issuer: string;
  audience: string;
  jwksUri: string;
}

let cached: CachedVerifier | null = null;

/** Exposed for tests that need to drop the cached JWKS between cases.
 *  Not destructive to running servers — the next verify() call rebuilds
 *  the JWKS client lazily. */
export function resetVerifierCache(): void {
  cached = null;
}

/** Lazy construction — first call pays the JWKS fetch on behalf of the
 *  caller, subsequent calls reuse the pooled keys per jose's internal
 *  rotation policy. Reconstruction happens only when issuer or audience
 *  changes, which in practice only happens in tests. */
function getOrBuild(cfg: VerifierConfig): CachedVerifier {
  const jwksUri = cfg.jwksUri ?? `${cfg.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  if (cached && cached.issuer === cfg.issuer && cached.audience === cfg.audience && cached.jwksUri === jwksUri) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    // Keep cooldown short so a single malformed request doesn't stall
    // downstream callers behind a long jose backoff. jose's default is
    // 30s which is fine for production but painful in incident recovery.
    cooldownDuration: 5_000,
    cacheMaxAge: 10 * 60_000, // 10 minutes
  });
  cached = { jwks, issuer: cfg.issuer, audience: cfg.audience, jwksUri };
  return cached;
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
  // The RFC 8707 `resource` claim is intentionally NOT used for the
  // audience decision — jose already enforced `aud` above (a token whose
  // `resource` matched but `aud` did not was rejected as wrong_audience
  // before we reach here). When present, `resource` rides along untouched
  // in `raw` for downstream inspection.
  return {
    subject: payload.sub,
    scopes: parseScopes(payload),
    raw: payload as Record<string, unknown>,
  };
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

  const verifier = getOrBuild(cfg);
  try {
    const { payload, protectedHeader } = await jwtVerify(token, verifier.jwks, {
      issuer: cfg.issuer,
      audience: cfg.audience,
      algorithms: ALLOWED_ALGS,
      clockTolerance: CLOCK_TOLERANCE_S,
    });
    if (!ALLOWED_ALGS.includes(protectedHeader.alg)) {
      // jose should have already rejected this via `algorithms`, but
      // double-check so a future jose behavior change can't silently
      // widen the accepted set.
      return { ok: false, reason: "unsupported_alg", detail: `alg=${protectedHeader.alg} not permitted` };
    }
    const claims = claimsFromPayload(payload);
    if (!claims) {
      return { ok: false, reason: "malformed_claims", detail: "missing sub claim" };
    }
    return { ok: true, claims };
  } catch (e) {
    return mapJoseError(e);
  }
}

function mapJoseError(e: unknown): VerifyErr {
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
  if (e instanceof joseErrors.JWKSNoMatchingKey || e instanceof joseErrors.JWKSInvalid) {
    return { ok: false, reason: "invalid_signature", detail: e.message };
  }
  // Network-level jose errors (timeout, 5xx from AS) all funnel here.
  // We treat them as `jwks_unreachable` so the caller can respond with
  // 503 (service unavailable — retry) instead of 401 (bad token — drop).
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|status code \d/i.test(msg)) {
    return { ok: false, reason: "jwks_unreachable", detail: msg };
  }
  return { ok: false, reason: "invalid_signature", detail: msg };
}

// Scope gate (RFC 0005 §3.4) lives in src/shared/oauth-scope.ts so
// the tool-registry pre-handler can import it without pulling jose +
// JWKS machinery into a shared-layer module.
