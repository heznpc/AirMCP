/**
 * Audit directory permission pin.
 *
 * ensureDir() creates the audit dir (VECTOR_STORE — holds audit.jsonl +
 * audit.checkpoint) owner-only (0o700) so other local users can't even
 * enumerate audit filenames / rotation timestamps. It runs once per process
 * (guarded by `initialized`), so this lives in its own file: a fresh module
 * load guarantees the first flush actually calls mkdir. (Closes the
 * "audit dir 0o700 — NOT tested" gap from the security audit.)
 */
import { describe, test, expect, beforeEach, jest } from "@jest/globals";

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

const { auditLog, _testReset, _testFlush } = await import("../dist/shared/audit.js");

beforeEach(() => {
  _testReset();
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

  appendFile.mockResolvedValue(undefined);
  link.mockResolvedValue(undefined);
  lstat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  mkdir.mockResolvedValue(undefined);
  open.mockImplementation(() => Promise.resolve({ sync: jest.fn(async () => {}), close: jest.fn(async () => {}) }));
  rm.mockResolvedValue(undefined);
  stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  chmod.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  readdir.mockResolvedValue([]);
  writeFile.mockResolvedValue(undefined);
  unlink.mockResolvedValue(undefined);
});

describe("audit directory permissions", () => {
  test("ensureDir creates the audit dir recursively with owner-only mode 0o700", async () => {
    auditLog({ timestamp: "T1", tool: "t", status: "ok" });
    await _testFlush();

    expect(mkdir).toHaveBeenCalled();
    const dirCall = mkdir.mock.calls.find(
      (c) => c[1] && c[1].recursive === true && Object.prototype.hasOwnProperty.call(c[1], "mode"),
    );
    expect(dirCall).toBeDefined();
    expect(dirCall[1].mode).toBe(0o700);
    expect(chmod).toHaveBeenCalledWith(expect.any(String), 0o700);
  });
});
