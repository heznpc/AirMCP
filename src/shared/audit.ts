import { appendFile, chmod, mkdir, readdir, readFile, stat, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname, platform } from "node:os";
import { createHmac } from "node:crypto";
import { AUDIT, PATHS } from "./constants.js";
import { assertTestMode } from "./errors.js";
import { getCorrelationId } from "./request-context.js";
import { log, errToCtx } from "./logger.js";

const AUDIT_PATH = join(PATHS.VECTOR_STORE, "audit.jsonl");
const AUDIT_DIR = PATHS.VECTOR_STORE;
const AUDIT_ROTATED_PREFIX = "audit.";
const AUDIT_ROTATED_SUFFIX = ".jsonl";

export type AuditEventKind = "tool" | "approval";
export type AuditApprovalDecision = "approved" | "denied" | "timed_out" | "unavailable";
export type AuditApprovalChannel = "elicitation" | "socket" | "unavailable";
export type AuditGate = "oauth_scope" | "emergency_stop" | "rate_limit";

export interface AuditEntry {
  timestamp: string;
  /** Event discriminator. Legacy rows omit this and normalize to `tool`. */
  kind?: AuditEventKind;
  tool: string;
  args?: Record<string, unknown>;
  status: "ok" | "error";
  durationMs?: number;
  /** Correlation ID for cross-line tracing. Auto-populated from
   *  request-context if not set explicitly by the caller. */
  correlationId?: string;
  /**
   * RFC 0012 Phase 1 prep — call origin tag.
   *
   *   - "user"                — interactive user request via MCP client.
   *                             This is the implicit default and remains
   *                             omitted when not explicitly stamped, so
   *                             pre-RFC-0012 audit entries are
   *                             backward-compatible.
   *   - "daemon-skill:<name>" — the always-on daemon's SkillScheduler
   *                             or event loop fired this autonomously.
   *                             Lets `audit_summary` separate human-driven
   *                             from autonomous activity for review.
   *   - "hitl-approved"       — a queued autonomous call the user later
   *                             reviewed and approved via the menu-bar
   *                             HITL queue UI; the corresponding
   *                             pending entry is also archived.
   */
  actor?: string;
  /** Machine-readable failure category only. Human error text is deliberately
   *  excluded from audit metadata to avoid duplicating sensitive output. */
  errorCategory?: string;
  /** Present only on `kind: "approval"` events. */
  approvalDecision?: AuditApprovalDecision;
  /** Approval transport, or `unavailable` when no channel could answer. */
  approvalChannel?: AuditApprovalChannel;
  /** Pre-handler policy gate that blocked a tool call. */
  gate?: AuditGate;
}

/** Public history row. Chain internals (`seq`, `_prev`, `_hmac`) never cross
 *  the audit_log tool boundary. */
