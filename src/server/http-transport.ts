/**
 * HTTP/SSE transport — Express server with StreamableHTTP sessions,
 * bearer token auth, health/discovery endpoints, and session management.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { NPM_PACKAGE_NAME } from "../shared/config.js";
import { LIMITS, TIMEOUT } from "../shared/constants.js";
import { printBanner } from "../shared/banner.js";
import { createServer, type CreateServerOptions } from "./mcp-setup.js";

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
        res.status(401).json({ error: "Unauthorized: invalid or missing Bearer token" });
        return;
      }
      next();
    });
  } else if (bindAll) {
    console.error("[AirMCP] WARNING: --bind-all without AIRMCP_HTTP_TOKEN is insecure. Set AIRMCP_HTTP_TOKEN for authentication.");
  }

  interface Session {
    transport: StreamableHTTPServerTransport;
    server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    lastActive: number;
  }
  const sessions = new Map<string, Session>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const id of [...sessions.keys()]) {
      const s = sessions.get(id);
      if (s && now - s.lastActive > TIMEOUT.SESSION_IDLE) {
        try {
          s.transport.close?.();
          s.server.close?.();
        } catch (e) {
          console.error(`[AirMCP] Session ${id} cleanup error:`, e);
        }
        sessions.delete(id);
      }
    }
  }, TIMEOUT.SESSION_CLEANUP);

  process.on("exit", () => clearInterval(cleanupInterval));

  // Health check — for load balancers, monitoring, and readiness probes
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: pkg.version,
      uptime: Math.floor(process.uptime()),
      sessions: {
        active: sessions.size,
        limit: LIMITS.HTTP_SESSIONS,
      },
    });
  });

  // MCP Server Card — discovery endpoint for Claude, VS Code Copilot, etc.
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json({
      name: NPM_PACKAGE_NAME,
      version: pkg.version,
      description: "MCP server for the entire Apple ecosystem — 262 tools, 32 prompts across 25 modules. macOS only.",
      transport: { type: "streamable-http", url: "/mcp" },
      capabilities: {
        tools: { listChanged: true, filtering: true },
        prompts: true,
        resources: true,
      },
    });
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

      const { server } = await createServer(serverOptions);
      let assignedSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          assignedSessionId = id;
          sessions.set(id, { transport, server, lastActive: Date.now() });
        },
        onsessionclosed: (id) => {
          const s = sessions.get(id);
          if (s) s.server.close?.();
          sessions.delete(id);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // If session was never initialized (transport rejected), clean up
      if (!assignedSessionId) {
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
  const handleSessionRequest = async (req: import("express").Request, res: import("express").Response, method: string) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const s = sessionId ? sessions.get(sessionId) : undefined;
      if (!s) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }
      s.lastActive = Date.now();
      await s.transport.handleRequest(req, res);
    } catch (err) {
      console.error(`${method} /mcp error:`, err);
    }
  };

  app.get("/mcp", (req, res) => handleSessionRequest(req, res, "GET"));
  app.delete("/mcp", (req, res) => handleSessionRequest(req, res, "DELETE"));

  // Pre-warm module registry + shortcuts cache (avoids per-session subprocess)
  const { bannerInfo: bi, server: warmupServer } = await createServer(serverOptions);
  warmupServer.close?.();
  const host = bindAll ? "0.0.0.0" : "127.0.0.1";
  app.listen(port, host, async () => {
    bi.transport = "http";
    bi.port = port;
    await printBanner(bi);
    if (bindAll) console.error(`[AirMCP] Bound to all interfaces (0.0.0.0:${port})${httpToken ? " with token auth" : " — NO AUTH"}`);
  });
}
