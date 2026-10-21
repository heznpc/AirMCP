import { execFile } from "node:child_process";
import { TIMEOUT, BUFFER, CONCURRENCY } from "./constants.js";
import { Semaphore } from "./semaphore.js";
import { log } from "./logger.js";

/** Apple Event failures that are safe to retry only for an explicitly
 * read-only JXA operation. Match the terminal osascript error number, never
 * arbitrary diagnostic text, because thrown/user-generated messages can
 * contain strings such as `-1728` without that being the process error. */
const TRANSIENT_ERROR_CODES = new Set(["-1728", "-600", "-609"]);

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

function osascriptErrorCode(msg: string): string | null {
  return msg.match(/\((-?\d+)\)\s*$/)?.[1] ?? null;
}

function describeJxaError(msg: string): string | null {
  const code = osascriptErrorCode(msg);
  const desc = code ? JXA_ERROR_CODES[code] : undefined;
  return code && desc ? `${desc} (${code})` : null;
}

// ── PII scrubbing ────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// A path can contain spaces and every printable punctuation character. Once a
// user-home path starts, conservatively redact the rest of that diagnostic
// line instead of guessing where the path ends and leaking its tail.
const PATH_RE = /\/Users\/[^\r\n]*/g;
const MAX_ERR_LEN = 200;

function scrubPii(msg: string): string {
  return msg.replace(EMAIL_RE, "[email]").replace(PATH_RE, "[path]").slice(0, MAX_ERR_LEN);
}

type OsascriptProcessError = {
  killed?: boolean;
  signal?: string;
  stderr?: string;
  message?: string;
};

/** Return only subprocess diagnostics, never the user-generated `-e` script.
 * `execFile` includes the complete argv in Error.message, so searching that
 * string for Apple error codes can mistake script literals/user input for the
 * actual failure and retry a write. Callback stderr is authoritative; when it
 * is absent, retain process metadata while replacing the script body. */
function osascriptDiagnostic(error: OsascriptProcessError): string {
  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  if (stderr) return stderr;

  const message = typeof error.message === "string" ? error.message.trim() : "";
  const scriptMarker = " -e ";
  const scriptIndex = message.indexOf(scriptMarker);
  return scriptIndex >= 0 ? `${message.slice(0, scriptIndex)}${scriptMarker}[script]` : message;
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
  const error = e as OsascriptProcessError;
  if (error.killed || error.signal === "SIGTERM" || error.signal === "SIGKILL") {
    // Do not retain the raw execFile error as `cause`: its message contains
    // the complete `-e` script and stderr can contain user paths or email.
    throw new Error(`osascript timed out after ${timeout / 1000}s`);
  }
  const diagnostic = osascriptDiagnostic(error);
  const cleanMsg = scrubPii(diagnostic);
  const friendly = describeJxaError(diagnostic);
  throw new Error(friendly ? `osascript error: ${friendly}` : `osascript error: ${cleanMsg}`);
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
    const child = execFile("/usr/bin/osascript", args, { timeout, maxBuffer: BUFFER.JXA }, (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      if (error) {
        // `execFile` delivers stderr as a separate callback argument. It is
        // not reliably attached to the Error object, so preserve it before
        // classification/scrubbing; otherwise a long `-e <script>` command
        // consumes the diagnostic limit and hides the actual TCC denial.
        (error as Error & { stderr?: string }).stderr = stderr;
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
  const err = e as OsascriptProcessError;
  if (err.killed || err.signal === "SIGTERM") return true;
  const code = osascriptErrorCode(osascriptDiagnostic(err));
  return code !== null && TRANSIENT_ERROR_CODES.has(code);
}

// ── Main entry point ─────────────────────────────────────────────────
/** Execute a JXA script once by default. A whole-script retry can duplicate a
 * mutation that reached the target app before the Apple Event response failed,
 * so transient recovery requires an explicit read-only declaration. */
export async function runJxa<T>(script: string, appName?: string, options?: { retryMode?: "read-only" }): Promise<T> {
  const app = appName ?? extractAppName(script);

  if (app) checkCircuit(app);

  const sem = jxaSemaphore();
  await sem.acquire();
  try {
    return await runJxaInner<T>(script, app, options?.retryMode === "read-only");
  } finally {
    sem.release();
  }
}

async function runJxaInner<T>(script: string, app: string | undefined, allowTransientRetry: boolean): Promise<T> {
  let stdout: string;
  const maxRetries = allowTransientRetry ? CONCURRENCY.JXA_RETRIES : 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      stdout = await execOsascript(script, TIMEOUT.JXA, "JavaScript");
      break;
    } catch (e: unknown) {
      if (!isTransient(e) || attempt === maxRetries) {
        handleOsascriptError(e, app, TIMEOUT.JXA);
      }
      log.debug("jxa retry", { attempt: attempt + 2, max: maxRetries + 1, app });
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
