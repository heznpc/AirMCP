/**
 * Lightweight error and runtime-precondition helpers shared across modules.
 *
 * Kept dependency-free so it can be imported from any layer (audit, usage
 * tracking, tool registry) without creating cycles.
 */

/**
 * Extract a human-readable message from any thrown value.
 *
 * Avoids the `e instanceof Error ? e.message : String(e)` snippet that was
 * scattered across audit/usage-tracker/etc. — single source of truth so the
 * format never drifts between log lines.
 */
export function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Serialise an unknown throwable for inclusion in a structured log `ctx`.
 *
 * `formatError` returns a single string (good for interpolated messages);
 * `errToCtx` returns `{name, message, stack}` so JSON consumers (menubar
 * viewer, log shipping) can filter on each field. Use the latter exclusively
 * with the structured logger (`src/shared/logger.ts`).
 *
 * `Error` instances don't round-trip through `JSON.stringify` because
 * `name`/`message`/`stack` are non-enumerable — `JSON.stringify(new Error("x"))`
 * is `"{}"`. This helper makes the fields explicit.
 */
export function errToCtx(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}

/**
 * Throws unless we're in a test environment.
 *
 * Test environment is signaled by `NODE_ENV=test` (set automatically by Jest)
 * or by `AIRMCP_TEST_MODE=1` for ad-hoc local runs. Used to gate test-only
 * helpers (`audit._testReset`, `toolRegistry.reset`) so production callers
 * with module access cannot wipe in-memory state at runtime.
 *
 * @param label  Human-readable name of the helper being guarded — included in
 *               the thrown message so the offending caller can be located.
 */
export function assertTestMode(label: string): void {
  if (process.env.NODE_ENV !== "test" && process.env.AIRMCP_TEST_MODE !== "1") {
    throw new Error(`${label} is only callable when NODE_ENV=test or AIRMCP_TEST_MODE=1`);
  }
}