export interface AuditHistoryEntry {
  timestamp: string;
  kind: AuditEventKind;
  tool: string;
  status: "ok" | "error";
  durationMs?: number;
  args?: Record<string, unknown>;
  correlationId?: string;
  actor?: string;
  errorCategory?: string;
  approvalDecision?: AuditApprovalDecision;
  approvalChannel?: AuditApprovalChannel;
  gate?: AuditGate;
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
/** True when no AIRMCP_AUDIT_HMAC_KEY is set and the chain falls back to a
 *  host-derived key — tamper-EVIDENT only, not strong auth (an attacker with
 *  shell access can re-derive it). Surfaced as a one-time warning on first
 *  flush so an operator in this mode knows it rather than over-trusting the
 *  chain as cryptographic non-repudiation. */
const AUDIT_USING_HOST_KEY = (process.env.AIRMCP_AUDIT_HMAC_KEY ?? "").length === 0;
const AUDIT_HMAC_KEY: Buffer = AUDIT_USING_HOST_KEY
  ? Buffer.from(`airmcp-audit::${hostname()}::${platform()}`, "utf-8")
  : Buffer.from(process.env.AIRMCP_AUDIT_HMAC_KEY as string, "utf-8");
let warnedHostKey = false;

const HMAC_GENESIS = "0".repeat(64);

function computeHmac(prev: string, body: string): string {
  return createHmac("sha256", AUDIT_HMAC_KEY).update(prev).update("\0").update(body).digest("hex");
}

/**
 * Tail-truncation anchor.
 *
 * The HMAC chain detects edits, insertions, reorders, and genesis-reroot —
 * but NOT removal of the most recent lines: a truncated chain is still a valid
 * shorter chain rooted at genesis. So every sealed line carries a monotonic
 * `seq`, and on each flush we overwrite a single signed checkpoint recording
 * the highest `seq` + chain head. The audit-chain scan reports
 * `truncated` when the checkpoint references a `seq` past the chain's last
 * line. The checkpoint's MAC is domain-separated from chain HMACs, so it can't
 * be forged or rolled back without the key — same trust grade as the chain.
 * Deleting the checkpoint disables only the truncation check; the rest of the
 * chain still verifies.
 */
const CHECKPOINT_PATH = join(PATHS.VECTOR_STORE, "audit.checkpoint");
const CHECKPOINT_DOMAIN = "airmcp-audit-checkpoint-v1";

function checkpointMac(seq: number, hmac: string): string {
  return computeHmac(CHECKPOINT_DOMAIN, `${seq}:${hmac}`);
}

/** In-memory chain head — updated on every appended line. Resumed from
 *  the on-disk tail at first flush so process restarts don't fork the
 *  chain. */
let lastHmac: string = HMAC_GENESIS;
/** Monotonic per-line sequence, resumed from the disk tail at first flush
 *  alongside `lastHmac`. -1 means no chained line has been written yet. */
let lastSeq = -1;
let chainResumed = false;

/**
 * Tools whose args carry sensitive PII that must NEVER reach the audit log,
 * even truncated. Matching tool calls get their args replaced with a single
 * `_redacted` marker. The audit log already lives behind 0600 permissions,
 * but defense-in-depth: a single accidental share of audit.jsonl shouldn't
 * leak the user's location coordinates, health metrics, or OAuth tokens.
 */
const SENSITIVE_TOOL_PATTERNS: RegExp[] = [
  /^get_current_location$/,
  /^get_location_permission$/,
  /^health_/,
  // OAuth / credential surface (RFC 0005). Tokens, refresh tokens, scope
  // grants — anything an attacker could replay against an authorization
  // server. Conservative pattern; tools that legitimately need to log
  // their args can opt out by living outside this pattern.
  /^oauth_/,
  /password/i,
  /credential/i,
  /token/i,
];

function isSensitiveTool(name: string): boolean {
  return SENSITIVE_TOOL_PATTERNS.some((re) => re.test(name));
}

let initialized = false;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  // 0o700: the audit dir holds audit.jsonl + audit.checkpoint. Files are already
  // 0600, but match the sibling app-runtime-token dir's owner-only mode so other
  // local users can't even enumerate audit filenames / rotation timestamps.
  await mkdir(PATHS.VECTOR_STORE, { recursive: true, mode: 0o700 });
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
  }
  let sanitized: Record<string, unknown> | undefined;
  if (isSensitiveTool(entry.tool)) {
    sanitized = entry.args ? { _redacted: "sensitive_tool" } : undefined;
  } else if (entry.args) {
    sanitized = sanitizeArgs(entry.args);
  }
  // Auto-attach the active correlation ID when the caller didn't pass
  // one. Falls through to undefined for synthetic / pre-context callers
  // (e.g. startup banner, direct test invocations).
  const correlationId = entry.correlationId ?? getCorrelationId();
  const normalizedEntry = {
    ...entry,
    kind: entry.kind ?? "tool",
    args: sanitized,
    correlationId,
  };
  let line = JSON.stringify(normalizedEntry);
  if (line.length > AUDIT.MAX_ENTRY_SIZE) {
    line = JSON.stringify({
      ...normalizedEntry,
      args: { _truncated: true },
      _note: `entry exceeded ${AUDIT.MAX_ENTRY_SIZE} char limit`,
    });
  }
  buffer.push(line);
  // A repeated append failure pauses disk retries, but it must not create an
  // unreported audit gap. Keep accepting entries into the in-memory spool
  // while disabled; the first recovery attempt drains the complete backlog.
  // (When the underlying disk itself is unavailable there is no safer
  // durable spool to write to.)
  if (!auditDisabled) ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    // flushBuffer() handles its own retry+logging; this catch only covers
    // unexpected throws outside the inner try (e.g. ENOSPC during the buffer
    // swap, ESM/dynamic import failure) so the rejection never goes silent.
    flushBuffer().catch((err) => {
      log.error("audit: flush timer error", { err: errToCtx(err) });
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
  log.info("audit: recovery window elapsed — re-enabling and retrying flush");
  auditDisabled = false;
  auditDisabledSince = 0;
  consecutiveFlushFailures = 0;
  ensureFlushTimer();
}

/** On first flush after process start, scan the disk tail to extract
 *  the previous chain head — so the chain spans process restarts
 *  instead of forking at every boot.
 *
 *  Walks back through audit.jsonl first; if that file doesn't exist
 *  (rotated-and-not-yet-rewritten race window) or contains no chained
 *  entries, falls back to the most recent rotated file. Without this
 *  fallback, a process restart that lands inside the "rotation just
 *  happened, no new flush yet" window would silently reset the chain
 *  to genesis and the audit summary would report `verified: false` at
 *  the seam — a false-positive that erodes the strongest trust signal
 *  in the codebase.
 */
async function resumeChainHead(): Promise<void> {
  if (chainResumed) return;
  chainResumed = true;
  if (await scanFileForChainHead(AUDIT_PATH, /* isPrimary */ true)) return;
  // Primary file missing/empty/no-chain — walk rotated files newest-first.
  let rotatedFiles: string[];
  try {
    const all = await readdir(AUDIT_DIR);
    rotatedFiles = all
      .filter((f) => f !== "audit.jsonl" && f.startsWith(AUDIT_ROTATED_PREFIX) && f.endsWith(AUDIT_ROTATED_SUFFIX))
      // Filenames are `audit.<Date.now()>.jsonl`; lex-sorting descending is
      // chronological-descending for the next 200+ years (constant 13-digit
      // millisecond timestamps). Sort reverse so we visit newest first.
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return;
  }
  for (const f of rotatedFiles) {
    if (await scanFileForChainHead(join(AUDIT_DIR, f), /* isPrimary */ false)) return;
  }
}

/** Returns true if a chain head was recovered from the given file. */
async function scanFileForChainHead(path: string, isPrimary: boolean): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return false;
  }
  const lines = raw.trimEnd().split("\n");
  let malformedCount = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { _hmac?: string; seq?: number };
      if (parsed._hmac && /^[0-9a-f]{64}$/.test(parsed._hmac)) {
        lastHmac = parsed._hmac;
        // Resume the seq counter from the tail so it stays monotonic across
        // restarts (the truncation checkpoint compares against it). A tail
        // written before seq existed leaves lastSeq at -1 — new lines start
        // numbering from 0 and the next flush's checkpoint anchors them.
        if (typeof parsed.seq === "number" && Number.isInteger(parsed.seq)) lastSeq = parsed.seq;
        if (malformedCount > 0) {
          log.warn("audit: resumed chain past malformed lines — possible tampering or corruption", {
            lastHmacPrefix: parsed._hmac.slice(0, 8),
            skippedMalformed: malformedCount,
            note: "run audit_summary to verify",
          });
        }
        return true;
      }
    } catch {
      malformedCount++;
    }
  }
  if (malformedCount > 0 && isPrimary) {
    log.warn("audit: no chain head found — falling back to rotated files", {
      lines: lines.length,
      malformed: malformedCount,
    });
  }
  return false;
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
  let appended = false;
  let candidateHmac = lastHmac;
  let candidateSeq = lastSeq;
  try {
    // Seal each line into the HMAC chain at flush time so the chain head
    // resumes correctly across process restarts (vs. computing in auditLog
    // where each turn would assume the in-memory head is current).
    await resumeChainHead();
    // Build the candidate batch against local state. The live chain head and
    // sequence are a commit record for bytes known to be on disk; advancing
    // them before appendFile succeeds forks every future entry after a
    // transient write failure.
    candidateHmac = lastHmac;
    candidateSeq = lastSeq;
    const sealedLines: string[] = [];
    for (const raw of toFlush) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const prev = candidateHmac;
      // Stamp a monotonic seq into the SIGNED body (added last so the parsed-
      // object insertion order the verifier relies on is preserved). The
      // truncation checkpoint anchors against this seq.
      obj.seq = ++candidateSeq;
      // _hmac is computed from the body PRE-attachment. The signed payload is
      // the JSON without _hmac/_prev, so verifiers reconstruct the same body.
      const body = JSON.stringify(obj);
      const hmac = computeHmac(prev, body);
      // Build the sealed line by string surgery instead of `JSON.stringify({
      // ...obj, _prev, _hmac })` to skip the second serialise of `obj`. Safe
      // because: (1) `body` starts with "{" and ends with "}" — JSON.stringify
      // of a non-null object is guaranteed to; (2) audit entries always carry
      // at least timestamp/tool/args/status, so body is never the empty "{}"
      // edge case where we'd need a leading comma guard; (3) `prev` and `hmac`
      // are hex strings (`[0-9a-f]{64}`) and need no JSON escaping. Verifier
      // round-trip (parse → delete _prev/_hmac → re-stringify) reconstructs
      // exactly `body` because V8 preserves parsed-object insertion order.
      const sealed = body.slice(0, -1) + `,"_prev":"${prev}","_hmac":"${hmac}"}`;
      sealedLines.push(sealed);
      candidateHmac = hmac;
    }
    const lines = sealedLines.join("\n") + "\n";

    try {
      await ensureDir();
      await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
      await rotateIfNeeded();
      consecutiveFlushFailures = 0;
      appended = true;
    } catch {
      // Retry the exact sealed payload once. Candidate state remains local
      // until one complete append reports success.
      try {
        await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
        consecutiveFlushFailures = 0;
        appended = true;
      } catch (retryErr) {
        recordFlushFailure(retryErr);
      }
    }
  } catch (unexpectedErr) {
    // Includes recovery scans, serialization, and other failures outside the
    // two append attempts. The batch still follows the same lossless requeue
    // rule instead of being abandoned by the timer-level catch.
    recordFlushFailure(unexpectedErr);
  } finally {
    if (appended) {
      // Commit chain state only after the complete sealed batch is known to
      // have landed. Entries logged concurrently remain in the fresh buffer
      // and will chain from this newly committed head on the next flush.
      lastHmac = candidateHmac;
      lastSeq = candidateSeq;
    } else {
      // Preserve FIFO order: the failed batch predates any entries that
      // arrived while the write was in flight.
      buffer = [...toFlush, ...buffer];
    }
    flushing = false;
  }
  if (!appended && !auditDisabled) ensureFlushTimer();
  // Outside the flush critical section: a checkpoint failure must never fail
  // or retry the append. Anchors the truncation guard at the seq just sealed.
  if (appended) {
    await writeCheckpoint();
    warnHostKeyOnce();
  }
}

