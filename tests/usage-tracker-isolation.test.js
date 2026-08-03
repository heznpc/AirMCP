/**
 * UsageTracker test-mode disk isolation (defense in depth).
 *
 * Real incident: fixture tool names (tool_a / tool_b / foo / test_tool)
 * leaked into a real user's ~/.airmcp/profile.json frequency/hourly stats and
 * then persisted forever through the tracker's merge-on-load cycle. The
 * jest-level fake HOME (tests/helpers/isolate-home.cjs) already guards jest
 * workers, but harness gates booted with AIRMCP_TEST_MODE=1 inherit the REAL
 * HOME — so the tracker itself must refuse to touch the resolved profile path
 * whenever it runs in test mode WITHOUT an explicit
 * AIRMCP_USAGE_PROFILE_PATH override.
 *
 * This suite deliberately does NOT set AIRMCP_USAGE_PROFILE_PATH (unlike
 * usage-tracker.test.js, which covers the persistence-enabled branch).
 */
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// Must be unset BEFORE import — the guard is captured at module load, same as
// PATHS. NODE_ENV=test is set by jest itself.
delete process.env.AIRMCP_USAGE_PROFILE_PATH;

const { usageTracker } = await import("../dist/shared/usage-tracker.js");
const { PATHS } = await import("../dist/shared/constants.js");

// A stand-in for the developer's real profile at the resolved default path
// (inside the suite's fake HOME, so this file is disposable either way).
const PRE_EXISTING = JSON.stringify(
  {
    version: 1,
    frequency: { create_note: 42 },
    sequences: { "create_note → list_notes": 7 },
    hourly: { create_note: new Array(24).fill(0) },
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  null,
  2,
);

beforeAll(() => {
  mkdirSync(dirname(PATHS.USAGE_PROFILE), { recursive: true });
  writeFileSync(PATHS.USAGE_PROFILE, PRE_EXISTING, "utf-8");
  usageTracker._resetForTests();
});

afterAll(() => {
  usageTracker.stop();
});

describe("UsageTracker — test-mode isolation without explicit profile path", () => {
  test("record + flush + flushSync never rewrite the default profile path", async () => {
    usageTracker.record("tool_a");
    usageTracker.record("tool_b");
    await usageTracker.flush();
    usageTracker.flushSync();

    expect(readFileSync(PATHS.USAGE_PROFILE, "utf-8")).toBe(PRE_EXISTING);
  });

  test("the pre-existing profile is not merged into test-mode memory", () => {
    // Only this session's records are visible — the 42 create_note calls from
    // the on-disk profile must NOT leak into stats.
    const stats = usageTracker.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.topTools.find((t) => t.tool === "create_note")).toBeUndefined();
  });
});
