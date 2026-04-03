import { appendFile, chmod, mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "./constants.js";

const AUDIT_PATH = join(PATHS.VECTOR_STORE, "audit.jsonl");
const MAX_ARG_LENGTH = 500;
const MAX_ENTRY_SIZE = 10_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — rotate after this
const DEFAULT_FLUSH_INTERVAL = 30_000; // flush buffer every 30s

/** Read lazily so config.ts can set the env var before first use. */
function getFlushInterval(): number {
  const env = process.env.AIRMCP_AUDIT_FLUSH_INTERVAL;
  if (env !== undefined) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_FLUSH_INTERVAL;
}

interface AuditEntry {
  timestamp: string;
  tool: string;
  args?: Record<string, unknown>;
  status: "ok" | "error";
  durationMs?: number;
}

let initialized = false;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  await mkdir(PATHS.VECTOR_STORE, { recursive: true });
  initialized = true;
}

/** Log a tool call to the audit log. Buffered — flushes every 30s (override via AIRMCP_AUDIT_FLUSH_INTERVAL). */
export function auditLog(entry: AuditEntry): void {
  if (auditDisabled) return;
  const sanitized = entry.args ? sanitizeArgs(entry.args) : undefined;
  let line = JSON.stringify({ ...entry, args: sanitized });
  if (line.length > MAX_ENTRY_SIZE) {
    line = JSON.stringify({ ...entry, args: { _truncated: true }, _note: "entry exceeded 10KB limit" });
  }
  buffer.push(line);
  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushBuffer().catch(() => {});
    flushTimer = null;
  }, getFlushInterval());
  if (flushTimer.unref) flushTimer.unref();
}

let flushing = false;
let consecutiveFlushFailures = 0;
let auditDisabled = false;
const MAX_FLUSH_FAILURES = 5;

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0 || flushing || auditDisabled) return;
  flushing = true;
  // Swap buffer reference before flushing so auditLog() writes to a fresh array
  const toFlush = buffer;
  buffer = [];
  const lines = toFlush.join("\n") + "\n";
  try {
    await ensureDir();
    await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
    await rotateIfNeeded();
    consecutiveFlushFailures = 0;
  } catch {
    // Retry once
    try {
      await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
      consecutiveFlushFailures = 0;
    } catch (retryErr) {
      consecutiveFlushFailures++;
      console.error(`[AirMCP Audit] flush failed (${consecutiveFlushFailures}/${MAX_FLUSH_FAILURES}): ${retryErr}`);
      if (consecutiveFlushFailures >= MAX_FLUSH_FAILURES) {
        auditDisabled = true;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        console.error("[AirMCP Audit] Too many consecutive flush failures — audit logging disabled");
      }
    }
  } finally {
    flushing = false;
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const s = await stat(AUDIT_PATH);
    // Ensure owner-only permissions on existing file
    if ((s.mode & 0o777) !== 0o600) await chmod(AUDIT_PATH, 0o600);
    if (s.size > MAX_FILE_SIZE) {
      const rotated = AUDIT_PATH.replace(".jsonl", `.${Date.now()}.jsonl`);
      await rename(AUDIT_PATH, rotated);
    }
  } catch {
    // file doesn't exist or rename failed — fine
  }
}

/** Exported for testing — sanitize argument keys that match sensitive patterns. */
export function sanitizeArgs(args: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 3) return { _truncated: true };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/\b(password|secret|token|api_?key|auth_?token|credential)\b/i.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string" && value.length > MAX_ARG_LENGTH) {
      result[key] = value.slice(0, MAX_ARG_LENGTH) + `... (${value.length} chars)`;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeArgs(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Reset all module-level state and return buffered entries. For testing only. */
export function _testReset(): string[] {
  const snapshot = [...buffer];
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  initialized = false;
  flushing = false;
  consecutiveFlushFailures = 0;
  auditDisabled = false;
  return snapshot;
}
