/**
 * RFC 0012 Phase 1 prep — scheduler state persistence.
 *
 * Tracks last-fire timestamps per skill so a daemon restart doesn't
 * double-fire (recently-fired skill) or skip (long-overdue skill needs
 * to fire on next tick rather than wait for next cron match). Same
 * atomic-write pattern as `MemoryStore` (PR #154): stage in a sibling
 * tempfile and `rename()` over the canonical path so a SIGKILL / power
 * loss mid-write leaves either the old or new content — never a
 * half-flushed JSON file.
 *
 * Single JSON file, ~1KB even for 100 scheduled skills. No need for
 * per-key locking (the queue is sub-second; serialized writes inside
 * the daemon are sufficient).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HOME } from "../../shared/constants.js";

export interface SchedulerState {
  /** ISO-8601 timestamp of last successful fire, keyed by skill name. */
  lastFire: Record<string, string>;
  /**
   * Optional: skill content signature at last fire (sha256 of YAML body).
   * Lets the scheduler detect a skill change between restarts and force
   * a re-evaluation rather than rely on the stale `lastFire` cursor.
   */
  lastFireSig?: Record<string, string>;
  /** Schema version for future migrations. */
  version: 1;
}

export const DEFAULT_STATE_PATH = path.join(HOME, ".config", "airmcp", "scheduler-state.json");

const EMPTY_STATE: SchedulerState = { lastFire: {}, version: 1 };

/** Read the persisted state. Returns an empty fresh state if the file
 *  doesn't exist (first boot) or is unreadable (corrupt → start over). */
export async function loadSchedulerState(filePath: string = DEFAULT_STATE_PATH): Promise<SchedulerState> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Partial<SchedulerState>;
    return {
      lastFire: parsed.lastFire ?? {},
      lastFireSig: parsed.lastFireSig,
      version: 1,
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { ...EMPTY_STATE };
    // Corrupt JSON — log and start fresh. The daemon will re-seed
    // on the next fire of each skill. Better than crash-looping at boot.
    return { ...EMPTY_STATE };
  }
}

/** Atomically persist state. Creates parent directory if missing. */
export async function saveSchedulerState(state: SchedulerState, filePath: string = DEFAULT_STATE_PATH): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempName = `${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const tempPath = path.join(dir, tempName);

  const json = JSON.stringify(state, null, 2);
  try {
    await fs.writeFile(tempPath, json, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (e) {
    // Cleanup the temp file on any failure so we don't leak.
    await fs.unlink(tempPath).catch(() => {
      /* already gone */
    });
    throw e;
  }
}

/** Read-modify-write helper. The mutator may return the same object
 *  it received (mutation in place is OK) since the file is rewritten
 *  on every save. */
export async function updateSchedulerState(
  mutate: (state: SchedulerState) => SchedulerState,
  filePath: string = DEFAULT_STATE_PATH,
): Promise<SchedulerState> {
  const current = await loadSchedulerState(filePath);
  const next = mutate(current);
  await saveSchedulerState(next, filePath);
  return next;
}

/** Compute a stable signature for a skill body. Used to detect skill
 *  edits between daemon restarts — a changed signature invalidates the
 *  `lastFire` cursor for that skill so the next tick re-evaluates from
 *  scratch. */
export function computeSkillSignature(yamlBody: string): string {
  return crypto.createHash("sha256").update(yamlBody, "utf8").digest("hex").slice(0, 16);
}
