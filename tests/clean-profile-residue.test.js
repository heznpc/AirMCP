/**
 * scripts/clean-profile-residue.mjs — removes historical test-fixture residue
 * (tool_a / tool_b / foo / test_tool / tool_<n>) from a usage profile without
 * touching real tool stats. Dry-run by default; --apply rewrites atomically.
 */
import { describe, test, expect, beforeEach, afterAll } from "@jest/globals";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "clean-profile-residue.mjs");
const SCRATCH = mkdtempSync(join(tmpdir(), "airmcp-clean-profile-"));
const PROFILE = join(SCRATCH, "profile.json");

const CONTAMINATED = {
  version: 1,
  frequency: {
    create_note: 42,
    tool_session_status: 3, // real tool that must survive the tool_* pattern
    tool_a: 6,
    tool_b: 3,
    foo: 1,
    test_tool: 1,
  },
  sequences: {
    "create_note → list_notes": 7,
    "tool_a → tool_b": 5,
    "tool_b → today_events": 1,
  },
  hourly: {
    create_note: new Array(24).fill(1),
    tool_a: new Array(24).fill(0),
  },
  updatedAt: "2026-08-03T00:00:00.000Z",
};

beforeEach(() => {
  writeFileSync(PROFILE, JSON.stringify(CONTAMINATED, null, 2), "utf-8");
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("clean-profile-residue script", () => {
  test("dry run reports residue but leaves the file untouched", async () => {
    const { stdout } = await run(process.execPath, [SCRIPT, PROFILE]);
    expect(stdout).toContain("dry run");
    expect(stdout).toContain("tool_a");
    expect(JSON.parse(readFileSync(PROFILE, "utf-8"))).toEqual(CONTAMINATED);
  });

  test("--apply removes residue from every section and keeps real tools", async () => {
    await run(process.execPath, [SCRIPT, PROFILE, "--apply"]);
    const cleaned = JSON.parse(readFileSync(PROFILE, "utf-8"));

    expect(cleaned.frequency).toEqual({ create_note: 42, tool_session_status: 3 });
    expect(cleaned.sequences).toEqual({ "create_note → list_notes": 7 });
    expect(Object.keys(cleaned.hourly)).toEqual(["create_note"]);
    expect(cleaned.updatedAt).toBe(CONTAMINATED.updatedAt);
  });

  test("a clean profile is a no-op exit 0", async () => {
    await run(process.execPath, [SCRIPT, PROFILE, "--apply"]);
    const { stdout } = await run(process.execPath, [SCRIPT, PROFILE, "--apply"]);
    expect(stdout).toContain("no test residue");
  });
});
