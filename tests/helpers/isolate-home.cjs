/**
 * Force every jest suite into a disposable HOME.
 *
 * Several modules derive state paths (~/.airmcp audit chain, ~/.config/airmcp
 * config, ~/.cache/airmcp memory store) from HOME at import time. A suite that
 * forgets to override those paths — or an async audit flush that outlives its
 * test — must land in a throwaway directory, never in the developer's real
 * home. This closed two real incidents: a suite sealing rows into the real
 * ~/.airmcp HMAC chain (intermittent exit-1 across unrelated runs) and a suite
 * writing a prompt-injection fixture into the real ~/.cache/airmcp/memory.json.
 *
 * Runs via jest `setupFiles`, i.e. in every worker before any test module is
 * imported, so import-time path constants pick up the fake HOME. Suites that
 * need finer isolation still set AIRMCP_VECTOR_STORE_DIR etc. themselves.
 * Escape hatch: AIRMCP_TEST_REAL_HOME=1 (deliberate, never set in CI).
 */
"use strict";

const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

if (process.env.AIRMCP_TEST_REAL_HOME !== "1") {
  const fakeHome = mkdtempSync(join(tmpdir(), "airmcp-test-home-"));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
}
