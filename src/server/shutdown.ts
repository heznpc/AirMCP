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
const SHUTDOWN_FINALIZER_RESERVE = 2000;

const hooks = new Set<ShutdownHook>();
const finalizers = new Set<ShutdownHook>();

export function registerShutdownHook(fn: ShutdownHook): void {
  hooks.add(fn);
}

/** Remove a lifecycle hook after its resource has already been disposed.
 * This is intentionally identity-based: callers keep the exact callback they
 * registered, so closing one server cannot remove another server's hook. */
export function unregisterShutdownHook(fn: ShutdownHook): void {
  hooks.delete(fn);
}

/** Register persistence work that must run after ordinary cleanup. The
 * orchestrator reserves part of the global budget for this stage so a hung
 * socket/session hook cannot consume the audit flush window. */
export function registerShutdownFinalizer(fn: ShutdownHook): void {
  finalizers.add(fn);
}

async function runStage(stage: "hooks" | "finalizers", callbacks: ShutdownHook[], budgetMs: number): Promise<void> {
  if (callbacks.length === 0 || budgetMs <= 0) return;
  const settled = Promise.allSettled(callbacks.map((callback) => Promise.resolve().then(callback)));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    settled.then((results) => ({ kind: "done" as const, results })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "timeout" as const }), budgetMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (winner.kind === "timeout") {
    log.warn(`shutdown ${stage} exceeded stage budget`, { budgetMs });
    return;
  }
  for (const result of winner.results) {
    if (result.status === "rejected") {
      log.warn(`shutdown ${stage} callback failed`, {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
}

/** Run every registered hook, bounded by GRACEFUL_SHUTDOWN_TIMEOUT.
 *  Never throws — a hook that rejects is logged via `allSettled` but does
 *  not prevent the remaining hooks or the caller's `process.exit`. */
export async function runShutdownHooks(): Promise<void> {
  const startedAt = Date.now();
  const hookBudget =
    finalizers.size > 0 ? GRACEFUL_SHUTDOWN_TIMEOUT - SHUTDOWN_FINALIZER_RESERVE : GRACEFUL_SHUTDOWN_TIMEOUT;
  await runStage("hooks", [...hooks], hookBudget);
  const elapsed = Date.now() - startedAt;
  await runStage("finalizers", [...finalizers], Math.max(0, GRACEFUL_SHUTDOWN_TIMEOUT - elapsed));
}

/** Test-only: clear registered hooks. Guarded so a production caller cannot
 *  wipe every hook at runtime (would leave sockets/timers leaking on exit). */
export function _resetShutdownHooksForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error("_resetShutdownHooksForTests is only callable in test mode");
  }
  hooks.clear();
  finalizers.clear();
}
