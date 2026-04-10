import { appendFile, chmod, mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { AUDIT, PATHS } from "./constants.js";
import { assertTestMode, formatError } from "./errors.js";

const AUDIT_PATH = join(PATHS.VECTOR_STORE, "audit.jsonl");

interface AuditEntry {
  timestamp: string;
  tool: string;
  args?: Record<string, unknown>;
  status: "ok" | "error";
  durationMs?: number;
}

/**
 * Tools whose args carry sensitive PII that must NEVER reach the audit log,
 * even truncated. Matching tool calls get their args replaced with a single
 * `_redacted` marker. The audit log already lives behind 0600 permissions,
 * but defense-in-depth: a single accidental share of audit.jsonl shouldn't
 * leak the user's location coordinates or health metrics.
 */
const SENSITIVE_TOOL_PATTERNS: RegExp[] = [/^get_current_location$/, /^get_location_permission$/, /^health_/];

function isSensitiveTool(name: string): boolean {
  return SENSITIVE_TOOL_PATTERNS.some((re) => re.test(name));
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
  let sanitized: Record<string, unknown> | undefined;
  if (isSensitiveTool(entry.tool)) {
    sanitized = entry.args ? { _redacted: "sensitive_tool" } : undefined;
  } else if (entry.args) {
    sanitized = sanitizeArgs(entry.args);
  }
  let line = JSON.stringify({ ...entry, args: sanitized });
  if (line.length > AUDIT.MAX_ENTRY_SIZE) {
    line = JSON.stringify({
      ...entry,
      args: { _truncated: true },
      _note: `entry exceeded ${AUDIT.MAX_ENTRY_SIZE} char limit`,
    });
  }
  buffer.push(line);
  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    // flushBuffer() handles its own retry+logging; this catch only covers
    // unexpected throws outside the inner try (e.g. ENOSPC during the buffer
    // swap, ESM/dynamic import failure) so the rejection never goes silent.
    flushBuffer().catch((err) => {
      console.error(`[AirMCP Audit] flush timer error: ${formatError(err)}`);
    });
    flushTimer = null;
  }, AUDIT.FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();
}

let flushing = false;
let consecutiveFlushFailures = 0;
let auditDisabled = false;

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
      console.error(
        `[AirMCP Audit] flush failed (${consecutiveFlushFailures}/${AUDIT.MAX_FLUSH_FAILURES}): ${retryErr}`,
      );
      if (consecutiveFlushFailures >= AUDIT.MAX_FLUSH_FAILURES) {
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
    if (s.size > AUDIT.MAX_FILE_SIZE) {
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
    if (typeof value === "string" && value.length > AUDIT.MAX_ARG_LENGTH) {
      result[key] = value.slice(0, AUDIT.MAX_ARG_LENGTH) + `... (${value.length} chars)`;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeArgs(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Reset all module-level state and return buffered entries. For testing only.
 * Guarded by `assertTestMode` so a production caller with module access cannot
 * wipe in-memory audit entries before they reach disk.
 */
export function _testReset(): string[] {
  assertTestMode("_testReset()");
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
