#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_PROTOCOL_VERSION, startMcp } from "./lib/mcp-stdio-client.mjs";
import { validateChatgptPlugin } from "./validate-chatgpt-plugin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = join(ROOT, "plugins", "airmcp");

function expectResult(response, label) {
  if (response.error) throw new Error(`${label} returned ${JSON.stringify(response.error)}`);
  return response.result;
}

export async function verifyChatgptPluginRuntime(options = {}) {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const validation = validateChatgptPlugin(PLUGIN_ROOT, { expectedVersion: rootPackage.version });
  if (!validation.ok) throw new Error(validation.errors.join("\n"));

  const mcpConfig = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8"));
  const server = mcpConfig.mcpServers.airmcp;
  const client = startMcp({
    entry: server.args[0],
    args: server.args,
    cwd: PLUGIN_ROOT,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      NODE_OPTIONS: "--require=/tmp/airmcp-plugin-preflight-must-not-load.cjs",
    },
    timeoutMs: options.timeoutMs ?? 15_000,
    nodeBin: server.command,
  });

  try {
    const initialized = expectResult(
      await client.request(
        "initialize",
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "airmcp-chatgpt-plugin-preflight", version: rootPackage.version },
        },
        1,
      ),
      "initialize",
    );
    client.notify("notifications/initialized");
    const listed = expectResult(await client.request("tools/list", {}, 2), "tools/list");
    if (!Array.isArray(listed?.tools) || listed.tools.length === 0) {
      throw new Error("tools/list returned no AirMCP tools");
    }
    if (!listed.tools.some((tool) => tool?.name === "profile_status")) {
      throw new Error("tools/list did not expose the profile_status preflight tool");
    }
    const profile = expectResult(
      await client.request("tools/call", { name: "profile_status", arguments: {} }, 3),
      "profile_status",
    );
    if (profile?.isError) throw new Error("profile_status returned an MCP tool error");
    return {
      pluginVersion: validation.manifest.version,
      serverName: initialized?.serverInfo?.name ?? "unknown",
      serverVersion: initialized?.serverInfo?.version ?? "unknown",
      protocolVersion: initialized?.protocolVersion ?? "unknown",
      toolCount: listed.tools.length,
      representativeTool: "profile_status",
      connectorDiagnostics: client.stderr().trim(),
    };
  } finally {
    await client.stop();
  }
}

async function main() {
  const result = await verifyChatgptPluginRuntime();
  console.log(
    `AirMCP ChatGPT plugin preflight passed: ${result.toolCount} tools and ${result.representativeTool} from ${result.serverName} v${result.serverVersion} (${result.protocolVersion})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
