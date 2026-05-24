/**
 * Process-wide async shutdown orchestrator.
 *
 * Callers register async cleanup callbacks with `registerShutdownHook()`;
 * the server's SIGINT/SIGTERM wiring (in `init.ts`) invokes `runShutdownHooks()`
 * before calling `process.exit()`. Hooks run via `allSettled` so one hook's
 * rejection does not skip the others, and the whole sequence is bounded by
 * `GRACEFUL_SHUTDOWN_TIMEOUT` so a hanging hook cannot prevent exit.
 *
 * This lives in its own file so transport modules (http-transport.ts) can
 * register cleanup without importing `init.ts` — which would otherwise pull
 * in the full configuration / HITL / Swift bridge dependency graph and
 * complicate test mocking.
 */

import { log } from "../shared/logger.js";

export type ShutdownHook = () => Promise<void> | void;

export const GRACEFUL_SHUTDOWN_TIMEOUT = 5000;

const hooks: ShutdownHook[] = [];

export function registerShutdownHook(fn: ShutdownHook): void {
  hooks.push(fn);
}

/** Run every registered hook, bounded by GRACEFUL_SHUTDOWN_TIMEOUT.
 *  Never throws — a hook that rejects is logged via `allSettled` but does
 *  not prevent the remaining hooks or the caller's `process.exit`. */
export async function runShutdownHooks(): Promise<void> {
  if (hooks.length === 0) return;
  const settled = Promise.allSettled(hooks.map((h) => Promise.resolve().then(h)));
  const winner = await Promise.race([
    settled.then(() => "done" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), GRACEFUL_SHUTDOWN_TIMEOUT)),
  ]);
  if (winner === "timeout") {
    log.warn("shutdown hooks exceeded budget — proceeding with exit", {
      budgetMs: GRACEFUL_SHUTDOWN_TIMEOUT,
    });
  }
}

/** Test-only: clear registered hooks. Guarded so a production caller cannot
 *  wipe every hook at runtime (would leave sockets/timers leaking on exit). */
export function _resetShutdownHooksForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error("_resetShutdownHooksForTests is only callable in test mode");
  }
  hooks.length = 0;
}
