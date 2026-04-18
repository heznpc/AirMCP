#!/usr/bin/env node
/**
 * summarize-audit — RFC 0003 Phase 1 helper.
 *
 * Runs `npm audit --json --audit-level=moderate` (non-fatal) and prints a
 * compact summary of moderate+ advisories. This is an *advisory* step: it
 * never exits non-zero. The hard gate is still the `npm audit
 * --audit-level=high` step in ci.yml. Once we've driven moderate findings
 * to zero and had stable behaviour for a release, RFC 0003 Phase 2 swaps
 * the hard threshold to `moderate` and retires this advisory.
 *
 * Output:
 *   — Total vulnerabilities by severity.
 *   — Top 5 moderate+ advisories (id, severity, package, title).
 *   — A hint whether the advisory step blocks CI today (always no).
 *
 * Behaviour:
 *   Exit code is always 0. Errors running npm audit are reported but
 *   don't fail the pipeline — we'd rather lose a step's signal than
 *   break CI on transient npm registry flakiness.
 */
import { spawnSync } from "node:child_process";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const BLOCKING_LEVEL = "high";

function main() {
  const res = spawnSync("npm", ["audit", "--json", "--audit-level=moderate"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) {
    console.log(`::warning::summarize-audit: npm audit failed to run — ${res.error.message}`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.stdout || "{}");
  } catch {
    console.log("::warning::summarize-audit: could not parse `npm audit --json` output");
    if (res.stdout) console.log(res.stdout.slice(0, 400));
    return;
  }

  // npm v7+ format: metadata.vulnerabilities is { info, low, moderate, high, critical, total }
  const counts = parsed?.metadata?.vulnerabilities ?? {};
  const total = counts.total ?? 0;
  const moderateOrAbove =
    (counts.moderate ?? 0) + (counts.high ?? 0) + (counts.critical ?? 0);

  console.log("── summarize-audit — RFC 0003 Phase 1 ──");
  console.log("Counts:");
  for (const lvl of LEVELS) {
    const n = counts[lvl] ?? 0;
    if (n > 0) console.log(`  ${lvl.padEnd(9)} ${n}`);
  }
  console.log(`  ${"total".padEnd(9)} ${total}`);
  console.log("");

  if (moderateOrAbove === 0) {
    console.log("No moderate+ advisories detected.");
    console.log("Hard gate: `npm audit --audit-level=high` (still blocking).");
    return;
  }

  const advisories = parsed?.vulnerabilities ?? {};
  const flat = [];
  for (const [name, info] of Object.entries(advisories)) {
    const severity = info?.severity ?? "unknown";
    if (!["moderate", "high", "critical"].includes(severity)) continue;
    const viaList = Array.isArray(info?.via) ? info.via : [];
    const title = viaList.find((v) => typeof v === "object" && v?.title)?.title ?? "(no title)";
    flat.push({ name, severity, title });
  }

  flat.sort((a, b) => LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity));

  console.log(`Top ${Math.min(5, flat.length)} advisories (moderate+):`);
  for (const a of flat.slice(0, 5)) {
    console.log(`  [${a.severity}] ${a.name} — ${a.title}`);
  }

  if (flat.length > 5) {
    console.log(`  …and ${flat.length - 5} more.`);
  }

  console.log("");
  console.log(`Hard gate: \`npm audit --audit-level=${BLOCKING_LEVEL}\` (still blocking).`);
  console.log("This advisory step is non-fatal. See docs/rfc/0003-npm-audit-policy.md for the upgrade plan.");
}

try {
  main();
} catch (err) {
  console.log(`::warning::summarize-audit: unexpected failure — ${err instanceof Error ? err.message : String(err)}`);
  // Always exit 0 — advisory step.
}
