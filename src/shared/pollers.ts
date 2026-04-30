import type { AirMCPEventType } from "./event-bus.js";
import { assertTestMode } from "./errors.js";

/**
 * Node-side poller registry. Feature modules (mail, music, …) import
 * their own poller file which calls `registerPoller()` at load time —
 * `shared/pollers.ts` no longer imports from any specific module, which
 * keeps the Core → Bridge → Services direction clean.
 *
 * Pollers are strictly passive — if the app isn't running or the user
 * hasn't granted Automation permission, individual pollers silence
 * transient errors on their own (via `createPollerLogger`) and keep
 * trying on the next tick instead of spamming stderr.
 */

export interface PollerDef {
  /** Unique identifier — used for dedup, diagnostics, and error-throttle keys. */
  name: string;
  /** Event bus type this poller emits (for diagnostics only). */
  event: AirMCPEventType;
  /** Poll interval in milliseconds. Each poller decides its own floor. */
  intervalMs: number;
  /** Called immediately at start (baseline) and on every interval tick. */
  tick: () => Promise<void>;
  /** Optional reset hook — clears any cached state when the registry stops. */
  reset?: () => void;
}

interface RegisteredPoller extends PollerDef {
  timer: ReturnType<typeof setInterval> | null;
}

const pollers = new Map<string, RegisteredPoller>();
let started = false;

/** Register a poller. Safe to call multiple times — later calls with the
 *  same name replace the previous definition (useful for hot reload in
 *  tests). If the registry is already started, the new poller is started
 *  too. */
export function registerPoller(def: PollerDef): void {
  const existing = pollers.get(def.name);
  if (existing?.timer) clearInterval(existing.timer);
  const entry: RegisteredPoller = { ...def, timer: null };
  pollers.set(def.name, entry);
  if (started && process.env.AIRMCP_DISABLE_POLLERS !== "1") {
    startOne(entry);
  }
}

function startOne(p: RegisteredPoller): void {
  // Fire once immediately to establish baseline, then on interval.
  p.tick().catch(() => undefined);
  p.timer = setInterval(() => {
    p.tick().catch(() => undefined);
  }, p.intervalMs);
  // unref so pollers don't keep the process alive on exit
  p.timer.unref?.();
}

/** Start all registered pollers. Idempotent. */
export function startPollers(): void {
  if (started) return;
  if (process.env.AIRMCP_DISABLE_POLLERS === "1") return;
  started = true;
  for (const p of pollers.values()) {
    if (!p.timer) startOne(p);
  }
}

/** Stop all pollers and clear cached state. */
export function stopPollers(): void {
  for (const p of pollers.values()) {
    if (p.timer) clearInterval(p.timer);
    p.timer = null;
    p.reset?.();
  }
  resetErrorThrottle();
  started = false;
}

/** Inspect poller status (diagnostics only). */
export function getPollerStatus(): Array<{ name: string; event: string; intervalMs: number; running: boolean }> {
  return [...pollers.values()].map((p) => ({
    name: p.name,
    event: p.event,
    intervalMs: p.intervalMs,
    running: p.timer !== null,
  }));
}

// ── Shared error throttling for poller `tick` implementations ────────
// Each poller gets a stable key; log at most once per 5 minutes per key.
// The map is GC'd periodically so long-running processes do not accumulate
// stale keys from transient poll names.

const errorThrottle = new Map<string, number>();
const ERROR_THROTTLE_MS = 5 * 60 * 1000;
const ERROR_THROTTLE_GC_MS = 24 * 60 * 60 * 1000;

function shouldLogError(key: string): boolean {
  const now = Date.now();
  const last = errorThrottle.get(key) ?? 0;
  if (now - last < ERROR_THROTTLE_MS) return false;
  errorThrottle.set(key, now);
  // Sweep entries older than a day so the map does not grow unbounded
  // when ephemeral keys are produced (e.g. tests that register many pollers).
  for (const [k, v] of errorThrottle) {
    if (now - v > ERROR_THROTTLE_GC_MS) errorThrottle.delete(k);
  }
  return true;
}

function resetErrorThrottle(): void {
  errorThrottle.clear();
}

/** Factory for a throttled error logger scoped to a specific poller.
 *  Callers pass the raw error; the logger formats a consistent prefix. */
export function createPollerLogger(name: string): (e: unknown) => void {
  return (e: unknown) => {
    if (shouldLogError(name)) {
      console.error(`[AirMCP pollers] ${name} poll failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

/** Test-only: clear all registered pollers. */
export function _resetPollerRegistryForTests(): void {
  assertTestMode("_resetPollerRegistryForTests");
  for (const p of pollers.values()) {
    if (p.timer) clearInterval(p.timer);
  }
  pollers.clear();
  resetErrorThrottle();
  started = false;
}
