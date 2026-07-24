import {
  appendFile,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { hostname, platform } from "node:os";
import { createHmac, randomUUID } from "node:crypto";
import { AUDIT, PATHS } from "./constants.js";
import { assertTestMode, formatError } from "./errors.js";
import { getCorrelationId } from "./request-context.js";
import { log, errToCtx } from "./logger.js";

const AUDIT_PATH = join(PATHS.VECTOR_STORE, "audit.jsonl");
const AUDIT_DIR = PATHS.VECTOR_STORE;

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
  approvalId?: string;
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
  approvalId?: string;
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

/**
 * Machine-readable trust grade of the audit HMAC key.
 * `operator-key`  — AIRMCP_AUDIT_HMAC_KEY is set: tamper-evident with an
 *                   external secret (cross-machine verifiable, non-repudiation).
 * `host-fallback` — no key set: chain uses a host-derived key, so it is
 *                   tamper-EVIDENT only (an attacker with shell access can
 *                   re-derive it). Previously this only ever surfaced as a
 *                   one-time stderr warning; the trust attestation exposes it
 *                   so a consumer can weigh the audit verdict accordingly.
 */
export function getAuditKeyGrade(): "operator-key" | "host-fallback" {
  return AUDIT_USING_HOST_KEY ? "host-fallback" : "operator-key";
}

const HMAC_GENESIS = "0".repeat(64);

function computeHmac(prev: string, body: string): string {
  return createHmac("sha256", AUDIT_HMAC_KEY).update(prev).update("\0").update(body).digest("hex");
}

/** Recover the exact body bytes emitted by every AirMCP signed-row writer.
 *
 * Signed rows have always been serialized as the JSON body without its final
 * `}`, followed by the fixed `_prev`, `_hmac` suffix below. Extracting that
 * suffix is intentionally stricter than parse/delete/re-stringify: JSON
 * whitespace, escape spelling, and duplicate keys are semantically normalized
 * by `JSON.parse`, which previously let raw-byte edits retain a valid verdict.
 *
 * This remains compatible with pre-sequence signed rows because `seq` lives in
 * the body, not the envelope. Unsigned pre-HMAC rows never enter this function
 * and keep their explicit untrusted legacy migration path.
 */
function exactSignedBody(line: string, prev: string, hmac: string): string | null {
  const suffix = `,"_prev":"${prev}","_hmac":"${hmac}"}`;
  if (!line.startsWith("{") || !line.endsWith(suffix)) return null;
  const bodyWithoutClosingBrace = line.slice(0, -suffix.length);
  if (bodyWithoutClosingBrace.length <= 1) return null;
  return `${bodyWithoutClosingBrace}}`;
}

/**
 * Tail-truncation anchor.
 *
 * The HMAC chain detects edits, insertions, reorders, and genesis-reroot —
 * but NOT removal of the most recent lines: a truncated chain is still a valid
 * shorter chain rooted at genesis. So every sealed line carries a monotonic
 * `seq`, and on each flush we overwrite a single signed checkpoint recording
 * the highest `seq` + chain head. The audit-chain scan reports
 * `truncated` whenever the checkpoint and signed tail are not an exact pair.
 * The checkpoint's MAC is domain-separated from chain HMACs, so it can't be
 * forged without the key. While this process is alive, an observed checkpoint
 * floor also detects replacement with an older valid log/checkpoint pair or
 * deletion of both files. That floor is intentionally memory-only: after a
 * restart, a complete older pair is internally valid and cannot be
 * distinguished from an intentional restore without an external monotonic
 * anchor. AirMCP does not claim restart-spanning rollback detection.
 *
 * Once sequenced rows remain on disk, deleting or corrupting the checkpoint
 * fails closed and later appends are refused rather than minting a weaker
 * anchor.
 */
const CHECKPOINT_PATH = join(PATHS.VECTOR_STORE, "audit.checkpoint");
const CHECKPOINT_DOMAIN = "airmcp-audit-checkpoint-v1";

/**
 * Cross-process writer lock.
 *
 * `link(2)` is the ownership primitive: each contender creates a unique file
 * and atomically hard-links it to `audit.lock`. This is the same dot-locking
 * protocol used by long-lived Unix mailbox tooling and works on both macOS
 * and Linux without a native addon. A second hard-link (`audit.lock.reap`)
 * serializes stale-owner recovery so a newly-acquired lock can never be
 * deleted by a competing reaper.
 */
const AUDIT_LOCK_PATH = join(PATHS.VECTOR_STORE, "audit.lock");
const AUDIT_LOCK_REAP_PATH = join(PATHS.VECTOR_STORE, "audit.lock.reap");
const AUDIT_LOCK_WAIT_MS = 60_000;
const AUDIT_LOCK_RETRY_MS = 10;

interface AuditLockOwner {
  pid: number;
  token: string;
  createdAt: number;
}

interface ObservedCheckpointFloor {
  seq: number;
  hmac: string;
}

/** Process-local freshness floor. It strengthens a live runtime but is not an
 * external monotonic anchor and is reset on process restart. */
let observedCheckpointFloor: ObservedCheckpointFloor | null = null;

function checkpointMac(seq: number, hmac: string): string {
  return computeHmac(CHECKPOINT_DOMAIN, `${seq}:${hmac}`);
}

function observeCheckpointFloor(seq: number, hmac: string): void {
  if (!observedCheckpointFloor || seq > observedCheckpointFloor.seq) {
    observedCheckpointFloor = { seq, hmac };
  }
}

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
let bufferBytes = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let auditSpoolOverflowed = false;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  // 0o700: the audit dir holds audit.jsonl + audit.checkpoint. Files are already
  // 0600, but match the sibling app-runtime-token dir's owner-only mode so other
  // local users can't even enumerate audit filenames / rotation timestamps.
  // mkdir's mode is ignored when the directory already exists, so chmod is a
  // required second step rather than a cosmetic belt-and-suspenders check.
  await mkdir(PATHS.VECTOR_STORE, { recursive: true, mode: 0o700 });
  await chmod(PATHS.VECTOR_STORE, 0o700);
  initialized = true;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncAuditDirectory(): Promise<void> {
  await syncPath(AUDIT_DIR);
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
  if (auditSpoolOverflowed) return;
  const lineBytes = Buffer.byteLength(line, "utf8");
  const maxBufferBytes = Math.max(AUDIT.MAX_ENTRY_SIZE, AUDIT.MAX_BUFFER_SIZE);
  if (bufferBytes + lineBytes > maxBufferBytes) {
    // auditLog() is synchronous and is also called after some read-only
    // outcomes, so it cannot safely block on disk or throw after the fact.
    // Bound memory instead, and permanently revoke this process's audit
    // authority. Exact approved-event verification will now fail closed; a
    // restart after the storage fault is repaired is required to resume it.
    auditSpoolOverflowed = true;
    auditDisabled = true;
    auditDisabledSince = Date.now();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    log.error("audit: in-memory spool limit exceeded — audit authority revoked for this process", {
      maxBufferBytes,
      bufferedBytes: bufferBytes,
      note: "repair audit storage and restart AirMCP before governed writes can resume",
    });
    return;
  }
  buffer.push(line);
  bufferBytes += lineBytes;
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
  if (auditSpoolOverflowed) return;
  const now = Date.now();
  if (now - auditDisabledSince < AUDIT_RECOVERY_INTERVAL_MS) return;
  log.info("audit: recovery window elapsed — re-enabling and retrying flush");
  auditDisabled = false;
  auditDisabledSince = 0;
  consecutiveFlushFailures = 0;
  ensureFlushTimer();
}

function isFsError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (isFsError(err, "ENOENT")) return false;
    throw err;
  }
}

