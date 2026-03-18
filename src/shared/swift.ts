import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TIMEOUT, BUFFER, PATHS } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = resolve(__dirname, PATHS.SWIFT_BRIDGE);

// ── Bridge availability check ────────────────────────────────────────

let bridgeChecked = false;
let bridgeError: string | null = null;

export async function checkSwiftBridge(): Promise<string | null> {
  if (bridgeChecked) return bridgeError;
  try {
    await access(BINARY_PATH);
    bridgeError = null;
  } catch {
    bridgeError = "Apple Intelligence requires macOS 26+ with Apple Silicon. Swift bridge not found. Run 'npm run swift-build' to compile.";
  }
  bridgeChecked = true;
  return bridgeError;
}

// ── Command discovery ────────────────────────────────────────────────

let swiftCommands: Set<string> | null = null;
let commandsFetching: Promise<void> | null = null;

/**
 * Load the set of commands supported by the Swift bridge.
 * Caches the result so subsequent calls are instant.
 */
async function loadSwiftCommands(): Promise<void> {
  if (swiftCommands !== null) return;
  if (commandsFetching) return commandsFetching;

  commandsFetching = (async () => {
    try {
      const commands = await runSwift<string[]>("list-commands", "{}");
      swiftCommands = new Set(commands);
    } catch {
      swiftCommands = new Set(); // Bridge unavailable — empty set
    } finally {
      commandsFetching = null;
    }
  })();

  return commandsFetching;
}

/**
 * Check whether the Swift bridge supports a specific command.
 * Returns false if the bridge is not available or the command is unknown.
 */
export async function hasSwiftCommand(name: string): Promise<boolean> {
  const missing = await checkSwiftBridge();
  if (missing) return false;
  await loadSwiftCommands();
  return swiftCommands?.has(name) ?? false;
}

// ── Persistent process management ────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let child: ChildProcess | null = null;
let buffer = "";
const pending = new Map<string, PendingRequest>();
let launching: Promise<void> | null = null;
let launchFailed = false;

function ensureProcess(): Promise<void> {
  if (child && !child.killed && child.exitCode === null) return Promise.resolve();
  if (launching) return launching;

  launching = new Promise<void>((resolve, reject) => {
    launchFailed = false;
    const proc = spawn(BINARY_PATH, ["--persistent"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let ready = false;

    proc.stdout!.setEncoding("utf-8");
    proc.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as { id: string; result?: unknown; error?: string };

          // Handle readiness signal
          if (!ready && msg.id === "__ready__") {
            ready = true;
            clearTimeout(readyTimer);
            child = proc;
            launching = null;
            resolve();
            continue;
          }

          const entry = pending.get(msg.id);
          if (!entry) continue;
          pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(msg.error));
          } else {
            entry.resolve(msg.result);
          }
        } catch {
          console.error("[AirMCP Swift] Invalid response:", trimmed.slice(0, 200));
        }
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      console.error(`[AirMCP Swift] ${chunk.toString().trim()}`);
    });

    proc.on("error", (err) => {
      rejectAll(`Swift bridge error: ${err.message}`);
      child = null;
      if (!ready) {
        launching = null;
        launchFailed = true;
        reject(err);
      }
    });

    proc.on("close", (code) => {
      rejectAll(`Swift bridge exited with code ${code}`);
      child = null;
      launching = null;
      if (!ready) {
        launchFailed = true;
        reject(new Error(`Swift bridge exited during startup with code ${code}`));
      }
    });

    // Timeout for initial readiness
    const readyTimer = setTimeout(() => {
      if (!ready) {
        proc.kill("SIGTERM");
        launching = null;
        launchFailed = true;
        reject(new Error("Swift bridge did not become ready within 10s"));
      }
    }, 10_000);
  });

  return launching;
}

function rejectAll(message: string): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
}

/** Gracefully shut down the persistent Swift process. */
export function closeSwiftBridge(): void {
  if (child && !child.killed) {
    child.stdin!.end();
    child.kill("SIGTERM");
  }
  child = null;
  launching = null;
  rejectAll("Swift bridge closed");
}

// ── Public API ───────────────────────────────────────────────────────

export async function runSwift<T>(command: string, input: string): Promise<T> {
  const missing = await checkSwiftBridge();
  if (missing) throw new Error(missing);

  // If persistent mode failed to launch, fall back to single-shot
  if (launchFailed) {
    return runSwiftSingleShot<T>(command, input);
  }

  try {
    await ensureProcess();
  } catch {
    // Persistent mode unavailable — fall back to single-shot
    launchFailed = true;
    return runSwiftSingleShot<T>(command, input);
  }

  const id = randomUUID();
  const request = `{"id":${JSON.stringify(id)},"command":${JSON.stringify(command)},"input":${input}}`;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Swift bridge timed out after ${TIMEOUT.SWIFT / 1000}s`));
    }, TIMEOUT.SWIFT);

    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });

    try {
      child!.stdin!.write(request + "\n");
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      // Process may have died — reset and fall back
      child = null;
      launchFailed = true;
      reject(new Error(`Failed to write to Swift bridge: ${e}`));
    }
  });
}

// ── Single-shot fallback (original spawn-per-call) ───────────────────

function runSwiftSingleShot<T>(command: string, input: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const proc = spawn(BINARY_PATH, [command], {
      timeout: TIMEOUT.SWIFT,
    });

    let stdout = "";
    let stderr = "";
    let size = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BUFFER.SWIFT) {
        proc.kill("SIGTERM");
        reject(new Error(`Swift bridge output exceeded ${BUFFER.SWIFT} bytes`));
        return;
      }
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        reject(new Error(`Swift bridge timed out after ${TIMEOUT.SWIFT / 1000}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Swift bridge exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error("Swift bridge returned empty output"));
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as T);
      } catch {
        reject(new Error(`Swift bridge returned invalid JSON: ${trimmed.slice(0, 200)}`));
      }
    });

    proc.on("error", (e) => { reject(e); });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
