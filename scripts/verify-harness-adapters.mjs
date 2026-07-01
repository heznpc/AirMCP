#!/usr/bin/env node
/**
 * Verify task-harness adapter policy over the real MCP stdio wire.
 *
 * Unit tests cover `resolveHarnessAdapter()`. This gate proves that the adapter
 * selection actually reaches the exposed MCP tools:
 *   - compatible keeps hidden `run_tool` dispatch compatible without a session,
 *   - strict/app-runtime/agent require a task session for hidden tools,
 *   - `discover_tools`, `describe_tool`, `start_tool_session`, and session
 *     allowlist rejection still behave the same way through stdio.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");
const TIMEOUT_MS = Number(process.env.HARNESS_VERIFY_TIMEOUT_MS ?? 30_000);

const CASES = [
  { name: "compatible", adapter: "compatible", expectedAdapter: "compatible", hiddenRunRequiresSession: false },
  { name: "strict", adapter: "strict", expectedAdapter: "strict", hiddenRunRequiresSession: true },
  { name: "app-runtime", adapter: "app-runtime", expectedAdapter: "app-runtime", hiddenRunRequiresSession: true },
  {
    name: "app-runtime-inferred",
    adapter: null,
    expectedAdapter: "app-runtime",
    hiddenRunRequiresSession: true,
    env: { AIRMCP_APP_OWNED_RUNTIME: "true" },
  },
  { name: "agent", adapter: "agent", expectedAdapter: "agent", hiddenRunRequiresSession: true },
];

if (!existsSync(ENTRY)) {
  console.error(`[harness-adapters] ${ENTRY} not found — run \`npm run build\` first`);
  process.exit(2);
}

function parseStructuredResult(callResp) {
  const result = callResp.result;
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find?.((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function firstText(callResp) {
  return callResp.result?.content?.find?.((c) => c.type === "text")?.text ?? "";
}

function startMcp(testCase) {
  const env = {
    ...cleanBootEnv(),
    AIRMCP_PROFILE: "starter",
    AIRMCP_TOOL_EXPOSURE: "progressive",
    AIRMCP_REQUIRE_TOOL_SESSION: "false",
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
    ...(testCase.env ?? {}),
  };
  if (testCase.adapter) env.AIRMCP_HARNESS_ADAPTER = testCase.adapter;
  const proc = spawn("node", [ENTRY], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map();
  let stderr = "";
  let closed = false;
  let stopping = null;

  proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  proc.on("close", () => {
    closed = true;
  });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: resolvePending, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolvePending(msg);
    }
  });

  function request(method, params, id) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rejectReq(new Error(`timeout waiting for id=${id} (${method})`));
        }
      }, TIMEOUT_MS);
      pending.set(id, { resolve: resolveReq, timer });
    });
  }

  function notify(method) {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  function stop() {
    if (closed) return Promise.resolve();
    if (stopping) return stopping;
    stopping = new Promise((resolveStop) => {
      rl.close();
      try {
        proc.stdin.end();
      } catch {
        /* child may already be gone */
      }
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
      const timer = setTimeout(() => {
        if (!closed) proc.kill("SIGKILL");
        resolveStop();
      }, 1000);
      timer.unref();
      proc.once("close", () => {
        clearTimeout(timer);
        resolveStop();
      });
      proc.kill("SIGTERM");
    });
    return stopping;
  }

  return { request, notify, stop, stderr: () => stderr };
}

