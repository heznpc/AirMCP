/**
 * Persistent debounce state for skill triggers.
 *
 * Why this exists: the previous `bindings[].lastFired` was a per-process
 * in-memory number. A daemon restart reset every counter to 0 — the next
 * burst of `calendar_changed` events would all fire (no debounce
 * suppression) because the loaded lastFired was younger than the
 * debounce window. The audit's MEDIUM-12 finding called this out: in
 * production the "always-on daemon" restarts a few times a day for
 * updates / crashes / sleep-wake, and each restart bypasses every
 * binding's debounce once.
 *
 * Fix: persist `lastFired` to `~/.airmcp/trigger-debounce.json` keyed by
 * `${skillName}::${eventType}`. The in-memory map mirrors the disk file
 * for the hot read path; every dispatch writes through to disk
 * atomically (temp + rename, same pattern as VectorStore.save). On
 * boot, `loadDebounceState()` is called once before any binding's
 * `lastFired` is consulted so the first event after restart still
 * honours the pre-restart debounce window.
 *
 * Failure modes:
 *   - file missing → empty map, treated as "never fired"
 *   - file unparseable → log + reset (operator visible)
 *   - write fails → log + keep in-memory state; next write retries
 *     (we don't crash the daemon over a transient ENOSPC)
 */
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { PATHS } from "../shared/constants.js";

const STATE_PATH = join(PATHS.VECTOR_STORE, "trigger-debounce.json");

/** key = `${skillName}::${eventType}` → epoch ms of last successful dispatch */
type DebounceMap = Record<string, number>;

let cache: DebounceMap | null = null;
let loadPromise: Promise<DebounceMap> | null = null;

/** Build the canonical key. Exported for tests. */
export function debounceKey(skillName: string, eventType: string): string {
  return `${skillName}::${eventType}`;
}

/**
 * Load the persisted debounce map (or return the in-memory cache if
 * already loaded). Concurrent calls share a single load promise so a
 * burst of registrations at startup doesn't fan out into N disk reads.
 */
export async function loadDebounceState(): Promise<DebounceMap> {
  if (cache !== null) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await readFile(STATE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        // File present but corrupted shape — start fresh and surface a
        // single stderr line so the operator notices. Don't crash: a
        // corrupted debounce file should never gate skill execution.
        console.error(`[AirMCP debounce] state file at ${STATE_PATH} had non-object root — resetting`);
        cache = {};
      } else {
        // Filter out non-numeric entries defensively. Past versions or
        // hand-edits could land a string here; let the schema win.
        const sanitized: DebounceMap = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "number" && Number.isFinite(v)) sanitized[k] = v;
        }
        cache = sanitized;
      }
    } catch {
      // File missing / unreadable — start with an empty map.
      cache = {};
    }
    return cache;
  })();
  return loadPromise;
}

/** Synchronous getter — assumes loadDebounceState() has resolved. */
export function getLastFired(skillName: string, eventType: string): number {
  if (cache === null) return 0; // load not yet awaited — treat as never fired
  return cache[debounceKey(skillName, eventType)] ?? 0;
}

/**
 * Update the lastFired timestamp and persist atomically. The in-memory
 * cache is updated synchronously; the disk write is awaited by callers
 * that need ordering, ignored by fire-and-forget callers. ENOSPC /
 * permission failures are logged but never thrown — losing the latest
 * persistence is preferable to crashing the daemon.
 */
export async function recordFired(skillName: string, eventType: string, when: number = Date.now()): Promise<void> {
  if (cache === null) await loadDebounceState();
  cache![debounceKey(skillName, eventType)] = when;
  await persistState();
}

/** Test-only: reset the singleton so each test case starts cold. */
export function _resetDebounceState(): void {
  cache = null;
  loadPromise = null;
}

async function persistState(): Promise<void> {
  if (cache === null) return;
  try {
    await mkdir(dirname(STATE_PATH), { recursive: true });
    // Atomic write: same pattern as VectorStore.save() — write a sibling
    // temp file then rename onto STATE_PATH so a SIGKILL mid-write
    // doesn't half-overwrite the previous good state.
    const tmp = `${STATE_PATH}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(cache), { encoding: "utf-8", mode: 0o600 });
      await rename(tmp, STATE_PATH);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        /* temp may not exist */
      }
      throw err;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AirMCP debounce] failed to persist state: ${msg}`);
    // Swallow — losing one fsync is acceptable; crashing the trigger
    // listener would lose every subsequent skill execution.
  }
}
