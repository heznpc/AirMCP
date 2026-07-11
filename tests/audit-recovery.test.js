/**
 * Quality-audit recovery-path coverage for `src/shared/audit.ts`.
 *
 * The happy path (append-to-buffer, flush succeeds) was already covered by
 * `tests/audit.test.js`. This file targets the cold paths the line-coverage
 * report flagged as untested:
 *
 *   - `flushBuffer` first-attempt failure → automatic retry → success
 *   - `flushBuffer` retry failure → `consecutiveFlushFailures` increments
 *   - `MAX_FLUSH_FAILURES` threshold → `auditDisabled` trips +
 *     pending flush timer cleared
 *   - `maybeAttemptRecovery` early-return when window hasn't elapsed
 *   - `maybeAttemptRecovery` re-enables flushing after the 5-minute window
 *   - `rotateIfNeeded` rotates when file size exceeds MAX_FILE_SIZE
 *   - `rotateIfNeeded` corrects file mode when permissions drift from 0o600
 *   - `rotateIfNeeded` swallows missing-file / rename failures
 *   - pre-append replay resumes a fully verified tail across restart
 *   - pre-append replay fails closed on malformed tail data
 *   - a parseable legacy-only file starts its first signed row at genesis
 *
 * Mocks `node:fs/promises` via `jest.unstable_mockModule` so each test can
 * inject the precise failure mode the production path is supposed to handle.
 */
import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { createHmac } from "node:crypto";

const appendFile = jest.fn();
const link = jest.fn();
const lstat = jest.fn();
const mkdir = jest.fn();
const open = jest.fn();
const rm = jest.fn();
const stat = jest.fn();
const chmod = jest.fn();
const rename = jest.fn();
const readFile = jest.fn();
const readdir = jest.fn();
const writeFile = jest.fn();
const unlink = jest.fn();

let virtualAudit = Buffer.alloc(0);
let virtualCheckpoint = null;
const ROTATED_PATH_RE = /audit\.\d+\.\d+\.[0-9a-f-]{36}\.jsonl$/;

