/**
 * RFC 0012 Phase 1 prep — environment opt-ins for daemon mode.
 *
 * All four flags are off by default. The Phase 1 implementation PR
 * will read these to decide whether the SkillScheduler ticks at all,
 * how to gate destructive autonomous calls, and what TTL to assign to
 * queued HITL entries.
 *
 * Reading them via accessor functions (rather than module-level
 * constants) keeps tests cheap — tests can mutate `process.env` and
 * the next call observes the change without a require-cache dance.
 */

/** Master switch. Required to be `"true"` for the daemon to tick. */
export function isDaemonMode(): boolean {
  return process.env.AIRMCP_DAEMON_MODE === "true";
}

/**
 * Required `"true"` for `hitl_policy.destructive_on_absence: "proceed"`
 * to actually fire instead of falling back to `"queue"`. Two-flag opt-in
 * (skill YAML + env) makes the bypass impossible to enable accidentally
 * via either side alone.
 */
export function isAutonomousDestructiveAllowed(): boolean {
  return process.env.AIRMCP_AUTONOMOUS_DESTRUCTIVE === "true";
}

/**
 * Idle-time threshold (seconds) above which the user is considered
 * "absent" for HITL queueing. Phase 1 implementation reads
 * `IOKit.IOHIDIdleTime` and compares to this. Default 60s matches the
 * RFC 0012 design note.
 */
export function getAbsentThresholdSec(): number {
  const raw = process.env.AIRMCP_HITL_ABSENT_THRESHOLD_SEC;
  if (!raw) return 60;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 60;
  return n;
}

/**
 * Default TTL for queued HITL entries when the skill omits
 * `hitl_policy.queue_ttl`. Format mirrors the per-skill field:
 * `"4h"` / `"30m"` / `"2d"`. Default `"4h"` keeps the queue fresh
 * without expiring in-flight workflows.
 */
export function getDefaultQueueTtl(): string {
  return process.env.AIRMCP_HITL_QUEUE_TTL ?? "4h";
}

/**
 * Fraction (0-1) of the global rate-limit budget reserved for
 * autonomous calls. The remainder stays available for client-driven
 * calls. 0.5 (default) lets autonomous skills consume up to half the
 * budget before backing off; 0 disables autonomous-side rate counting
 * entirely (autonomous calls share the same pool with no reservation).
 */
export function getDaemonRateBudgetPct(): number {
  const raw = process.env.AIRMCP_DAEMON_RATE_BUDGET_PCT;
  if (!raw) return 0.5;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.5;
  return n;
}
