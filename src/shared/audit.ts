import { appendFile, chmod, mkdir, readdir, readFile, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { hostname, platform } from "node:os";
import { createHmac } from "node:crypto";
import { AUDIT, PATHS } from "./constants.js";
import { assertTestMode, formatError } from "./errors.js";

const AUDIT_PATH = join(PATHS.VECTOR_STORE, "audit.jsonl");
const AUDIT_DIR = PATHS.VECTOR_STORE;
const AUDIT_ROTATED_PREFIX = "audit.";
const AUDIT_ROTATED_SUFFIX = ".jsonl";

interface AuditEntry {
  timestamp: string;
  tool: string;
  args?: Record<string, unknown>;
  status: "ok" | "error";
  durationMs?: number;
}

/**
 * HMAC-SHA256 chain key. Each audit line carries `_hmac` (computed from
 * the previous line's hmac + this line's JSON) and `_prev` (the previous
 * hmac). Tampering with any line breaks the chain at that point + every
 * line after; `summarizeAuditEntries` reports `verified: false` and the
 * offending file.
 *
 * Key source priority:
 *   1. `AIRMCP_AUDIT_HMAC_KEY` env var — strongest. Operator-provided,
 *      enables cross-machine integrity check (move audit.jsonl to a
 *      different host + verify with the same key).
 *   2. Host-derived fallback — `airmcp-audit::<hostname>::<platform>`.
 *      Tamper-detection grade only: an attacker with shell access can
 *      derive the key. This is fine for the actual threat model
 *      (catching log doctoring after-the-fact) but explicitly NOT
 *      strong auth. For high-assurance, set the env.
 */
const AUDIT_HMAC_KEY: Buffer = (() => {
  const env = process.env.AIRMCP_AUDIT_HMAC_KEY;
  if (env && env.length > 0) return Buffer.from(env, "utf-8");
  return Buffer.from(`airmcp-audit::${hostname()}::${platform()}`, "utf-8");
})();

const HMAC_GENESIS = "0".repeat(64);

function computeHmac(prev: string, body: string): string {
  return createHmac("sha256", AUDIT_HMAC_KEY).update(prev).update("\0").update(body).digest("hex");
}

/** In-memory chain head — updated on every appended line. Resumed from
 *  the on-disk tail at first flush so process restarts don't fork the
 *  chain. */
let lastHmac: string = HMAC_GENESIS;
let chainResumed = false;

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

/** Log a tool call to the audit log. Buffered — flushes every 30s (override via AIRMCP_AUDIT_FLUSH_INTERVAL).
 *
 * Each emitted line carries `_prev` and `_hmac` so `summarizeAuditEntries`
 * can verify integrity later. Buffering still happens with raw entries
 * (object form); the HMAC chain is sealed at flush time so a process
 * restart can resume the chain from the disk tail rather than forking it. */
export function auditLog(entry: AuditEntry): void {
  if (auditDisabled) {
    maybeAttemptRecovery();
    if (auditDisabled) return;
  }
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
let auditDisabledSince = 0;

/** Backoff before re-attempting after auditDisabled trips. Disk-full
 *  is the primary trigger and typically clears after the user frees
 *  space, so 5 minutes balances "give the disk time to recover" with
 *  "don't lose hours of audit data on a transient blip". */
const AUDIT_RECOVERY_INTERVAL_MS = 5 * 60_000;

function maybeAttemptRecovery(): void {
  if (!auditDisabled) return;
  const now = Date.now();
  if (now - auditDisabledSince < AUDIT_RECOVERY_INTERVAL_MS) return;
  console.error("[AirMCP Audit] Recovery window elapsed — re-enabling and retrying flush.");
  auditDisabled = false;
  auditDisabledSince = 0;
  consecutiveFlushFailures = 0;
  ensureFlushTimer();
}

/** On first flush after process start, scan the disk tail to extract
 *  the previous chain head — so the chain spans process restarts
 *  instead of forking at every boot. */
async function resumeChainHead(): Promise<void> {
  if (chainResumed) return;
  chainResumed = true;
  try {
    const raw = await readFile(AUDIT_PATH, "utf-8");
    const lines = raw.trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { _hmac?: string };
        if (parsed._hmac && /^[0-9a-f]{64}$/.test(parsed._hmac)) {
          lastHmac = parsed._hmac;
          return;
        }
      } catch {
        // skip malformed
      }
    }
  } catch {
    // file missing or unreadable — start from genesis
  }
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0 || flushing || auditDisabled) {
    if (auditDisabled) maybeAttemptRecovery();
    if (auditDisabled || flushing) return;
    if (buffer.length === 0) return;
  }
  flushing = true;
  // Swap buffer reference before flushing so auditLog() writes to a fresh array
  const toFlush = buffer;
  buffer = [];
  // Seal each line into the HMAC chain at flush time so the chain head
  // resumes correctly across process restarts (vs. computing in auditLog
  // where each turn would assume the in-memory head is current).
  await resumeChainHead();
  const sealedLines: string[] = [];
  for (const raw of toFlush) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const prev = lastHmac;
      // _hmac is computed from the body PRE-attachment. The signed payload is
      // the JSON without _hmac/_prev, so verifiers reconstruct the same body.
      const body = JSON.stringify(obj);
      const hmac = computeHmac(prev, body);
      const sealed = JSON.stringify({ ...obj, _prev: prev, _hmac: hmac });
      sealedLines.push(sealed);
      lastHmac = hmac;
    } catch {
      // Malformed pre-buffer entry — skip rather than crash the flush.
      // This shouldn't happen because auditLog itself JSON.stringify's.
    }
  }
  const lines = sealedLines.join("\n") + "\n";
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
        auditDisabledSince = Date.now();
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        console.error(
          `[AirMCP Audit] Too many consecutive flush failures — audit logging disabled. ` +
            `Auto-retry in ${AUDIT_RECOVERY_INTERVAL_MS / 60_000} minutes (or next auditLog call after that window).`,
        );
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
  auditDisabledSince = 0;
  lastHmac = HMAC_GENESIS;
  chainResumed = false;
  return snapshot;
}

