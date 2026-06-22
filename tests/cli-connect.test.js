import { afterEach, describe, expect, test } from "@jest/globals";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";

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

function spawnAirMcp(args) {
  const child = spawn(process.execPath, [DIST, ...args], {
    cwd: ROOT,
    env: cleanBootEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderrText = "";
  child.stderr.on("data", (chunk) => {
    child.stderrText += chunk;
  });
  children.push(child);
  return child;
}

async function waitForHealth(port, child) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check passed: ${child.stderrText}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // Retry until the HTTP listener is ready.
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy at ${url}: ${child.stderrText}`);
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

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  await sleep(100);
});

describe("airmcp connect", () => {
  test("bridges a stdio client to the app-owned HTTP runtime", async () => {
    const port = await getFreePort();
    const server = spawnAirMcp(["--http", "--port", String(port)]);
    await waitForHealth(port, server);

    const proxy = spawnAirMcp(["connect", "--url", `http://127.0.0.1:${port}/mcp`]);
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
  }, 30_000);
});