function recordFlushFailure(err: unknown): void {
  consecutiveFlushFailures++;
  log.error("audit: flush failed", {
    attempts: consecutiveFlushFailures,
    max: AUDIT.MAX_FLUSH_FAILURES,
    err: errToCtx(err),
  });
  if (consecutiveFlushFailures < AUDIT.MAX_FLUSH_FAILURES) return;

  auditDisabled = true;
  auditDisabledSince = Date.now();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  log.error("audit: too many consecutive flush failures — audit logging disabled", {
    retryAfterMinutes: AUDIT_RECOVERY_INTERVAL_MS / 60_000,
    note: "auto-retry after that window or on next auditLog call",
  });
}

/** Persist the signed tail-truncation checkpoint (single small write — a
 *  parse/shape failure on read is treated as "absent", not tampering, so a
 *  rare torn write never produces a false alarm). Best-effort: a failure here
 *  only weakens truncation detection until the next successful flush — it must
 *  not disturb the append that already landed. */
async function writeCheckpoint(): Promise<void> {
  if (lastSeq < 0) return; // nothing chained yet
  try {
    const mac = checkpointMac(lastSeq, lastHmac);
    const payload = JSON.stringify({ seq: lastSeq, hmac: lastHmac, mac }) + "\n";
    await writeFile(CHECKPOINT_PATH, payload, { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    log.warn("audit: checkpoint write failed — tail-truncation detection degraded until next flush", {
      err: errToCtx(err),
    });
  }
}

/** One-time warning when the chain is keyed off the host-derived fallback.
 *  Fires on first successful flush (not at import) to avoid noise in tests
 *  and short-lived CLI invocations that never write audit lines. */
function warnHostKeyOnce(): void {
  if (warnedHostKey || !AUDIT_USING_HOST_KEY) return;
  warnedHostKey = true;
  log.warn("audit: HMAC chain keyed off host-derived fallback — tamper-EVIDENT only, not strong auth", {
    note: "an attacker with shell access can re-derive this key; set AIRMCP_AUDIT_HMAC_KEY for cross-machine / strong integrity",
  });
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
    // Normalize the key (strip separators, lowercase) before matching. A `\b` word
    // boundary never fires before an embedded "token"/"secret" in compound names, so
    // the old regex FAILED to redact access_token / refreshToken / sessionToken /
    // clientSecret / api-key and wrote their raw VALUES into the audit log. Matching
    // fragments against the separator-stripped key catches those standard names.
    const normalizedKey = key.replace(/[_\-\s]/g, "").toLowerCase();
    if (
      /token|secret|password|passphrase|passwd|apikey|credential|bearer|privatekey|sessionid|accesskey|oauth|authorization/.test(
        normalizedKey,
      )
    ) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = sanitizeValue(value, depth);
  }
  return result;
}

/**
 * Recursively sanitize a single value: truncate long strings, recurse into
 * plain objects (so nested secret-named keys are redacted), and recurse into
 * arrays element-by-element — an array of objects (e.g. `headers: [{ authorization }]`)
 * would otherwise be written verbatim and leak the embedded credential.
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string" && value.length > AUDIT.MAX_ARG_LENGTH) {
    return value.slice(0, AUDIT.MAX_ARG_LENGTH) + `... (${value.length} chars)`;
  }
  if (Array.isArray(value)) {
    if (depth > 3) return "[truncated]";
    return value.map((el) => sanitizeValue(el, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return sanitizeArgs(value as Record<string, unknown>, depth + 1);
  }
  return value;
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
  lastSeq = -1;
  warnedHostKey = false;
  chainResumed = false;
  return snapshot;
}

/**
 * Manually flush the buffer to disk. For testing only — production flushing
 * happens automatically via the 30s timer (see `ensureFlushTimer`). Tests use
 * this to exercise the flush + rotate + recovery code paths synchronously
 * instead of waiting on real timers.
 */
export async function _testFlush(): Promise<void> {
  assertTestMode("_testFlush()");
  await flushBuffer();
}

/**
 * Read internal state for test assertions. For testing only — exposes the
 * audit-disabled / consecutive-failure counters that production code only
 * surfaces through `summarizeAuditEntries`.
 */
export function _testGetState(): {
  auditDisabled: boolean;
  consecutiveFlushFailures: number;
  bufferLength: number;
  flushing: boolean;
} {
  assertTestMode("_testGetState()");
  return {
    auditDisabled,
    consecutiveFlushFailures,
    bufferLength: buffer.length,
    flushing,
  };
}

/**
 * Override `auditDisabledSince` to a specific Unix-ms timestamp. For testing
 * only — lets the recovery-window test exercise `maybeAttemptRecovery()`
 * without waiting 5 real minutes between the auditDisabled trip and the
 * retry probe.
 */
export function _testSetAuditDisabledSince(timestamp: number): void {
  assertTestMode("_testSetAuditDisabledSince()");
  auditDisabledSince = timestamp;
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
  /** Filter to one trace/run. */
  correlationId?: string;
  /** Filter by event kind. Legacy rows normalize to `tool`. */
  kind?: AuditEventKind;
  /** Cap on returned entries. Most recent first. */
  limit?: number;
}

export interface ReadAuditResult {
  entries: AuditHistoryEntry[];
  total: number;
  returned: number;
  scannedFiles: number;
  verified: boolean;
  firstBreak?: { file: string; lineIndex: number; reason: AuditChainBreakReason };
  auditDisabled: boolean;
}

/** Why the HMAC chain failed to verify. `truncated` / `checkpoint_forged`
 *  come from the tail-truncation checkpoint; the rest from chain replay. */
export type AuditChainBreakReason = "hmac_mismatch" | "prev_mismatch" | "malformed" | "truncated" | "checkpoint_forged";

interface AuditChainScanResult {
  /** Entries accepted before the first integrity break. This is either the
   *  explicit legacy prefix (valid audit rows before the chain starts) or
   *  rows whose HMAC was replayed successfully. */
  entries: AuditEntry[];
  scannedFiles: number;
  verified: boolean;
  firstBreak?: { file: string; lineIndex: number; reason: AuditChainBreakReason };
}

function asAuditEntry(entry: Record<string, unknown>): AuditEntry | null {
  if (
    typeof entry.timestamp !== "string" ||
    typeof entry.tool !== "string" ||
    (entry.status !== "ok" && entry.status !== "error")
  ) {
    return null;
  }
  return entry as unknown as AuditEntry;
}

function normalizeAuditEntry(entry: AuditEntry): AuditHistoryEntry {
  const raw = entry as AuditEntry & Record<string, unknown>;
  const approvalDecision =
    raw.approvalDecision === "approved" ||
    raw.approvalDecision === "denied" ||
    raw.approvalDecision === "timed_out" ||
    raw.approvalDecision === "unavailable"
      ? raw.approvalDecision
      : undefined;
  const approvalChannel =
    raw.approvalChannel === "elicitation" || raw.approvalChannel === "socket" || raw.approvalChannel === "unavailable"
      ? raw.approvalChannel
      : undefined;
  const gate =
    raw.gate === "oauth_scope" || raw.gate === "emergency_stop" || raw.gate === "rate_limit" ? raw.gate : undefined;
  return {
    timestamp: entry.timestamp,
    kind: entry.kind === "approval" ? "approval" : "tool",
    tool: entry.tool,
    status: entry.status,
    ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
    ...(raw.args && typeof raw.args === "object" && !Array.isArray(raw.args)
      ? { args: raw.args as Record<string, unknown> }
      : {}),
    ...(typeof raw.correlationId === "string" ? { correlationId: raw.correlationId } : {}),
    ...(typeof raw.actor === "string" ? { actor: raw.actor } : {}),
    ...(typeof raw.errorCategory === "string" ? { errorCategory: raw.errorCategory } : {}),
    ...(approvalDecision ? { approvalDecision } : {}),
    ...(approvalChannel ? { approvalChannel } : {}),
    ...(gate ? { gate } : {}),
  };
}

/** Replay and decode the log in a single oldest→newest pass.
 *
 * Compatibility is deliberately narrow: valid unsigned audit rows are
 * accepted only as one contiguous legacy prefix before the first chained
 * row. Once the chain starts, malformed JSON, a partial signature envelope,
 * or another unsigned row is an integrity break. The returned entry list
 * stops at that break so callers never aggregate attacker-inserted data (or
 * later rows whose full file ordering is no longer trustworthy). */
async function scanAuditChain(): Promise<AuditChainScanResult> {
  const entries: AuditEntry[] = [];
  const seenFiles = new Set<string>();
  let prev: string = HMAC_GENESIS;
  let chainStarted = false;
  let chainLastSeq = -1;
  let chainHeadHmac: string = HMAC_GENESIS;

  const broken = (file: string, lineIndex: number, reason: AuditChainBreakReason): AuditChainScanResult => ({
    entries,
    scannedFiles: seenFiles.size,
    verified: false,
    firstBreak: { file, lineIndex, reason },
  });

  for await (const { line, file, lineIndex } of readAllAuditLinesIndexed()) {
    seenFiles.add(file);
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return broken(file, lineIndex, "malformed");
    }

    const hasHmac = Object.prototype.hasOwnProperty.call(entry, "_hmac");
    const hasPrev = Object.prototype.hasOwnProperty.call(entry, "_prev");
    if (!hasHmac && !hasPrev) {
      const legacyEntry = asAuditEntry(entry);
      if (chainStarted || !legacyEntry) return broken(file, lineIndex, "malformed");
      entries.push(legacyEntry);
      continue;
    }

    const hmacField = entry._hmac;
    const prevField = entry._prev;
    if (
      !hasHmac ||
      !hasPrev ||
      typeof hmacField !== "string" ||
      typeof prevField !== "string" ||
      !/^[0-9a-f]{64}$/.test(hmacField) ||
      !/^[0-9a-f]{64}$/.test(prevField)
    ) {
      return broken(file, lineIndex, "malformed");
    }

    const expectedPrev = chainStarted ? prev : HMAC_GENESIS;
    if (prevField !== expectedPrev) return broken(file, lineIndex, "prev_mismatch");

    // Reconstruct the exact body that was signed: parsed insertion order is
    // retained by V8 and `_prev` / `_hmac` were appended after the body.
    const {
      _hmac: _h,
      _prev: _p,
      ...body
    } = entry as {
      _hmac: unknown;
      _prev: unknown;
    } & Record<string, unknown>;
    void _h;
    void _p;
    const expected = computeHmac(prevField, JSON.stringify(body));
    if (expected !== hmacField) return broken(file, lineIndex, "hmac_mismatch");

    const decoded = asAuditEntry(entry);
    if (!decoded) return broken(file, lineIndex, "malformed");
    entries.push(decoded);
    prev = hmacField;
    chainStarted = true;
    chainHeadHmac = hmacField;
    if (typeof entry.seq === "number" && Number.isInteger(entry.seq)) chainLastSeq = entry.seq;
  }

  // A valid signed checkpoint anchors the tail. Its integrity verdict is part
  // of this same snapshot so the rows used by readers and the `verified`
  // signal can never come from two different filesystem walks.
  const ck = await readCheckpoint();
  if (ck) {
    if (ck.mac !== checkpointMac(ck.seq, ck.hmac)) {
      return broken("audit.checkpoint", -1, "checkpoint_forged");
    }
    if (ck.seq > chainLastSeq || (ck.seq === chainLastSeq && ck.hmac !== chainHeadHmac)) {
      return broken("audit.checkpoint", -1, "truncated");
    }
  }

  return { entries, scannedFiles: seenFiles.size, verified: true };
}

