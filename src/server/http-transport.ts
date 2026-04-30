/**
 * HTTP/SSE transport — Express server with StreamableHTTP sessions,
 * bearer token auth, health/discovery endpoints, and session management.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { NPM_PACKAGE_NAME } from "../shared/config.js";
import { LIMITS, TIMEOUT } from "../shared/constants.js";
import { printBanner } from "../shared/banner.js";
import { auditLog } from "../shared/audit.js";
import { SERVER_ICON, WEBSITE_URL } from "../shared/icons.js";
import { toolRegistry } from "../shared/tool-registry.js";
import { runWithRequestContext } from "../shared/request-context.js";
import { checkIpRateLimit, pruneStaleIpBuckets } from "../shared/rate-limit.js";
import { createServer, type CreateServerOptions } from "./mcp-setup.js";
import { registerShutdownHook } from "./shutdown.js";
import { buildServerCard, buildOAuthProtectedResourceCard } from "./well-known-card.js";
import { verifyBearer, type VerifyResult } from "./oauth-verifier.js";

// Per-IP rate limiting now lives in src/shared/rate-limit.ts so the
// bucket math is shared with the per-tenant tool-call gate. Prune
// stale buckets once per window so a long-running server doesn't
// accumulate state from rotating client IPs.
const ratePruneTimer = setInterval(() => pruneStaleIpBuckets(), 60_000);
if (ratePruneTimer.unref) ratePruneTimer.unref();

// Compiled once — used in Origin validation middleware
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

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
  | "loopback-only"
  | "with-token"
  | "with-token+origin"
  | "with-oauth"
  | "with-oauth+origin"
  | "unauthenticated";

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

/** RFC 0005 Step 1 — OAuth issuer + audience. Read once at startup so
 *  subsequent handlers can reference them without re-probing env. Both
 *  are required when `allowNetwork` lands on `with-oauth*` (enforced by
 *  `validateNetworkPolicy`); Step 1 doesn't verify JWTs yet, but the
 *  discovery card emits them so MCP clients (including Managed Agents /
 *  Cowork) can bootstrap against the right authorization server. */
export interface OAuthContext {
  issuer: string;
  /** Resource Indicators target per RFC 8707 — the `aud` claim a valid
   *  token must carry. Typically the server's public MCP endpoint URL. */
  audience: string;
}

