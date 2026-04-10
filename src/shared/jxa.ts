import { execFile } from "node:child_process";
import { TIMEOUT, BUFFER, CONCURRENCY } from "./constants.js";
import { Semaphore } from "./semaphore.js";

const TRANSIENT_PATTERNS = ["Application isn't running", "Connection is invalid", "-1728"];

// ── JXA error code descriptions ──────────────────────────────────────
const JXA_ERROR_CODES: Record<string, string> = {
  "-1743": "Permission denied — grant Automation access in System Settings > Privacy & Security > Automation",
  "-1728": "Object not found — the app may need to be opened first",
  "-1712": "Scripting not enabled — enable in System Settings > Privacy & Security > Automation",
  "-1708": "Application does not understand this command",
  "-1725": "Invalid parameter — check input values",
  "-600": "Application is not running",
  "-10810": "Application launch failed — the app may be damaged or missing",
};

function describeJxaError(msg: string): string | null {
  for (const [code, desc] of Object.entries(JXA_ERROR_CODES)) {
    if (msg.includes(code)) return `${desc} (${code})`;
  }
  return null;
}

// ── PII scrubbing ────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PATH_RE = /\/Users\/[^\s'",;)}\]]+/g;
const MAX_ERR_LEN = 200;

function scrubPii(msg: string): string {
  return msg.replace(EMAIL_RE, "[email]").replace(PATH_RE, "[path]").slice(0, MAX_ERR_LEN);
}

// ── Concurrency semaphore (lazy — created on first use after config is parsed) ──
let _semaphore: Semaphore | undefined;
function jxaSemaphore(): Semaphore {
  return (_semaphore ??= new Semaphore(CONCURRENCY.JXA_SLOTS));
}

// ── Circuit breaker ──────────────────────────────────────────────────
interface CircuitState {
  failures: number;
  state: "closed" | "open" | "half-open";
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();

function getCircuit(app: string): CircuitState {
  let c = circuits.get(app);
  if (c) {
    // Move to end for LRU eviction — frequently used apps stay in cache
    circuits.delete(app);
    circuits.set(app, c);
    return c;
  }
  if (circuits.size >= CONCURRENCY.CB_CACHE_SIZE) {
    const lru = circuits.keys().next().value;
    if (lru !== undefined) circuits.delete(lru);
  }
  c = { failures: 0, state: "closed", openedAt: 0 };
  circuits.set(app, c);
  return c;
}

function checkCircuit(app: string): void {
  const c = getCircuit(app);
  if (c.state === "open") {
    if (Date.now() - c.openedAt >= CONCURRENCY.CB_OPEN_MS) {
      c.state = "half-open";
      return;
    }
    throw new Error(`Circuit open for ${app} — failing fast`);
  }
}

function recordSuccess(app: string): void {
  const c = getCircuit(app);
  c.failures = 0;
  c.state = "closed";
}

function recordFailure(app: string): void {
  const c = getCircuit(app);
  c.failures++;
  if (c.failures >= CONCURRENCY.CB_THRESHOLD || c.state === "half-open") {
    c.state = "open";
    c.openedAt = Date.now();
  }
}

/** Try to extract Application('Name') from a JXA script string. */
function extractAppName(script: string): string | undefined {
  const m = script.match(/Application\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  return m?.[1];
}

// ── Shared error & parse helpers ─────────────────────────────────────

/** Classify an osascript error and throw a clean, PII-scrubbed Error. */
function handleOsascriptError(e: unknown, app: string | undefined, timeout: number): never {
  if (app) recordFailure(app);
  const error = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  if (error.killed || error.signal === "SIGTERM" || error.signal === "SIGKILL") {
    throw new Error(`osascript timed out after ${timeout / 1000}s`, { cause: e });
  }
  const rawMsg = `${error.stderr ?? ""} ${error.message ?? ""}`.trim();
  const cleanMsg = scrubPii(rawMsg);
  const friendly = describeJxaError(rawMsg);
  throw new Error(friendly ? `osascript error: ${friendly}` : `osascript error: ${cleanMsg}`, { cause: e });
}

/** Parse osascript stdout → JSON, scrub PII, wrap primitives. */
function parseOsascriptOutput<T>(stdout: string, app: string | undefined, stripControlChars = false): T {
  let trimmed = stdout.trim();
  if (stripControlChars) {
    // eslint-disable-next-line no-control-regex
    trimmed = trimmed.replace(/[\x00-\x1f\x7f]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? c : ""));
  }
  if (!trimmed) throw new Error("osascript returned empty output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`osascript returned invalid JSON: ${scrubPii(trimmed)}`);
  }

  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    parsed = { value: parsed };
  }

  if (app) recordSuccess(app);
  return parsed as T;
}

// ── SIGKILL fallback helper ──────────────────────────────────────────
function execOsascript(script: string, timeout: number, language?: "JavaScript"): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const args = language ? ["-l", language, "-e", script] : ["-e", script];
    const child = execFile("osascript", args, { timeout, maxBuffer: BUFFER.JXA }, (error, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });

    child.on("close", () => {
      settled = true;
      clearTimeout(killTimer);
    });

    const killTimer = setTimeout(() => {
      if (child && !child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, timeout + TIMEOUT.KILL_GRACE);

    killTimer.unref();
  });
}

// ── Transient detection ──────────────────────────────────────────────
function isTransient(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  if (err.killed || err.signal === "SIGTERM") return true;
  const msg = `${err.stderr ?? ""} ${err.message ?? ""}`;
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

// ── Main entry point ─────────────────────────────────────────────────
export async function runJxa<T>(script: string, appName?: string): Promise<T> {
  const app = appName ?? extractAppName(script);

  if (app) checkCircuit(app);

  const sem = jxaSemaphore();
  await sem.acquire();
  try {
    return await runJxaInner<T>(script, app);
  } finally {
    sem.release();
  }
}

async function runJxaInner<T>(script: string, app: string | undefined): Promise<T> {
  let stdout: string;

  for (let attempt = 0; attempt <= CONCURRENCY.JXA_RETRIES; attempt++) {
    try {
      stdout = await execOsascript(script, TIMEOUT.JXA, "JavaScript");
      break;
    } catch (e: unknown) {
      if (!isTransient(e) || attempt === CONCURRENCY.JXA_RETRIES) {
        handleOsascriptError(e, app, TIMEOUT.JXA);
      }
      console.error(`[AirMCP] JXA retry attempt ${attempt + 2}/3`);
      const jitter = Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, CONCURRENCY.JXA_RETRY_DELAYS[attempt]! + jitter));
    }
  }

  return parseOsascriptOutput<T>(stdout!, app);
}

/**
 * Run an AppleScript via osascript with the same protections as runJxa
 * (semaphore, circuit breaker, PII scrubbing, SIGKILL fallback).
 */
export async function runAppleScript<T>(script: string, options?: { app?: string; timeout?: number }): Promise<T> {
  const app = options?.app;
  const timeout = options?.timeout ?? TIMEOUT.JXA;

  if (app) checkCircuit(app);

  const sem = jxaSemaphore();
  await sem.acquire();
  try {
    let stdout: string;
    try {
      stdout = await execOsascript(script, timeout);
    } catch (e: unknown) {
      handleOsascriptError(e, app, timeout);
    }
    return parseOsascriptOutput<T>(stdout, app, true);
  } finally {
    sem.release();
  }
}
