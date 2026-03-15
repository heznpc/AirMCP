import { execFile } from "node:child_process";
import { TIMEOUT, BUFFER, CONCURRENCY } from "./constants.js";

const TRANSIENT_PATTERNS = [
  "Application isn't running",
  "Connection is invalid",
  "-1728",
];

// ── JXA error code descriptions ──────────────────────────────────────
const JXA_ERROR_CODES: Record<string, string> = {
  "-1743": "Permission denied — grant Automation access in System Settings > Privacy & Security > Automation",
  "-1728": "Object not found — the app may need to be opened first",
  "-1712": "Scripting not enabled — enable in System Settings > Privacy & Security > Automation",
  "-1708": "Application does not understand this command",
  "-1725": "Invalid parameter — check input values",
  "-600":  "Application is not running",
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
  return msg
    .replace(EMAIL_RE, "[email]")
    .replace(PATH_RE, "[path]")
    .slice(0, MAX_ERR_LEN);
}

// ── Concurrency semaphore ────────────────────────────────────────────
class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (this.running < CONCURRENCY.JXA_SLOTS) {
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

// ── Circuit breaker ──────────────────────────────────────────────────
interface CircuitState {
  failures: number;
  state: "closed" | "open" | "half-open";
  openedAt: number;
}

const circuits = new Map<string, CircuitState>();

function getCircuit(app: string): CircuitState {
  let c = circuits.get(app);
  if (!c) {
    if (circuits.size >= CONCURRENCY.CB_CACHE_SIZE) {
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

// ── SIGKILL fallback helper ──────────────────────────────────────────
function execJxa(
  script: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      { timeout, maxBuffer: BUFFER.JXA },
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

    child.on("close", () => {
      settled = true;
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

  await semaphore.acquire();
  try {
    return await runJxaInner<T>(script, app);
  } finally {
    semaphore.release();
  }
}

async function runJxaInner<T>(script: string, app: string | undefined): Promise<T> {
  let stdout: string;

  for (let attempt = 0; attempt <= CONCURRENCY.JXA_RETRIES; attempt++) {
    try {
      stdout = await execJxa(script, TIMEOUT.JXA);
      break;
    } catch (e: unknown) {
      if (!isTransient(e) || attempt === CONCURRENCY.JXA_RETRIES) {
        const err = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
        if (app) recordFailure(app);
        if (err.killed || err.signal === "SIGTERM" || err.signal === "SIGKILL") {
          throw new Error(
            `osascript timed out after ${TIMEOUT.JXA / 1000}s`,
            { cause: e },
          );
        }
        const rawMsg = `${err.stderr ?? ""} ${err.message ?? ""}`.trim();
        const cleanMsg = scrubPii(rawMsg);
        const friendly = describeJxaError(rawMsg);
        throw new Error(friendly ? `osascript error: ${friendly}` : `osascript error: ${cleanMsg}`, { cause: e });
      }
      console.error(`[AirMCP] JXA retry attempt ${attempt + 2}/3`);
      await new Promise((r) => setTimeout(r, CONCURRENCY.JXA_RETRY_DELAYS[attempt]));
    }
  }

  stdout = stdout!;
  const trimmed = stdout.trim();
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
