/**
 * Logger contract tests — runtime behaviour of `src/shared/logger.ts`.
 *
 * Per CLAUDE.md design principle 3 ("Tests assert handler behavior, not
 * just registration metadata"), these tests don't just check that the
 * `log` object exposes the right method names — they capture stderr and
 * verify each method writes the expected wire shape.
 *
 * Coverage:
 *   1. level filter — debug suppressed when level=info
 *   2. JSON format — emits one JSON line per call with ts/level/msg
 *   3. errToCtx — preserves Error name/message/stack across serialisation
 *   4. context guard — ctx keys can't clobber reserved fields
 *   5. line termination — every emit ends with a single \n (one log line)
 */

import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Capture stderr writes for assertion. The logger routes through
// `console.error`, which in Node writes the formatted line + a trailing
// newline to stderr. Capturing console.error directly is the most reliable
// hook because Node's console may have cached a reference to the original
// `process.stderr.write` at module init time.
function captureStderr(fn) {
  const written = [];
  const orig = console.error;
  console.error = (...args) => {
    // Match Node's behaviour: join with space, append \n.
    written.push(args.map(String).join(" ") + "\n");
  };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return written.join("");
}

// Reload the logger module so AIRMCP_LOG_LEVEL / AIRMCP_LOG_FORMAT env
// changes set in `beforeEach` take effect — module-level constants are
// computed at import time.
async function freshLogger() {
  jest.resetModules();
  return await import("../dist/shared/logger.js");
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.AIRMCP_LOG_LEVEL;
  delete process.env.AIRMCP_LOG_FORMAT;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("logger", () => {
  test("emits one JSON line per call when format=json", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    const { log } = await freshLogger();
    const out = captureStderr(() => log.info("hello", { tool: "notes" }));
    const lines = out.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.msg).toBe("hello");
    expect(parsed.level).toBe("info");
    expect(parsed.tool).toBe("notes");
    expect(typeof parsed.ts).toBe("string");
    // ISO 8601 sanity check
    expect(new Date(parsed.ts).toString()).not.toBe("Invalid Date");
  });

  test("respects AIRMCP_LOG_LEVEL — debug suppressed at info level", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    process.env.AIRMCP_LOG_LEVEL = "info";
    const { log } = await freshLogger();
    const out = captureStderr(() => {
      log.debug("quiet");
      log.info("loud");
    });
    expect(out).not.toContain("quiet");
    expect(out).toContain("loud");
  });

  test("AIRMCP_LOG_LEVEL=debug lets debug through", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    process.env.AIRMCP_LOG_LEVEL = "debug";
    const { log } = await freshLogger();
    const out = captureStderr(() => log.debug("trace"));
    expect(out).toContain("trace");
  });

  test("errToCtx preserves Error fields across JSON round-trip", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    const { log, errToCtx } = await freshLogger();
    const err = new TypeError("boom");
    const out = captureStderr(() => log.error("oops", { err: errToCtx(err) }));
    const parsed = JSON.parse(out.trim());
    expect(parsed.err.name).toBe("TypeError");
    expect(parsed.err.message).toBe("boom");
    expect(typeof parsed.err.stack).toBe("string");
  });

  test("ctx keys cannot clobber reserved ts/level/msg fields", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    const { log } = await freshLogger();
    const out = captureStderr(() =>
      log.warn("real", { ts: "FAKE_TS", level: "FAKE_LEVEL", msg: "FAKE_MSG", extra: "ok" }),
    );
    const parsed = JSON.parse(out.trim());
    expect(parsed.ts).not.toBe("FAKE_TS");
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("real");
    expect(parsed.extra).toBe("ok");
  });

  test("every emit terminates with exactly one newline", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    const { log } = await freshLogger();
    const out = captureStderr(() => {
      log.info("a");
      log.warn("b");
      log.error("c");
    });
    expect(out.split("\n").filter(Boolean)).toHaveLength(3);
    expect(out.endsWith("\n")).toBe(true);
  });

  test("pretty format produces single human-readable line", async () => {
    process.env.AIRMCP_LOG_FORMAT = "pretty";
    const { log } = await freshLogger();
    const out = captureStderr(() => log.info("hi", { tool: "notes" }));
    expect(out).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(out).toContain("INFO");
    expect(out).toContain("hi");
    expect(out).toContain('"tool":"notes"');
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("only writes via console.error — console.log untouched", async () => {
    process.env.AIRMCP_LOG_FORMAT = "json";
    const { log } = await freshLogger();
    const stdoutCapture = [];
    const origLog = console.log;
    console.log = (...args) => {
      stdoutCapture.push(args.map(String).join(" "));
    };
    try {
      captureStderr(() => {
        log.info("stderr-only");
        log.error("stderr-only");
      });
    } finally {
      console.log = origLog;
    }
    expect(stdoutCapture.join("")).toBe("");
  });
});
