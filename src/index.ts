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
    await server.connect(transport);
    await printBanner(bannerInfo);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
