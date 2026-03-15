#!/usr/bin/env node

if (!process.env.HOME && !process.env.USERPROFILE) {
  console.error("[AirMCP] HOME environment variable not set — cannot initialize");
  process.exit(1);
}

// CLI subcommands: route before heavy imports
const _sub = process.argv[2];
if (_sub === "init" || _sub === "doctor" || _sub === "--help" || _sub === "-h" || _sub === "help") {
  if (_sub === "init") {
    const mod = await import("./cli/init.js");
    await mod.runInit();
  } else if (_sub === "doctor") {
    const mod = await import("./cli/doctor.js");
    await mod.runDoctor();
  } else {
    const mod = await import("./cli/help.js");
    mod.runHelp();
  }
  process.exit(0);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, err } from "./shared/result.js";
import { registerCrossPrompts } from "./cross/prompts.js";
import { registerCrossTools } from "./cross/tools.js";
import { registerSemanticTools } from "./semantic/tools.js";
import { registerResources } from "./shared/resources.js";
import { registerSetupTools } from "./shared/setup.js";
import { registerSkillEngine } from "./skills/index.js";
import { registerApps } from "./apps/tools.js";
import { parseConfig, isModuleEnabled, getOsVersion, NPM_PACKAGE_NAME } from "./shared/config.js";
import { loadModuleRegistry, setModuleRegistry } from "./shared/modules.js";
import { registerDynamicShortcutTools } from "./shortcuts/tools.js";
import { HitlClient } from "./shared/hitl.js";
import { installHitlGuard } from "./shared/hitl-guard.js";
import { setShareGuardHitlClient } from "./shared/share-guard.js";
import { printBanner, type BannerInfo } from "./shared/banner.js";
import { LIMITS, TIMEOUT, IDENTITY } from "./shared/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string };

const config = parseConfig();
const osVersion = getOsVersion();

// HITL client — shared across all servers, created once if enabled
let hitlClient: HitlClient | null = null;
if (config.hitl.level !== "off") {
  hitlClient = new HitlClient(config.hitl);
  setShareGuardHitlClient(hitlClient);
}

// Clean up HITL socket on exit
function onExit() {
  if (hitlClient) {
    hitlClient.dispose();
    hitlClient = null;
    setShareGuardHitlClient(null);
  }
}
process.on("exit", onExit);
process.on("SIGINT", () => { onExit(); process.exit(0); });
process.on("SIGTERM", () => { onExit(); process.exit(0); });

