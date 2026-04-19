import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Agent-safety rate limit + emergency kill switch.
 *
 * Motivation: v2.8's `ai_agent` can autonomously call tools in a loop,
 * and a buggy plan or model regression can chain hundreds of destructive
 * operations (create 100 notes, delete a mailbox, etc.) before the user
 * notices. HITL approval catches each one interactively, but:
 *   (a) users routinely approve in bulk during demos, and
 *   (b) non-destructive chaining (reads) can still exhaust OS quotas.
 *
 * This module caps the rate at two tiers:
 *   - global  (default 60 calls / minute) — caps the raw tool-call rate
 *   - destructive (default 10 / hour) — caps mutations specifically
 *
 * Both are token-bucket, so short bursts are fine as long as the average
 * stays within budget. Emergency stop is a file probe: if the file
 * `~/.config/airmcp/emergency-stop` exists, every destructive call is
 * denied immediately with a rate_limited error — a one-command panic
 * button (`touch ~/.config/airmcp/emergency-stop`) that doesn't need a
 * restart.
 *
 * Env overrides:
 *   AIRMCP_RATE_LIMIT=false                — disable entirely
 *   AIRMCP_MAX_TOOL_CALLS_PER_MINUTE=<n>   — global bucket (default 60)
 *   AIRMCP_MAX_DESTRUCTIVE_PER_HOUR=<n>    — destructive bucket (default 10)
 *   AIRMCP_EMERGENCY_STOP_PATH=<path>      — override kill switch file
 */

const DEFAULT_GLOBAL_PER_MINUTE = 60;
const DEFAULT_DESTRUCTIVE_PER_HOUR = 10;

function parseIntEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export const RATE_LIMIT_ENABLED = process.env.AIRMCP_RATE_LIMIT !== "false";
export const MAX_GLOBAL_PER_MINUTE = parseIntEnv("AIRMCP_MAX_TOOL_CALLS_PER_MINUTE", DEFAULT_GLOBAL_PER_MINUTE);
export const MAX_DESTRUCTIVE_PER_HOUR = parseIntEnv("AIRMCP_MAX_DESTRUCTIVE_PER_HOUR", DEFAULT_DESTRUCTIVE_PER_HOUR);

const EMERGENCY_STOP_PATH =
  process.env.AIRMCP_EMERGENCY_STOP_PATH ?? join(homedir(), ".config", "airmcp", "emergency-stop");

/** Token-bucket state. `tokens` is the current bucket level (float),
 *  `lastRefill` is the wall-clock at which we last accrued tokens. */
interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRatePerMs: number;
}

function makeBucket(capacity: number, windowMs: number): Bucket {
  return {
    tokens: capacity,
    lastRefill: Date.now(),
    capacity,
    refillRatePerMs: capacity / windowMs,
  };
}

const globalBucket = makeBucket(MAX_GLOBAL_PER_MINUTE, 60_000);
const destructiveBucket = makeBucket(MAX_DESTRUCTIVE_PER_HOUR, 60 * 60_000);

function refillAndTake(bucket: Bucket): boolean {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRatePerMs);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Returns the ms until the next token is available in this bucket.
 *  Used to build actionable error messages so agents know when to retry. */
function msUntilNextToken(bucket: Bucket): number {
  const needed = 1 - bucket.tokens;
  if (needed <= 0) return 0;
  return Math.ceil(needed / bucket.refillRatePerMs);
}

export interface RateLimitCheckResult {
  allowed: boolean;
  /** Populated only when allowed=false. Human-readable reason. */
  reason?: string;
  /** Populated only when allowed=false. Suggested retry-after in ms. */
  retryAfterMs?: number;
}

/** Check whether a tool call may proceed right now. Decrements a token
 *  when allowed; on denial no state changes, so callers can safely retry
 *  after the suggested delay. `destructive` triggers both bucket checks
 *  AND the kill-switch probe; non-destructive calls only consume the
 *  global bucket. */
export function checkRateLimit(destructive: boolean): RateLimitCheckResult {
  if (!RATE_LIMIT_ENABLED) return { allowed: true };

  if (destructive && isEmergencyStopActive()) {
    return {
      allowed: false,
      reason: `Emergency stop engaged (${EMERGENCY_STOP_PATH} exists). All destructive tools are blocked until the file is removed.`,
      retryAfterMs: 60_000,
    };
  }

  // Pre-check both buckets so we don't take a token from one and then
  // reject at the other. Deny side-effects must be atomic.
  if (!canTake(globalBucket)) {
    return {
      allowed: false,
      reason: `Global tool-call budget exhausted (max ${MAX_GLOBAL_PER_MINUTE} / minute).`,
      retryAfterMs: msUntilNextToken(globalBucket),
    };
  }
  if (destructive && !canTake(destructiveBucket)) {
    return {
      allowed: false,
      reason: `Destructive-call budget exhausted (max ${MAX_DESTRUCTIVE_PER_HOUR} / hour). Review AirMCP audit log to confirm no runaway agent.`,
      retryAfterMs: msUntilNextToken(destructiveBucket),
    };
  }

  // Commit side-effects atomically after all pre-checks pass.
  refillAndTake(globalBucket);
  if (destructive) refillAndTake(destructiveBucket);
  return { allowed: true };
}

/** Peek without consuming. Lets us pre-check both buckets and only
 *  commit once we know the call is cleared on every gate. */
function canTake(bucket: Bucket): boolean {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  const projectedTokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRatePerMs);
  return projectedTokens >= 1;
}

let emergencyProbeCache: { checkedAt: number; active: boolean } | null = null;
const EMERGENCY_PROBE_TTL_MS = 1000;

/** Is the emergency stop file present? Cached for 1s so we don't hit
 *  the fs on every single tool call during an agent burst. */
export function isEmergencyStopActive(): boolean {
  const now = Date.now();
  if (emergencyProbeCache && now - emergencyProbeCache.checkedAt < EMERGENCY_PROBE_TTL_MS) {
    return emergencyProbeCache.active;
  }
  const active = existsSync(EMERGENCY_STOP_PATH);
  emergencyProbeCache = { checkedAt: now, active };
  return active;
}

/** Test-only: wipe bucket state and the emergency probe cache so each
 *  case starts fresh. Guarded via NODE_ENV to prevent production misuse. */
export function _resetRateLimitForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error("_resetRateLimitForTests is only callable in test mode");
  }
  globalBucket.tokens = globalBucket.capacity;
  globalBucket.lastRefill = Date.now();
  destructiveBucket.tokens = destructiveBucket.capacity;
  destructiveBucket.lastRefill = Date.now();
  emergencyProbeCache = null;
}

/** Diagnostics for doctor / audit_summary. Read-only snapshot. */
export function getRateLimitStatus(): {
  enabled: boolean;
  globalRemaining: number;
  destructiveRemaining: number;
  emergencyStop: boolean;
  emergencyStopPath: string;
} {
  return {
    enabled: RATE_LIMIT_ENABLED,
    globalRemaining: Math.floor(globalBucket.tokens),
    destructiveRemaining: Math.floor(destructiveBucket.tokens),
    emergencyStop: isEmergencyStopActive(),
    emergencyStopPath: EMERGENCY_STOP_PATH,
  };
}