async function readLockOwner(path: string): Promise<AuditLockOwner | null> {
  try {
    const parsed = JSON.parse((await readFile(path, "utf-8")).trim()) as Partial<AuditLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return parsed as AuditLockOwner;
    }
  } catch {
    // The caller treats an owner it cannot identify as fail-closed corruption.
  }
  return null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM still proves that a process occupies the PID. Only ESRCH is dead.
    return !isFsError(err, "ESRCH");
  }
}

/** Reap one dead dot-lock owner. The fixed `.reap` hard-link is itself an
 * atomic mutex; contenders refuse ownership while it exists. That closes the
 * classic stale-unlink race where a reaper deletes a replacement lock. */
async function tryReapStaleAuditLock(): Promise<boolean> {
  const observed = await readLockOwner(AUDIT_LOCK_PATH);
  if (observed) {
    if (processIsAlive(observed.pid)) return false;
  } else {
    // A contender file is complete before link(2) publishes it. An unreadable
    // or malformed public lock therefore signals external damage, not a torn
    // acquisition; fail closed rather than deleting an owner we cannot name.
    return !(await pathExists(AUDIT_LOCK_PATH));
  }

  try {
    await link(AUDIT_LOCK_PATH, AUDIT_LOCK_REAP_PATH);
  } catch (err) {
    if (isFsError(err, "ENOENT") || isFsError(err, "EEXIST")) return false;
    throw err;
  }

  try {
    // The reaper link pins the exact inode. Validate that the public lock still
    // names that inode and that a shaped owner did not come back to life.
    const [lockInfo, reapInfo] = await Promise.all([lstat(AUDIT_LOCK_PATH), lstat(AUDIT_LOCK_REAP_PATH)]);
    if (lockInfo.dev !== reapInfo.dev || lockInfo.ino !== reapInfo.ino) return false;
    const current = await readLockOwner(AUDIT_LOCK_REAP_PATH);
    if (observed && current?.token !== observed.token) return false;
    if (current && processIsAlive(current.pid)) return false;
    await unlink(AUDIT_LOCK_PATH);
    return true;
  } catch (err) {
    if (isFsError(err, "ENOENT")) return false;
    throw err;
  } finally {
    await unlink(AUDIT_LOCK_REAP_PATH).catch(() => {});
  }
}

/** Complete the exact crash residue left when a reaper dies after publishing
 * `audit.lock.reap` but before removing both hard links. Helping is safe even
 * when the original reaper is merely delayed: both names must still identify
 * the same dead-owner inode, and unlinking either pathname is idempotent. */