function enoent() {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

function appendVirtualAudit(_path, data) {
  virtualAudit = Buffer.concat([virtualAudit, Buffer.from(data)]);
  return Promise.resolve();
}

jest.unstable_mockModule("node:fs/promises", () => ({
  appendFile,
  link,
  lstat,
  mkdir,
  open,
  rm,
  stat,
  chmod,
  rename,
  readFile,
  readdir,
  writeFile,
  unlink,
}));

const { auditLog, _testReset, _testFlush, _testGetState, _testSetAuditDisabledSince } =
  await import("../dist/shared/audit.js");

beforeEach(() => {
  _testReset();
  virtualAudit = Buffer.alloc(0);
  virtualCheckpoint = null;
  appendFile.mockReset();
  link.mockReset();
  lstat.mockReset();
  mkdir.mockReset();
  open.mockReset();
  rm.mockReset();
  stat.mockReset();
  chmod.mockReset();
  rename.mockReset();
  readFile.mockReset();
  readdir.mockReset();
  writeFile.mockReset();
  unlink.mockReset();

  // Default happy-path mock behaviour. Individual tests override.
  appendFile.mockImplementation(appendVirtualAudit);
  link.mockResolvedValue(undefined);
  lstat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  mkdir.mockResolvedValue(undefined);
  open.mockImplementation(() => Promise.resolve({ sync: jest.fn(async () => {}), close: jest.fn(async () => {}) }));
  rm.mockResolvedValue(undefined);
  stat.mockImplementation(() =>
    virtualAudit.byteLength > 0
      ? Promise.resolve({ size: virtualAudit.byteLength, mode: 0o100600 })
      : Promise.reject(enoent()),
  );
  chmod.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  readFile.mockImplementation((path, encoding) => {
    const value = String(path);
    if (value.endsWith("audit.checkpoint")) {
      return virtualCheckpoint === null ? Promise.reject(enoent()) : Promise.resolve(virtualCheckpoint);
    }
    if (value.endsWith("audit.jsonl")) {
      if (virtualAudit.byteLength === 0) return Promise.reject(enoent());
      return Promise.resolve(encoding ? virtualAudit.toString() : Buffer.from(virtualAudit));
    }
    return Promise.reject(enoent());
  });
  readdir.mockImplementation(() => Promise.resolve(virtualAudit.byteLength > 0 ? ["audit.jsonl"] : []));
  writeFile.mockImplementation((path, data) => {
    if (/audit\.checkpoint\..+\.tmp$/.test(String(path))) virtualCheckpoint = String(data);
    return Promise.resolve();
  });
  unlink.mockResolvedValue(undefined);
});

// ── flushBuffer error paths ───────────────────────────────────────────

describe("flushBuffer: first-attempt failure → retry → success", () => {
  test("appendFile fails once then succeeds — consecutiveFlushFailures stays 0", async () => {
    appendFile
      .mockRejectedValueOnce(Object.assign(new Error("EAGAIN"), { code: "EAGAIN" }))
      .mockResolvedValueOnce(undefined);

    auditLog({ timestamp: "T1", tool: "tool_x", status: "ok" });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(2); // initial + retry
    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBe(0);
    expect(state.auditDisabled).toBe(false);
    expect(state.bufferLength).toBe(0); // drained on success
  });

  test("fsyncs the audit file, directory, and checkpoint before completing", async () => {
    auditLog({ timestamp: "T1", tool: "durable", status: "ok" });
    await _testFlush();

    const opened = open.mock.calls.map(([path]) => String(path));
    expect(opened.some((path) => path.endsWith("audit.jsonl"))).toBe(true);
    expect(opened.some((path) => /audit\.checkpoint\..+\.tmp$/.test(path))).toBe(true);
    expect(opened.filter((path) => !path.endsWith("audit.jsonl") && !path.includes("audit.checkpoint.")).length).toBeGreaterThan(0);
  });

  test("fails closed when the post-append fsync barrier fails", async () => {
    open.mockRejectedValueOnce(Object.assign(new Error("fsync unavailable"), { code: "EIO" }));

    auditLog({ timestamp: "T1", tool: "not_durable", status: "ok" });
    await _testFlush();

    expect(_testGetState()).toMatchObject({ auditDisabled: true, bufferLength: 0 });
  });
});

describe("flushBuffer: ambiguous append outcomes", () => {
  test("suppresses retry when the first append committed the exact full payload before rejecting", async () => {
    const committedError = Object.assign(new Error("close failed after write"), { code: "EIO" });
    appendFile.mockImplementationOnce((_path, data) => {
      virtualAudit = Buffer.concat([virtualAudit, Buffer.from(data)]);
      return Promise.reject(committedError);
    });

    auditLog({ timestamp: "T1", tool: "committed_once", status: "ok" });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(1);
    expect(virtualAudit.toString().trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(virtualAudit.toString()).tool).toBe("committed_once");
    expect(_testGetState()).toMatchObject({ auditDisabled: false, bufferLength: 0 });
  });

  test("partial append fails closed immediately and never requeues the unsafe batch", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    appendFile.mockImplementationOnce((_path, data) => {
      const payload = Buffer.from(data);
      virtualAudit = Buffer.concat([virtualAudit, payload.subarray(0, Math.max(1, Math.floor(payload.length / 2)))]);
      return Promise.reject(Object.assign(new Error("partial write"), { code: "ENOSPC" }));
    });

    auditLog({ timestamp: "T1", tool: "partial_must_not_retry", status: "ok" });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(1);
    expect(_testGetState()).toMatchObject({ auditDisabled: true, bufferLength: 0 });
    expect(errorSpy.mock.calls.some((args) => args.join(" ").includes("partial or ambiguous"))).toBe(true);
    errorSpy.mockRestore();
  });

  test("uninspectable append outcome fails closed without retry or requeue", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    stat
      .mockResolvedValueOnce({ size: 0, mode: 0o100600 })
      .mockRejectedValueOnce(Object.assign(new Error("stat unavailable"), { code: "EIO" }));
    appendFile.mockRejectedValueOnce(Object.assign(new Error("append status unknown"), { code: "EIO" }));

    auditLog({ timestamp: "T1", tool: "ambiguous_must_not_retry", status: "ok" });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(1);
    expect(_testGetState()).toMatchObject({ auditDisabled: true, bufferLength: 0 });
    errorSpy.mockRestore();
  });
});

