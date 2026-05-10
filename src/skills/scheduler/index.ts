/**
 * RFC 0012 Phase 1 prep — daemon-side scheduler infrastructure.
 *
 * This module exports the foundational pieces (cron parser, state
 * persistence, HITL queue) that the always-on daemon will assemble in
 * the implementation PR following RFC 0012 acceptance.
 *
 * Each piece is independently testable and side-effect-free at import
 * time so the existing client-driven mode boots unchanged.
 */

export { parseCron, nextFireAt, nextFireFromExpr } from "./cron.js";
export type { CronExpr } from "./cron.js";

export {
  loadSchedulerState,
  saveSchedulerState,
  updateSchedulerState,
  computeSkillSignature,
  DEFAULT_STATE_PATH,
} from "./state.js";
export type { SchedulerState } from "./state.js";

export {
  appendToQueue,
  readQueue,
  readPending,
  resolveQueueEntry,
  expirePending,
  maybeRotate,
  parseTtl,
  DEFAULT_QUEUE_PATH,
  DEFAULT_ARCHIVE_PATH,
  MAX_ENTRIES,
} from "./queue.js";
export type { HitlQueueEntry } from "./queue.js";

export {
  isDaemonMode,
  isAutonomousDestructiveAllowed,
  getAbsentThresholdSec,
  getDefaultQueueTtl,
  getDaemonRateBudgetPct,
} from "./env.js";
