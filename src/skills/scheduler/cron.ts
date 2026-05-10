/**
 * RFC 0012 Phase 1 prep — POSIX 5-field cron parser.
 *
 * Format: `minute hour day-of-month month day-of-week`
 *
 * Each field accepts:
 * - `*`         — every
 * - `5`         — single value
 * - `1,3,5`     — list
 * - `1-5`       — inclusive range
 * - `* /5`      — step (every 5 starting at field min)
 * - `0-30/10`   — range with step (0, 10, 20, 30)
 *
 * Out of scope (deliberately): named months/days (`MON`, `JAN`), `?`, `L`,
 * `W`, `H`, second-resolution, year field. Phase 2 may add named tokens
 * if user feedback demands them — POSIX is the contract.
 *
 * Day-of-week: Sunday=0, Saturday=6 (matches `Date.prototype.getDay()`).
 *
 * Timezone: all fields are interpreted in the host's local time. DST
 * forward jumps cause the matching minute to be skipped that day; DST
 * backward jumps may cause the same minute to repeat. This matches
 * standard cron(8) behaviour on macOS / Linux.
 */

export interface CronExpr {
  minute: number[]; // 0-59
  hour: number[]; // 0-23
  dayOfMonth: number[]; // 1-31
  month: number[]; // 1-12
  dayOfWeek: number[]; // 0-6 (Sunday=0)
  /** Original expression for diagnostics / round-tripping. */
  raw: string;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const;

type FieldName = keyof typeof RANGES;

/** Parse one cron field into the explicit set of integers it represents. */
function parseField(field: string, name: FieldName): number[] {
  const [min, max] = RANGES[name];
  const items: number[] = [];

  for (const part of field.split(",")) {
    if (part.length === 0) {
      throw new Error(`Cron field "${name}" has empty list element in "${field}"`);
    }

    // Step suffix: "<base>/<step>"
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const baseExpr: string = stepMatch ? stepMatch[1]! : part;
    const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;

    if (step <= 0) {
      throw new Error(`Cron field "${name}" has non-positive step "${part}"`);
    }

    let startVal: number;
    let endVal: number;

    if (baseExpr === "*") {
      startVal = min;
      endVal = max;
    } else if (baseExpr.includes("-")) {
      const dashParts = baseExpr.split("-");
      if (dashParts.length !== 2) {
        throw new Error(`Cron field "${name}" has malformed range "${part}"`);
      }
      startVal = parseInt(dashParts[0]!, 10);
      endVal = parseInt(dashParts[1]!, 10);
    } else {
      startVal = parseInt(baseExpr, 10);
      endVal = startVal;
    }

    if (!Number.isFinite(startVal) || !Number.isFinite(endVal) || startVal < min || endVal > max || startVal > endVal) {
      throw new Error(`Cron field "${name}" value "${part}" out of range [${min}, ${max}]`);
    }

    for (let i = startVal; i <= endVal; i += step) {
      items.push(i);
    }
  }

  // De-dupe + sort for predictable iteration.
  return [...new Set(items)].sort((a, b) => a - b);
}

/** Parse a 5-field cron expression. Throws on malformed input. */
export function parseCron(expr: string): CronExpr {
  const trimmed = expr.trim();
  if (trimmed.length === 0) {
    throw new Error("Cron expression is empty");
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression "${expr}" must have 5 space-separated fields (got ${fields.length}). ` +
        `Format: 'minute hour day-of-month month day-of-week'.`,
    );
  }

  return {
    minute: parseField(fields[0]!, "minute"),
    hour: parseField(fields[1]!, "hour"),
    dayOfMonth: parseField(fields[2]!, "dayOfMonth"),
    month: parseField(fields[3]!, "month"),
    dayOfWeek: parseField(fields[4]!, "dayOfWeek"),
    raw: trimmed,
  };
}

/**
 * Compute the next time after `fromDate` that matches the cron expression.
 *
 * The algorithm is "advance minute by minute and check membership" —
 * O(N) in the gap between `fromDate` and the next fire. For typical
 * skills (hourly to daily) this terminates within hundreds of iterations.
 * Worst case (once-yearly skill on Feb 29) caps at ~2.1M minute-checks
 * which still completes in <100ms on modern hardware.
 *
 * Returns a fresh `Date` set to the matching minute boundary (seconds = 0,
 * milliseconds = 0). The caller should compare against the previous
 * fire timestamp before dispatching to avoid double-fire on rapid restarts.
 *
 * Throws if no match exists within 4 years — which only happens for
 * impossible expressions like `0 0 30 2 *` (Feb 30, never).
 */
export function nextFireAt(cron: CronExpr, fromDate: Date = new Date()): Date {
  const cursor = new Date(fromDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // 4 years of minute-resolution lookahead — covers leap-year edge cases.
  const maxIterations = 4 * 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    if (
      cron.minute.includes(cursor.getMinutes()) &&
      cron.hour.includes(cursor.getHours()) &&
      cron.dayOfMonth.includes(cursor.getDate()) &&
      cron.month.includes(cursor.getMonth() + 1) &&
      cron.dayOfWeek.includes(cursor.getDay())
    ) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(
    `Cron expression "${cron.raw}" has no fire time within 4 years — likely impossible (e.g. day 30 of February).`,
  );
}

/** Convenience: combine parse + nextFire in one call. */
export function nextFireFromExpr(expr: string, fromDate: Date = new Date()): Date {
  return nextFireAt(parseCron(expr), fromDate);
}
