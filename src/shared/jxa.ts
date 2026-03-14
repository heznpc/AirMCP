import { execFile, type ChildProcess } from "node:child_process";

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const MAX_RETRIES = 2; // up to 3 total attempts
const RETRY_DELAYS = [500, 1000];
const TRANSIENT_PATTERNS = [
  "Application isn't running",
  "Connection is invalid",
  "-1728",
];

// ── Fix 6: PII scrubbing ──────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PATH_RE = /\/Users\/[^\s'",;)}\]]+/g;
const MAX_ERR_LEN = 200;

function scrubPii(msg: string): string {
  return msg
    .replace(EMAIL_RE, "[email]")
    .replace(PATH_RE, "[path]")
    .slice(0, MAX_ERR_LEN);
}

// ── Fix 4: Concurrency semaphore ──────────────────────────────────────
const MAX_CONCURRENT = 3;

class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const semaphore = new Semaphore();

// ── Fix 5: Circuit breaker ────────────────────────────────────────────
const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;
const MAX_CIRCUITS = 50;

interface CircuitState {
  failures: number;
  state: "closed" | "open" | "half-open";
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();

function getCircuit(app: string): CircuitState {
  let c = circuits.get(app);
  if (!c) {
    // Evict oldest entry if map is at capacity.
    if (circuits.size >= MAX_CIRCUITS) {
      const oldest = circuits.keys().next().value!;
      circuits.delete(oldest);
    }
    c = { failures: 0, state: "closed", openedAt: 0 };
    circuits.set(app, c);
  }
  return c;
}

function checkCircuit(app: string): void {
  const c = getCircuit(app);
  if (c.state === "open") {
    if (Date.now() - c.openedAt >= OPEN_DURATION_MS) {
      c.state = "half-open";
      return; // allow probe
    }
    throw new Error(`Circuit open for ${app} — failing fast`);
  }
  // closed or half-open: allow
}

function recordSuccess(app: string): void {
  const c = getCircuit(app);
  c.failures = 0;
  c.state = "closed";
}

function recordFailure(app: string): void {
  const c = getCircuit(app);
  c.failures++;
  if (c.failures >= FAILURE_THRESHOLD || c.state === "half-open") {
    c.state = "open";
    c.openedAt = Date.now();
  }
}

/** Try to extract Application('Name') from a JXA script string. */
function extractAppName(script: string): string | undefined {
  const m = script.match(/Application\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  return m?.[1];
}

// ── Fix 3: SIGKILL fallback helper ────────────────────────────────────
const SIGKILL_GRACE_MS = 3_000;

function execJxa(
  script: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child: ChildProcess | undefined;

    child = execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { timeout, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (settled) return;
        settled = true;

        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );

    // After Node sends SIGTERM (on timeout), wait then escalate to SIGKILL.
    child.on("close", () => {
      // Process has exited — nothing more to do.
      settled = true;
    });

    // Safety: if the process is still alive after timeout + grace, force-kill.
    const killTimer = setTimeout(() => {
      if (child && !child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, timeout + SIGKILL_GRACE_MS);

    // Don't keep the Node process alive just for this timer.
    killTimer.unref();
  });
}

// ── Transient detection ───────────────────────────────────────────────
function isTransient(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  if (err.killed || err.signal === "SIGTERM") return true;
  const msg = `${err.stderr ?? ""} ${err.message ?? ""}`;
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

// ── Main entry point ──────────────────────────────────────────────────
export async function runJxa<T>(script: string, appName?: string): Promise<T> {
  // Resolve app name for circuit breaker (prefer explicit, fall back to extraction).
  const app = appName ?? extractAppName(script);

  // Fix 5: check circuit breaker (skip if no app name).
  if (app) checkCircuit(app);

  // Fix 4: acquire semaphore slot.
  await semaphore.acquire();
  try {
    return await runJxaInner<T>(script, app);
  } finally {
    semaphore.release();
  }
}

async function runJxaInner<T>(script: string, app: string | undefined): Promise<T> {
  let stdout: string;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      stdout = await execJxa(script, TIMEOUT_MS);
      break;
    } catch (e: unknown) {
      if (!isTransient(e) || attempt === MAX_RETRIES) {
        const err = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
        if (app) recordFailure(app);
        if (err.killed || err.signal === "SIGTERM" || err.signal === "SIGKILL") {
          throw new Error(
            `osascript timed out after ${TIMEOUT_MS / 1000}s`,
            { cause: e },
          );
        }
        // Fix 6: scrub PII from error messages.
        const rawMsg = `${err.stderr ?? ""} ${err.message ?? ""}`.trim();
        const cleanMsg = scrubPii(rawMsg);
        throw new Error(`osascript error: ${cleanMsg}`, { cause: e });
      }
      console.error(`[AirMCP] JXA retry attempt ${attempt + 2}/3`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  // stdout is guaranteed to be assigned: the loop either breaks on success or throws
  stdout = stdout!;
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("osascript returned empty output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`osascript returned invalid JSON: ${scrubPii(trimmed)}`);
  }

  // Fix 2: ensure the result is structurally sane (object or array).
  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    parsed = { value: parsed };
  }

  // Circuit breaker: record success.
  if (app) recordSuccess(app);

  return parsed as T;
}
