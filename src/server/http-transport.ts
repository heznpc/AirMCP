/**
 * HTTP/SSE transport — Express server with StreamableHTTP sessions,
 * bearer token auth, health/discovery endpoints, and session management.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, timingSafeEqual, randomBytes } from "node:crypto";
import { NPM_PACKAGE_NAME } from "../shared/config.js";
import { LIMITS, TIMEOUT } from "../shared/constants.js";
import { printBanner } from "../shared/banner.js";
import { auditLog } from "../shared/audit.js";
import { SERVER_ICON, WEBSITE_URL } from "../shared/icons.js";
import { createServer, type CreateServerOptions } from "./mcp-setup.js";

// ── Per-IP rate limiter (token bucket, no external dependency) ────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120; // 120 requests/minute per IP

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket) {
    // Evict oldest bucket if map is at capacity (prevents unbounded growth from IP rotation)
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest !== undefined) rateBuckets.delete(oldest);
    }
    bucket = { tokens: RATE_MAX_REQUESTS, lastRefill: now };
    rateBuckets.set(ip, bucket);
  }
  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(RATE_MAX_REQUESTS, bucket.tokens + (elapsed / RATE_WINDOW_MS) * RATE_MAX_REQUESTS);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}

// Clean stale rate buckets every window cycle (prevents accumulation from rotating IPs)
const ratePruneTimer = setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.lastRefill < cutoff) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS);
if (ratePruneTimer.unref) ratePruneTimer.unref();

// Compiled once — used in Origin validation middleware
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface HttpServerOptions extends CreateServerOptions {
  port: number;
  bindAll: boolean;
  httpToken: string;
}

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const { port, bindAll, httpToken, ...serverOptions } = options;
  const { pkg } = serverOptions;

  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Origin validation — MCP spec 2025-11-25 requires 403 for invalid Origin
  const allowedOrigins = new Set<string>((process.env.AIRMCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean));
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

  // Per-IP rate limiting — 120 requests/minute (with standard RateLimit headers)
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      res.set("RateLimit-Limit", String(RATE_MAX_REQUESTS));
      res.set("RateLimit-Remaining", "0");
      res.set("Retry-After", "60");
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    const bucket = rateBuckets.get(ip);
    if (bucket) {
      res.set("RateLimit-Limit", String(RATE_MAX_REQUESTS));
      res.set("RateLimit-Remaining", String(Math.floor(bucket.tokens)));
    }
    next();
  });

  // Bearer token auth — required when --bind-all is used, optional otherwise
  if (httpToken) {
    app.use((req, res, next) => {
      // Skip auth for health/discovery endpoints
      if (req.path === "/health" || req.path === "/.well-known/mcp.json") return next();
      const auth = req.headers.authorization;
      const expected = `Bearer ${httpToken}`;
      const authBuf = Buffer.from(auth ?? "");
      const expBuf = Buffer.from(expected);
      if (authBuf.length !== expBuf.length || !timingSafeEqual(authBuf, expBuf)) {
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
  } else if (bindAll) {
    console.error(
      "[AirMCP] FATAL: --bind-all requires AIRMCP_HTTP_TOKEN. Refusing to expose all tools without authentication.",
    );
    process.exit(1);
  }

  interface Session {
    transport: StreamableHTTPServerTransport;
    server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    lastActive: number;
    cleanupEventListeners?: () => void;
  }
  const sessions = new Map<string, Session>();

  /** Clean up all resources for a session (transport, server, event listeners). Idempotent. */
  function destroySession(id: string, s: Session): void {
    if (!sessions.has(id)) return; // Already destroyed by another async path
    sessions.delete(id);
    try {
      s.cleanupEventListeners?.();
      s.transport.close?.();
      s.server.close?.();
    } catch (e) {
      console.error(`[AirMCP] Session ${id} cleanup error:`, e);
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

  process.on("exit", () => {
    clearInterval(cleanupInterval);
    clearInterval(ratePruneTimer);
  });

  // Health check — for load balancers, monitoring, and readiness probes
  // Note: session counts and uptime omitted to prevent information leakage
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: pkg.version,
    });
  });

  // MCP Server Card — spec 2025-11-25 .well-known discovery
  const serverCard = {
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
    description: pkg.description,
    websiteUrl: WEBSITE_URL,
    icons: [SERVER_ICON],
    transport: { type: "streamable-http" as const, url: "/mcp" },
    capabilities: {
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true },
    },
    ...(httpToken ? { authorization: { type: "bearer" as const } } : {}),
  };
  app.get("/.well-known/mcp.json", (_req, res) => res.json(serverCard));

  // Request ID middleware for tracing
  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string) || randomBytes(8).toString("hex");
    res.set("X-Request-ID", requestId);
    (req as unknown as Record<string, string>).__requestId = requestId;
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
  const host = bindAll ? "0.0.0.0" : "127.0.0.1";
  app.listen(port, host, async () => {
    bi.transport = "http";
    bi.port = port;
    await printBanner(bi);
    if (bindAll)
      console.error(
        `[AirMCP] Bound to all interfaces (0.0.0.0:${port})${httpToken ? " with token auth" : " — NO AUTH"}`,
      );
  });
}
