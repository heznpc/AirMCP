#!/usr/bin/env node

// CLI subcommands: route before heavy imports
const _sub = process.argv[2];
if (_sub === "init" || _sub === "doctor") {
  const mod = _sub === "init"
    ? await import("./cli/init.js")
    : await import("./cli/doctor.js");
  await (_sub === "init" ? (mod as typeof import("./cli/init.js")).runInit() : (mod as typeof import("./cli/doctor.js")).runDoctor());
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
import { parseConfig, isModuleEnabled, NPM_PACKAGE_NAME } from "./shared/config.js";
import { MODULE_REGISTRY } from "./shared/modules.js";
import { HitlClient } from "./shared/hitl.js";
import { installHitlGuard } from "./shared/hitl-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string };

const config = parseConfig();

// HITL client — shared across all servers, created once if enabled
let hitlClient: HitlClient | null = null;
if (config.hitl.level !== "off") {
  hitlClient = new HitlClient(config.hitl);
  console.error(`iConnect HITL enabled: level=${config.hitl.level}, timeout=${config.hitl.timeout}s, socket=${config.hitl.socketPath}`);
} else {
  console.error("iConnect HITL disabled");
}

// Clean up HITL socket on exit
function onExit() {
  if (hitlClient) {
    hitlClient.dispose();
    hitlClient = null;
  }
}
process.on("exit", onExit);
process.on("SIGINT", () => { onExit(); process.exit(0); });
process.on("SIGTERM", () => { onExit(); process.exit(0); });

function createServer(): McpServer {
  const server = new McpServer({
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
  });

  // Install HITL guard before any tool registrations
  if (hitlClient && config.hitl.level !== "off") {
    installHitlGuard(server, hitlClient, config);
  }

  const enabled: string[] = [];
  const disabled: string[] = [];
  for (const mod of MODULE_REGISTRY) {
    if (isModuleEnabled(config, mod.name)) {
      mod.tools(server, config);
      mod.prompts?.(server);
      enabled.push(mod.name);
    } else {
      disabled.push(mod.name);
    }
  }
  if (disabled.length > 0) {
    console.error(`iConnect modules disabled: ${disabled.join(", ")}`);
  }
  console.error(`iConnect modules enabled: ${enabled.join(", ")}`);

  // Cross-module workflows
  registerCrossPrompts(server);
  registerCrossTools(server, config);

  // Semantic search (on-device embeddings via Swift bridge)
  registerSemanticTools(server, config);

  // MCP Resources
  registerResources(server, config);

  // Setup & diagnostics
  registerSetupTools(server, config);

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
      const prompts = (server as any)._registeredPrompts as Map<string, { callback: (...a: any[]) => any }> | undefined;
      if (!prompts) return err("Prompt registry not available");
      const prompt = prompts.get(name);
      if (!prompt) {
        const available = [...prompts.keys()].sort();
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

  return server;
}

const args = process.argv.slice(2);
const httpMode = args.includes("--http");
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 3847;

async function main() {
  if (httpMode) {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());

    const transports = new Map<string, StreamableHTTPServerTransport>();
    const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
    const sessionActivity = new Map<string, number>();

    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, lastActive] of sessionActivity) {
        if (now - lastActive > SESSION_TTL) {
          const transport = transports.get(id);
          if (transport) transport.close?.();
          transports.delete(id);
          sessionActivity.delete(id);
        }
      }
    }, 5 * 60 * 1000);

    process.on("exit", () => clearInterval(cleanupInterval));

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

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            sessionActivity.set(id, Date.now());
          },
          onsessionclosed: (id) => {
            transports.delete(id);
            sessionActivity.delete(id);
          },
        });

        const server = createServer();
        await server.connect(transport);
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

    app.listen(port, () => {
      console.error(`iConnect server running on http://localhost:${port}/mcp (shared notes: ${config.includeShared ? "on" : "off"}, send messages: ${config.allowSendMessages ? "on" : "off"}, send mail: ${config.allowSendMail ? "on" : "off"})`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`iConnect server running on stdio (shared notes: ${config.includeShared ? "on" : "off"}, send messages: ${config.allowSendMessages ? "on" : "off"}, send mail: ${config.allowSendMail ? "on" : "off"})`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
