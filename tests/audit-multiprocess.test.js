/** Cross-process audit writer serialization and stale dot-lock recovery. */
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-audit-multiprocess-"));
const hmacKey = "audit-multiprocess-regression-key";
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = hmacKey;
process.env.AIRMCP_AUDIT_LOG = "true";

const auditModuleUrl = pathToFileURL(resolve("dist/shared/audit.js")).href;
const audit = await import("../dist/shared/audit.js");

async function wipeDir() {
  const files = await readdir(workDir).catch(() => []);
  for (const file of files) await rm(join(workDir, file), { recursive: true, force: true });
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function startWriter(tool, holdLockMs = 0) {
  const source = `
    const audit = await import(${JSON.stringify(auditModuleUrl)});
    audit.auditLog({ timestamp: new Date().toISOString(), tool: ${JSON.stringify(tool)}, status: 'ok' });
    await audit._testFlush();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: dirname(fileURLToPath(auditModuleUrl)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      AIRMCP_VECTOR_STORE_DIR: workDir,
      AIRMCP_AUDIT_HMAC_KEY: hmacKey,
      AIRMCP_AUDIT_LOG: "true",
      AIRMCP_TEST_AUDIT_HOLD_LOCK_MS: String(holdLockMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolveDone, rejectDone) => {
    child.once("error", rejectDone);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveDone();
      else rejectDone(new Error(`writer ${tool} exited code=${code} signal=${signal}\n${stdout}\n${stderr}`));
    });
  });
  return { done };
}

beforeEach(async () => {
  audit._testReset();
  await wipeDir();
});

afterAll(async () => {
  audit._testReset();
  await rm(workDir, { recursive: true, force: true });
});

describe("audit cross-process writer lock", () => {
  test("repairs an existing permissive audit directory to owner-only mode", async () => {
    await chmod(workDir, 0o755);

    audit.auditLog({ timestamp: new Date().toISOString(), tool: "permission_repair", status: "ok" });
    await audit._testFlush();

    expect((await stat(workDir)).mode & 0o777).toBe(0o700);
  });

  test("two child processes append one continuous HMAC/seq chain", async () => {
    const first = startWriter("child_first", 500);
    await waitUntil(() => existsSync(join(workDir, "audit.lock")));
    const second = startWriter("child_second");

    await Promise.all([first.done, second.done]);

    const rows = (await readFile(join(workDir, "audit.jsonl"), "utf-8")).trimEnd().split("\n").map(JSON.parse);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
    expect(rows[1]._prev).toBe(rows[0]._hmac);
    expect(new Set(rows.map((row) => row.tool))).toEqual(new Set(["child_first", "child_second"]));
    expect(existsSync(join(workDir, "audit.lock"))).toBe(false);

    audit._testReset();
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(2);
  }, 10_000);

  test("a dead owner lock is reaped atomically before append", async () => {
    let deadPid = process.pid + 100_000;
    while (true) {
      try {
        process.kill(deadPid, 0);
        deadPid++;
      } catch {
        break;
      }
    }
    await writeFile(
      join(workDir, "audit.lock"),
      JSON.stringify({ pid: deadPid, token: "dead-owner-token", createdAt: Date.now() - 1_000 }) + "\n",
      { mode: 0o600 },
    );

    audit.auditLog({ timestamp: new Date().toISOString(), tool: "after_stale_lock", status: "ok" });
    await audit._testFlush();

    const rows = (await readFile(join(workDir, "audit.jsonl"), "utf-8")).trimEnd().split("\n").map(JSON.parse);
    expect(rows.map((row) => row.tool)).toEqual(["after_stale_lock"]);
    expect(existsSync(join(workDir, "audit.lock"))).toBe(false);
    expect(existsSync(join(workDir, "audit.lock.reap"))).toBe(false);
  });

  test("recovers a dead reaper crash residue without waiting for the 60-second lock timeout", async () => {
    const lockPath = join(workDir, "audit.lock");
    const reapPath = join(workDir, "audit.lock.reap");
    const source = `
      const { writeFile, link } = await import('node:fs/promises');
      const owner = { pid: process.pid, token: 'dead-reaper-token', createdAt: Date.now() };
      await writeFile(${JSON.stringify(lockPath)}, JSON.stringify(owner) + '\\n', { mode: 0o600, flag: 'wx' });
      await link(${JSON.stringify(lockPath)}, ${JSON.stringify(reapPath)});
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolveChild, rejectChild) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", rejectChild);
      child.once("exit", (code, signal) => {
        if (code === 0) resolveChild();
        else rejectChild(new Error(`reaper fixture exited code=${code} signal=${signal}\n${stderr}`));
      });
    });
    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(reapPath)).toBe(true);

    const startedAt = Date.now();
    audit.auditLog({ timestamp: new Date().toISOString(), tool: "after_dead_reaper", status: "ok" });
    await audit._testFlush();

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const rows = (await readFile(join(workDir, "audit.jsonl"), "utf-8")).trimEnd().split("\n").map(JSON.parse);
    expect(rows.map((row) => row.tool)).toEqual(["after_dead_reaper"]);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(reapPath)).toBe(false);
  }, 10_000);
});
