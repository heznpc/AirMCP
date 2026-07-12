/**
 * HTTP/SSE transport — Express server with StreamableHTTP sessions,
 * bearer token auth, health/discovery endpoints, and session management.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";
import { NPM_PACKAGE_NAME } from "../shared/config.js";
import { LIMITS, TIMEOUT } from "../shared/constants.js";
import { log, errToCtx } from "./../shared/logger.js";
import { printBanner } from "../shared/banner.js";
import { auditLog } from "../shared/audit.js";
import { SERVER_ICON, WEBSITE_URL } from "../shared/icons.js";
import type { ToolRegistry } from "../shared/tool-registry.js";
import { getOAuthClaims, getRequestContext, runWithRequestContext } from "../shared/request-context.js";
import { checkIpRateLimit, pruneStaleIpBuckets } from "../shared/rate-limit.js";
import { createServer, type CreateServerOptions } from "./mcp-setup.js";
import type { RuntimeModuleState } from "./mcp-setup.js";
import { registerShutdownHook, unregisterShutdownHook } from "./shutdown.js";
import {
  buildServerCard,
  buildOAuthProtectedResourceCard,
  buildOAuthAuthorizationServerMetadata,
} from "./well-known-card.js";
import { verifyBearer, type VerifyResult } from "./oauth-verifier.js";
import {
  buildBearerChallenge,
  isSameOAuthSessionPrincipal,
  missingScopesForMcpRequest,
  toOAuthSessionPrincipal,
  wellKnownPath,
  wellKnownUrl,
  type OAuthSessionPrincipal,
} from "./oauth-http.js";

// Per-IP rate limiting now lives in src/shared/rate-limit.ts so the
// bucket math is shared with the per-tenant tool-call gate. Prune
// stale buckets once per window so a long-running server doesn't
// accumulate state from rotating client IPs.
const ratePruneTimer = setInterval(() => pruneStaleIpBuckets(), 60_000);
if (ratePruneTimer.unref) ratePruneTimer.unref();

/** Optional run identifier supplied by native app surfaces and diagnostic
 *  clients. Only UUIDs are accepted so an untrusted HTTP peer cannot inject
 *  arbitrary text or high-cardinality labels into the audit trail. */
