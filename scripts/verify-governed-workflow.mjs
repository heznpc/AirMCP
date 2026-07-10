#!/usr/bin/env node

/**
 * Deterministic governed-workflow acceptance probe.
 *
 * The caller owns process launch and path isolation. This script connects to
 * the real app-owned Streamable HTTP runtime and acts as an MCP client with
 * form elicitation support. It proves one complete safety loop without
 * touching Apple apps or persistent user data:
 *
 *   read -> approved write -> denied write -> emergency-stop denial ->
 *   HMAC-chain audit verification
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

function usage() {
  return [
    "Usage: node scripts/verify-governed-workflow.mjs \\",
    "  --url http://127.0.0.1:3847/mcp --token <token> \\",
    "  --memory-store <temp-memory.json> --audit-dir <temp-audit-dir> \\",
    "  --emergency-stop <temp-stop-file>",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    url: "",
    token: "",
    memoryStore: "",
    auditDir: "",
    emergencyStop: "",
    timeoutMs: 10_000,
  };
  const names = new Map([
    ["--url", "url"],
    ["--token", "token"],
    ["--memory-store", "memoryStore"],
    ["--audit-dir", "auditDir"],
    ["--emergency-stop", "emergencyStop"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index] ?? "");
      continue;
    }
    const key = names.get(arg);
    if (!key) throw new Error(`unknown option: ${arg}`);
    options[key] = argv[++index] ?? "";
  }

  for (const key of ["url", "token", "memoryStore", "auditDir", "emergencyStop"]) {
    if (!options[key])
      throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  options.memoryStore = resolve(options.memoryStore);
  options.auditDir = resolve(options.auditDir);
  options.emergencyStop = resolve(options.emergencyStop);
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstText(result) {
  return result?.content?.find?.((item) => item.type === "text")?.text ?? "";
}

function expectSuccess(result, label) {
  if (result?.isError === true) throw new Error(`${label} returned a tool error: ${firstText(result)}`);
  return result?.structuredContent;
}

function expectError(result, label, pattern) {
  assert(result?.isError === true, `${label} should return isError:true`);
  const text = firstText(result);
  assert(pattern.test(text), `${label} returned the wrong error: ${text}`);
}

async function waitForAuditFlush(auditPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const rows = (await readFile(auditPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const putCount = rows.filter((row) => row.tool === "memory_put").length;
      const forgetCount = rows.filter((row) => row.tool === "memory_forget").length;
      if (putCount >= 2 && forgetCount >= 1) return;
    } catch {
      // The buffered audit writer has not created or completed the file yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`audit entries did not flush to ${auditPath} within ${timeoutMs}ms`);
}

function topTool(summary, name) {
  return summary?.topTools?.find?.((entry) => entry.tool === name);
}

function matchingEntry(entries, expected) {
  return entries.find((entry) => Object.entries(expected).every(([key, value]) => entry?.[key] === value));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = randomUUID();
  const decisions = [true, false];
  const approvalPrompts = [];
  const client = new Client(
    { name: "airmcp-governed-acceptance", version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    assert(request.params.mode === "form", `unexpected elicitation mode: ${request.params.mode}`);
    const decision = decisions[approvalPrompts.length];
    assert(decision !== undefined, `unexpected extra elicitation: ${request.params.message}`);
    assert(request.params.message.includes("memory_put"), `unexpected tool elicitation: ${request.params.message}`);
    approvalPrompts.push({ decision, message: request.params.message });
    return decision ? { action: "accept", content: { approve: true } } : { action: "decline" };
  });

  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${options.token}`,
        "X-AirMCP-Run-ID": runId,
      },
    },
  });
  const call = (name, args = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: options.timeoutMs });

  try {
    await client.connect(transport, { timeout: options.timeoutMs });
    const listed = await client.listTools(undefined, { timeout: options.timeoutMs });
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const required of ["memory_stats", "memory_put", "memory_forget", "audit_log", "audit_summary"]) {
      assert(names.has(required), `app-owned runtime did not expose required acceptance tool: ${required}`);
    }

    const initial = expectSuccess(await call("memory_stats"), "initial memory_stats");
    assert(initial?.total === 0, `isolated memory store should start empty, got ${initial?.total}`);
    assert(
      resolve(String(initial?.path ?? "")) === options.memoryStore,
      `runtime memory store escaped isolation: expected ${options.memoryStore}, got ${initial?.path}`,
    );

    const approved = expectSuccess(
      await call("memory_put", { kind: "fact", key: "governed-approved", value: "accepted" }),
      "approved memory_put",
    );
    assert(approved?.stored?.key === "governed-approved", "approved write did not return its stored entry");
    const afterApproved = expectSuccess(await call("memory_stats"), "post-approval memory_stats");
    assert(afterApproved?.total === 1, `approved write should produce one entry, got ${afterApproved?.total}`);

    const denied = await call("memory_put", { kind: "fact", key: "governed-denied", value: "rejected" });
    expectError(denied, "denied memory_put", /\[permission_denied\].*rejected via MCP elicitation/s);
    const afterDenied = expectSuccess(await call("memory_stats"), "post-denial memory_stats");
    assert(afterDenied?.total === 1, `denied write changed state; expected 1 entry, got ${afterDenied?.total}`);
    assert(approvalPrompts.length === 2, `expected two approval prompts, got ${approvalPrompts.length}`);

    await writeFile(options.emergencyStop, "", { flag: "wx" });
    const promptsBeforeStop = approvalPrompts.length;
    const blocked = await call("memory_forget", { key: "governed-approved" });
    expectError(blocked, "emergency-stopped memory_forget", /\[rate_limited\].*Emergency stop engaged/s);
    assert(
      approvalPrompts.length === promptsBeforeStop,
      "emergency stop must block destructive work before soliciting approval",
    );
    const afterStop = expectSuccess(await call("memory_stats"), "post-stop memory_stats");
    assert(afterStop?.total === 1, `emergency-stopped delete changed state; got ${afterStop?.total} entries`);

    await waitForAuditFlush(resolve(options.auditDir, "audit.jsonl"), options.timeoutMs);
    const history = expectSuccess(
      await call("audit_log", { correlationId: runId, limit: 100 }),
      "correlated audit_log",
    );
    assert(history?.verified === true, "audit_log history did not pass HMAC verification");
    assert(history?.auditDisabled === false, "audit_log reported a disabled writer");
    const entries = history?.entries ?? [];
    assert(entries.length >= 5, `correlated audit history is incomplete: ${entries.length} entries`);
    assert(
      entries.every((entry) => entry.correlationId === runId),
      "audit_log returned an entry outside the requested run correlation",
    );
    assert(
      matchingEntry(entries, {
        kind: "approval",
        tool: "memory_put",
        status: "ok",
        approvalDecision: "approved",
        approvalChannel: "elicitation",
      }),
      "audit history is missing the approved elicitation event",
    );
    assert(
      matchingEntry(entries, {
        kind: "approval",
        tool: "memory_put",
        status: "error",
        approvalDecision: "denied",
        approvalChannel: "elicitation",
      }),
      "audit history is missing the denied elicitation event",
    );
    assert(
      matchingEntry(entries, { kind: "tool", tool: "memory_put", status: "ok" }),
      "audit history is missing the successful memory_put tool call",
    );
    assert(
      matchingEntry(entries, {
        kind: "tool",
        tool: "memory_put",
        status: "error",
        errorCategory: "permission_denied",
      }),
      "audit history is missing the denied memory_put tool result",
    );
    assert(
      matchingEntry(entries, {
        kind: "tool",
        tool: "memory_forget",
        status: "error",
        errorCategory: "rate_limited",
        gate: "emergency_stop",
      }),
      "audit history is missing the emergency-stop gate result",
    );

    const summary = expectSuccess(await call("audit_summary"), "audit_summary");
    assert(summary?.verified === true, "audit HMAC chain did not verify");
    assert(summary?.auditDisabled === false, "audit writer reported disabled");
    const puts = topTool(summary, "memory_put");
    const forgets = topTool(summary, "memory_forget");
    assert(puts?.count === 2, `audit should contain two memory_put calls, got ${puts?.count}`);
    assert(puts?.errors === 1, `audit should mark the denied memory_put as error, got ${puts?.errors}`);
    assert(forgets?.count === 1, `audit should contain one memory_forget call, got ${forgets?.count}`);
    assert(forgets?.errors === 1, `audit should mark the emergency-stopped memory_forget as error`);

    console.log(
      `governed workflow passed: read, approved write, denied write, emergency stop, verified audit (${summary.total} entries)`,
    );
  } finally {
    await rm(options.emergencyStop, { force: true }).catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
