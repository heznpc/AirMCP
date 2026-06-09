// Shared child-process env for the three "boot the server and read tools/list"
// gates — smoke-mcp.mjs, mcp-validate.mjs, verify-published-package.mjs — so
// they all measure the DEFAULT STARTER tool surface deterministically,
// independent of the host's ~/.config/airmcp/config.json or any exported
// AIRMCP_*.
//
// Why this is shared, not special-cased in one gate: in CI (no config.json) the
// server already applies the STARTER preset, so all three measure the same
// ~111-tool surface there. On a dev box, an existing config.json (which may
// disable modules), an exported AIRMCP_FULL, or a per-module override would make
// the SAME gate measure a different surface — and could false-fail a floor
// (smoke-mcp's MIN_TOOLS >= 100) or silently validate the wrong set. Routing all
// three through one helper gives local <-> CI parity instead of three gates that
// drift on whatever the host happens to have configured.
//
// Surgical, not a full `env -i`: strip every AIRMCP_* from the inherited env
// (drops AIRMCP_FULL, any per-module override, and an inherited
// AIRMCP_CONFIG_PATH), then re-set only the two the gates legitimately need:
//   - AIRMCP_TEST_MODE=1 — gates test-only shutdown/error paths; kept symmetric
//     across all three gates.
//   - AIRMCP_CONFIG_PATH — pointed at a guaranteed-absent file so loadConfig
//     falls through to the STARTER preset (config.ts loadFileConfig returns
//     fileExists:false on ENOENT, and parseConfig then applies STARTER).
// Non-AIRMCP env (PATH / HOME / npm_config_*) is preserved so node, npx, and the
// npm cache keep working on any runner.

import { tmpdir } from "node:os";
import { join } from "node:path";

// Parent directory deliberately does not exist, so readFileSync throws ENOENT
// (not EACCES or a parse error) and the server treats it as "no config file".
// Nothing ever writes here — it is a read-only sentinel path.
const ABSENT_CONFIG = join(tmpdir(), "airmcp-nonexistent-config-dir", "config.json");

/**
 * Build a child-process env that boots AirMCP at its DEFAULT (STARTER) surface,
 * regardless of host config.json or exported AIRMCP_*.
 *
 * @param {NodeJS.ProcessEnv} [base=process.env] - env to derive from.
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanBootEnv(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AIRMCP_")) delete env[key];
  }
  env.AIRMCP_TEST_MODE = "1";
  env.AIRMCP_CONFIG_PATH = ABSENT_CONFIG;
  return env;
}
