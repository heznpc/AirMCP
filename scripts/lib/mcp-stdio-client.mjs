import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

/** Stable protocol version exported by the pinned MCP SDK. Production wire
 *  probes import this instead of carrying independent date literals. */
export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

export function parseStructuredResult(callResp) {
  const result = callResp.result;
  if (result?.structuredContent) return result.structuredContent;
  const text = firstText(callResp);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function firstText(callResp) {
  return callResp.result?.content?.find?.((c) => c.type === "text")?.text ?? "";
}

export function expectNoWireError(resp, label) {
  if (resp.error || resp.result?.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(resp)}`);
  }
}

export function startMcp({ entry, cwd, env, timeoutMs = 30_000, nodeBin = "node" }) {
  if (!entry) throw new TypeError("startMcp requires an entry path");

  const proc = spawn(nodeBin, [entry], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map();
  let stderr = "";
  let closed = false;
  let stopping = null;

  function rejectPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  proc.on("close", () => {
    closed = true;
    rejectPending(new Error("MCP process exited before responding"));
  });
  proc.on("error", (error) => {
    rejectPending(error);
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
      const { resolve, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  function writeJson(payload) {
    if (closed) throw new Error("MCP process is already closed");
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  function request(method, params, id) {
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rejectReq(new Error(`timeout waiting for id=${id} (${method})`));
        }
      }, timeoutMs);
      pending.set(id, { resolve: resolveReq, reject: rejectReq, timer });

      try {
        writeJson({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        rejectReq(error);
      }
    });
  }

  function notify(method, params) {
    writeJson({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
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
