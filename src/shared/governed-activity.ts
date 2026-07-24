import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./logger.js";

/** Leave enough of shutdown.ts's ordinary-hook budget for transport cleanup.
 * The audit finalizer runs only after this bounded drain stage completes. */
export const GOVERNED_ACTIVITY_DRAIN_TIMEOUT_MS = 2_500;

interface GovernedActivityScope {
  active: boolean;
}

const activityScope = new AsyncLocalStorage<GovernedActivityScope>();
const idleWaiters = new Set<() => void>();

let activeCalls = 0;
let shutdownStarted = false;

function notifyIdle(): void {
  if (activeCalls !== 0) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

/**
 * Track one complete governed tool/resource invocation, including its outcome
 * audit emission. Once shutdown starts, unrelated new calls fail closed while
 * nested calls that are still part of an already-active invocation may finish.
 */
export async function runGovernedActivity<T>(fn: () => T | Promise<T>): Promise<T> {
  const parentScope = activityScope.getStore();
  if (shutdownStarted && parentScope?.active !== true) {
    throw new Error("[internal_error] AirMCP is shutting down; new governed calls are not accepted.");
  }

  const scope: GovernedActivityScope = { active: true };
  activeCalls += 1;
  try {
    return await activityScope.run(scope, fn);
  } finally {
    // Detached work inherits the scope object. Marking it inactive prevents a
    // callback that starts after its parent returned from bypassing the drain.
    scope.active = false;
    activeCalls -= 1;
    notifyIdle();
  }
}

/**
 * Ordinary shutdown hook: close admission first, then wait for already-active
 * governed calls to emit their real outcome rows. A timeout is an explicit
 * fail boundary; it never fabricates a success/error outcome for unfinished
 * work, and the audit finalizer still gets its reserved shutdown stage.
 */
export async function drainGovernedActivityForShutdown(timeoutMs = GOVERNED_ACTIVITY_DRAIN_TIMEOUT_MS): Promise<void> {
  shutdownStarted = true;
  if (activeCalls === 0) return;

  let resolveIdle: (() => void) | undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
    idleWaiters.add(resolve);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
  });

  try {
    const result = await Promise.race([idle.then(() => "idle" as const), timedOut]);
    if (result === "timeout") {
      log.error("governed shutdown drain timed out — unfinished calls have no fabricated outcome", {
        activeCalls,
        timeoutMs,
        boundary: "audit finalizer will persist only outcomes emitted before its barrier",
      });
      throw new Error(`Timed out waiting for ${activeCalls} governed call(s) to finish before audit finalization`);
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (resolveIdle) idleWaiters.delete(resolveIdle);
  }
}

/** Test-only state reset. Production shutdown admission is intentionally
 * irreversible for the lifetime of the process. */
export function _resetGovernedActivityForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error("_resetGovernedActivityForTests is only callable in test mode");
  }
  if (activeCalls !== 0) {
    throw new Error("Cannot reset governed activity while calls are active");
  }
  shutdownStarted = false;
  idleWaiters.clear();
}

export function _getGovernedActivityStateForTests(): { activeCalls: number; shutdownStarted: boolean } {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error("_getGovernedActivityStateForTests is only callable in test mode");
  }
  return { activeCalls, shutdownStarted };
}
