import { afterEach, describe, expect, test } from "@jest/globals";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";
import { probeAppRuntimeMcp } from "../dist/cli/app-runtime-probe.js";

const DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const children = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === "string") throw new Error("failed to allocate a test port");
  return address.port;
}

function spawnAirMcp(args, envOverrides = {}) {
  const child = spawn(process.execPath, [DIST, ...args], {
    cwd: ROOT,
    env: { ...cleanBootEnv(), ...envOverrides },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderrText = "";
  child.stdoutText = "";
  child.stderr.on("data", (chunk) => {
    child.stderrText += chunk;
  });
  child.stdout.on("data", (chunk) => {
    child.stdoutText += chunk;
  });
  children.push(child);
  return child;
}

async function waitForHealth(port, child, timeoutMs = 30_000) {
  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `server exited before health check passed (code ${child.exitCode}):\nstdout:\n${child.stdoutText}\nstderr:\n${child.stderrText}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // Retry until the HTTP listener is ready.
    }
    await sleep(100);
  }
  throw new Error(
    `server did not become healthy at ${url} within ${timeoutMs}ms:\nstdout:\n${child.stdoutText}\nstderr:\n${child.stderrText}`,
  );
}

function createJsonReader(stream) {
  const reader = createInterface({ input: stream });
  const queue = [];
  const waiters = [];

  function drain() {
    for (let i = 0; i < waiters.length; i += 1) {
      const waiter = waiters[i];
      const messageIndex = queue.findIndex(waiter.predicate);
      if (messageIndex === -1) continue;
      const [message] = queue.splice(messageIndex, 1);
      waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      i -= 1;
    }
  }

  reader.on("line", (line) => {
    try {
      queue.push(JSON.parse(line));
      drain();
    } catch {
      // Ignore non-JSON stdout from a failed child; the test will timeout with stderr.
    }
  });

  return {
    read(predicate, timeoutMs = 10_000) {
      const queuedIndex = queue.findIndex(predicate);
      if (queuedIndex !== -1) {
        const [message] = queue.splice(queuedIndex, 1);
        return Promise.resolve(message);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex !== -1) waiters.splice(waiterIndex, 1);
          reject(new Error("timed out waiting for JSON-RPC response"));
        }, timeoutMs);
        waiters.push({ predicate, resolve, timer });
        drain();
      });
    },
  };
}

function writeJson(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function request(child, reader, id, method, params = {}) {
  writeJson(child, { jsonrpc: "2.0", id, method, params });
  return reader.read((message) => message.id === id);
}

function parseStreamableHttpJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    // Streamable HTTP commonly returns `text/event-stream` for JSON-RPC
    // responses. AppIntents.swift has a tiny parser for this exact shape;
    // keep the runtime contract behavioral here so a server transport
    // change fails before Shortcuts/Siri does.
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      return JSON.parse(payload);
    }
    throw new Error(`no JSON payload in Streamable HTTP response: ${body.slice(0, 200)}`);
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  await sleep(100);
});

describe("airmcp connect", () => {
  test("app runtime probe performs initialize and tools/list over token-gated HTTP", async () => {
    const port = await getFreePort();
    const token = "test-runtime-token";
    const server = spawnAirMcp(["--http", "--port", String(port)], {
      AIRMCP_ALLOW_NETWORK: "with-token",
      AIRMCP_HTTP_TOKEN: token,
    });
    await waitForHealth(port, server);

    const probe = await probeAppRuntimeMcp({
      url: `http://127.0.0.1:${port}/mcp`,
      token,
      clientName: "airmcp-runtime-probe-test",
      timeoutMs: 10_000,
      minTools: 100,
    });

    expect(probe.serverName).toBe("airmcp");
    expect(probe.toolCount).toBeGreaterThan(100);
    expect(probe.sampleTools.length).toBeGreaterThan(0);
  }, 60_000);

  test("manual Streamable HTTP sequence used by AppIntents returns session + SSE tool result", async () => {
    const port = await getFreePort();
    const token = "test-runtime-token";
    const server = spawnAirMcp(["--http", "--port", String(port)], {
      AIRMCP_ALLOW_NETWORK: "with-token",
      AIRMCP_HTTP_TOKEN: token,
    });
    await waitForHealth(port, server);

    const url = `http://127.0.0.1:${port}/mcp`;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    };
    const initialized = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "airmcp-appintent-http-test", version: "0" },
        },
      }),
    });
    const sessionId = initialized.headers.get("mcp-session-id");
    expect(initialized.status).toBe(200);
    expect(sessionId).toBeTruthy();
    expect(parseStreamableHttpJson(await initialized.text()).result.serverInfo.name).toBe("airmcp");

    const sessionHeaders = { ...headers, "Mcp-Session-Id": sessionId };
    const notification = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");

    const called = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "discover_tools", arguments: { query: "calendar", limit: 1 } },
      }),
    });
    expect(called.status).toBe(200);
    const result = parseStreamableHttpJson(await called.text()).result;
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("calendar");
  }, 60_000);

  test("bridges a stdio client to the token-gated app-owned HTTP runtime", async () => {
    const port = await getFreePort();
    const token = "test-runtime-token";
    const server = spawnAirMcp(["--http", "--port", String(port)], {
      AIRMCP_ALLOW_NETWORK: "with-token",
      AIRMCP_HTTP_TOKEN: token,
    });
    await waitForHealth(port, server);

    const unauthenticated = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize" }),
    });
    expect(unauthenticated.status).toBe(401);

    const proxy = spawnAirMcp(["connect", "--url", `http://127.0.0.1:${port}/mcp`], {
      AIRMCP_HTTP_TOKEN: token,
    });
    const reader = createJsonReader(proxy.stdout);

    const initialized = await request(proxy, reader, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "airmcp-connect-test", version: "0.0.0" },
    });
    expect(initialized.error).toBeUndefined();
    expect(initialized.result.serverInfo.name).toBe("airmcp");

    writeJson(proxy, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    const tools = await request(proxy, reader, 2, "tools/list");

    expect(tools.error).toBeUndefined();
    expect(Array.isArray(tools.result.tools)).toBe(true);
    expect(tools.result.tools.length).toBeGreaterThan(100);
  }, 60_000);
});
