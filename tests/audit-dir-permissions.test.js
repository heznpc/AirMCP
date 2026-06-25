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
const mkdir = jest.fn();
const stat = jest.fn();
const chmod = jest.fn();
const rename = jest.fn();
const readFile = jest.fn();
const readdir = jest.fn();
const writeFile = jest.fn();

jest.unstable_mockModule("node:fs/promises", () => ({
  appendFile,
  mkdir,
  stat,
  chmod,
  rename,
  readFile,
  readdir,
  writeFile,
}));

const { auditLog, _testReset, _testFlush } = await import("../dist/shared/audit.js");

beforeEach(() => {
  _testReset();
  appendFile.mockReset();
  mkdir.mockReset();
  stat.mockReset();
  chmod.mockReset();
  rename.mockReset();
  readFile.mockReset();
  readdir.mockReset();
  writeFile.mockReset();

  appendFile.mockResolvedValue(undefined);
  mkdir.mockResolvedValue(undefined);
  stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  chmod.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  readdir.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  writeFile.mockResolvedValue(undefined);
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
  });
});