function filterAuditEntries(
  entries: AuditEntry[],
  opts: ReadAuditOptions,
): { entries: AuditHistoryEntry[]; total: number; returned: number } {
  const sinceIso = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(10_000, opts.limit ?? 100));
  const matched = entries.filter((entry) => {
    if (entry.timestamp < sinceIso) return false;
    if (opts.tool && entry.tool !== opts.tool) return false;
    if (opts.status && entry.status !== opts.status) return false;
    if (opts.correlationId && entry.correlationId !== opts.correlationId) return false;
    if (opts.kind && (entry.kind ?? "tool") !== opts.kind) return false;
    return true;
  });
  matched.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const normalized = matched.slice(0, limit).map(normalizeAuditEntry);
  return { entries: normalized, total: matched.length, returned: normalized.length };
}

/** Read audit entries with optional filters. Walks every log file so
 *  rotated history stays queryable; the limit bounds memory at the end,
 *  not during scan. Only the accepted legacy prefix + HMAC-verified chain
 *  prefix is returned. Pending entries are sealed before the scan so `entries`
 *  and the integrity verdict describe one HMAC-backed snapshot. */
export async function readAuditEntries(opts: ReadAuditOptions = {}): Promise<ReadAuditResult> {
  await flushBuffer();
  const scan = await scanAuditChain();
  const page = filterAuditEntries(scan.entries, opts);
  return {
    entries: page.entries,
    total: page.total,
    returned: page.returned,
    scannedFiles: scan.scannedFiles,
    verified: scan.verified,
    ...(scan.firstBreak ? { firstBreak: scan.firstBreak } : {}),
    auditDisabled,
  };
}

