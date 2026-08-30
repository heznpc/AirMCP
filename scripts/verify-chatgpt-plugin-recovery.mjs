#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_PROTOCOL_VERSION, startMcp } from "./lib/mcp-stdio-client.mjs";
import {
  preflight,
  readPrivateOwnerSecret,
  resolveRuntimePaths,
  verifyAppOwnedListener,
  verifyRuntimeIdentityChallenge,
} from "../plugins/airmcp/scripts/airmcp-app-stdio.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = join(ROOT, "plugins", "airmcp");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const MCP_CONFIG = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8"));

function startPluginClient() {
  const server = MCP_CONFIG.mcpServers.airmcp;
  return startMcp({
    entry: server.args[0],
    args: server.args,
    cwd: PLUGIN_ROOT,
    env: process.env,
    timeoutMs: 20_000,
    nodeBin: server.command,
  });
}

async function initialize(client, name, id) {
  const response = await client.request(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name, version: PACKAGE.version },
    },
    id,
  );
  if (response.error) throw new Error(`${name} initialize failed: ${JSON.stringify(response.error)}`);
  client.notify("notifications/initialized");
}

async function waitUntilUnavailable(url, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(250) });
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("the verified app runtime listener did not stop within the recovery budget");
}

async function main() {
  const paths = resolveRuntimePaths();
  let staleClient;
  let freshClient;
  let primaryError;
  let phase = "initial preflight";
  try {
    await preflight();
    phase = "first listener receipt";
    const firstListener = verifyAppOwnedListener(paths);
    const firstReceipt = await verifyRuntimeIdentityChallenge(paths, firstListener.pid);
    const firstOwnerSecret = readPrivateOwnerSecret(paths.ownerSecretPath);

    phase = "pre-rotation connector initialize";
    staleClient = startPluginClient();
    await initialize(staleClient, "airmcp-chatgpt-stale-generation", 1);
    phase = "pre-rotation tools/list";
    const firstTools = await staleClient.request("tools/list", {}, 2);
    if (firstTools.error || !Array.isArray(firstTools.result?.tools) || firstTools.result.tools.length === 0) {
      throw new Error("the pre-rotation connector did not expose AirMCP tools");
    }

    phase = "verified child termination";
    const killTarget = verifyAppOwnedListener(paths);
    if (killTarget.pid !== firstListener.pid) {
      throw new Error(
        `the verified app runtime changed from PID ${firstListener.pid} to ${killTarget.pid} before termination`,
      );
    }
    await verifyRuntimeIdentityChallenge(paths, killTarget.pid);
    // Keep the signal adjacent to the final receipt: no asynchronous work may
    // separate identity verification from terminating this exact child.
    process.kill(killTarget.pid, "SIGTERM");
    await waitUntilUnavailable(new URL("/health", paths.mcpUrl));

    phase = "fresh connector initialize";
    freshClient = startPluginClient();
    await initialize(freshClient, "airmcp-chatgpt-fresh-generation", 101);
    phase = "fresh tools/list";
    const freshTools = await freshClient.request("tools/list", {}, 102);
    if (freshTools.error || !Array.isArray(freshTools.result?.tools) || freshTools.result.tools.length === 0) {
      throw new Error("the recovered connector did not expose AirMCP tools");
    }

    phase = "second listener receipt";
    const secondListener = verifyAppOwnedListener(paths);
    const secondReceipt = await verifyRuntimeIdentityChallenge(paths, secondListener.pid);
    const secondOwnerSecret = readPrivateOwnerSecret(paths.ownerSecretPath);
    if (secondOwnerSecret === firstOwnerSecret) {
      throw new Error("the recovered app runtime reused its previous generation secret");
    }

    phase = "stale bearer rejection";
    const staleAuthorization = await fetch(new URL("/app/runtime-state", paths.mcpUrl), {
      headers: { Authorization: `Bearer ${firstReceipt.authorizationToken}` },
    });
    if (staleAuthorization.status !== 401) {
      throw new Error(`the previous generation bearer returned HTTP ${staleAuthorization.status}, expected 401`);
    }

    const freshAuthorization = await fetch(new URL("/app/runtime-state", paths.mcpUrl), {
      headers: { Authorization: `Bearer ${secondReceipt.authorizationToken}` },
    });
    if (freshAuthorization.status !== 200) {
      throw new Error(`the fresh generation bearer returned HTTP ${freshAuthorization.status}, expected 200`);
    }

    phase = "stale connector rejection";
    let staleConnectorFailedClosed = false;
    try {
      const staleResponse = await staleClient.request("tools/list", {}, 3);
      staleConnectorFailedClosed = Boolean(staleResponse.error || staleResponse.result?.isError);
    } catch {
      staleConnectorFailedClosed = true;
    }
    if (!staleConnectorFailedClosed) {
      throw new Error("the pre-rotation connector remained usable after generation rotation");
    }

    phase = "fresh profile_status";
    const profile = await freshClient.request("tools/call", { name: "profile_status", arguments: {} }, 103);
    if (profile.error || profile.result?.isError) {
      throw new Error("the recovered connector could not call profile_status");
    }

    console.log(
      `AirMCP plugin recovery passed: ${firstTools.result.tools.length} tools, rotated generation, stale connector rejected, fresh connector healthy`,
    );
  } catch (error) {
    const diagnostics = [staleClient?.stderr(), freshClient?.stderr()].filter(Boolean).join(" | ");
    primaryError = new Error(
      `${phase}: ${error instanceof Error ? error.message : String(error)}` +
        (diagnostics ? `; connector diagnostics: ${diagnostics}` : ""),
    );
  } finally {
    await staleClient?.stop();
    await freshClient?.stop();
    try {
      await preflight();
    } catch (restoreError) {
      if (!primaryError) primaryError = restoreError;
    }
  }
  if (primaryError) throw primaryError;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
