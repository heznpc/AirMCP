#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";

function usage() {
  return [
    "Usage: node scripts/probe-app-runtime.mjs --url http://127.0.0.1:3847/mcp --token-file <owner-only-file>",
    "",
    "Performs a real MCP initialize + tools/list round trip against the app-owned HTTP runtime.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    url: "",
    token: "",
    tokenFile: "",
    timeoutMs: 5_000,
    minTools: 1,
    clientName: "airmcp-bundle-verify",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--url") {
      options.url = argv[++i] ?? "";
      continue;
    }
    if (arg === "--token") {
      options.token = argv[++i] ?? "";
      continue;
    }
    if (arg === "--token-file") {
      options.tokenFile = argv[++i] ?? "";
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i] ?? "");
      continue;
    }
    if (arg === "--min-tools") {
      options.minTools = Number(argv[++i] ?? "");
      continue;
    }
    if (arg === "--client-name") {
      options.clientName = argv[++i] ?? "";
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  if (!options.url) throw new Error("--url is required");
  if (Boolean(options.token) === Boolean(options.tokenFile)) {
    throw new Error("exactly one of --token or --token-file is required");
  }
  if (options.tokenFile) {
    options.token = readFileSync(options.tokenFile, "utf8").trim();
    if (!options.token) throw new Error("--token-file is empty");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isInteger(options.minTools) || options.minTools < 1) {
    throw new Error("--min-tools must be a positive integer");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new Client({ name: options.clientName, version: "0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
    },
  });

  try {
    await client.connect(transport, { timeout: options.timeoutMs });
    const result = await client.listTools(undefined, { timeout: options.timeoutMs });
    if (result.tools.length < options.minTools) {
      throw new Error(`tools/list returned ${result.tools.length} tools; expected at least ${options.minTools}`);
    }
    const server = client.getServerVersion();
    const name = server?.name ?? "unknown";
    const version = server?.version ?? "unknown";
    console.log(`${result.tools.length} tools from ${name} v${version}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
