/** Locks the jest-level HOME isolation (tests/helpers/isolate-home.cjs).
 *  If this fails, suites are running against the developer's real HOME and
 *  can pollute the real audit chain, config, and memory store. */
import { describe, expect, test } from "@jest/globals";

describe("test-run HOME isolation", () => {
  test("HOME points at a disposable airmcp-test-home directory", () => {
    // App code derives every home path from env HOME (constants.ts HOME),
    // which jest sandboxes per worker — os.homedir() is native and reads the
    // real environment, so source modules must never use it for state paths.
    expect(process.env.HOME).toMatch(/airmcp-test-home-/);
  });

  test("no source module derives a state path from os.homedir()", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const grep = promisify(execFile);
    // grep exits 1 on no matches — that is the passing case.
    const result = await grep("grep", ["-rln", "homedir", "src/"], { cwd: process.cwd() }).catch((err) => err);
    expect(result.stdout ?? "").toBe("");
  });
});
