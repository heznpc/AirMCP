#!/usr/bin/env node
/**
 * print-compat-report — RFC 0004 module compatibility report.
 *
 * Renders the current module manifest × the current host environment
 * (`getCompatibilityEnv()`) through `resolveModuleCompatibility()` and prints
 * a human-readable classification. Useful when triaging user bug reports
 * ("which modules actually register on your Mac?") or validating that a
 * manifest change behaves as expected before rolling out.
 *
 * Usage:
 *   node scripts/print-compat-report.mjs            # text table, default
 *   node scripts/print-compat-report.mjs --json     # machine-readable JSON
 *   node scripts/print-compat-report.mjs --env=…    # override env (debug)
 *
 * Exit codes:
 *   0 — all modules classify (even "skip-*" counts as a clean classification).
 *   1 — resolver threw / unexpected error.
 *
 * Purity:
 *   The resolver itself is side-effect-free; this script only reads env
 *   (via getCompatibilityEnv) and prints to stdout.
 */
import { MODULE_MANIFEST } from "../dist/shared/modules.js";
import { resolveModuleCompatibility, summarizeCompatibility } from "../dist/shared/compatibility.js";
import { getCompatibilityEnv } from "../dist/shared/config.js";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const showHelp = args.includes("--help") || args.includes("-h");

if (showHelp) {
  console.log(`print-compat-report — RFC 0004 module compatibility report

Usage:
  node scripts/print-compat-report.mjs [--json] [--help]

Options:
  --json   Emit a JSON object { env, summary, decisions } for programmatic consumers.
  --help   Show this message and exit.

Without flags, renders a plain-text table grouped by decision.`);
  process.exit(0);
}

function main() {
  const env = getCompatibilityEnv();
  const decisions = MODULE_MANIFEST.map((m) => ({
    name: m.name,
    compatibility: m.compatibility ?? null,
    decision: resolveModuleCompatibility(m.name, m.compatibility, env),
  }));
  const summary = summarizeCompatibility(
    MODULE_MANIFEST.map((m) => ({ name: m.name, compatibility: m.compatibility })),
    env,
  );

  if (jsonOutput) {
    const out = {
      env,
      summary,
      decisions: decisions.map((d) => ({
        name: d.name,
        decision: d.decision.decision,
        reason: d.decision.reason ?? null,
        compatibility: d.compatibility,
      })),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  const envLine = `macOS ${env.osVersion === 0 ? "(non-darwin)" : env.osVersion}   arch=${env.cpu}   healthkit=${env.healthkitAvailable ? "yes" : "no"}`;
  console.log(`AirMCP compatibility report — ${envLine}`);
  console.log("─".repeat(72));

  const groups = [
    ["register", "✔ register", summary.register.map((n) => ({ name: n, reason: "" }))],
    ["deprecated", "⚠ register-with-deprecation", summary.deprecated],
    ["skip-unsupported", "↷ skip-unsupported", summary.unsupported],
    ["skip-broken", "✖ skip-broken", summary.broken],
  ];

  for (const [, label, list] of groups) {
    if (list.length === 0) continue;
    console.log(`\n${label}  (${list.length})`);
    for (const { name, reason } of list) {
      const pad = name.padEnd(18);
      console.log(reason ? `  ${pad}  ${reason}` : `  ${pad}`);
    }
  }

  console.log("\n" + "─".repeat(72));
  console.log(
    `Total ${MODULE_MANIFEST.length}   register ${summary.register.length}   deprecated ${summary.deprecated.length}   unsupported ${summary.unsupported.length}   broken ${summary.broken.length}`,
  );
}

try {
  main();
} catch (err) {
  console.error(`[print-compat-report] Failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
}