export interface AuditSummary {
  since: string;
  total: number;
  errors: number;
  errorRate: number;
  topTools: Array<{ tool: string; count: number; errors: number }>;
  scannedFiles: number;
  /** True when the audit file is one valid legacy prefix followed by an
   *  intact HMAC chain. Once the chain starts, unsigned or malformed rows
   *  fail verification. `verifiedFirstBreak` carries the first mismatch. */
  verified: boolean;
  verifiedFirstBreak?: { file: string; lineIndex: number; reason: AuditChainBreakReason };
  /** Audit logging is currently disabled (disk full / permission error /
   *  too many failures). Auto-recovery kicks in after the backoff window;
   *  the field surfaces the state so a doctor / health check can flag it. */
  auditDisabled: boolean;
}

/** Aggregate statistics over the accepted audit prefix: total calls, error
 *  rate, and the top-N busiest tools. Rows at or after the first integrity
 *  break are excluded, so the numbers never bless an inserted unsigned or
 *  malformed record. `since` defaults to 7 days. */
export async function summarizeAuditEntries(opts: { since?: string; topN?: number } = {}): Promise<AuditSummary> {
  const sinceIso = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const topN = Math.max(1, Math.min(50, opts.topN ?? 10));
  await flushBuffer();
  const chainResult = await scanAuditChain();
  // Summary counts are based on the exact snapshot that produced the chain
  // verdict. Pending, not-yet-sealed buffer rows are intentionally omitted.
  const page = filterAuditEntries(chainResult.entries, {
    since: sinceIso,
    kind: "tool",
    limit: 10_000,
  });
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
  return {
    since: sinceIso,
    total,
    errors,
    errorRate: total > 0 ? Number((errors / total).toFixed(4)) : 0,
    topTools,
    scannedFiles: chainResult.scannedFiles,
    verified: chainResult.verified,
    verifiedFirstBreak: chainResult.firstBreak,
    auditDisabled,
  };
}