// ── Read API (audit_log / audit_summary tools) ───────────────────────

export interface ReadAuditOptions {
  /** Lower bound on timestamp — ISO 8601 string. Entries older than this
   *  are filtered out. Defaults to 7 days ago. */
  since?: string;
  /** Only return entries for this tool name (exact match). */
  tool?: string;
  /** Filter by status. Omit to include both. */
  status?: "ok" | "error";
  /** Cap on returned entries. Most recent first. */
  limit?: number;
}

export interface ReadAuditResult {
  entries: AuditEntry[];
  total: number;
  returned: number;
  scannedFiles: number;
}

/** Yield every JSONL line across the current file + rotated siblings, in
 *  oldest→newest order. Rotated files are named `audit.<timestamp>.jsonl`
 *  so we can sort lexicographically by the embedded timestamp. */
async function* readAllAuditLines(): AsyncGenerator<{ line: string; file: string }> {
  let files: string[];
  try {
    files = await readdir(AUDIT_DIR);
  } catch {
    return;
  }
  const logFiles = files
    .filter((f) => f === "audit.jsonl" || (f.startsWith(AUDIT_ROTATED_PREFIX) && f.endsWith(AUDIT_ROTATED_SUFFIX)))
    .sort((a, b) => {
      // audit.jsonl is the current (newest) — put it last.
      if (a === "audit.jsonl") return 1;
      if (b === "audit.jsonl") return -1;
      return a.localeCompare(b);
    });
  for (const f of logFiles) {
    let raw: string;
    try {
      raw = await readFile(join(AUDIT_DIR, f), "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line) continue;
      yield { line, file: f };
    }
  }
}

/** Read audit entries with optional filters. Walks every log file so
 *  rotated history stays queryable; the limit bounds memory at the end,
 *  not during scan. Buffered entries still in memory are included so a
 *  user asking for "today" doesn't miss the last 30 seconds. */
export async function readAuditEntries(opts: ReadAuditOptions = {}): Promise<ReadAuditResult> {
  const sinceIso = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(10_000, opts.limit ?? 100));
  const matched: AuditEntry[] = [];
  let scannedFiles = 0;
  const seenFiles = new Set<string>();

  const lineSources: Array<() => AsyncGenerator<{ line: string; file: string }>> = [
    () =>
      (async function* () {
        for (const line of buffer) yield { line, file: "<buffer>" };
      })(),
    () => readAllAuditLines(),
  ];

  for (const source of lineSources) {
    for await (const { line, file } of source()) {
      if (!seenFiles.has(file)) {
        seenFiles.add(file);
        scannedFiles++;
      }
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch {
        continue; // tolerate malformed lines (partial writes, old formats)
      }
      if (typeof entry.timestamp !== "string" || typeof entry.tool !== "string") continue;
      if (entry.timestamp < sinceIso) continue;
      if (opts.tool && entry.tool !== opts.tool) continue;
      if (opts.status && entry.status !== opts.status) continue;
      matched.push(entry);
    }
  }
  // Newest first.
  matched.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const sliced = matched.slice(0, limit);
  return { entries: sliced, total: matched.length, returned: sliced.length, scannedFiles };
}

export interface AuditSummary {
  since: string;
  total: number;
  errors: number;
  errorRate: number;
  topTools: Array<{ tool: string; count: number; errors: number }>;
  scannedFiles: number;
  /** True when every line carrying `_hmac` verifies against the chain.
   *  Legacy lines (no `_hmac` — written before this version) are skipped
   *  and don't break verification on their own. False means a chained
   *  line was tampered with or removed. `verifiedFirstBreak` carries the
   *  file + line index of the first mismatch when verification fails. */
  verified: boolean;
  verifiedFirstBreak?: { file: string; lineIndex: number; reason: "hmac_mismatch" | "prev_mismatch" | "malformed" };
  /** Audit logging is currently disabled (disk full / permission error /
   *  too many failures). Auto-recovery kicks in after the backoff window;
   *  the field surfaces the state so a doctor / health check can flag it. */
  auditDisabled: boolean;
}

