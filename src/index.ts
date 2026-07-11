#!/usr/bin/env node

if (!process.env.HOME && !process.env.USERPROFILE) {
  console.error("[AirMCP] HOME environment variable not set — cannot initialize");
  process.exit(1);
}

// CLI subcommands: route before heavy imports
const _sub = process.argv[2];
if (_sub === "--version" || _sub === "-v" || _sub === "-V") {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __d = dirname(fileURLToPath(import.meta.url));
  const v = JSON.parse(readFileSync(join(__d, "..", "package.json"), "utf-8")).version;
  console.log(v);
  process.exit(0);
}
if (
  _sub === "init" ||
  _sub === "doctor" ||
  _sub === "modules" ||
  _sub === "workflows" ||
  _sub === "connect" ||
  _sub === "connect-clients" ||
  _sub === "codex" ||
  _sub === "--help" ||
  _sub === "-h" ||
  _sub === "help"
) {
  if (_sub === "init") {
    const mod = await import("./cli/init.js");
    await mod.runInit();
  } else if (_sub === "doctor") {
    const mod = await import("./cli/doctor.js");
    await mod.runDoctor();
  } else if (_sub === "modules") {
    const mod = await import("./cli/modules.js");
    await mod.runModules();
  } else if (_sub === "workflows") {
    const mod = await import("./cli/workflows.js");
    await mod.runWorkflows();
  } else if (_sub === "connect") {
    const mod = await import("./cli/connect.js");
    await mod.runConnect();
  } else if (_sub === "connect-clients") {
    const mod = await import("./cli/connect-clients.js");
    mod.runConnectClients();
  } else if (_sub === "codex") {
    const mod = await import("./cli/codex.js");
    mod.runCodex();
  } else {
    const mod = await import("./cli/help.js");
    mod.runHelp();
  }
  // Respect a non-zero code a subcommand set via process.exitCode (e.g.
  // `workflows <unknown>` / `--preview` errors). A blanket exit(0) would mask
  // those and silently break `npx airmcp workflows … || exit 1` scripting.
  process.exit(process.exitCode ?? 0);
}
// Reject unknown subcommands (anything that doesn't start with --)
if (_sub && !_sub.startsWith("--")) {
  console.error(`[AirMCP] Unknown command: "${_sub}". Run 'npx airmcp --help' for usage.`);
  process.exit(1);
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { printBanner } from "./shared/banner.js";
import { IDENTITY } from "./shared/constants.js";
import { initializeServer } from "./server/init.js";
import { createServer } from "./server/mcp-setup.js";
import { startHttpServer } from "./server/http-transport.js";
import { wireStdioShutdown } from "./server/stdio-shutdown.js";

const ctx = initializeServer();

const args = process.argv.slice(2);
const httpMode = args.includes("--http");
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1]!, 10) : IDENTITY.HTTP_PORT;
const bindAll = args.includes("--bind-all");
const unsafeNoAuth = args.includes("--unsafe-no-auth");
const httpToken = process.env.AIRMCP_HTTP_TOKEN ?? "";

async function main() {
  if (httpMode) {
    await startHttpServer({
      config: ctx.config,
      hitlClient: ctx.hitlClient,
      osVersion: ctx.osVersion,
      pkg: ctx.pkg,
      port,
      bindAll,
      httpToken,
      unsafeNoAuth,
    });
  } else {
    const { server, bannerInfo } = await createServer(ctx);
    const transport = new StdioServerTransport();
    wireStdioShutdown(transport, process.stdin, ctx.shutdown);
    await server.connect(transport);
    await printBanner(bannerInfo);
  }
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await ctx.shutdown(1);
});