/** Read + shape-validate the truncation checkpoint. Returns null when absent
 *  OR present-but-unparseable / wrong-shape — both degrade to "no truncation
 *  check, chain still verifies on its own" rather than a false alarm (a torn
 *  write is indistinguishable from corruption, and the moat must not cry wolf;
 *  deleting the checkpoint is already an undetectable disable, documented).
 *  A well-formed checkpoint with a WRONG MAC is the real forgery signal —
 *  that's returned here so the chain scan reports `checkpoint_forged`. */
async function readCheckpoint(): Promise<{ seq: number; hmac: string; mac: string } | null> {
  let raw: string;
  try {
    raw = await readFile(CHECKPOINT_PATH, "utf-8");
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(raw.trim()) as { seq?: unknown; hmac?: unknown; mac?: unknown };
    if (
      typeof obj.seq === "number" &&
      Number.isInteger(obj.seq) &&
      obj.seq >= 0 &&
      typeof obj.hmac === "string" &&
      /^[0-9a-f]{64}$/.test(obj.hmac) &&
      typeof obj.mac === "string" &&
      /^[0-9a-f]{64}$/.test(obj.mac)
    ) {
      return { seq: obj.seq, hmac: obj.hmac, mac: obj.mac };
    }
  } catch {
    // unparseable — fall through to absent
  }
  return null;
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