describe("flushBuffer: single-flight callers await their own sealed row", () => {
  test("a second caller arriving during append does not return before its row is flushed", async () => {
    let releaseFirstAppend;
    appendFile
      .mockImplementationOnce(
        (path, data) =>
          new Promise((resolve) => {
            releaseFirstAppend = () => {
              appendVirtualAudit(path, data);
              resolve();
            };
          }),
      )
      .mockImplementationOnce(appendVirtualAudit);

    auditLog({ timestamp: "T1", tool: "first", status: "ok" });
    const firstFlush = _testFlush();
    while (appendFile.mock.calls.length === 0) await Promise.resolve();

    auditLog({ timestamp: "T2", tool: "second", status: "ok" });
    let secondReturned = false;
    const secondFlush = _testFlush().then(() => {
      secondReturned = true;
    });
    await Promise.resolve();
    expect(secondReturned).toBe(false);

    releaseFirstAppend();
    await Promise.all([firstFlush, secondFlush]);

    expect(appendFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(Buffer.from(appendFile.mock.calls[0][1]).toString().trim()).tool).toBe("first");
    expect(JSON.parse(Buffer.from(appendFile.mock.calls[1][1]).toString().trim()).tool).toBe("second");
    expect(_testGetState().bufferLength).toBe(0);
  });
});

describe("flushBuffer: both attempts fail → consecutiveFlushFailures increments", () => {
  test("increments by 1 per double-failure and requeues the complete batch", async () => {
    appendFile.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    auditLog({ timestamp: "T1", tool: "tool_x", status: "ok" });
    await _testFlush();

    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBe(1);
    expect(state.auditDisabled).toBe(false); // not yet at threshold
    expect(state.bufferLength).toBe(1); // failed audit row is never dropped
  });

  test("two append failures then recovery preserves rows and chain continuity", async () => {
    const diskError = Object.assign(new Error("EAGAIN"), { code: "EAGAIN" });
    appendFile
      .mockRejectedValueOnce(diskError)
      .mockRejectedValueOnce(diskError)
      .mockImplementationOnce(appendVirtualAudit);

    auditLog({ timestamp: "T1", tool: "first", status: "ok" });
    await _testFlush(); // initial attempt + retry both fail
    expect(_testGetState().bufferLength).toBe(1);

    // A newer row arrives before the retry window. Recovery must retain FIFO
    // order and reseal from the last chain head known to be on disk.
    auditLog({ timestamp: "T2", tool: "second", status: "error" });
    await _testFlush();

    expect(appendFile).toHaveBeenCalledTimes(3);
    const recovered = Buffer.from(appendFile.mock.calls[2][1]).toString().trimEnd().split("\n").map(JSON.parse);
    expect(recovered.map((entry) => entry.tool)).toEqual(["first", "second"]);
    expect(recovered.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(recovered[0]._prev).toBe("0".repeat(64));
    expect(recovered[1]._prev).toBe(recovered[0]._hmac);
    expect(_testGetState().bufferLength).toBe(0);
  });

  test("reaches MAX_FLUSH_FAILURES (5) → auditDisabled trips, timer cleared", async () => {
    appendFile.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: "tool_x", status: "ok" });
      await _testFlush();
    }

    const state = _testGetState();
    expect(state.consecutiveFlushFailures).toBeGreaterThanOrEqual(5);
    expect(state.auditDisabled).toBe(true);
    expect(state.bufferLength).toBe(5);
  });
});

// ── maybeAttemptRecovery ──────────────────────────────────────────────

describe("maybeAttemptRecovery: window-gated re-enable", () => {
  test("does not re-enable inside the 5-minute window", async () => {
    appendFile.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: "t", status: "ok" });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    // Within window → retry stays paused, but the row remains spooled.
    const before = _testGetState().bufferLength;
    _testSetAuditDisabledSince(Date.now()); // just tripped
    auditLog({ timestamp: "T-fresh", tool: "t", status: "ok" });
    expect(_testGetState().auditDisabled).toBe(true);
    expect(_testGetState().bufferLength).toBe(before + 1);
  });

  test("re-enables when 5-minute window elapses + clears consecutiveFailures", async () => {
    appendFile.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: "t", status: "ok" });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    // Simulate 6 minutes elapsed since tripping.
    _testSetAuditDisabledSince(Date.now() - 6 * 60 * 1000);
    appendFile.mockResolvedValue(undefined); // disk recovered

    // The next auditLog triggers maybeAttemptRecovery → re-enables + schedules timer.
    auditLog({ timestamp: "T-recovered", tool: "t", status: "ok" });
    expect(_testGetState().auditDisabled).toBe(false);
    expect(_testGetState().consecutiveFlushFailures).toBe(0);
  });
});

// ── rotateIfNeeded ────────────────────────────────────────────────────