function expectNoWireError(resp, label) {
  if (resp.error || resp.result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(resp)}`);
  }
}

async function verifyCase(testCase) {
  const client = startMcp(testCase);
  const watchdog = setTimeout(() => {
    client.stop().finally(() => {
      console.error(`[harness-adapters] FAIL ${testCase.name}: timeout after ${TIMEOUT_MS}ms`);
      process.exit(1);
    });
  }, TIMEOUT_MS);

  try {
    const initResp = await client.request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "airmcp-harness-adapter-verify", version: "0.0.0" },
      },
      1,
    );
    if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
    client.notify("notifications/initialized");

    const listResp = await client.request("tools/list", {}, 2);
    const tools = listResp.result?.tools;
    if (!Array.isArray(tools) || tools.length < 10) {
      throw new Error(`tools/list malformed or too small: ${JSON.stringify(listResp)}`);
    }

    const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
    expectNoWireError(statusResp, "profile_status");
    const status = parseStructuredResult(statusResp);
    if (status?.harnessAdapter !== testCase.expectedAdapter) {
      throw new Error(`profile_status.harnessAdapter=${status?.harnessAdapter}, expected ${testCase.expectedAdapter}`);
    }

    const discoverResp = await client.request(
      "tools/call",
      { name: "discover_tools", arguments: { query: "create note", limit: 10 } },
      4,
    );
    expectNoWireError(discoverResp, "discover_tools");
    const discover = parseStructuredResult(discoverResp);
    if (!discover?.matches?.some?.((match) => match.name === "create_note")) {
      throw new Error(`discover_tools did not return hidden create_note: ${JSON.stringify(discoverResp)}`);
    }

    const describeResp = await client.request(
      "tools/call",
      { name: "describe_tool", arguments: { name: "create_note", full: true } },
      5,
    );
    expectNoWireError(describeResp, "describe_tool");
    const described = parseStructuredResult(describeResp);
    if (described?.name !== "create_note" || described?.descriptionDetail !== "full") {
      throw new Error(`describe_tool did not return full create_note detail: ${JSON.stringify(describeResp)}`);
    }

    const hiddenNoSessionResp = await client.request(
      "tools/call",
      { name: "run_tool", arguments: { name: "create_note", args: {} } },
      6,
    );
    const hiddenNoSessionText = firstText(hiddenNoSessionResp);
    if (testCase.hiddenRunRequiresSession) {
      if (!hiddenNoSessionResp.result?.isError || !hiddenNoSessionText.includes("Tool session required")) {
        throw new Error(`hidden run_tool without session was not rejected: ${JSON.stringify(hiddenNoSessionResp)}`);
      }
    } else if (
      !hiddenNoSessionResp.result?.isError ||
      !hiddenNoSessionText.includes('Invalid arguments for tool "create_note"')
    ) {
      throw new Error(
        `compatible hidden run_tool did not reach target validation: ${JSON.stringify(hiddenNoSessionResp)}`,
      );
    }

    const sessionResp = await client.request(
      "tools/call",
      { name: "start_tool_session", arguments: { tools: ["create_note"], label: testCase.name, ttlSeconds: 60 } },
      7,
    );
    expectNoWireError(sessionResp, "start_tool_session");
    const session = parseStructuredResult(sessionResp);
    if (!session?.sessionId || !session.allowedTools?.includes?.("create_note")) {
      throw new Error(`start_tool_session did not return create_note session: ${JSON.stringify(sessionResp)}`);
    }

    const statusSessionResp = await client.request(
      "tools/call",
      { name: "tool_session_status", arguments: { sessionId: session.sessionId } },
      8,
    );
    expectNoWireError(statusSessionResp, "tool_session_status");

    const hiddenWithSessionResp = await client.request(
      "tools/call",
      { name: "run_tool", arguments: { name: "create_note", args: {}, sessionId: session.sessionId } },
      9,
    );
    const hiddenWithSessionText = firstText(hiddenWithSessionResp);
    if (
      !hiddenWithSessionResp.result?.isError ||
      !hiddenWithSessionText.includes('Invalid arguments for tool "create_note"')
    ) {
      throw new Error(
        `sessioned hidden run_tool did not reach target validation: ${JSON.stringify(hiddenWithSessionResp)}`,
      );
    }

    const deniedResp = await client.request(
      "tools/call",
      { name: "run_tool", arguments: { name: "list_notes", sessionId: session.sessionId } },
      10,
    );
    if (!deniedResp.result?.isError || !firstText(deniedResp).includes("outside tool session")) {
      throw new Error(`session allowlist did not reject list_notes: ${JSON.stringify(deniedResp)}`);
    }

    const endResp = await client.request(
      "tools/call",
      { name: "end_tool_session", arguments: { sessionId: session.sessionId } },
      11,
    );
    expectNoWireError(endResp, "end_tool_session");

    return { tools: tools.length, registered: status.toolsRegistered };
  } catch (error) {
    const stderr = client.stderr();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- stderr ---\n${stderr.slice(-2000)}`,
    );
  } finally {
    clearTimeout(watchdog);
    await client.stop();
  }
}

let failed = false;
for (const testCase of CASES) {
  try {
    const result = await verifyCase(testCase);
    console.error(
      `[harness-adapters] OK ${testCase.name}: ${result.tools} exposed / ${result.registered} registered / adapter=${testCase.expectedAdapter} / hiddenRequiresSession=${testCase.hiddenRunRequiresSession}`,
    );
  } catch (error) {
    failed = true;
    console.error(
      `[harness-adapters] FAIL ${testCase.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (failed) process.exit(1);
console.error("[harness-adapters] all adapter wire checks passed");