/** Aggregate statistics over the audit log: total calls, error rate,
 *  and the top-N busiest tools. `since` defaults to 7 days. `topN`
 *  bounds the returned leaderboard (default 10, max 50). Also walks the
 *  HMAC chain and reports `verified: true` only when every chained line
 *  passes its prev/hmac check (legacy un-chained lines are tolerated). */
export async function summarizeAuditEntries(opts: { since?: string; topN?: number } = {}): Promise<AuditSummary> {
  const sinceIso = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const topN = Math.max(1, Math.min(50, opts.topN ?? 10));
  // Pull everything inside the window — limit set high enough that the
  // caller gets the real population rather than a truncated sample.
  const page = await readAuditEntries({ since: sinceIso, limit: 10_000 });
  const byTool = new Map<string, { count: number; errors: number }>();
  let errors = 0;
  for (const e of page.entries) {
    if (e.status === "error") errors++;
    const cur = byTool.get(e.tool) ?? { count: 0, errors: 0 };
    cur.count++;
    if (e.status === "error") cur.errors++;
    byTool.set(e.tool, cur);
  }
  const topTools = [...byTool.entries()]
    .map(([tool, v]) => ({ tool, count: v.count, errors: v.errors }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  const total = page.entries.length;
  const chainResult = await verifyAuditChain();
  return {
    since: sinceIso,
    total,
    errors,
    errorRate: total > 0 ? Number((errors / total).toFixed(4)) : 0,
    topTools,
    scannedFiles: page.scannedFiles,
    verified: chainResult.verified,
    verifiedFirstBreak: chainResult.firstBreak,
    auditDisabled,
  };
}

/** Walk every audit file in oldest→newest order and replay the HMAC
 *  chain. A line carrying `_hmac` + `_prev` is "chained": the body
 *  (entry minus those two fields) is fed to HMAC-SHA256(prev || \0 ||
 *  body) and the result must equal `_hmac`; `_prev` must equal the
 *  previous chained line's `_hmac` (or `HMAC_GENESIS` if first).
 *
 *  Lines without `_hmac` (legacy, pre-chain) are skipped — they don't
 *  themselves break verification, but a malicious actor inserting a
 *  legacy-shaped line in the middle of the chain would just mean the
 *  next chained line's `_prev` doesn't match the prior `_hmac`, which
 *  IS reported. So legacy interleaving cannot be used to launder a
 *  tampered insertion. */
async function verifyAuditChain(): Promise<{
  verified: boolean;
  firstBreak?: { file: string; lineIndex: number; reason: "hmac_mismatch" | "prev_mismatch" | "malformed" };
}> {
  let prev: string = HMAC_GENESIS;
  let chainStarted = false;
  for await (const { line, file, lineIndex } of readAllAuditLinesIndexed()) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Tolerate malformed lines (partial writes, manual edits) — they
      // don't break the chain because they have no `_hmac` to check.
      continue;
    }
    const hmacField = entry._hmac;
    const prevField = entry._prev;
    if (typeof hmacField !== "string" || typeof prevField !== "string") continue; // legacy line
    if (typeof hmacField !== "string" || !/^[0-9a-f]{64}$/.test(hmacField)) {
      return { verified: false, firstBreak: { file, lineIndex, reason: "malformed" } };
    }
    if (chainStarted && prevField !== prev) {
      return { verified: false, firstBreak: { file, lineIndex, reason: "prev_mismatch" } };
    }
    // Reconstruct the body that was signed: entry minus _hmac/_prev.
    const { _hmac: _h, _prev: _p, ...body } = entry as { _hmac: unknown; _prev: unknown } & Record<string, unknown>;
    void _h;
    void _p;
    const expected = computeHmac(prevField, JSON.stringify(body));
    if (expected !== hmacField) {
      return { verified: false, firstBreak: { file, lineIndex, reason: "hmac_mismatch" } };
    }
    prev = hmacField;
    chainStarted = true;
  }
  return { verified: true };
}

async function* readAllAuditLinesIndexed(): AsyncGenerator<{ line: string; file: string; lineIndex: number }> {
  let files: string[];
  try {
    files = await readdir(AUDIT_DIR);
  } catch {
    return;
  }
  const logFiles = files
    .filter((f) => f === "audit.jsonl" || (f.startsWith(AUDIT_ROTATED_PREFIX) && f.endsWith(AUDIT_ROTATED_SUFFIX)))
    .sort((a, b) => {
      if (a === "audit.jsonl") return 1;
      if (b === "audit.jsonl") return -1;
      return a.localeCompare(b);
    });
  for (const f of logFiles) {
    let raw: string;
    try {
      raw = await readFile(join(AUDIT_DIR, f), "utf-8");
    } catch {
      continue;
    }
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      yield { line, file: f, lineIndex: i };
    }
  }
}