describe("rotateIfNeeded: triggered on size threshold", () => {
  test("renames audit.jsonl when file size > MAX_FILE_SIZE", async () => {
    stat.mockResolvedValue({
      size: 11 * 1024 * 1024, // > 10 MiB threshold
      mode: 0o100600,
    });

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    const rotations = rename.mock.calls.filter(([, target]) => ROTATED_PATH_RE.test(target));
    expect(rotations).toHaveLength(1);
    const renameTarget = rotations[0][1];
    expect(renameTarget).toMatch(ROTATED_PATH_RE);
  });

  test("advances past the greatest on-disk rotation timestamp when the wall clock moved backward", async () => {
    stat.mockResolvedValue({ size: 11 * 1024 * 1024, mode: 0o100600 });
    readdir.mockResolvedValueOnce([]).mockResolvedValueOnce(["audit.1700000000999.jsonl"]);
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);

    try {
      auditLog({ timestamp: "T1", tool: "t", status: "ok" });
      await _testFlush();
    } finally {
      nowSpy.mockRestore();
    }

    const target = rename.mock.calls.find(([, path]) => ROTATED_PATH_RE.test(path))?.[1];
    expect(target).toMatch(/audit\.1700000001000\.0\.[0-9a-f-]{36}\.jsonl$/);
  });

  test("refuses to overwrite externally pre-created rotation targets", async () => {
    stat.mockResolvedValue({ size: 11 * 1024 * 1024, mode: 0o100600 });
    lstat.mockImplementation((path) =>
      ROTATED_PATH_RE.test(String(path)) ? Promise.resolve({ dev: 1, ino: 1 }) : Promise.reject(enoent()),
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    expect(rename.mock.calls.filter(([, target]) => ROTATED_PATH_RE.test(target))).toHaveLength(0);
    expect(errorSpy.mock.calls.some((args) => args.join(" ").includes("post-append rotation check failed"))).toBe(true);
    errorSpy.mockRestore();
  });

  test("does NOT rename when file size is under threshold", async () => {
    stat.mockResolvedValue({ size: 1024, mode: 0o100600 });

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    expect(rename.mock.calls.filter(([, target]) => ROTATED_PATH_RE.test(target))).toHaveLength(0);
  });

  test("corrects permission drift to 0o600 when mode differs", async () => {
    stat.mockResolvedValue({
      size: 1024,
      mode: 0o100644, // world-readable — drift to fix
    });

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    expect(chmod.mock.calls.filter(([, mode]) => mode === 0o600)).toHaveLength(1);
  });

  test("preserves 0o600 mode without calling chmod", async () => {
    stat.mockResolvedValue({ size: 1024, mode: 0o100600 });

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    expect(chmod.mock.calls.filter(([, mode]) => mode === 0o600)).toHaveLength(0);
  });

  test("silently swallows missing-file stat failure", async () => {
    stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await expect(_testFlush()).resolves.toBeUndefined();

    expect(rename.mock.calls.filter(([, target]) => ROTATED_PATH_RE.test(target))).toHaveLength(0);
    expect(_testGetState().consecutiveFlushFailures).toBe(0); // not counted as flush failure
  });

  test("records rename failure after append without requeueing the committed batch", async () => {
    stat.mockResolvedValue({ size: 11 * 1024 * 1024, mode: 0o100600 });
    rename.mockImplementation((_source, target) =>
      ROTATED_PATH_RE.test(String(target))
        ? Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }))
        : Promise.resolve(),
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await expect(_testFlush()).resolves.toBeUndefined();

    expect(_testGetState().consecutiveFlushFailures).toBe(0); // rotation failure is non-fatal
    expect(errorSpy.mock.calls.some((args) => args.join(" ").includes("post-append rotation check failed"))).toBe(true);
    errorSpy.mockRestore();
  });
});

// ── pre-append chain replay ──────────────────────────────────────────

