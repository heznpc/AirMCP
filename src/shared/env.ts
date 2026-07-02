/**
 * Small env-var parsing helpers shared across pollers, triggers, and config.
 */

/**
 * Parse an integer env var with a floor and a safe fallback.
 *
 * A missing OR non-numeric value yields `fallback` (never NaN) — this matters
 * because a NaN interval/backoff coerces to 0 in `setTimeout`/`setInterval`,
 * turning a misconfigured knob into a runaway hot loop. The floor is applied to
 * both the parsed value and the fallback so the result is always >= floor.
 */
export function parseIntEnv(raw: string | undefined, opts: { floor: number; fallback: number }): number {
  const parsed = parseInt(raw ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : opts.fallback;
  return Math.max(opts.floor, value);
}