async function tryCompleteOrphanedAuditReap(): Promise<boolean> {
  let lockInfo: Awaited<ReturnType<typeof lstat>>;
  let reapInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    [lockInfo, reapInfo] = await Promise.all([lstat(AUDIT_LOCK_PATH), lstat(AUDIT_LOCK_REAP_PATH)]);
  } catch (err) {
    if (!isFsError(err, "ENOENT")) throw err;
    // The destructive half already completed. The remaining reaper pin has no
    // public lock to protect and can be removed by any contender.
    if (!(await pathExists(AUDIT_LOCK_PATH))) {
      await unlink(AUDIT_LOCK_REAP_PATH).catch(() => {});
      return true;
    }
    return false;
  }

  if (lockInfo.dev !== reapInfo.dev || lockInfo.ino !== reapInfo.ino) return false;
  const owner = await readLockOwner(AUDIT_LOCK_REAP_PATH);
  if (!owner || processIsAlive(owner.pid)) return false;

  try {
    await unlink(AUDIT_LOCK_PATH);
  } catch (err) {
    if (!isFsError(err, "ENOENT")) throw err;
  }
  await unlink(AUDIT_LOCK_REAP_PATH).catch(() => {});
  return true;
}

async function acquireAuditWriteLock(): Promise<() => Promise<void>> {
  await ensureDir();
  const owner: AuditLockOwner = { pid: process.pid, token: randomUUID(), createdAt: Date.now() };
  const contenderPath = join(AUDIT_DIR, `audit.lock.${process.pid}.${owner.token}.tmp`);
  await writeFile(contenderPath, JSON.stringify(owner) + "\n", { encoding: "utf-8", mode: 0o600, flag: "wx" });
  const deadline = Date.now() + AUDIT_LOCK_WAIT_MS;

  try {
    while (Date.now() < deadline) {
      if (await pathExists(AUDIT_LOCK_REAP_PATH)) {
        if (await tryCompleteOrphanedAuditReap()) continue;
        await sleep(AUDIT_LOCK_RETRY_MS);
        continue;
      }
      let installedByThisAttempt = false;
      try {
        // link(2) either installs our complete owner record or changes nothing.
        await link(contenderPath, AUDIT_LOCK_PATH);
        installedByThisAttempt = true;
        // A reaper that started just before our link keeps the gate closed.
        if (await pathExists(AUDIT_LOCK_REAP_PATH)) {
          // The link above proved this pathname still names our inode. Remove
          // it before waiting; do not let an ambiguous half-acquisition strand
          // a live-PID lock that no caller can release.
          await unlink(AUDIT_LOCK_PATH);
          installedByThisAttempt = false;
          await sleep(AUDIT_LOCK_RETRY_MS);
          continue;
        }
        await unlink(contenderPath).catch(() => {});
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          const installed = await readLockOwner(AUDIT_LOCK_PATH);
          if (installed?.token === owner.token) {
            try {
              await unlink(AUDIT_LOCK_PATH);
            } catch (err) {
              if (!isFsError(err, "ENOENT")) log.error("audit: writer lock release failed", { err: errToCtx(err) });
            }
          } else if (await pathExists(AUDIT_LOCK_PATH).catch(() => true)) {
            log.error("audit: writer lock ownership changed before release — leaving replacement lock intact");
          }
        };
      } catch (err) {
        if (installedByThisAttempt) await unlink(AUDIT_LOCK_PATH).catch(() => {});
        if (!isFsError(err, "EEXIST")) throw err;
        await tryReapStaleAuditLock();
        await sleep(AUDIT_LOCK_RETRY_MS);
      }
    }
    throw new Error(`Timed out after ${AUDIT_LOCK_WAIT_MS}ms waiting for the audit writer lock`);
  } catch (err) {
    await unlink(contenderPath).catch(() => {});
    throw err;
  }
}

/** Deterministic inter-process race hook used only by the regression test. */
async function holdAuditLockForTest(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const ms = Number(process.env.AIRMCP_TEST_AUDIT_HOLD_LOCK_MS ?? "0");
  if (Number.isFinite(ms) && ms > 0 && ms <= 5_000) await sleep(ms);
}

let activeFlush: Promise<boolean> | null = null;

type FailedAppendInspection = { kind: "zero" } | { kind: "full" } | { kind: "unsafe"; detail: string };

async function auditPrimarySize(): Promise<number> {
  try {
    return (await stat(AUDIT_PATH)).size;
  } catch (err) {
    if (isFsError(err, "ENOENT")) return 0;
    throw err;
  }
}

/** `appendFile()` rejection is not proof that zero bytes reached disk. Inspect
 * the size delta and exact byte suffix while the writer lock is still held so
 * a fully committed append is never duplicated. Anything other than zero or
 * the exact full payload is an unsafe partial/ambiguous commit. */
async function inspectFailedAppend(beforeSize: number, payload: Buffer): Promise<FailedAppendInspection> {
  let afterSize: number;
  try {
    afterSize = await auditPrimarySize();
  } catch (err) {
    return { kind: "unsafe", detail: `post-error stat failed: ${formatError(err)}` };
  }
  if (afterSize === beforeSize) return { kind: "zero" };
  if (afterSize !== beforeSize + payload.byteLength) {
    return { kind: "unsafe", detail: `unexpected size delta ${afterSize - beforeSize}/${payload.byteLength}` };
  }
  try {
    const onDisk = await readFile(AUDIT_PATH);
    if (onDisk.byteLength < payload.byteLength) {
      return { kind: "unsafe", detail: "file shorter than committed payload" };
    }
    const suffix = onDisk.subarray(onDisk.byteLength - payload.byteLength);
    return suffix.equals(payload)
      ? { kind: "full" }
      : { kind: "unsafe", detail: "size matched but exact payload suffix did not" };
  } catch (err) {
    return { kind: "unsafe", detail: `post-error suffix read failed: ${formatError(err)}` };
  }
}

