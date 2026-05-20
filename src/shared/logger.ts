/**
 * Structured logger — single sink for AirMCP runtime logs.
 *
 * Why this exists
 * ----------------
 * The server has 70+ scattered `console.error`/`console.warn` calls used as
 * ad-hoc diagnostic output. They all write to stderr (correct — stdout is
 * reserved for the JSON-RPC stream on stdio transport), but the format is
 * inconsistent: some are bare strings, some prefix with `[AirMCP …]`, some
 * include structured context inline as `${JSON.stringify(...)}`, and the
 * menubar app's log viewer has to parse the union of all of those shapes.
 *
 * This module standardises:
 *   - One sink: `console.error` (which Node routes to `process.stderr`,
 *     leaving stdout — reserved for the JSON-RPC stream on stdio
 *     transport — completely untouched). Going through `console.error`
 *     rather than `process.stderr.write` directly lets existing test
 *     spies on `console.error` keep working without per-test refactors.
 *   - One shape: `{ts, level, msg, ...ctx}` JSON when `AIRMCP_LOG_FORMAT=json`
 *     or stderr is not a TTY (i.e. the menubar viewer is reading the pipe);
 *     human-readable single-line otherwise.
 *   - One level filter: `AIRMCP_LOG_LEVEL` (default `info`).
 *
 * Non-goals
 * ----------
 * - No external dep (`pino`/`winston`). Zero added bytes to the npm tarball.
 * - No log rotation here — the audit log has its own rotation; this is for
 *   ephemeral diagnostic stderr, which the OS / launchd / menubar viewer
 *   already manage.
 * - No async/buffered writes. stderr is line-buffered and slow enough to
 *   matter only at very high volume; the audit log already has the async
 *   buffered path.
 *
 * CLI subcommands (`airmcp init` / `doctor` / `--version`) keep using
 * `console.log` directly: those are user-facing CLI output to stdout, not
 * server diagnostic logs. The boot-time HOME check in `src/index.ts` also
 * keeps raw `console.error` because the logger isn't loaded yet.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (!raw) return fallback;
  const l = raw.toLowerCase();
  if (l === "debug" || l === "info" || l === "warn" || l === "error") return l;
  return fallback;
}

function pickFormat(): "json" | "pretty" {
  const explicit = process.env.AIRMCP_LOG_FORMAT?.toLowerCase();
  if (explicit === "json" || explicit === "pretty") return explicit;
  // Default: if stderr is piped (menubar viewer, log file, CI), prefer JSON
  // so consumers don't have to scrape; if it's a TTY, prefer human-readable.
  return process.stderr.isTTY ? "pretty" : "json";
}

const minLevel = LEVELS[parseLevel(process.env.AIRMCP_LOG_LEVEL, "info")];
const format = pickFormat();

function formatPretty(level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  const ctxStr = ctx && Object.keys(ctx).length ? " " + JSON.stringify(ctx) : "";
  return `[${ts}] ${lvl} ${msg}${ctxStr}`;
}

function formatJson(level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      // Don't let ctx clobber reserved keys.
      if (k !== "ts" && k !== "level" && k !== "msg") entry[k] = v;
    }
  }
  return JSON.stringify(entry);
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel) return;
  const line = format === "json" ? formatJson(level, msg, ctx) : formatPretty(level, msg, ctx);
  // Route through console.error so test spies on `console.error` keep
  // working. Node implements console.error as `process.stderr.write(... + '\n')`
  // so the wire effect is identical to writing to stderr directly.
   
  console.error(line);
}

/**
 * Serialise an unknown error for inclusion in a log context object.
 *
 * Errors don't round-trip through `JSON.stringify` (name/message/stack are
 * non-enumerable), so callers that just spread `{ err }` lose the data.
 * Use as: `log.error("flush failed", { err: errToCtx(e) })`.
 */
export function errToCtx(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}

export const log = {
  debug(msg: string, ctx?: Record<string, unknown>): void {
    emit("debug", msg, ctx);
  },
  info(msg: string, ctx?: Record<string, unknown>): void {
    emit("info", msg, ctx);
  },
  warn(msg: string, ctx?: Record<string, unknown>): void {
    emit("warn", msg, ctx);
  },
  error(msg: string, ctx?: Record<string, unknown>): void {
    emit("error", msg, ctx);
  },
};

/** Exported for tests — read the effective level without going through env. */
export function _effectiveLevel(): LogLevel {
  const inverse = Object.entries(LEVELS).find(([, n]) => n === minLevel);
  return (inverse?.[0] as LogLevel) ?? "info";
}

/** Exported for tests — read the effective format without going through env. */
export function _effectiveFormat(): "json" | "pretty" {
  return format;
}
