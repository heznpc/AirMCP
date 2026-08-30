/**
 * cleanBootEnv — state isolation contract for test-spawned real servers.
 *
 * cleanBootEnv() is the shared child env for every harness that boots the
 * REAL server binary (smoke/validate gates, cli-connect, codex/connect-clients
 * CLI tests). Those children inherit the real HOME, so every stateful default
 * path must be explicitly redirected or the suite leaks into developer state:
 *   - ~/.airmcp/profile.json (usage stats) — leaked until 2.16.4, now gated
 *     by AIRMCP_USAGE_TRACKING=false;
 *   - ~/.airmcp/audit.jsonl (HMAC-chained audit log) — leaked until this
 *     test's redirect existed: cli-connect asserts a deliberate 401 against a
 *     spawned server, and each full-suite run appended one __auth_failure row
 *     to the real audit chain, indistinguishable from a production incident
 *     (2026-08: 13 loopback 401s were chased as an unattributable prober
 *     before being traced here).
 *
 * If a new stateful default path is added under PATHS.*, it belongs in
 * cleanBootEnv and in these assertions.
 */
import { describe, test, expect } from "@jest/globals";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanBootEnv } from "../scripts/lib/clean-boot-env.mjs";

describe("cleanBootEnv state isolation", () => {
  test("strips inherited AIRMCP_* and locks the default-surface contract", () => {
    const env = cleanBootEnv({
      HOME: homedir(),
      AIRMCP_FULL: "true",
      AIRMCP_VECTOR_STORE_DIR: join(homedir(), ".airmcp"),
      AIRMCP_HTTP_TOKEN: "leaked",
    });
    expect(env.AIRMCP_FULL).toBeUndefined();
    expect(env.AIRMCP_HTTP_TOKEN).toBeUndefined();
    expect(env.AIRMCP_TEST_MODE).toBe("1");
    expect(env.AIRMCP_PROFILE).toBe("starter");
    expect(env.AIRMCP_TOOL_EXPOSURE).toBe("progressive");
    expect(env.HOME).toBe(homedir());
  });

  test("usage tracking is disabled and audit state is redirected off the real HOME", () => {
    const env = cleanBootEnv();
    expect(env.AIRMCP_USAGE_TRACKING).toBe("false");

    const stateDir = env.AIRMCP_VECTOR_STORE_DIR;
    expect(stateDir).toBeDefined();
    // The audit log (and every other PATHS.VECTOR_STORE file) must land in a
    // scratch dir, never in the developer's real ~/.airmcp.
    expect(stateDir.startsWith(tmpdir())).toBe(true);
    expect(stateDir.startsWith(join(homedir(), ".airmcp"))).toBe(false);
  });

  test("state dir is stable within a process so sibling spawns share one audit chain", () => {
    expect(cleanBootEnv().AIRMCP_VECTOR_STORE_DIR).toBe(cleanBootEnv().AIRMCP_VECTOR_STORE_DIR);
  });
});