export const RUN_ID_HEADER = "x-airmcp-run-id";
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRunCorrelationId(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return RUN_ID_RE.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

/** Stable, non-secret comparison token for the effective module scope loaded
 * by this process. It is served only from the authenticated app runtime-state
 * endpoint; public /health intentionally omits effective runtime evidence. */
export function runtimeScopeFingerprint(disabledModules: Iterable<string>): string {
  const canonical = [...new Set(disabledModules)].sort().join("\n");
  return createHash("sha256").update(`airmcp-runtime-scope-v1\n${canonical}`, "utf8").digest("hex");
}

/** Fingerprint the native app's private process-owner credential without ever
 * returning the credential itself. Invalid or missing credentials cannot make
 * a process eligible for app lifecycle adoption. */
export function runtimeOwnerFingerprint(ownerSecret: string | undefined): string | undefined {
  const normalized = ownerSecret?.trim();
  if (!normalized || !/^[A-Za-z0-9_-]{43}$/.test(normalized)) return undefined;
  return createHash("sha256").update(`airmcp-app-owner-v1\n${normalized}`, "utf8").digest("hex");
}

/**
 * Declarative network-exposure policy (see docs/rfc/0002-http-allow-network.md).
 *
 *   loopback-only       — default; only 127.0.0.1 bindings accepted. Rejects
 *                         `--bind-all` at startup so a proxy sitting in front
 *                         of AirMCP cannot silently turn a loopback server
 *                         into a public one.
 *   with-token          — external binding allowed; AIRMCP_HTTP_TOKEN required.
 *   with-token+origin   — external binding + token + explicit Origin allow-list
 *                         (AIRMCP_ALLOWED_ORIGINS) required.
 *   unauthenticated     — explicit opt-in danger mode for CI/debug. Emits a
 *                         loud warning and flags `.well-known/mcp.json` as
 *                         `security: insecure`. Not a default anyone stumbles
 *                         into.
 */
export type AllowNetwork =
  "loopback-only" | "with-token" | "with-token+origin" | "with-oauth" | "with-oauth+origin" | "unauthenticated";

const ALLOW_NETWORK_VALUES: readonly AllowNetwork[] = [
  "loopback-only",
  "with-token",
  "with-token+origin",
  "with-oauth",
  "with-oauth+origin",
  "unauthenticated",
];

export interface HttpServerOptions extends CreateServerOptions {
  port: number;
  bindAll: boolean;
  httpToken: string;
  /** Overrides the policy inferred from CLI flags / env. When omitted the
   *  policy is derived: loopback-only unless `--bind-all` or
   *  `--unsafe-no-auth` is set. */
  allowNetwork?: AllowNetwork;
  /** Opt-in to the `unauthenticated` policy via CLI flag. Ignored when
   *  `allowNetwork` is set explicitly. */
  unsafeNoAuth?: boolean;
}

/** RFC 0005 — OAuth issuer + audience. Read once at startup so
 *  subsequent handlers can reference them without re-probing env. Both
 *  are required when `allowNetwork` lands on `with-oauth*` (enforced by
 *  `validateNetworkPolicy`). The HTTP middleware verifies JWTs with this
 *  same resource indicator before any protected MCP route runs. */
export interface OAuthContext {
  issuer: string;
  /** Resource Indicators target per RFC 8707 — the `aud` claim a valid
   *  token must carry. Typically the server's public MCP endpoint URL. */
  audience: string;
  /** Optional RFC 8414 publication contract for deployments that co-host or
   *  reverse-proxy their authorization server through this HTTP process. */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  /** Optional operator override for the verifier key set. When absent, the
   *  verifier discovers `jwks_uri` from issuer metadata (RFC 8414 / OIDC). */
  jwksUri?: string;
  /** Methods this co-hosted RFC 8414 document truthfully advertises. Required
   *  when metadata publication is enabled; public PKCE deployments explicitly
   *  configure `none` rather than having AirMCP infer AS capability. */
  tokenEndpointAuthMethods?: string[];
}

export const OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = [
  "none",
  "client_secret_basic",
  "client_secret_post",
  "client_secret_jwt",
  "private_key_jwt",
  "tls_client_auth",
  "self_signed_tls_client_auth",
] as const;

export function readOAuthContext(): OAuthContext | null {
  const issuer = (process.env.AIRMCP_OAUTH_ISSUER ?? "").trim();
  const audience = (process.env.AIRMCP_OAUTH_AUDIENCE ?? "").trim();
  const authorizationEndpoint = (process.env.AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT ?? "").trim();
  const tokenEndpoint = (process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT ?? "").trim();
  const jwksUri = (process.env.AIRMCP_OAUTH_JWKS_URI ?? "").trim();
  const rawTokenEndpointAuthMethods = (process.env.AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS ?? "").trim();
  if (!issuer && !audience && !authorizationEndpoint && !tokenEndpoint && !jwksUri && !rawTokenEndpointAuthMethods) {
    return null;
  }
  const tokenEndpointAuthMethods = rawTokenEndpointAuthMethods
    ? rawTokenEndpointAuthMethods
        .split(",")
        .map((method) => method.trim())
        .filter(Boolean)
    : undefined;
  return {
    issuer,
    audience,
    ...(authorizationEndpoint ? { authorizationEndpoint } : {}),
    ...(tokenEndpoint ? { tokenEndpoint } : {}),
    ...(jwksUri ? { jwksUri } : {}),
    ...(tokenEndpointAuthMethods ? { tokenEndpointAuthMethods } : {}),
  };
}

/** Derive the effective policy from explicit overrides + CLI/env signals.
 *  Exported so `init.ts` / tests can reuse the same resolution logic. */
export function resolveAllowNetwork(opts: {
  explicit?: AllowNetwork;
  bindAll: boolean;
  httpToken: string;
  allowedOriginsCount: number;
  unsafeNoAuth?: boolean;
}): AllowNetwork {
  if (opts.explicit) {
    if (!ALLOW_NETWORK_VALUES.includes(opts.explicit)) {
      throw new Error(
        `Invalid allowNetwork value "${opts.explicit}". Expected one of: ${ALLOW_NETWORK_VALUES.join(", ")}`,
      );
    }
    return opts.explicit;
  }
  if (opts.unsafeNoAuth) return "unauthenticated";
  if (opts.bindAll) {
    return opts.allowedOriginsCount > 0 ? "with-token+origin" : "with-token";
  }
  return "loopback-only";
}

const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  // URL.origin is `null` for custom schemes, so validate Chrome extension
  // origins explicitly. Chrome IDs are exactly 32 lowercase characters from
  // a-p. Requiring the canonical string also rejects ports, paths, query,
  // fragments, userinfo, and lookalike schemes.
  if (CHROME_EXTENSION_ORIGIN_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseAllowedOrigins(raw: string): Set<string> {
  const origins = new Set<string>();
  for (const part of raw.split(",")) {
    const origin = normalizeOrigin(part);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function isOriginAllowed(
  origin: string | undefined,
  ctx: { policy: AllowNetwork; bindAll: boolean; allowedOrigins: Set<string>; denyNoOrigin?: boolean },
): boolean {
  // A browser always attaches Origin to a cross-origin request, so a MISSING
  // Origin is a non-browser client (curl, a native MCP client), never a browser
  // CSRF / DNS-rebinding vector. Whatever else gates that client depends on the
  // active policy — loopback-only relies on the 127.0.0.1 socket binding,
  // with-token* / with-oauth* on the Bearer / JWT auth middleware — so allowing
  // no-Origin here adds no browser-attack surface under any of them. Allowed by
  // default; `denyNoOrigin` (AIRMCP_DENY_NO_ORIGIN) opts into a strict deny for
  // deployments that only ever serve browser clients.
  if (!origin) return !ctx.denyNoOrigin;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  if (ctx.policy === "with-token+origin" || ctx.policy === "with-oauth+origin") {
    return ctx.allowedOrigins.has(normalized);
  }
  // Loopback binding protects the socket from remote hosts, but it does not
  // make every local web page trustworthy. A hostile page at an arbitrary
  // localhost port can still drive a browser request to 127.0.0.1. Browser
  // origins therefore require an explicit allow-list even in the default
  // loopback-only mode. Native MCP clients omit Origin and pass above.
  if (ctx.policy === "loopback-only") return ctx.allowedOrigins.has(normalized);
  if (ctx.allowedOrigins.has(normalized)) return true;
  return ctx.bindAll && ctx.allowedOrigins.size === 0;
}

/** Startup invariant check. Throws on misconfiguration so the process
 *  refuses to start rather than silently exposing the tool surface. */
export function validateNetworkPolicy(ctx: {
  policy: AllowNetwork;
  bindAll: boolean;
  httpToken: string;
  allowedOriginsCount: number;
  oauthIssuer?: string;
  oauthAudience?: string;
  oauthAuthorizationEndpoint?: string;
  oauthTokenEndpoint?: string;
  oauthJwksUri?: string;
  oauthTokenEndpointAuthMethods?: string[];
}): void {
  switch (ctx.policy) {
    case "loopback-only":
      if (ctx.bindAll) {
        throw new Error(
          "allowNetwork=loopback-only conflicts with --bind-all. " +
            'Either drop --bind-all, or set AIRMCP_ALLOW_NETWORK="with-token" ' +
            "(and provide AIRMCP_HTTP_TOKEN).",
        );
      }
      return;
    case "with-token":
      if (!ctx.httpToken) {
        throw new Error(
          "allowNetwork=with-token requires AIRMCP_HTTP_TOKEN. " +
            'Set the token or switch to AIRMCP_ALLOW_NETWORK="loopback-only".',
        );
      }
      return;
    case "with-token+origin":
      if (!ctx.httpToken) {
        throw new Error("allowNetwork=with-token+origin requires AIRMCP_HTTP_TOKEN.");
      }
      if (ctx.allowedOriginsCount === 0) {
        throw new Error(
          "allowNetwork=with-token+origin requires AIRMCP_ALLOWED_ORIGINS. " +
            'Example: AIRMCP_ALLOWED_ORIGINS="https://claude.ai,https://cursor.sh"',
        );
      }
      return;
    case "with-oauth":
    case "with-oauth+origin": {
      // OAuth policy validation. Startup refuses when
      // AIRMCP_OAUTH_ISSUER or AIRMCP_OAUTH_AUDIENCE is missing so the
      // .well-known/oauth-protected-resource card never goes live with
      // empty fields (clients that fetch it must see a pointer to a real
      // authorization server).
      if (!ctx.oauthIssuer) {
        throw new Error(
          `allowNetwork=${ctx.policy} requires AIRMCP_OAUTH_ISSUER ` +
            '(the authorization server base URL, e.g. "https://auth.example.com/realms/airmcp").',
        );
      }
      let issuerUrl: URL;
      try {
        issuerUrl = new URL(ctx.oauthIssuer);
      } catch {
        throw new Error("AIRMCP_OAUTH_ISSUER must be a valid https:// URL.");
      }
      if (
        issuerUrl.protocol !== "https:" ||
        issuerUrl.search ||
        issuerUrl.hash ||
        issuerUrl.username ||
        issuerUrl.password
      ) {
        // No part of the issuer value flows into the error message — not
        // even the scheme. The URL can carry an internal hostname an
        // operator treats as sensitive, and this error reaches stderr via
        // the FATAL log path. The operator can read their own env var to
        // debug; the message just names the contract that was violated.
        // (Avoids CodeQL js/clear-text-logging on the taint flow into the
        // logger sink.)
        throw new Error(
          "AIRMCP_OAUTH_ISSUER must be an https:// URL. " +
            "Plain http issuers are a security hole — reject at startup.",
        );
      }
      if (!ctx.oauthAudience) {
        throw new Error(
          `allowNetwork=${ctx.policy} requires AIRMCP_OAUTH_AUDIENCE ` +
            "(RFC 8707 Resource Indicator — the URL your MCP endpoint is reachable at).",
        );
      }
      let audienceUrl: URL;
      try {
        audienceUrl = new URL(ctx.oauthAudience);
      } catch {
        throw new Error("AIRMCP_OAUTH_AUDIENCE must be a valid https:// resource URL.");
      }
      if (audienceUrl.protocol !== "https:" || audienceUrl.hash || audienceUrl.username || audienceUrl.password) {
        throw new Error("AIRMCP_OAUTH_AUDIENCE must be a valid https:// resource URL without a fragment or userinfo.");
      }
      const hasAuthorizationEndpoint = !!ctx.oauthAuthorizationEndpoint;
      const hasTokenEndpoint = !!ctx.oauthTokenEndpoint;
      if (hasAuthorizationEndpoint !== hasTokenEndpoint) {
        throw new Error(
          "RFC 8414 publication requires both AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT and AIRMCP_OAUTH_TOKEN_ENDPOINT.",
        );
      }
      for (const [name, value] of [
        ["AIRMCP_OAUTH_AUTHORIZATION_ENDPOINT", ctx.oauthAuthorizationEndpoint],
        ["AIRMCP_OAUTH_TOKEN_ENDPOINT", ctx.oauthTokenEndpoint],
      ] as const) {
        if (!value) continue;
        let endpoint: URL;
        try {
          endpoint = new URL(value);
        } catch {
          throw new Error(`${name} must be a valid https:// URL.`);
        }
        if (endpoint.protocol !== "https:" || endpoint.hash || endpoint.username || endpoint.password) {
          throw new Error(`${name} must be a valid https:// URL without a fragment or userinfo.`);
        }
      }
      if (ctx.oauthJwksUri) {
        let jwksUri: URL;
        try {
          jwksUri = new URL(ctx.oauthJwksUri);
        } catch {
          throw new Error("AIRMCP_OAUTH_JWKS_URI must be a valid https:// URL.");
        }
        if (jwksUri.protocol !== "https:" || jwksUri.hash || jwksUri.username || jwksUri.password) {
          throw new Error("AIRMCP_OAUTH_JWKS_URI must be a valid https:// URL without a fragment or userinfo.");
        }
      }
      const tokenEndpointAuthMethods = ctx.oauthTokenEndpointAuthMethods;
      if (tokenEndpointAuthMethods && !hasAuthorizationEndpoint && !hasTokenEndpoint) {
        throw new Error(
          "AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS requires RFC 8414 endpoint publication to be configured.",
        );
      }
      if (
        hasAuthorizationEndpoint &&
        hasTokenEndpoint &&
        (!tokenEndpointAuthMethods || tokenEndpointAuthMethods.length === 0)
      ) {
        throw new Error("RFC 8414 publication requires at least one token endpoint authentication method.");
      }
      for (const method of tokenEndpointAuthMethods ?? []) {
        if (!(OAUTH_TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(method)) {
          throw new Error(
            "AIRMCP_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS contains an unsupported method. " +
              `Expected a comma-separated subset of: ${OAUTH_TOKEN_ENDPOINT_AUTH_METHODS.join(", ")}.`,
          );
        }
      }
      if (ctx.policy === "with-oauth+origin" && ctx.allowedOriginsCount === 0) {
        throw new Error("allowNetwork=with-oauth+origin requires AIRMCP_ALLOWED_ORIGINS.");
      }
      return;
    }
    case "unauthenticated":
      // No invariant — but loudly warn so the choice is visible.
      log.warn("allowNetwork=unauthenticated — tool surface exposed without auth", {
        note: "This mode is intended for CI/debug only. Public deployments in this mode are a security incident.",
      });
      return;
  }
}

export async function startHttpServer(options: HttpServerOptions): Promise<NodeHttpServer> {
  const { port, bindAll, httpToken, allowNetwork: explicitPolicy, unsafeNoAuth, ...serverOptions } = options;
  const { pkg } = serverOptions;

  const express = (await import("express")).default;
  const app = express();

  // Origin validation — MCP spec 2025-11-25 requires 403 for invalid Origin
  const allowedOrigins = parseAllowedOrigins(process.env.AIRMCP_ALLOWED_ORIGINS ?? "");

  // Resolve and validate the declarative network policy before touching the
  // socket. Misconfiguration exits before any routes are mounted, so an
  // operator's footgun (e.g. `--bind-all` without a token) cannot end up as
  // a running-but-insecure server.
  const envPolicy = (process.env.AIRMCP_ALLOW_NETWORK ?? "").trim() as AllowNetwork | "";
  const allowNetwork = resolveAllowNetwork({
    explicit: envPolicy || explicitPolicy || undefined,
    bindAll,
    httpToken,
    allowedOriginsCount: allowedOrigins.size,
    unsafeNoAuth,
  });
  const oauth = readOAuthContext();
  try {
    validateNetworkPolicy({
      policy: allowNetwork,
      bindAll,
      httpToken,
      allowedOriginsCount: allowedOrigins.size,
      oauthIssuer: oauth?.issuer,
      oauthAudience: oauth?.audience,
      oauthAuthorizationEndpoint: oauth?.authorizationEndpoint,
      oauthTokenEndpoint: oauth?.tokenEndpoint,
      oauthJwksUri: oauth?.jwksUri,
      oauthTokenEndpointAuthMethods: oauth?.tokenEndpointAuthMethods,
    });
  } catch (e) {
    // Only the error MESSAGE is logged, never the stack. Stacks can capture
    // interpolated env-derived strings (OAuth issuer URL, audience) which
    // CodeQL's `js/clear-text-logging` treats as sensitive. The message
    // alone tells the operator what invariant failed without re-emitting
    // the config that derived from secret env vars.
    const msg = e instanceof Error ? e.message : String(e);
    log.error("FATAL — startup invariant failed", { reason: msg });
    process.exit(1);
  }
  // Opt-in strict mode (default off): reject requests with no Origin header.
  // Off by default because a missing Origin means a non-browser client gated by
  // the active policy (127.0.0.1 binding for loopback-only, Bearer/JWT auth for
  // token/OAuth) — denying it would break curl / native MCP clients for no
  // security gain, since browsers always send Origin.
  const denyNoOrigin = /^(1|true)$/i.test((process.env.AIRMCP_DENY_NO_ORIGIN ?? "").trim());
  // Install request IDs before CORS / auth so browser clients can correlate
  // preflight, rejected-origin, rate-limit, and bearer-challenge responses.
  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string) || randomBytes(8).toString("hex");
    res.set("X-Request-ID", requestId);
    (req as unknown as Record<string, string>).__requestId = requestId;
    next();
  });

  const CORS_METHODS = ["GET", "POST", "DELETE", "OPTIONS"] as const;
  // Match the headers emitted by the real StreamableHTTPClientTransport.
  // After initialize it sends MCP-Protocol-Version on every request, and a
  // resumed SSE GET carries Last-Event-ID. Omitting either makes a browser
  // fail at preflight before the MCP client can reach this server.
  const CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Mcp-Session-Id",
    "MCP-Protocol-Version",
    "Last-Event-ID",
    "X-AirMCP-Run-Id",
  ] as const;
  const CORS_EXPOSED_HEADERS = [
    "Mcp-Session-Id",
    "MCP-Protocol-Version",
    "X-Request-ID",
    "WWW-Authenticate",
    "Retry-After",
    "RateLimit",
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
    "RateLimit-Policy",
  ] as const;
  const corsAllowedHeaderNames = new Set(CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()));
  const isCorsRoute = (path: string): boolean => path === "/mcp" || path.startsWith("/.well-known/");
  const corsOriginAllowed = new WeakMap<object, boolean>();

  // Canonicalize the browser origin and prepare response headers before the IP
  // bucket runs, but defer rejection until afterwards. This keeps CORS headers
  // on an allowed-origin 429 while ensuring a forged/denied Origin cannot use
  // the cheap 403 path to bypass HTTP abuse accounting.
  app.use((req, res, next) => {
    if (!isCorsRoute(req.path)) return next();
    res.vary("Origin");
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin, { policy: allowNetwork, bindAll, allowedOrigins, denyNoOrigin });
    corsOriginAllowed.set(req, allowed);
    const canonicalOrigin = origin ? normalizeOrigin(origin) : null;
    if (allowed && canonicalOrigin) {
      // Echo the validated canonical origin (instead of `*`) so configuration,
      // discovery, and the response never disagree about default ports or a
      // syntactically tolerated HTTP(S) trailing slash.
      res.set("Access-Control-Allow-Origin", canonicalOrigin);
      res.set("Access-Control-Expose-Headers", CORS_EXPOSED_HEADERS.join(", "));
    }
    next();
  });

  // Per-IP rate limiting (default 120 req/min) with standard RateLimit headers.
  // Both the bucket math and the IP eviction policy live in the shared
  // rate-limit module — this middleware only owns the response shape.
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const verdict = checkIpRateLimit(ip);
    res.set("RateLimit-Limit", String(verdict.limit));
    res.set("RateLimit-Remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      res.set("Retry-After", String(verdict.retryAfterSeconds ?? 60));
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    next();
  });

  // Origin validation is deliberately enforced after rate accounting. A
  // denied browser still receives no Access-Control-Allow-Origin header, but
  // it consumes the same per-IP budget as every other HTTP peer.
  app.use((req, res, next) => {
    if (!isCorsRoute(req.path) || corsOriginAllowed.get(req) !== false) return next();
    res.status(403).json({ error: "Forbidden: Origin not allowed" });
  });

  // Answer a valid preflight after the IP bucket has accounted for it but
  // before bearer authentication. This avoids both auth deadlock and an
  // unmetered browser-request path.
  app.use((req, res, next) => {
    if (!isCorsRoute(req.path) || req.method !== "OPTIONS") return next();
    const origin = req.headers.origin;
    const requestedMethod = req.headers["access-control-request-method"]?.toUpperCase();
    if (!origin || !requestedMethod || !(CORS_METHODS as readonly string[]).includes(requestedMethod)) {
      res.status(403).json({ error: "Forbidden: invalid CORS preflight" });
      return;
    }
    const requestedHeaders = (req.headers["access-control-request-headers"] ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => !corsAllowedHeaderNames.has(header))) {
      res.status(403).json({ error: "Forbidden: invalid CORS preflight headers" });
      return;
    }
    res.set("Access-Control-Allow-Methods", CORS_METHODS.join(", "));
    res.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS.join(", "));
    res.status(204).end();
  });

  // Auth middleware — the branch depends on the active network policy.
  // with-oauth* → JWT verify + AsyncLocalStorage scope context.
  // with-token* (legacy) → static Bearer token + constant-time compare.
  // Everything else (loopback-only, unauthenticated) skips both paths.
  const isOAuthPolicy = allowNetwork === "with-oauth" || allowNetwork === "with-oauth+origin";
  const resourceMetadataPath =
    isOAuthPolicy && oauth?.audience
      ? wellKnownPath(oauth.audience, "oauth-protected-resource")
      : "/.well-known/oauth-protected-resource";
  const resourceMetadataUrl =
    isOAuthPolicy && oauth?.audience ? wellKnownUrl(oauth.audience, "oauth-protected-resource") : "";
  const authorizationServerMetadataPath =
    isOAuthPolicy && oauth?.issuer
      ? wellKnownPath(oauth.issuer, "oauth-authorization-server")
      : "/.well-known/oauth-authorization-server";
  const AUTH_SKIP_PATHS = new Set([
    "/health",
    "/.well-known/mcp.json",
    "/.well-known/oauth-protected-resource",
    resourceMetadataPath,
    authorizationServerMetadataPath,
  ]);

  if (isOAuthPolicy && oauth) {
    // RFC 0005 Step 2 — real JWT verification. issuer + audience are
    // guaranteed present at this point by `validateNetworkPolicy`.
    const oauthCfg = {
      issuer: oauth.issuer,
      audience: oauth.audience,
      ...(oauth.jwksUri ? { jwksUri: oauth.jwksUri } : {}),
    };
    app.use((req, res, next) => {
      if (AUTH_SKIP_PATHS.has(req.path)) return next();
      verifyBearer(req.headers.authorization, oauthCfg)
        .then((result: VerifyResult) => {
          if (!result.ok) {
            auditLog({
              timestamp: new Date().toISOString(),
              tool: "__auth_failure",
              args: {
                ip: req.ip ?? req.socket.remoteAddress ?? "unknown",
                path: req.path,
                reason: result.reason,
              },
              status: "error",
            });
            if (result.reason === "jwks_unreachable") {
              // AS-side problem — retry-safe, not a bad-token signal.
              res.set("Retry-After", "10");
              res.status(503).json({ error: "authorization server unavailable" });
              return;
            }
            const errCode =
              result.reason === "expired" || result.reason === "not_yet_valid" || result.reason === "invalid_signature"
                ? "invalid_token"
                : result.reason === "wrong_audience" || result.reason === "wrong_issuer"
                  ? "invalid_token"
                  : "invalid_request";
            res.set(
              "WWW-Authenticate",
              buildBearerChallenge({
                resourceMetadata: resourceMetadataUrl,
                ...(result.reason === "missing_header" ? {} : { error: errCode }),
                scopes: ["mcp:read"],
                ...(result.reason === "missing_header" ? {} : { errorDescription: result.reason }),
              }),
            );
            res.status(401).json({
              error: "Unauthorized",
              code: result.reason === "missing_header" ? "authorization_required" : errCode,
            });
            return;
          }
          // Happy path — claims available to the tool handler via
          // AsyncLocalStorage. The MCP SDK's dispatcher awaits inside
          // the request chain, so async context propagates end-to-end.
          runWithRequestContext({ oauth: result.claims }, () => next());
        })
        .catch((e: unknown) => {
          // Defensive — verifyBearer's contract says it doesn't throw,
          // but a malformed jose dependency update shouldn't take down
          // the server silently.
          log.error("oauth verify internal error", { err: errToCtx(e) });
          res.status(500).json({ error: "Authorization internal error" });
        });
    });
  } else if (httpToken) {
    // Legacy Bearer token. Hash both inputs to a fixed length before
    // timingSafeEqual so the length comparison itself does not become a
    // timing oracle for the token length.
    const expectedHash = createHash("sha256").update(`Bearer ${httpToken}`).digest();
    app.use((req, res, next) => {
      if (AUTH_SKIP_PATHS.has(req.path)) return next();
      const auth = req.headers.authorization ?? "";
      const authHash = createHash("sha256").update(auth).digest();
      if (!timingSafeEqual(authHash, expectedHash)) {
        auditLog({
          timestamp: new Date().toISOString(),
          tool: "__auth_failure",
          args: { ip: req.ip ?? req.socket.remoteAddress ?? "unknown", path: req.path },
          status: "error",
        });
        res.status(401).json({ error: "Unauthorized: invalid or missing Bearer token" });
        return;
      }
      next();
    });
  }

  // Parse MCP JSON only after origin, rate-limit, preflight, and authentication
  // gates. The parser's errors are normalized here instead of falling through
  // to Express's development handler, which otherwise returns a stack trace
  // containing local absolute paths to an unauthenticated HTTP peer.
  app.use("/mcp", express.json({ limit: "1mb" }));
  app.use(
    "/mcp",
    (
      error: unknown,
      _req: import("express").Request,
      res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      const bodyError = error as { status?: unknown; type?: unknown } | null;
      if (!bodyError || typeof bodyError.type !== "string") return next(error);
      const tooLarge = bodyError.status === 413 || bodyError.type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "JSON body too large" : "Invalid JSON body" });
    },
  );

  // Native app workflows may span more than one MCP request. Carry their
  // explicit UUID through AsyncLocalStorage so approval events, tool results,
  // telemetry, and typed errors can be rendered as one governed run. Invalid
  // or absent headers are ignored; the tool-registry still generates its
  // normal per-call correlation ID. Preserve any OAuth claims installed by
  // the preceding authentication middleware.
  app.use((req, _res, next) => {
    if (req.path !== "/mcp") return next();
    const correlationId = parseRunCorrelationId(req.headers[RUN_ID_HEADER]);
    if (!correlationId) return next();
    return runWithRequestContext({ ...(getRequestContext() ?? {}), correlationId }, () => next());
  });

  // The legacy `--bind-all without token` fatal path is now subsumed by
  // `validateNetworkPolicy` above — we arrive here only after the policy
  // resolver has confirmed the configuration is internally consistent.

  interface Session {
    transport: StreamableHTTPServerTransport;
    server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    toolRegistry: ToolRegistry;
    lastActive: number;
    oauthPrincipal?: OAuthSessionPrincipal;
    cleanupEventListeners?: () => void;
  }
  const sessions = new Map<string, Session>();

  function rejectSessionPrincipalMismatch(req: import("express").Request, res: import("express").Response): void {
    auditLog({
      timestamp: new Date().toISOString(),
      tool: "__authorization_failure",
      args: { path: req.path, reason: "session_principal_mismatch" },
      status: "error",
    });
    res.status(403).json({ error: "Forbidden", code: "session_principal_mismatch" });
  }

  function rejectInsufficientScopes(
    req: import("express").Request,
    res: import("express").Response,
    session: Session,
  ): boolean {
    if (!isOAuthPolicy) return false;
    const claims = getOAuthClaims();
    if (!claims) return false;
    const missingScopes = missingScopesForMcpRequest(req.body, session.toolRegistry, claims);
    if (missingScopes.length === 0) return false;
    auditLog({
      timestamp: new Date().toISOString(),
      tool: "__authorization_failure",
      args: { path: req.path, reason: "insufficient_scope", requiredScopes: missingScopes },
      status: "error",
    });
    res.set(
      "WWW-Authenticate",
      buildBearerChallenge({
        resourceMetadata: resourceMetadataUrl,
        error: "insufficient_scope",
        scopes: missingScopes,
        errorDescription: "Additional permission required for this operation",
      }),
    );
    res.status(403).json({
      error: "Forbidden",
      code: "insufficient_scope",
      required_scope: missingScopes.join(" "),
      resource_metadata: resourceMetadataUrl,
    });
    return true;
  }

  /** Clean up all resources for a session (transport, server, event listeners). Idempotent.
   *  Each cleanup step is wrapped individually so a failure in one step does not
   *  prevent the remaining steps from running. */
  function destroySession(id: string, s: Session): void {
    if (!sessions.has(id)) return; // Already destroyed by another async path
    sessions.delete(id);
    try {
      s.cleanupEventListeners?.();
    } catch (e) {
      log.error("session listener cleanup failed", { session: id, err: errToCtx(e) });
    }
    try {
      s.transport.close?.();
    } catch (e) {
      log.error("session transport close failed", { session: id, err: errToCtx(e) });
    }
    try {
      s.server.close?.();
    } catch (e) {
      log.error("session server close failed", { session: id, err: errToCtx(e) });
    }
  }

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const id of [...sessions.keys()]) {
      const s = sessions.get(id);
      if (s && now - s.lastActive > TIMEOUT.SESSION_IDLE) {
        destroySession(id, s);
      }
    }
  }, TIMEOUT.SESSION_CLEANUP);
  if (cleanupInterval.unref) cleanupInterval.unref();

  // Health check — for load balancers, monitoring, and readiness probes.
  // `appOwned` is deliberately non-sensitive: the macOS app still requires
  // the private bearer token and an MCP round trip before it trusts a listener.
  // The bit only prevents it from adopting/killing a same-token runtime the
  // user launched manually on the reserved port.
  const appRuntimeOwnerFingerprint = runtimeOwnerFingerprint(process.env.AIRMCP_APP_RUNTIME_OWNER_SECRET);
  const appOwnedRuntime =
    process.env.AIRMCP_APP_OWNED_RUNTIME === "1" && Boolean(httpToken) && Boolean(appRuntimeOwnerFingerprint);
  // Warmup owns the authoritative effective module surface. Keep it nullable
  // until createServer has applied module packs, add-on presence, and host/OS
  // compatibility; an empty array before then would be false readiness.
  let runtimeModuleState: RuntimeModuleState | null = null;
  let enabledModuleNames: string[] = [];
  let discoveryRegistry: ToolRegistry | null = null;
  let modulesWarming = true;
  // Note: session counts and uptime omitted to prevent information leakage.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: pkg.version,
      appOwned: appOwnedRuntime,
    });
  });

  // Authenticated native-app state: unlike public /health, this may reveal the
  // effective module and HITL policies. Setup uses it to prove the running
  // generation actually parsed the exact scope and per-call approval policy.
  // PID plus the app-only owner fingerprint binds lifecycle control to this
  // exact process instead of every process with a matching command line.
  app.get("/app/runtime-state", (_req, res) => {
    if (!appOwnedRuntime || !httpToken || !appRuntimeOwnerFingerprint) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!runtimeModuleState) {
      res.set("Retry-After", "1");
      res.status(503).json({ error: "Runtime module surface is still warming" });
      return;
    }
    const disabledModules = [...(serverOptions.config?.disabledModules ?? [])].sort();
    const effectiveHitlWhitelist = [...serverOptions.config.hitl.whitelist].sort();
    res.json({
      status: "ok",
      version: pkg.version,
      appOwned: appOwnedRuntime,
      pid: process.pid,
      ownerFingerprint: appRuntimeOwnerFingerprint,
      disabledModules,
      scopeFingerprint: runtimeScopeFingerprint(disabledModules),
      enabledModules: runtimeModuleState.enabledModules,
      unavailableModules: runtimeModuleState.unavailableModules,
      effectiveHitlLevel: serverOptions.config.hitl.level,
      effectiveHitlWhitelist,
    });
  });

  // MCP Server Card — .well-known discovery for registry crawlers.
  // Shape + rationale lives in well-known-card.ts; we capture the
  // enabled-module list via closure so it reflects the live module
  // selection once `createServer` runs (depends on config + OS gates).
  // True until the background warmup resolves the live module list. While
  // false the module list is not yet known, so the discovery card must NOT
  // claim `modules: []` — it advertises a `warming` status instead so a
  // crawler hitting the warmup window can distinguish "no modules" from
  // "not resolved yet". Tools are read live from toolRegistry and stay valid.
  app.get("/.well-known/mcp.json", (_req, res) => {
    const card = buildServerCard({
      name: NPM_PACKAGE_NAME,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      homepage: pkg.homepage,
      websiteUrl: WEBSITE_URL,
      icon: SERVER_ICON,
      httpToken,
      allowNetwork,
      allowedOrigins: [...allowedOrigins],
      // Read the advertised tools/list inventory at request time so a
      // hot-reload, profile change, or later `listChanged` notification
      // doesn't leave the discovery card stale or wider than active exposure.
      tools: {
        count: discoveryRegistry?.getExposedToolCount() ?? 0,
        names: discoveryRegistry?.getExposedToolNames() ?? [],
      },
      modules: enabledModuleNames,
      oauth: oauth ?? undefined,
    });
    if (modulesWarming) card.warming = true;
    res.json(card);
  });

  // RFC 9728 — OAuth protected resource metadata. Emitted only when
  // the active policy is an OAuth policy AND issuer + audience are
  // both configured (otherwise returning the card with empty fields
  // would mislead Managed Agents into bootstrapping against nothing).
  const serveProtectedResourceMetadata = (_req: import("express").Request, res: import("express").Response) => {
    const isOAuth = allowNetwork === "with-oauth" || allowNetwork === "with-oauth+origin";
    if (!isOAuth || !oauth?.issuer || !oauth.audience) {
      res.status(404).json({ error: "Not Found — server is not in an OAuth policy" });
      return;
    }
    res.json(buildOAuthProtectedResourceCard(oauth.audience, oauth.issuer));
  };
  // The path derived from a path-bearing resource identifier is normative
  // (RFC 9728 §3.1). Keep the legacy root location as an explicit compatibility
  // alias; WWW-Authenticate always points clients at the derived path.
  for (const path of new Set(["/.well-known/oauth-protected-resource", resourceMetadataPath])) {
    app.get(path, serveProtectedResourceMetadata);
  }

  // RFC 8414 metadata publication is opt-in because AirMCP remains a resource
  // server by default. It becomes authoritative only when the operator routes
  // the configured issuer origin to this process and provides both endpoints.
  app.get(authorizationServerMetadataPath, (_req, res) => {
    if (
      !isOAuthPolicy ||
      !oauth?.authorizationEndpoint ||
      !oauth.tokenEndpoint ||
      !oauth.tokenEndpointAuthMethods?.length
    ) {
      res.status(404).json({ error: "Not Found — authorization-server metadata is not configured" });
      return;
    }
    res.json(
      buildOAuthAuthorizationServerMetadata({
        issuer: oauth.issuer,
        authorizationEndpoint: oauth.authorizationEndpoint,
        tokenEndpoint: oauth.tokenEndpoint,
        tokenEndpointAuthMethodsSupported: oauth.tokenEndpointAuthMethods,
      }),
    );
  });

  // Reverse-proxy header soft-detection (RFC 0002 Phase 2).
  //
  // Loopback-only servers behind a misconfigured reverse proxy are the
  // motivating threat: AirMCP sees 127.0.0.1 and skips auth while the
  // proxy has actually exposed the server on a public interface. If we
  // see `X-Forwarded-*` or a non-loopback Host header, surface it once
  // per process to stderr + audit so operators get a clear nudge to
  // move to `with-token` (or explicitly acknowledge the proxy with an
  // origin allow-list).
  let proxyWarned = false;
  app.use((req, _res, next) => {
    if (proxyWarned || allowNetwork !== "loopback-only") return next();
    const forwardedFor = req.headers["x-forwarded-for"];
    const forwardedHost = req.headers["x-forwarded-host"];
    const realIp = req.headers["x-real-ip"];
    const host = (req.headers.host as string | undefined) ?? "";
    const hostIsRemote =
      host !== "" &&
      !/^localhost(:\d+)?$/.test(host) &&
      !/^127\.0\.0\.1(:\d+)?$/.test(host) &&
      !/^\[::1\](:\d+)?$/.test(host);
    if (forwardedFor || forwardedHost || realIp || hostIsRemote) {
      proxyWarned = true;
      const signals = [
        forwardedFor && `X-Forwarded-For=${String(forwardedFor).slice(0, 64)}`,
        forwardedHost && `X-Forwarded-Host=${String(forwardedHost).slice(0, 64)}`,
        realIp && `X-Real-IP=${String(realIp).slice(0, 64)}`,
        hostIsRemote && `Host=${host}`,
      ]
        .filter(Boolean)
        .join(", ");
      log.warn("proxy signal detected on a loopback-only server", {
        signals,
        remediation:
          'If AirMCP is reachable from outside this machine, set AIRMCP_ALLOW_NETWORK="with-token" (or "with-token+origin") + AIRMCP_HTTP_TOKEN. This warning fires once per process.',
      });
      auditLog({
        timestamp: new Date().toISOString(),
        tool: "__proxy_signal_detected",
        args: { signals, policy: allowNetwork },
        status: "ok",
      });
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const requestPrincipal = toOAuthSessionPrincipal(getOAuthClaims());

      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        if (!isSameOAuthSessionPrincipal(existing.oauthPrincipal, requestPrincipal)) {
          rejectSessionPrincipalMismatch(req, res);
          return;
        }
        if (rejectInsufficientScopes(req, res, existing)) return;
        existing.lastActive = Date.now();
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      if (sessions.size >= LIMITS.HTTP_SESSIONS) {
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Too many concurrent sessions. Try again later." },
          id: null,
        });
        return;
      }

      const { server, toolRegistry, cleanupEventListeners } = await createServer(serverOptions);
      let assignedSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          assignedSessionId = id;
          sessions.set(id, {
            transport,
            server,
            toolRegistry,
            lastActive: Date.now(),
            oauthPrincipal: requestPrincipal,
            cleanupEventListeners,
          });
        },
        onsessionclosed: (id) => {
          const s = sessions.get(id);
          if (s) destroySession(id, s);
        },
      });

      // Immediate cleanup when transport closes (don't wait for 60s cleanup interval)
      transport.onclose = () => {
        if (assignedSessionId) {
          const s = sessions.get(assignedSessionId);
          if (s) destroySession(assignedSessionId, s);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // If session was never initialized (transport rejected), clean up
      if (!assignedSessionId) {
        transport.onclose = undefined;
        server.close?.();
      }
    } catch (err) {
      log.error("POST /mcp request failed", { err: errToCtx(err) });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null,
        });
      }
    }
  });

  // Shared handler for GET/DELETE (SSE streaming + session close)
  const handleSessionRequest = async (
    req: import("express").Request,
    res: import("express").Response,
    method: string,
  ) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const s = sessionId ? sessions.get(sessionId) : undefined;
      if (!s) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      const requestPrincipal = toOAuthSessionPrincipal(getOAuthClaims());
      if (!isSameOAuthSessionPrincipal(s.oauthPrincipal, requestPrincipal)) {
        rejectSessionPrincipalMismatch(req, res);
        return;
      }
      s.lastActive = Date.now();

      // For SSE GET streams: clean up immediately when the client disconnects
      // (don't wait for the 60s cleanup interval). Without this, abrupt disconnects
      // leave transport buffers + ReadableStream controllers in memory until idle timeout.
      if (method === "GET" && sessionId) {
        const sid = sessionId;
        res.on("close", () => {
          const entry = sessions.get(sid);
          if (entry) destroySession(sid, entry);
        });
      }

      await s.transport.handleRequest(req, res);
    } catch (err) {
      log.error("session request failed", { method, err: errToCtx(err) });
    }
  };

  app.get("/mcp", (req, res) => handleSessionRequest(req, res, "GET"));
  app.delete("/mcp", (req, res) => handleSessionRequest(req, res, "DELETE"));

  // Pre-warm module registry + shortcuts cache in the background. The HTTP
  // listener must bind before this heavier module pass so app-owned runtime
  // probes can distinguish "socket is up" from "module warmup is still busy".
  // First real MCP sessions still create their own server instance; prewarm is
  // only a cache/discovery optimization.
  const warmupPromise = (async () => {
    const {
      bannerInfo: bi,
      server: warmupServer,
      toolRegistry: warmupRegistry,
      runtimeModuleState: warmedRuntimeModuleState,
      cleanupEventListeners: warmupCleanup,
    } = await createServer(serverOptions);
    warmupCleanup();
    warmupServer.close?.();
    // Publish the resolved enabled-module list into the .well-known
    // card's closure so registry crawlers see what's actually loaded
    // on this host (module enablement depends on config + OS gates).
    runtimeModuleState = warmedRuntimeModuleState;
    enabledModuleNames = warmedRuntimeModuleState.enabledModules;
    discoveryRegistry = warmupRegistry;
    modulesWarming = false;
    return bi;
  })();
  const host = bindAll ? "0.0.0.0" : "127.0.0.1";
  const httpServer = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.once("listening", async () => {
      httpServer.off("error", reject);
      // Keep a permanent error handler after the socket is bound. Without it a
      // post-listen server "error" (accept failure under fd exhaustion, late
      // EADDR change, etc.) has no listener, so Node throws it as an uncaught
      // exception and the whole MCP server crashes. Log and keep serving.
      httpServer.on("error", (err) => log.error("http server error (post-listen)", { err: errToCtx(err) }));
      try {
        if (bindAll)
          log.warn("bound to all interfaces", {
            host: "0.0.0.0",
            port,
            auth: httpToken ? "token" : "NONE",
          });
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
  void warmupPromise
    .then(async (bi) => {
      const address = httpServer.address();
      bi.transport = "http";
      bi.port = address && typeof address !== "string" ? address.port : port;
      await printBanner(bi);
    })
    .catch((err) => {
      log.error("HTTP prewarm failed", { err: errToCtx(err) });
      auditLog({
        timestamp: new Date().toISOString(),
        tool: "__http_prewarm_failed",
        args: { transport: "http", error: err instanceof Error ? err.message : String(err) },
        status: "error",
      });
    });

  // One server lifecycle owns one idle-session timer, one process exit
  // listener, and one async shutdown hook. Explicit `server.close()` must
  // release all three; otherwise an embedded/repeated start-close cycle keeps
  // the whole server closure alive until process exit. The process-wide IP
  // prune timer is intentionally retained across an explicit server close and
  // is stopped only when the process itself is shutting down.
  let lifecycleDisposed = false;
  const disposeLifecycle = (): void => {
    if (lifecycleDisposed) return;
    lifecycleDisposed = true;
    clearInterval(cleanupInterval);
    process.off("exit", onProcessExit);
    unregisterShutdownHook(shutdownHook);
  };

  function onProcessExit(): void {
    disposeLifecycle();
    clearInterval(ratePruneTimer);
    httpServer.close();
  }

  async function shutdownHook(): Promise<void> {
    // Unregister first so an already-completed shutdown cannot be retained or
    // executed again. runShutdownHooks() iterates a snapshot, so removing this
    // callback while it is running does not disturb the audit finalizer stage.
    disposeLifecycle();
    clearInterval(ratePruneTimer);
    // Tear down active sessions so SSE streams close cleanly and HITL
    // timers stop. `destroySession` is idempotent — duplicate calls from
    // transport.onclose / onsessionclosed racing with this path are safe.
    for (const [id, s] of [...sessions.entries()]) destroySession(id, s);
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      httpServer.close(() => done());
      setTimeout(done, 3000);
    });
  }

  registerShutdownHook(shutdownHook);
  process.on("exit", onProcessExit);
  httpServer.once("close", disposeLifecycle);
  return httpServer;
}
