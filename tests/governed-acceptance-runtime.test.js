import { expect, test } from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { output = (output + chunk).slice(-64_000); });
  }
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
  return { child, completed, output: () => output };
}

test("governed acceptance flushes audit through the real MCP API before checking persisted rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "airmcp-governed-acceptance-"));
  const port = await freePort();
  const auditDir = join(directory, "audit");
  const memoryStore = join(directory, "memory.json");
  const emergencyStop = join(directory, "emergency-stop");
  const tokenPath = join(directory, "token");
  const token = "isolated-governed-acceptance-token-123456789";
  await writeFile(tokenPath, token, { mode: 0o600 });
  const env = {
    ...cleanBootEnv(), HOME: directory,
    AIRMCP_PROFILE: "full", AIRMCP_TOOL_EXPOSURE: "full",
    AIRMCP_REQUIRE_TOOL_SESSION: "false", AIRMCP_HITL_LEVEL: "sensitive-only",
    AIRMCP_HITL_SOCKET_PATH: join(directory, "absent-hitl.sock"),
    AIRMCP_HTTP_TOKEN: token, AIRMCP_ALLOW_NETWORK: "with-token",
    AIRMCP_MEMORY_STORE_PATH: memoryStore, AIRMCP_VECTOR_STORE_DIR: auditDir,
    AIRMCP_EMERGENCY_STOP_PATH: emergencyStop, AIRMCP_AUDIT_LOG: "true",
    AIRMCP_RATE_LIMIT: "true", AIRMCP_ELICITATION_DISABLE: "false",
    // A delayed background flush must not fail a healthy runtime whose
    // public audit_log API already provides an awaited durability barrier.
    AIRMCP_AUDIT_FLUSH_INTERVAL: "300000",
  };
  delete env.AIRMCP_TEST_MODE;
  const runtime = launch(["dist/index.js", "--http", "--port", String(port)], env);
  let probe;
  try {
    const deadline = Date.now() + 20_000;
    let healthy = false;
    while (Date.now() < deadline && runtime.child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { healthy = true; break; }
      } catch { /* Wait for the isolated HTTP listener. */ }
      await sleep(50);
    }
    expect({ healthy, output: healthy ? "" : runtime.output() }).toEqual({ healthy: true, output: "" });
    probe = launch([
      "scripts/verify-governed-workflow.mjs", "--url", `http://127.0.0.1:${port}/mcp`,
      "--token-file", tokenPath, "--memory-store", memoryStore,
      "--audit-dir", auditDir, "--emergency-stop", emergencyStop, "--timeout-ms", "5000",
    ], env);
    const result = await probe.completed;
    expect(result).toEqual({ code: 0, output: expect.stringContaining("governed workflow passed") });
    const rows = (await readFile(join(auditDir, "audit.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    expect(rows).toContainEqual(expect.objectContaining({
      kind: "tool", tool: "memory_forget", status: "error", gate: "emergency_stop",
    }));
  } finally {
    for (const process of [probe, runtime].filter(Boolean)) {
      if (process.child.exitCode !== null) continue;
      process.child.kill("SIGTERM");
      const force = setTimeout(() => process.child.kill("SIGKILL"), 7000);
      await process.completed;
      clearTimeout(force);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