function disableAuditAfterUnsafeAppend(err: unknown, detail: string): void {
  consecutiveFlushFailures = AUDIT.MAX_FLUSH_FAILURES;
  auditDisabled = true;
  auditDisabledSince = Date.now();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  log.error("audit: append outcome was partial or ambiguous — dropping the in-flight batch and failing closed", {
    detail,
    err: errToCtx(err),
    note: "inspect/repair the audit chain before governed writes can resume",
  });
}

function disableAuditAfterDurabilityFailure(err: unknown, detail: string): void {
  consecutiveFlushFailures = AUDIT.MAX_FLUSH_FAILURES;
  auditDisabled = true;
  auditDisabledSince = Date.now();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  log.error("audit: durability barrier failed after append — failing closed", {
    detail,
    err: errToCtx(err),
    note: "the appended bytes are not trusted until the audit chain is inspected and repaired",
  });
}

/**
 * A real single-flight queue. Every caller awaits the active flush and then
 * loops until rows that arrived during it are sealed as well. This matters to
 * governed writes: the approval audit snapshot must include that caller's own
 * decision before the mutation is allowed to run.
 */
async function flushBuffer(): Promise<void> {
  while (true) {
    if (auditDisabled) maybeAttemptRecovery();
    // A capped spool may still be drained during shutdown, but its process
    // remains untrusted because at least one event was refused at the bound.
    if (auditDisabled && !auditSpoolOverflowed) return;
    if (activeFlush) {
      if (!(await activeFlush)) return;
      continue;
    }
    if (buffer.length === 0) return;

    flushing = true;
    const operation = flushOneBatch();
    const tracked = operation.finally(() => {
      if (activeFlush === tracked) activeFlush = null;
      flushing = false;
    });
    activeFlush = tracked;
    if (!(await tracked)) return;
  }
}

/** Flush every audit row currently accepted by this process. Unlike the
 * test-only helper, this is the production shutdown barrier: it cancels the
 * long-lived timer, waits through any active single-flight append, drains rows
 * that arrived during that append, and reports a fail-closed spool instead of
 * pretending shutdown persistence succeeded. */
export async function flushAuditLog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (auditDisabled || buffer.length > 0 || activeFlush !== null) {
    throw new Error(
      `Audit shutdown flush incomplete (disabled=${auditDisabled}, buffered=${buffer.length}, active=${activeFlush !== null})`,
    );
  }
}

async function flushOneBatch(): Promise<boolean> {
  // Swap before waiting for the OS lock. New events remain ordered in the
  // fresh buffer and the outer queue seals them before its callers return.
  const toFlush = buffer;
  const toFlushBytes = bufferBytes;
  buffer = [];
  bufferBytes = 0;
  let appended = false;
  let unsafeAppend = false;
  let releaseLock: (() => Promise<void>) | null = null;

  try {
    releaseLock = await acquireAuditWriteLock();

    // Never trust an in-memory tail in a multi-process runtime. Replay the
    // complete signed chain and checkpoint while holding the writer lock. A
    // truncation, forged/missing checkpoint, malformed row, or fork makes the
    // batch fail closed and leaves the older checkpoint untouched.
    let disk = await scanAuditChain();
    if (!disk.appendable) {
      const detail = disk.firstBreak
        ? `${disk.firstBreak.file}:${disk.firstBreak.lineIndex} ${disk.firstBreak.reason}`
        : "unknown integrity failure";
      throw new Error(`Audit chain integrity check failed before append (${detail})`);
    }
    if (disk.legacyEntries.length > 0) {
      // Unsigned history can be inspected, but it can never become part of a
      // trusted governed-write barrier. Move that prefix behind an explicit
      // untrusted quarantine boundary before sealing the first/new approval.
      // This also handles older mixed files where a genesis-rooted signed
      // chain was appended after legacy rows: signed bytes stay unchanged.
      await quarantineUnsignedLegacyPrefix();
      disk = await scanAuditChain();
      if (!disk.appendable || !disk.verified || disk.legacyEntries.length > 0) {
        const detail = disk.firstBreak
          ? `${disk.firstBreak.file}:${disk.firstBreak.lineIndex} ${disk.firstBreak.reason}`
          : "legacy quarantine did not produce a clean signed boundary";
        throw new Error(`Audit legacy quarantine verification failed (${detail})`);
      }
    }
    let candidateHmac = disk.chainHeadHmac;
    let candidateSeq = disk.chainLastSeq;
    await holdAuditLockForTest();

    const sealedLines: string[] = [];
    for (const raw of toFlush) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const prev = candidateHmac;
      obj.seq = ++candidateSeq;
      const body = JSON.stringify(obj);
      const hmac = computeHmac(prev, body);
      const sealed = body.slice(0, -1) + `,"_prev":"${prev}","_hmac":"${hmac}"}`;
      sealedLines.push(sealed);
      candidateHmac = hmac;
    }
    const lines = sealedLines.join("\n") + "\n";
    const payload = Buffer.from(lines, "utf-8");
    const beforeSize = await auditPrimarySize();

    try {
      await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
      appended = true;
    } catch (firstError) {
      const firstOutcome = await inspectFailedAppend(beforeSize, payload);
      if (firstOutcome.kind === "full") {
        appended = true;
        log.warn("audit: append reported an error but the exact batch was already committed; retry suppressed", {
          err: errToCtx(firstError),
        });
      } else if (firstOutcome.kind === "unsafe") {
        unsafeAppend = true;
        disableAuditAfterUnsafeAppend(firstError, firstOutcome.detail);
      } else {
        try {
          await appendFile(AUDIT_PATH, lines, { encoding: "utf-8", mode: 0o600 });
          appended = true;
        } catch (retryError) {
          const retryOutcome = await inspectFailedAppend(beforeSize, payload);
          if (retryOutcome.kind === "full") {
            appended = true;
            log.warn("audit: append retry reported an error but the exact batch was committed", {
              err: errToCtx(retryError),
            });
          } else if (retryOutcome.kind === "unsafe") {
            unsafeAppend = true;
            disableAuditAfterUnsafeAppend(retryError, retryOutcome.detail);
          } else {
            throw retryError;
          }
        }
      }
    }
    if (unsafeAppend) return false;
    try {
      // appendFile completion only reaches the kernel page cache. Seal the
      // payload itself and its directory entry before publishing a checkpoint
      // that governed reads may rely on after a power loss or kernel crash.
      await syncPath(AUDIT_PATH);
      await syncAuditDirectory();
    } catch (syncError) {
      disableAuditAfterDurabilityFailure(syncError, "audit file or directory fsync failed");
      return false;
    }
    consecutiveFlushFailures = 0;
    await rotateIfNeeded(candidateSeq);
    // Checkpoint replacement is atomic and occurs before releasing the writer
    // lock. A failure is logged, but the next verification sees the missing or
    // older anchor and prevents any mutation from trusting the gap.
    if (!(await writeCheckpoint(candidateSeq, candidateHmac))) {
      disableAuditAfterDurabilityFailure(
        new Error("checkpoint durability barrier failed"),
        "checkpoint fsync/rename failed",
      );
      return false;
    }
    warnHostKeyOnce();
  } catch (err) {
    if (!appended) {
      buffer = [...toFlush, ...buffer];
      bufferBytes += toFlushBytes;
      recordFlushFailure(err);
    }
  } finally {
    if (releaseLock) await releaseLock();
  }

  if (!appended && !auditDisabled) ensureFlushTimer();
  return appended;
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

