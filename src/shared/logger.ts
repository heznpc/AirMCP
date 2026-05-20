/**
 * Structured logger — single sink for AirMCP runtime logs.
 *
 * The server has 70+ scattered `console.error`/`console.warn` calls used as
 * ad-hoc diagnostic output. They all write to stderr (correct — stdout is
 * reserved for the JSON-RPC stream on stdio transport), but the format is
 * inconsistent: bare strings, `[AirMCP …]` prefixes, inline
 * `${JSON.stringify(...)}`. The menubar viewer has to parse the union of all
 * those shapes. This module collapses them to one shape and one level filter.
 *
 * The sink is `console.error` rather than `process.stderr.write` directly so
 * existing test spies on `console.error` keep working — Node's `console.error`
 * is implemented as `process.stderr.write(... + '\n')`, so the wire effect is
 * identical.
 *
 * Non-goals
 * ----------
 * - No external dep (`pino`/`winston`). Zero added bytes to the npm tarball.
 * - No log rotation — `src/shared/audit.ts` has its own; this is for ephemeral
 *   diagnostic stderr that the OS / launchd / menubar viewer already manage.
 * - No async/buffered writes. stderr is fast enough except at very high
 *   volume; the audit log already has the buffered path for that case.
 *
 * CLI subcommands (`airmcp init` / `doctor` / `--version`) keep using
 * `console.log` directly — that's user-facing CLI output to stdout, not
 * server diagnostic logs. The boot-time HOME check in `src/index.ts` also
 * keeps raw `console.error` because the logger isn't loaded yet.
 */

// Re-export so callers that already pull `log` from this module can grab
// `errToCtx` without a second import. The implementation lives in
// `./errors.ts` next to `formatError` so error-serialisation helpers stay
// co-located.
export { errToCtx } from "./errors.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Pre-padded level labels for the pretty formatter — avoids `toUpperCase()`
// + `padEnd(5)` per emitted line.
const PRETTY_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
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
  // If stderr is piped (menubar viewer, log file, CI), prefer JSON so
  // consumers don't have to scrape; if it's a TTY, prefer human-readable.
  return process.stderr.isTTY ? "pretty" : "json";
}

const minLevel = LEVELS[parseLevel(process.env.AIRMCP_LOG_LEVEL, "info")];
const format = pickFormat();

function formatPretty(level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const ctxStr = ctx && Object.keys(ctx).length ? " " + JSON.stringify(ctx) : "";
  return `[${ts}] ${PRETTY_LABEL[level]} ${msg}${ctxStr}`;
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

  console.error(line);
}

export const log = {
  /**
   * Cheap level check for hot paths — callers can skip building a heavy `ctx`
   * object when the level would be suppressed anyway. Example:
   *   `if (log.isLevelEnabled("debug")) log.debug("...", expensiveCtx());`
   */
  isLevelEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= minLevel;
  },
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
