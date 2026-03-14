import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const MAX_RETRIES = 2; // up to 3 total attempts
const RETRY_DELAYS = [500, 1000];
const TRANSIENT_PATTERNS = [
  "Application isn't running",
  "Connection is invalid",
  "-1728",
];

function isTransient(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  if (err.killed || err.signal === "SIGTERM") return true;
  const msg = `${err.stderr ?? ""} ${err.message ?? ""}`;
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

export async function runJxa<T>(script: string): Promise<T> {
  let stdout: string;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await execFileAsync(
        "osascript",
        ["-l", "JavaScript", "-e", script],
        { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      );
      stdout = result.stdout;
      break;
    } catch (e: unknown) {
      if (!isTransient(e) || attempt === MAX_RETRIES) {
        const err = e as { killed?: boolean; signal?: string };
        if (err.killed || err.signal === "SIGTERM") {
          throw new Error(`osascript timed out after ${TIMEOUT_MS / 1000}s`, { cause: e });
        }
        throw e;
      }
      console.error(`[iConnect] JXA retry attempt ${attempt + 2}/3`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  // stdout is guaranteed to be assigned: the loop either breaks on success or throws
  stdout = stdout!;
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("osascript returned empty output");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`osascript returned invalid JSON: ${trimmed.slice(0, 200)}`);
  }
}