/** Persist the signed tail-truncation checkpoint via same-directory atomic
 * replacement. Readers therefore see either the complete old checkpoint or
 * the complete new one; malformed content is evidence of external damage,
 * not a normal torn-write state. */
async function writeCheckpoint(seq: number, hmac: string): Promise<boolean> {
  if (seq < 0) return true; // nothing chained yet
  const tempPath = join(AUDIT_DIR, `audit.checkpoint.${process.pid}.${randomUUID()}.tmp`);
  try {
    const mac = checkpointMac(seq, hmac);
    const payload = JSON.stringify({ seq, hmac, mac }) + "\n";
    await writeFile(tempPath, payload, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    await syncPath(tempPath);
    if (process.env.NODE_ENV === "test" && process.env.AIRMCP_TEST_AUDIT_FAIL_CHECKPOINT === "1") {
      throw new Error("injected atomic checkpoint replacement failure");
    }
    await rename(tempPath, CHECKPOINT_PATH);
    await syncAuditDirectory();
    observeCheckpointFloor(seq, hmac);
    return true;
  } catch (err) {
    log.warn("audit: atomic checkpoint write failed — subsequent governed writes will fail closed", {
      err: errToCtx(err),
    });
    return false;
  } finally {
    await unlink(tempPath).catch(() => {});
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

interface RotatedAuditName {
  timestamp: number;
  seq: number | null;
}

/** Accept both the historical `audit.<ms>.jsonl` name and the collision-safe
 * `audit.<ms>.<tail-seq>.<uuid>.jsonl` form. */
function parseRotatedAuditName(file: string): RotatedAuditName | null {
  const legacy = /^audit\.(\d+)\.jsonl$/.exec(file);
  const current = /^audit\.(\d+)\.(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(
    file,
  );
  const match = current ?? legacy;
  if (!match) return null;
  const timestamp = Number(match[1]);
  const seq = current ? Number(current[2]) : null;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;
  if (seq !== null && (!Number.isSafeInteger(seq) || seq < 0)) return null;
  return { timestamp, seq };
}

function sortActiveAuditFiles(files: string[]): string[] {
  return files
    .filter((file) => file === "audit.jsonl" || parseRotatedAuditName(file) !== null)
    .sort((a, b) => {
      if (a === "audit.jsonl") return 1;
      if (b === "audit.jsonl") return -1;
      const parsedA = parseRotatedAuditName(a);
      const parsedB = parseRotatedAuditName(b);
      if (!parsedA || !parsedB) return a.localeCompare(b);
      if (parsedA.timestamp !== parsedB.timestamp) return parsedA.timestamp < parsedB.timestamp ? -1 : 1;
      const seqA = parsedA.seq ?? -1;
      const seqB = parsedB.seq ?? -1;
      if (seqA !== seqB) return seqA < seqB ? -1 : 1;
      return a.localeCompare(b);
    });
}

async function createLegacyQuarantineLink(sourcePath: string, sourceName: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    // This prefix deliberately does not match either active rotation pattern.
    // A hard link preserves the exact original bytes before any active file is
    // unlinked or rewritten, and fails instead of overwriting a collision.
    const targetPath = join(AUDIT_DIR, `audit.legacy-untrusted.${Date.now()}.${randomUUID()}.${sourceName}`);
    try {
      await link(sourcePath, targetPath);
      // Hard links share an inode, so this simultaneously repairs a
      // permissive legacy source before it is removed or rewritten.
      try {
        await chmod(targetPath, 0o600);
      } catch (err) {
        await unlink(targetPath).catch(() => {});
        throw err;
      }
      return targetPath;
    } catch (err) {
      if (isFsError(err, "EEXIST")) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a non-overwriting legacy audit quarantine path");
}

function assertUnsignedLegacyLines(lines: string[], file: string): void {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[lineIndex]!) as Record<string, unknown>;
    } catch {
      throw new Error(`Legacy audit quarantine encountered malformed JSON (${file}:${lineIndex})`);
    }
    if (
      Object.prototype.hasOwnProperty.call(parsed, "_hmac") ||
      Object.prototype.hasOwnProperty.call(parsed, "_prev") ||
      !asAuditEntry(parsed)
    ) {
      throw new Error(`Legacy audit quarantine encountered a signed or malformed row (${file}:${lineIndex})`);
    }
  }
}

/**
 * Establish an explicit trust boundary for upgrades from unsigned history.
 *
 * The scanner has already proved that every unsigned row is a prefix and that
 * any signed suffix/checkpoint is internally intact. Whole legacy-only files
 * are hard-linked into an excluded quarantine name and removed from the active
 * set. If the first signed row shares a file with the prefix, the exact original
 * file is quarantined before an atomic rewrite keeps only the unchanged signed
 * lines. A crash at any point therefore leaves either the original active file
 * or an exact quarantine copy; unsigned bytes are never promoted into the HMAC
 * verdict or trusted summaries.
 */
async function quarantineUnsignedLegacyPrefix(): Promise<void> {
  const files = sortActiveAuditFiles(await readdir(AUDIT_DIR));
  let signedHistoryStarted = false;
  let quarantinedFiles = 0;
  let quarantinedRows = 0;

  for (const file of files) {
    const sourcePath = join(AUDIT_DIR, file);
    const raw = await readFile(sourcePath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) continue;

    const firstSignedIndex = lines.findIndex((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return (
          Object.prototype.hasOwnProperty.call(parsed, "_hmac") || Object.prototype.hasOwnProperty.call(parsed, "_prev")
        );
      } catch {
        return false;
      }
    });

    if (firstSignedIndex < 0) {
      if (signedHistoryStarted) {
        throw new Error(`Unsigned audit rows appeared after the signed chain (${file})`);
      }
      assertUnsignedLegacyLines(lines, file);
      await createLegacyQuarantineLink(sourcePath, file);
      await unlink(sourcePath);
      quarantinedFiles++;
      quarantinedRows += lines.length;
      continue;
    }

    const unsignedPrefix = lines.slice(0, firstSignedIndex);
    if (unsignedPrefix.length > 0) {
      if (signedHistoryStarted) {
        throw new Error(`Unsigned audit rows appeared after the signed chain (${file})`);
      }
      assertUnsignedLegacyLines(unsignedPrefix, file);
      await createLegacyQuarantineLink(sourcePath, file);
      const tempPath = join(AUDIT_DIR, `audit.legacy-rewrite.${process.pid}.${randomUUID()}.tmp`);
      try {
        await writeFile(tempPath, lines.slice(firstSignedIndex).join("\n") + "\n", {
          encoding: "utf-8",
          mode: 0o600,
          flag: "wx",
        });
        await rename(tempPath, sourcePath);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
      quarantinedFiles++;
      quarantinedRows += unsignedPrefix.length;
    }
    signedHistoryStarted = true;
  }

  if (quarantinedRows > 0) {
    log.warn("audit: unsigned legacy history moved behind an untrusted quarantine boundary", {
      files: quarantinedFiles,
      rows: quarantinedRows,
      note: "quarantine files are owner-only and excluded from HMAC verification and summaries",
    });
  }
}

async function nextRotatedAuditPath(tailSeq: number): Promise<string> {
  const files = await readdir(AUDIT_DIR);
  let maxTimestamp = -1;
  for (const file of files) {
    const parsed = parseRotatedAuditName(file);
    if (parsed && parsed.timestamp > maxTimestamp) maxTimestamp = parsed.timestamp;
  }
  if (maxTimestamp >= Number.MAX_SAFE_INTEGER) throw new Error("Audit rotation timestamp space exhausted");
  const timestamp = Math.max(0, Math.trunc(Date.now()), maxTimestamp + 1);
  if (!Number.isSafeInteger(timestamp)) throw new Error("Audit rotation timestamp is not a safe integer");

  // The writer lock excludes AirMCP contenders; the existence check makes an
  // externally pre-created collision non-overwriting as well. UUID retries are
  // bounded so filesystem damage fails closed instead of replacing history.
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = join(AUDIT_DIR, `audit.${timestamp}.${tailSeq}.${randomUUID()}.jsonl`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error("Could not allocate a non-overwriting audit rotation path");
}

async function rotateIfNeeded(tailSeq: number): Promise<void> {
  try {
    const s = await stat(AUDIT_PATH);
    // Ensure owner-only permissions on existing file
    if ((s.mode & 0o777) !== 0o600) await chmod(AUDIT_PATH, 0o600);
    if (s.size > AUDIT.MAX_FILE_SIZE) {
      const rotated = await nextRotatedAuditPath(tailSeq);
      await rename(AUDIT_PATH, rotated);
      await syncAuditDirectory();
    }
  } catch (err) {
    // ENOENT can occur when rotation already moved the file. Other failures
    // happen after the append committed, so record them without requeueing the
    // already-durable batch.
    if (!isFsError(err, "ENOENT")) {
      log.warn("audit: post-append rotation check failed", { err: errToCtx(err) });
    }
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
  bufferBytes = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  initialized = false;
  flushing = false;
  activeFlush = null;
  consecutiveFlushFailures = 0;
  auditDisabled = false;
  auditDisabledSince = 0;
  auditSpoolOverflowed = false;
  warnedHostKey = false;
  observedCheckpointFloor = null;
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
  auditSpoolOverflowed: boolean;
  consecutiveFlushFailures: number;
  bufferLength: number;
  bufferBytes: number;
  flushing: boolean;
} {
  assertTestMode("_testGetState()");
  return {
    auditDisabled,
    auditSpoolOverflowed,
    consecutiveFlushFailures,
    bufferLength: buffer.length,
    bufferBytes,
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
  /** Only rows whose HMAC was replayed successfully. Unsigned legacy rows are
   * never included in a trusted aggregate. */
  entries: AuditEntry[];
  /** Kept solely so a genuinely legacy-only file stays inspectable through
   * audit_log while the overall verdict remains unverified. Once any signed
   * row exists, a prepended unsigned prefix is indistinguishable from forgery
   * and is not returned. */
  legacyEntries: AuditEntry[];
  scannedFiles: number;
  verified: boolean;
  firstBreak?: { file: string; lineIndex: number; reason: AuditChainBreakReason };
  /** Structural integrity is sufficient to append. A valid unsigned prefix is
   * untrusted but appendable; a chain/checkpoint break is not. */
  appendable: boolean;
  chainStarted: boolean;
  /** A row declared `_hmac` or `_prev`, even if its envelope was malformed.
   * This distinguishes inspectable legacy corruption from a forged unsigned
   * prefix placed in front of a broken signed-looking chain. */
  signedShapeEncountered: boolean;
  chainHeadHmac: string;
  chainLastSeq: number;
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
  const approvalId =
    typeof raw.approvalId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.approvalId)
      ? raw.approvalId.toLowerCase()
      : undefined;
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
    ...(approvalId ? { approvalId } : {}),
    ...(approvalDecision ? { approvalDecision } : {}),
    ...(approvalChannel ? { approvalChannel } : {}),
    ...(gate ? { gate } : {}),
  };
}

/** Replay and decode the log in a single oldest→newest pass. */
async function scanAuditChain(): Promise<AuditChainScanResult> {
  const entries: AuditEntry[] = [];
  const legacyEntries: AuditEntry[] = [];
  const seenFiles = new Set<string>();
  let prev: string = HMAC_GENESIS;
  let chainStarted = false;
  let signedShapeEncountered = false;
  let seqStarted = false;
  let chainLastSeq = -1;
  let chainHeadHmac: string = HMAC_GENESIS;
  let legacyFirst: { file: string; lineIndex: number } | undefined;
  const checkpoint = await readCheckpoint();
  let checkpointHmacAtSeq: string | undefined;

  const broken = (file: string, lineIndex: number, reason: AuditChainBreakReason): AuditChainScanResult => ({
    entries,
    legacyEntries,
    scannedFiles: seenFiles.size,
    verified: false,
    firstBreak: { file, lineIndex, reason },
    appendable: false,
    chainStarted,
    signedShapeEncountered,
    chainHeadHmac,
    chainLastSeq,
  });

  for await (const item of readAllAuditLinesIndexed()) {
    if ("readFailure" in item) return broken(item.readFailure, -1, "malformed");
    const { line, file, lineIndex } = item;
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
      legacyFirst ??= { file, lineIndex };
      legacyEntries.push(legacyEntry);
      continue;
    }
    signedShapeEncountered = true;

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

    // Verify the literal bytes sealed by the writer. Reconstructing from the
    // parsed object would normalize duplicate keys, escape spellings, and
    // whitespace, allowing a raw JSONL edit to keep `verified: true`.
    const signedBody = exactSignedBody(line, prevField, hmacField);
    if (!signedBody) return broken(file, lineIndex, "malformed");
    const expected = computeHmac(prevField, signedBody);
    if (expected !== hmacField) return broken(file, lineIndex, "hmac_mismatch");

    const decoded = asAuditEntry(entry);
    if (!decoded) return broken(file, lineIndex, "malformed");

    const seqField = entry.seq;
    if (seqField === undefined) {
      // Once the signed sequence starts it is part of every subsequent signed
      // body. Omitting it would evade the truncation checkpoint's ordering.
      if (seqStarted) return broken(file, lineIndex, "malformed");
    } else {
      if (!Number.isInteger(seqField) || (seqField as number) < 0) return broken(file, lineIndex, "malformed");
      const seq = seqField as number;
      const expectedSeq = seqStarted ? chainLastSeq + 1 : 0;
      if (seq !== expectedSeq) return broken(file, lineIndex, "malformed");
      seqStarted = true;
      chainLastSeq = seq;
      if (checkpoint.kind === "valid" && checkpoint.seq === seq) checkpointHmacAtSeq = hmacField;
    }

    entries.push(decoded);
    prev = hmacField;
    chainStarted = true;
    chainHeadHmac = hmacField;
  }

  // The checkpoint is atomically replaced. Missing/malformed state after a
  // sequenced chain exists is therefore a fail-closed integrity gap rather
  // than an excuse to mint a lower replacement anchor on the next append.
  if (checkpoint.kind === "malformed") {
    return broken("audit.checkpoint", -1, "checkpoint_forged");
  }
  if (checkpoint.kind === "valid") {
    if (checkpoint.mac !== checkpointMac(checkpoint.seq, checkpoint.hmac)) {
      return broken("audit.checkpoint", -1, "checkpoint_forged");
    }
    // The checkpoint and tail form one committed snapshot. A lagging anchor
    // (append landed but checkpoint replacement failed/crashed) is deliberately
    // unverified until an operator repairs it; a later append must not heal it.
    if (
      checkpoint.seq !== chainLastSeq ||
      checkpointHmacAtSeq !== checkpoint.hmac ||
      checkpoint.hmac !== chainHeadHmac
    ) {
      return broken("audit.checkpoint", -1, "truncated");
    }
    if (
      observedCheckpointFloor &&
      (checkpoint.seq < observedCheckpointFloor.seq ||
        (checkpoint.seq === observedCheckpointFloor.seq && checkpoint.hmac !== observedCheckpointFloor.hmac))
    ) {
      return broken("audit.checkpoint", -1, "truncated");
    }
    observeCheckpointFloor(checkpoint.seq, checkpoint.hmac);
  } else if (chainLastSeq >= 0 || observedCheckpointFloor) {
    return broken("audit.checkpoint", -1, "truncated");
  }

  if (legacyFirst) {
    return {
      entries,
      legacyEntries,
      scannedFiles: seenFiles.size,
      verified: false,
      firstBreak: { ...legacyFirst, reason: "malformed" },
      appendable: true,
      chainStarted,
      signedShapeEncountered,
      chainHeadHmac,
      chainLastSeq,
    };
  }

  return {
    entries,
    legacyEntries,
    scannedFiles: seenFiles.size,
    verified: true,
    appendable: true,
    chainStarted,
    signedShapeEncountered,
    chainHeadHmac,
    chainLastSeq,
  };
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

async function scanAuditChainLocked(): Promise<AuditChainScanResult> {
  const release = await acquireAuditWriteLock();
  try {
    return await scanAuditChain();
  } finally {
    await release();
  }
}

/** Read audit entries with optional filters. Walks every log file so
 * rotated history stays queryable. A clean legacy-only file remains visible
 * for migration/inspection, but it is explicitly unverified; unsigned rows
 * are never mixed into a signed-era result. */
export async function readAuditEntries(opts: ReadAuditOptions = {}): Promise<ReadAuditResult> {
  await flushBuffer();
  const scan = await scanAuditChainLocked();
  // A successfully parsed unsigned prefix remains inspectable for legacy
  // diagnostics, including the prefix before plain malformed JSON. Once any
  // row claims to be signed, however, a failure before chain start must hide
  // the unsigned prefix or an attacker could smuggle forged rows into Trust
  // Center by following them with a malformed signed-looking envelope.
  const visibleEntries = !scan.chainStarted && !scan.signedShapeEncountered ? scan.legacyEntries : scan.entries;
  const page = filterAuditEntries(visibleEntries, opts);
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
  /** True only for an intact HMAC chain. Unsigned legacy rows remain
   * unverified and never contribute to this trusted aggregate. */
  verified: boolean;
  verifiedFirstBreak?: { file: string; lineIndex: number; reason: AuditChainBreakReason };
  /** Audit logging is currently disabled (disk full / permission error /
   *  too many failures). Auto-recovery kicks in after the backoff window;
   *  the field surfaces the state so a doctor / health check can flag it. */
  auditDisabled: boolean;
}

/** Aggregate statistics over the HMAC-verified prefix only. */
export async function summarizeAuditEntries(opts: { since?: string; topN?: number } = {}): Promise<AuditSummary> {
  const sinceIso = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const topN = Math.max(1, Math.min(50, opts.topN ?? 10));
  await flushBuffer();
  const chainResult = await scanAuditChainLocked();
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

type CheckpointReadResult =
  { kind: "absent" } | { kind: "malformed" } | { kind: "valid"; seq: number; hmac: string; mac: string };

/** Atomic writes make malformed checkpoint bytes a real integrity failure.
 * Only ENOENT is absence; permission/read errors fail closed as malformed. */
async function readCheckpoint(): Promise<CheckpointReadResult> {
  let raw: string;
  try {
    raw = await readFile(CHECKPOINT_PATH, "utf-8");
  } catch (err) {
    return isFsError(err, "ENOENT") ? { kind: "absent" } : { kind: "malformed" };
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
      return { kind: "valid", seq: obj.seq, hmac: obj.hmac, mac: obj.mac };
    }
  } catch {
    // fall through to fail-closed malformed state
  }
  return { kind: "malformed" };
}

type AuditLineReadResult = { line: string; file: string; lineIndex: number } | { readFailure: string };

async function* readAllAuditLinesIndexed(): AsyncGenerator<AuditLineReadResult> {
  let files: string[];
  try {
    files = await readdir(AUDIT_DIR);
  } catch {
    yield { readFailure: "audit directory" };
    return;
  }
  const logFiles = sortActiveAuditFiles(files);
  for (const f of logFiles) {
    let raw: string;
    try {
      raw = await readFile(join(AUDIT_DIR, f), "utf-8");
    } catch {
      yield { readFailure: f };
      return;
    }
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      yield { line, file: f, lineIndex: i };
    }
  }
}
