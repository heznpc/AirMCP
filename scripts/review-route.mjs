#!/usr/bin/env node
/**
 * review-route.mjs — make /code-review stratified by construction (RFC 0013).
 *
 * A flat diff-scan over 29 modules / 272 tools dilutes attention and misses the
 * silent-systemic defects (audit-seal / HITL-bypass / OAuth / rate-limit) that
 * actually matter. This script is the EXECUTABLE form of RFC 0013: it takes a
 * diff, classifies every changed file into a risk tier, and emits the exact
 * failure modes to hunt + the contract tests that must stay green — so review
 * effort is ROUTED to blast radius instead of spread evenly.
 *
 * It is not another doc. It runs.
 *
 * Usage:
 *   node scripts/review-route.mjs                 # route the diff vs origin/main
 *   node scripts/review-route.mjs --base <ref>    # route the diff vs <ref>
 *   node scripts/review-route.mjs --audit         # full T0 deep-audit plan (RFC 0013 §5 cadence)
 *   node scripts/review-route.mjs --json          # machine-readable (drives /review + CI)
 *   node scripts/review-route.mjs --check         # CI: print plan; warn on T0 touched w/o its guard test
 *   node scripts/review-route.mjs --check --strict# CI: exit 1 on a T0 change with no guard-test change
 *
 * The tier lists + failure-mode catalog below are the source of truth that
 * RFC 0013 §1/§2 describe in prose. Keep them in sync — when you add a T0
 * invariant, add its row here AND its behaviour test.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Failure-mode catalog (RFC 0013 §2): area → what to hunt + guarding tests ──
// `files` are exact repo-relative paths or path prefixes that belong to the area.
const CATALOG = [
  {
    area: "audit-chain",
    tier: 0,
    files: ["src/shared/audit.ts"],
    hunt: "seal/_prev mismatch, rotation re-anchor, genesis, tamper not detected",
    tests: ["audit-tamper-detection", "audit-genesis-check", "audit-rotation-resume", "audit-recovery"],
  },
  {
    area: "hitl-gate",
    tier: 0,
    files: ["src/shared/hitl.ts", "src/shared/hitl-guard.ts", "src/shared/share-guard.ts"],
    hunt: "per-call bypass, batched 'next N calls' regression, deny-on-unreachable",
    tests: ["hitl-client", "hitl-guard", "skills-hitl-queue"],
  },
  {
    area: "rate-limit",
    tier: 0,
    files: ["src/shared/rate-limit.ts"],
    hunt: "off-by-one, reset-window drift, counter race",
    tests: ["rate-limit"],
  },
  {
    area: "oauth",
    tier: 0,
    files: ["src/server/oauth-verifier.ts", "src/shared/oauth-scope.ts", "src/server/well-known-card.ts"],
    hunt: "alg confusion (alg=none/HS), scope-gate bypass, RFC 8707 audience, RFC 9728 PRM",
    tests: ["oauth-verifier", "oauth-scope", "well-known-card"],
  },
  {
    area: "network-transport",
    tier: 0,
    files: ["src/server/http-transport.ts", "src/server/init.ts", "src/server/mcp-setup.ts", "src/server/shutdown.ts"],
    hunt: "SSRF, allowlist bypass, Origin 403, bind-all-without-token, boot-order invariants",
    tests: ["http-transport"],
  },
  {
    area: "tool-registry",
    tier: 0,
    files: ["src/shared/tool-registry.ts", "src/shared/registry.ts", "src/shared/tool-filter.ts"],
    hunt: "wrapper not forwarding, re-entry/recursion, scope-gate not applied",
    tests: ["tool-registry", "tool-registry-scope-gate"],
  },
  {
    area: "jxa-escaping",
    tier: 0,
    files: ["src/shared/esc.ts", "src/shared/jxa.ts", "src/shared/swift.ts"],
    hunt: "injection via esc/escShell/escJxaShell, prototype-pollution in the Swift JSON reviver",
    tests: ["esc", "jxa", "jxa-scripts-ast"],
  },
  {
    area: "result-validators",
    tier: 0,
    files: ["src/shared/result.ts", "src/shared/validate.ts", "src/shared/mcp.ts"],
    hunt: "declared outputSchema with no matching runtime structuredContent → SDK validation error in prod",
    tests: ["output-schema-structured", "script-shape-contract"],
  },
  {
    area: "circuit-breaker",
    tier: 0,
    files: ["src/shared/circuit-breaker.ts"],
    hunt: "HALF_OPEN probe race, state-transition gaps, never-resets",
    tests: ["circuit-breaker"],
  },
  {
    area: "logger-stdout-discipline",
    tier: 0,
    files: ["src/shared/logger.ts", "src/shared/banner.ts"],
    hunt: "stdout pollution on the stdio transport (must be stderr); ANSI on a pipe",
    tests: ["logger"],
  },
  {
    area: "codegen-contract",
    tier: 0,
    files: ["scripts/gen-swift-intents.mjs", "scripts/dump-tool-manifest.mjs"],
    hunt: "manifest ↔ AppIntents ↔ README drift; destructive-confirmation body; eligible-set selection",
    tests: ["codegen-destructive-dialog", "codegen-helpers", "tool-count-drift"],
  },
  {
    area: "agent-controls-the-mac",
    tier: 1,
    files: ["src/system/", "src/ui/", "src/finder/", "src/shortcuts/"],
    hunt: "missing HITL on a destructive action, absent destructiveHint annotation, scope-gate gap, rate-limit tier (RFC 0014 §4.5)",
    tests: ["output-schema-wave1", "output-schema-wave2"],
  },
];

// ── Tier classification (RFC 0013 §1) ──
// Returns { tier, label, depth, area? } for a repo-relative path.
function classify(file) {
  // T3 — generated / vendored: review the generator, not the output.
  if (
    file.includes("/Generated/") ||
    file.startsWith("dist/") ||
    file === "package-lock.json" ||
    file.startsWith("docs/llms") ||
    file === "docs/tool-manifest.json"
  ) {
    return { tier: 3, label: "T3 generated/vendored", depth: "review the generator + the drift guard, never the output" };
  }

  // T0 / T1 — by catalog membership (exact file or path-prefix).
  for (const row of CATALOG) {
    for (const f of row.files) {
      const isPrefix = f.endsWith("/");
      if (isPrefix ? file.startsWith(f) : file === f) {
        return {
          tier: row.tier,
          label: row.tier === 0 ? "T0 critical infra" : "T1 high-blast surface",
          depth: row.tier === 0 ? "MAX — adversarial, per failure mode below" : "HIGH — governance + the failure mode below",
          area: row.area,
        };
      }
    }
  }

  // T2 — JXA-thin tool modules (any other src/<module>/ source).
  if (file.startsWith("src/") && file.endsWith(".ts")) {
    return { tier: 2, label: "T2 JXA-thin module", depth: "LIGHT — escaping + result-shape + contract test still green" };
  }

  // Everything else (docs, workflows, config) — context, not risk-routed.
  return { tier: 9, label: "— non-code", depth: "context only" };
}

// ── Inputs ──
const argv = process.argv.slice(2);
const mode = argv.includes("--audit") ? "audit" : argv.includes("--check") ? "check" : "route";
const asJson = argv.includes("--json");
const strict = argv.includes("--strict");
const baseIdx = argv.indexOf("--base");
const base = baseIdx >= 0 ? argv[baseIdx + 1] : "origin/main";

function changedFiles() {
  // execFileSync (no shell) — `base` comes from argv, so never interpolate it
  // into a shell string. The repo's own rule: don't build shell/JXA strings
  // from outside input. A review-routing tool must follow it.
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // No base ref (shallow clone / detached) — fall back to staged + unstaged.
    const out = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

function testTouched(testStem) {
  // Is the guarding test in the diff? (heuristic for "did you re-verify the contract")
  return changed.some((f) => f === `tests/${testStem}.test.js`);
}

// ── AUDIT mode: the full T0 deep-audit plan, regardless of diff (RFC 0013 §5) ──
if (mode === "audit") {
  const t0 = CATALOG.filter((r) => r.tier === 0);
  if (asJson) {
    console.log(JSON.stringify({ mode: "audit", areas: t0 }, null, 2));
    process.exit(0);
  }
  console.log("RFC 0013 §5 — T0 deep audit (re-read these top to bottom against the catalog):\n");
  for (const r of t0) {
    const present = r.files.filter((f) => existsSync(join(ROOT, f)));
    console.log(`■ ${r.area}`);
    console.log(`  files: ${present.join(", ")}`);
    console.log(`  hunt:  ${r.hunt}`);
    console.log(`  guard: ${r.tests.map((t) => `tests/${t}.test.js`).join(", ")}\n`);
  }
  process.exit(0);
}

// ── ROUTE / CHECK mode: classify the diff ──
const changed = changedFiles();
const routed = changed.map((file) => ({ file, ...classify(file) }));
const byTier = (t) => routed.filter((r) => r.tier === t);
const touchedAreas = [...new Set(routed.map((r) => r.area).filter(Boolean))];
const catalogFor = (area) => CATALOG.find((r) => r.area === area);

// Teeth: a T0 area changed but its guard test did not (RFC 0013 §4).
const unguarded = touchedAreas
  .map(catalogFor)
  .filter((r) => r && r.tier === 0)
  .filter((r) => !r.tests.some(testTouched));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        base,
        changed: routed,
        highestTier: Math.min(...routed.map((r) => r.tier), 9),
        touchedAreas: touchedAreas.map((a) => catalogFor(a)),
        unguardedT0: unguarded.map((r) => r.area),
      },
      null,
      2,
    ),
  );
  process.exit(strict && unguarded.length ? 1 : 0);
}

if (!changed.length) {
  console.log(`No changes vs ${base}. (Use --audit for the periodic T0 deep audit.)`);
  process.exit(0);
}

console.log(`Review plan — ${changed.length} file(s) vs ${base}\n`);

const TIER_ORDER = [0, 1, 2, 3, 9];
const TIER_NAME = {
  0: "T0 — CRITICAL INFRA (silent, systemic — review at MAX depth)",
  1: "T1 — HIGH-BLAST SURFACE (agent drives the Mac — review at HIGH depth)",
  2: "T2 — JXA-THIN MODULES (fails loud — light review, lean on contract tests)",
  3: "T3 — GENERATED/VENDORED (review the generator, not the output)",
  9: "— NON-CODE (context only)",
};

for (const t of TIER_ORDER) {
  const rows = byTier(t);
  if (!rows.length) continue;
  console.log(`${TIER_NAME[t]}`);
  for (const r of rows) console.log(`  • ${r.file}${r.area ? `  [${r.area}]` : ""}`);
  console.log("");
}

// For each touched T0/T1 area, print the exact failure modes + guard tests.
const hot = touchedAreas.map(catalogFor).filter(Boolean).sort((a, b) => a.tier - b.tier);
if (hot.length) {
  console.log("Hunt these (do not run a generic scan):");
  for (const r of hot) {
    console.log(`  ■ T${r.tier} ${r.area}`);
    console.log(`    hunt:  ${r.hunt}`);
    console.log(`    guard: ${r.tests.map((t) => `tests/${t}.test.js`).join(", ")} (must be green)`);
  }
  console.log("");
}

if (unguarded.length) {
  console.log("⚠ T0 changed WITHOUT touching its guard test — confirm the invariant is still covered:");
  for (const r of unguarded) {
    console.log(`  • ${r.area} → expected one of ${r.tests.map((t) => `tests/${t}.test.js`).join(", ")}`);
  }
  console.log("");
  if (mode === "check" && strict) {
    console.error("review-route: --strict and a T0 area changed with no guard-test change. Failing.");
    process.exit(1);
  }
}

const highest = Math.min(...routed.map((r) => r.tier), 9);
if (highest <= 1) {
  console.log(`→ Highest tier touched: T${highest}. Run /code-review at T${highest} depth with the hunt list above.`);
} else {
  console.log(`→ Highest tier touched: T${highest}. Light review sufficient; ensure contract tests pass.`);
}
process.exit(0);