async function createServer(): Promise<{ server: McpServer; bannerInfo: BannerInfo }> {
  const server = new McpServer({
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
  });

  // Install HITL guard before any tool registrations
  if (hitlClient && config.hitl.level !== "off") {
    installHitlGuard(server, hitlClient, config);
  }

  // Dynamic module loading — only imports modules at startup
  const MODULE_REGISTRY = await loadModuleRegistry();
  setModuleRegistry(MODULE_REGISTRY);

  const enabled: string[] = [];
  const disabled: string[] = [];
  const osBlocked: string[] = [];
  let shortcutsEnabled = false;
  for (const mod of MODULE_REGISTRY) {
    if (mod.minMacosVersion && osVersion > 0 && osVersion < mod.minMacosVersion) {
      osBlocked.push(`${mod.name} (requires macOS ${mod.minMacosVersion}+)`);
    } else if (isModuleEnabled(config, mod.name)) {
      try {
        mod.tools(server, config);
        mod.prompts?.(server);
      } catch (e) {
        console.error(`[AirMCP] Failed to register module ${mod.name}: ${e instanceof Error ? e.message : String(e)}`);
        disabled.push(mod.name);
        continue;
      }
      enabled.push(mod.name);
      if (mod.name === "shortcuts") shortcutsEnabled = true;
    } else {
      disabled.push(mod.name);
    }
  }
  // Dynamic shortcut tools: auto-discover and register individual shortcuts
  let dynamicShortcutCount = 0;
  if (shortcutsEnabled) {
    dynamicShortcutCount = await registerDynamicShortcutTools(server);
  }

  // Cross-module workflows
  registerCrossPrompts(server);
  registerCrossTools(server, config);

  // Semantic search (on-device embeddings via Swift bridge)
  registerSemanticTools(server, config);

  // MCP Resources
  registerResources(server, config);

  // Setup & diagnostics
  registerSetupTools(server, config);

  // Personal Skills Engine (YAML-based workflows)
  await registerSkillEngine(server);

  // MCP Apps — interactive UI views (Calendar week, Music player)
  registerApps(server, {
    calendar: enabled.includes("calendar"),
    music: enabled.includes("music"),
  });

  // get_workflow: expose prompt handlers as a tool for autonomous agents (Cowork, etc.)
  server.registerTool(
    "get_workflow",
    {
      title: "Get Workflow",
      description:
        "Retrieve a registered MCP prompt by name and return its workflow instructions as text. " +
        "Useful in autonomous/Cowork environments where prompts cannot be invoked directly.",
      inputSchema: {
        name: z.string().min(1).describe("Prompt name (e.g. 'daily-briefing', 'dev-session')"),
        args: z
          .record(z.string())
          .optional()
          .describe("Prompt arguments as key-value pairs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, args }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompts = (server as any)._registeredPrompts as Record<string, { callback: (...a: any[]) => any }> | undefined;
      if (!prompts) return err("Prompt registry not available");
      const prompt = prompts[name];
      if (!prompt) {
        const available = Object.keys(prompts).sort();
        return err(`Unknown prompt "${name}". Available: ${available.join(", ")}`);
      }
      try {
        const result = await prompt.callback(args ?? {}, {});
        const text = result?.messages?.[0]?.content?.text ?? JSON.stringify(result);
        return ok({ prompt: name, description: result?.description, workflow: text });
      } catch (e) {
        return err(`Failed to get workflow: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // Collect banner info for startup display
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCount = Object.keys((server as any)._registeredTools ?? {}).length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promptCount = Object.keys((server as any)._registeredPrompts ?? {}).length;

  const bannerInfo: BannerInfo = {
    version: pkg.version,
    transport: "stdio",
    modulesEnabled: enabled,
    modulesDisabled: disabled,
    modulesOsBlocked: osBlocked,
    toolCount,
    promptCount,
    dynamicShortcuts: dynamicShortcutCount,
    skillsBuiltin: 3,
    skillsUser: 0,
    hitlLevel: config.hitl.level,
    macosVersion: osVersion,
    nodeVersion: process.version.slice(1),
    sendMessages: config.allowSendMessages,
    sendMail: config.allowSendMail,
  };

  return { server, bannerInfo };
}

const args = process.argv.slice(2);
const httpMode = args.includes("--http");
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : IDENTITY.HTTP_PORT;

async function main() {
  if (httpMode) {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());

    const transports = new Map<string, StreamableHTTPServerTransport>();
    const servers = new Map<string, McpServer>();
    const sessionActivity = new Map<string, number>();

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, lastActive] of sessionActivity) {
        if (now - lastActive > TIMEOUT.SESSION_IDLE) {
          const transport = transports.get(id);
          if (transport) transport.close?.();
          const srv = servers.get(id);
          if (srv) srv.close?.();
          transports.delete(id);
          servers.delete(id);
          sessionActivity.delete(id);
        }
      }
    }, TIMEOUT.SESSION_CLEANUP);

    process.on("exit", () => clearInterval(cleanupInterval));

    // MCP Server Card — discovery endpoint for Claude, VS Code Copilot, etc.
    app.get("/.well-known/mcp.json", (_req, res) => {
      res.json({
        name: NPM_PACKAGE_NAME,
        version: pkg.version,
        description: "MCP server for the entire Apple ecosystem — 226 tools, 30 prompts across 24 modules. macOS only.",
        transport: { type: "streamable-http", url: "/mcp" },
        capabilities: {
          tools: true,
          prompts: true,
          resources: true,
        },
      });
    });

    app.post("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
          sessionActivity.set(sessionId, Date.now());
          await transports.get(sessionId)!.handleRequest(req, res, req.body);
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

        if (transports.size >= LIMITS.HTTP_SESSIONS) {
          res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Too many concurrent sessions. Try again later." },
            id: null,
          });
          return;
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            sessionActivity.set(id, Date.now());
          },
          onsessionclosed: (id) => {
            transports.delete(id);
            const srv = servers.get(id);
            if (srv) srv.close?.();
            servers.delete(id);
            sessionActivity.delete(id);
          },
        });

        const { server } = await createServer();
        await server.connect(transport);
        // Track server for cleanup once session ID is assigned
        const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
        if (sid) servers.set(sid, server);
        await transport.handleRequest(req, res, req.body);
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

    app.get("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
          res.status(400).json({ error: "Invalid or missing session ID" });
          return;
        }
        sessionActivity.set(sessionId, Date.now());
        await transports.get(sessionId)!.handleRequest(req, res);
      } catch (err) {
        console.error("GET /mcp error:", err);
      }
    });

    app.delete("/mcp", async (req, res) => {
      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
          res.status(400).json({ error: "Invalid or missing session ID" });
          return;
        }
        sessionActivity.set(sessionId, Date.now());
        await transports.get(sessionId)!.handleRequest(req, res);
      } catch (err) {
        console.error("DELETE /mcp error:", err);
      }
    });

    // Pre-warm module registry + shortcuts cache (avoids per-session subprocess)
    const { bannerInfo: bi, server: warmupServer } = await createServer();
    warmupServer.close?.();
    app.listen(port, async () => {
      bi.transport = "http";
      bi.port = port;
      await printBanner(bi);
    });
  } else {
    const { server, bannerInfo } = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await printBanner(bannerInfo);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