describe("pre-append chain replay across process restart", () => {
  test("resumes from a fully verified on-disk tail", async () => {
    // The module uses the host-derived fallback in this suite. Reproduce its
    // exact key rather than accepting a merely well-shaped arbitrary hash.
    const { hostname, platform } = await import("node:os");
    const body = { timestamp: "T-old", tool: "prev", status: "ok" };
    const prev = "0".repeat(64);
    const validHmac = createHmac("sha256", `airmcp-audit::${hostname()}::${platform()}`)
      .update(prev)
      .update("\0")
      .update(JSON.stringify(body))
      .digest("hex");
    const sealed = JSON.stringify({ ...body, _prev: prev, _hmac: validHmac }) + "\n";
    readdir.mockResolvedValue(["audit.jsonl"]);
    readFile.mockImplementation((path) =>
      String(path).endsWith("audit.checkpoint")
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : Promise.resolve(sealed),
    );

    auditLog({ timestamp: "T-new", tool: "new", status: "ok" });
    await _testFlush();

    // After flush, the written line's _prev should match the on-disk tail's _hmac.
    const writtenLines = Buffer.from(appendFile.mock.calls[0][1]).toString();
    const firstLine = JSON.parse(writtenLines.split("\n")[0]);
    expect(firstLine._prev).toBe(validHmac);
  });

  test("starts from genesis when the audit directory contains no log files", async () => {
    readdir.mockResolvedValue([]);

    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    const writtenLines = Buffer.from(appendFile.mock.calls[0][1]).toString();
    const firstLine = JSON.parse(writtenLines.split("\n")[0]);
    expect(firstLine._prev).toBe("0".repeat(64)); // HMAC_GENESIS
  });

  test("fails closed when the audit directory cannot be enumerated", async () => {
    readdir.mockRejectedValue(Object.assign(new Error("EACCES"), { code: "EACCES" }));

    auditLog({ timestamp: "T-new", tool: "must_not_append", status: "ok" });
    await _testFlush();

    expect(appendFile).not.toHaveBeenCalled();
    expect(_testGetState()).toMatchObject({ bufferLength: 1, consecutiveFlushFailures: 1 });
  });

  test.each(["EACCES", "ENOENT"])("fails closed when a listed audit file read returns %s", async (code) => {
    readdir.mockResolvedValue(["audit.jsonl"]);
    readFile.mockImplementation((path) =>
      String(path).endsWith("audit.checkpoint")
        ? Promise.reject(enoent())
        : Promise.reject(Object.assign(new Error(code), { code })),
    );

    auditLog({ timestamp: "T-new", tool: "must_not_append", status: "ok" });
    await _testFlush();

    expect(appendFile).not.toHaveBeenCalled();
    expect(_testGetState()).toMatchObject({ bufferLength: 1, consecutiveFlushFailures: 1 });
  });

  test("malformed tail fails closed instead of resuming past corruption", async () => {
    readdir.mockResolvedValue(["audit.jsonl"]);
    readFile.mockImplementation((path) =>
      String(path).endsWith("audit.checkpoint")
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : Promise.resolve("{not valid json\n"),
    );

    auditLog({ timestamp: "T-new", tool: "new", status: "ok" });
    await _testFlush();

    expect(appendFile).not.toHaveBeenCalled();
    expect(_testGetState().bufferLength).toBe(1);
    expect(_testGetState().consecutiveFlushFailures).toBe(1);
  });

  test("starts a signed chain from genesis for a parseable legacy-only file", async () => {
    let legacyActive = true;
    readdir.mockImplementation(() => Promise.resolve(legacyActive ? ["audit.jsonl"] : []));
    readFile.mockImplementation((path) =>
      String(path).endsWith("audit.checkpoint")
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : Promise.resolve(JSON.stringify({ timestamp: "T-legacy", tool: "old", status: "ok" }) + "\n"),
    );
    unlink.mockImplementation((path) => {
      if (String(path).endsWith("audit.jsonl")) legacyActive = false;
      return Promise.resolve();
    });

    auditLog({ timestamp: "T-new", tool: "new", status: "ok" });
    await _testFlush();

    const firstLine = JSON.parse(Buffer.from(appendFile.mock.calls[0][1]).toString().split("\n")[0]);
    expect(firstLine._prev).toBe("0".repeat(64));
    expect(link.mock.calls.some(([, target]) => String(target).includes("audit.legacy-untrusted."))).toBe(true);
  });
});

// ── flushBuffer no-op short-circuits ──────────────────────────────────

describe("flushBuffer: short-circuit conditions", () => {
  test("no-op when buffer is empty", async () => {
    await _testFlush();
    expect(appendFile).not.toHaveBeenCalled();
  });

  test("no-op when auditDisabled and recovery window not elapsed", async () => {
    appendFile.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));

    // Trip auditDisabled
    for (let i = 0; i < 5; i++) {
      auditLog({ timestamp: `T${i}`, tool: "t", status: "ok" });
      await _testFlush();
    }
    expect(_testGetState().auditDisabled).toBe(true);

    appendFile.mockClear();
    appendFile.mockResolvedValue(undefined);
    _testSetAuditDisabledSince(Date.now()); // window NOT elapsed

    auditLog({ timestamp: "T-blocked", tool: "t", status: "ok" });
    await _testFlush();
    expect(appendFile).not.toHaveBeenCalled(); // blocked
  });
});