export function readOAuthContext(): OAuthContext | null {
  const issuer = (process.env.AIRMCP_OAUTH_ISSUER ?? "").trim();
  const audience = (process.env.AIRMCP_OAUTH_AUDIENCE ?? "").trim();
  if (!issuer && !audience) return null;
  return { issuer, audience };
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

/** Startup invariant check. Throws on misconfiguration so the process
 *  refuses to start rather than silently exposing the tool surface. */
export function validateNetworkPolicy(ctx: {
  policy: AllowNetwork;
  bindAll: boolean;
  httpToken: string;
  allowedOriginsCount: number;
  oauthIssuer?: string;
  oauthAudience?: string;
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
    case "with-oauth+origin":
      // RFC 0005 Step 1 — discovery-only. Startup still refuses when
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
      if (!/^https:\/\//.test(ctx.oauthIssuer)) {
        throw new Error(
          `AIRMCP_OAUTH_ISSUER must be an https:// URL (got "${ctx.oauthIssuer}"). ` +
            "Plain http issuers are a security hole — reject at startup.",
        );
      }
      if (!ctx.oauthAudience) {
        throw new Error(
          `allowNetwork=${ctx.policy} requires AIRMCP_OAUTH_AUDIENCE ` +
            "(RFC 8707 Resource Indicator — the URL your MCP endpoint is reachable at).",
        );
      }
      if (ctx.policy === "with-oauth+origin" && ctx.allowedOriginsCount === 0) {
        throw new Error("allowNetwork=with-oauth+origin requires AIRMCP_ALLOWED_ORIGINS.");
      }
      // No token validation happens in Step 1 — middleware is a follow-up.
      // The server will refuse tool calls until Step 2 lands; for now, the
      // .well-known card advertises OAuth support so Managed Agents /
      // discovery clients can see the auth model before they try.
      console.error(
        `[AirMCP] allowNetwork=${ctx.policy} — Step 1 (discovery-only). ` +
          "Token validation middleware arrives in a follow-up; " +
          "do NOT bind this to a public interface until the middleware lands.",
      );
      return;
    case "unauthenticated":
      // No invariant — but loudly warn so the choice is visible.
      console.error(
        "[AirMCP] ⚠️  allowNetwork=unauthenticated — tool surface is exposed without auth. " +
          "This mode is intended for CI/debug only. Public deployments in this mode are a security incident.",
      );
      return;
  }
}

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const { port, bindAll, httpToken, allowNetwork: explicitPolicy, unsafeNoAuth, ...serverOptions } = options;
  const { pkg } = serverOptions;

  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Origin validation — MCP spec 2025-11-25 requires 403 for invalid Origin
  const allowedOrigins = new Set<string>((process.env.AIRMCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean));

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
    });
  } catch (e) {
    console.error(`[AirMCP] FATAL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  app.use((req, res, next) => {
    if (req.path !== "/mcp") return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (LOCALHOST_ORIGIN_RE.test(origin)) return next();
    if (allowedOrigins.has(origin)) return next();
    // Reject unless bind-all with no explicit allow-list (operator chose open access)
    if (!bindAll || allowedOrigins.size > 0) {
      res.status(403).json({ error: "Forbidden: Origin not allowed" });
      return;
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

  // Auth middleware — the branch depends on the active network policy.
  // with-oauth* → JWT verify + AsyncLocalStorage scope context.
  // with-token* (legacy) → static Bearer token + constant-time compare.
  // Everything else (loopback-only, unauthenticated) skips both paths.
  const isOAuthPolicy = allowNetwork === "with-oauth" || allowNetwork === "with-oauth+origin";
  const AUTH_SKIP_PATHS = new Set(["/health", "/.well-known/mcp.json", "/.well-known/oauth-protected-resource"]);

  if (isOAuthPolicy && oauth) {
    // RFC 0005 Step 2 — real JWT verification. issuer + audience are
    // guaranteed present at this point by `validateNetworkPolicy`.
    const oauthCfg = { issuer: oauth.issuer, audience: oauth.audience };
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
            // RFC 6750 §3 — advertise resource + error on 401 so
            // conforming clients can retry with corrected audience /
            // scope before giving up.
            const resource = oauth.audience;
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
              `Bearer resource="${resource}", error="${errCode}", error_description="${result.reason}"`,
            );
            res.status(401).json({ error: "Unauthorized", code: errCode });
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
          console.error("[AirMCP] OAuth verify internal error:", e);
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
  // The legacy `--bind-all without token` fatal path is now subsumed by
  // `validateNetworkPolicy` above — we arrive here only after the policy
  // resolver has confirmed the configuration is internally consistent.

  interface Session {
    transport: StreamableHTTPServerTransport;
    server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    lastActive: number;
    cleanupEventListeners?: () => void;
  }
  const sessions = new Map<string, Session>();

  /** Clean up all resources for a session (transport, server, event listeners). Idempotent.
   *  Each cleanup step is wrapped individually so a failure in one step does not
   *  prevent the remaining steps from running. */
  function destroySession(id: string, s: Session): void {
    if (!sessions.has(id)) return; // Already destroyed by another async path
    sessions.delete(id);
    try {
      s.cleanupEventListeners?.();
    } catch (e) {
      console.error(`[AirMCP] Session ${id} listener cleanup error:`, e);
    }
    try {
      s.transport.close?.();
    } catch (e) {
      console.error(`[AirMCP] Session ${id} transport close error:`, e);
    }
    try {
      s.server.close?.();
    } catch (e) {
      console.error(`[AirMCP] Session ${id} server close error:`, e);
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

  // Health check — for load balancers, monitoring, and readiness probes
  // Note: session counts and uptime omitted to prevent information leakage
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: pkg.version,
    });
  });

  // MCP Server Card — .well-known discovery for registry crawlers.
  // Shape + rationale lives in well-known-card.ts; we capture the
  // enabled-module list via closure so it reflects the live module
  // selection once `createServer` runs (depends on config + OS gates).
  let enabledModuleNames: string[] = [];
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json(
      buildServerCard({
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
        // Read tool inventory at request time so a hot-reload or a
        // later `listChanged` notification doesn't leave the card stale.
        tools: {
          count: toolRegistry.getToolCount(),
          names: toolRegistry.getToolNames(),
        },
        modules: enabledModuleNames,
        oauth: oauth ?? undefined,
      }),
    );
  });

  // RFC 9728 — OAuth protected resource metadata. Emitted only when
  // the active policy is an OAuth policy AND issuer + audience are
  // both configured (otherwise returning the card with empty fields
  // would mislead Managed Agents into bootstrapping against nothing).
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    const isOAuth = allowNetwork === "with-oauth" || allowNetwork === "with-oauth+origin";
    if (!isOAuth || !oauth?.issuer || !oauth.audience) {
      res.status(404).json({ error: "Not Found — server is not in an OAuth policy" });
      return;
    }
    res.json(buildOAuthProtectedResourceCard(oauth.audience, oauth.issuer));
  });

  // Request ID middleware for tracing
  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string) || randomBytes(8).toString("hex");
    res.set("X-Request-ID", requestId);
    (req as unknown as Record<string, string>).__requestId = requestId;
    next();
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
      console.error(
        `[AirMCP] ⚠️  Proxy signal detected on a loopback-only server (${signals}). ` +
          "If AirMCP is reachable from outside this machine, move to " +
          'AIRMCP_ALLOW_NETWORK="with-token" (or "with-token+origin") + AIRMCP_HTTP_TOKEN. ' +
          "This warning fires once per process.",
      );
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

      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
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

      const { server, cleanupEventListeners } = await createServer(serverOptions);
      let assignedSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          assignedSessionId = id;
          sessions.set(id, { transport, server, lastActive: Date.now(), cleanupEventListeners });
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
      console.error("POST /mcp error:", err);
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
      console.error(`${method} /mcp error:`, err);
    }
  };

  app.get("/mcp", (req, res) => handleSessionRequest(req, res, "GET"));
  app.delete("/mcp", (req, res) => handleSessionRequest(req, res, "DELETE"));

  // Pre-warm module registry + shortcuts cache (avoids per-session subprocess)
  const {
    bannerInfo: bi,
    server: warmupServer,
    cleanupEventListeners: warmupCleanup,
  } = await createServer(serverOptions);
  warmupCleanup();
  warmupServer.close?.();
  // Publish the resolved enabled-module list into the .well-known
  // card's closure so registry crawlers see what's actually loaded
  // on this host (module enablement depends on config + OS gates).
  enabledModuleNames = bi.modulesEnabled;
  const host = bindAll ? "0.0.0.0" : "127.0.0.1";
  const httpServer = app.listen(port, host, async () => {
    bi.transport = "http";
    bi.port = port;
    await printBanner(bi);
    if (bindAll)
      console.error(
        `[AirMCP] Bound to all interfaces (0.0.0.0:${port})${httpToken ? " with token auth" : " — NO AUTH"}`,
      );
  });

  // Release the listening socket and per-process timers on shutdown so
  // in-flight requests are not left dangling and the port can be reused.
  // The "exit" hook only handles synchronous teardown (Node disallows async
  // work there); graceful shutdown of active sessions runs via the shutdown
  // hook installed below, which is bounded by GRACEFUL_SHUTDOWN_TIMEOUT.
  process.on("exit", () => {
    clearInterval(cleanupInterval);
    clearInterval(ratePruneTimer);
    httpServer.close();
  });

  registerShutdownHook(async () => {
    clearInterval(cleanupInterval);
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
  });
}
