#!/usr/bin/env node
// Measure the LLM token cost of every tool description shipped in the
// MCP manifest, and quantify the savings produced by tool-filter.ts's
// compactDescription transform.
//
// Why this lives outside the runtime path:
//   compactDescription has been opaque since it landed — the docstring
//   on `src/shared/tool-filter.ts` claims a 46% reduction (37K → 20K
//   tokens) but there's no scripted way to re-verify after every
//   description rewrite. This script reads `docs/tool-manifest.json`
//   (already kept in sync via the dump-tool-manifest gate), applies
//   the same transform, and prints a before/after report.
//
// Token accounting:
//   We use a heuristic of 4 characters per token. Anthropic's tokenizer
//   averages ~3.3-4.0 chars/token for English prose; 4 is a safe upper
//   bound that lets us track relative changes without depending on the
//   real tokenizer (which would require either a dependency or a live
//   API call). The script prints both raw chars and estimated tokens
//   so a reader can re-cost with their own ratio if needed.
//
// Usage:
//   node scripts/measure-tool-tokens.mjs              — pretty report
//   node scripts/measure-tool-tokens.mjs --json       — machine-readable
//   node scripts/measure-tool-tokens.mjs --top 20     — top-N heaviest
//   AIRMCP_TOKEN_RATIO=3.3 node scripts/measure-tool-tokens.mjs

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(ROOT, "docs", "tool-manifest.json");
const TOKEN_RATIO = Number(process.env.AIRMCP_TOKEN_RATIO ?? 4);
const JSON_MODE = process.argv.includes("--json");
const TOP_FLAG = process.argv.indexOf("--top");
const TOP_N = TOP_FLAG !== -1 ? Number(process.argv[TOP_FLAG + 1] ?? 10) : 10;

if (!existsSync(MANIFEST)) {
  console.error(`[measure-tokens] ${MANIFEST} not found — run \`node scripts/dump-tool-manifest.mjs\` first`);
  process.exit(2);
}

// Mirror src/shared/tool-filter.ts:compactDescription — keep them in
// lockstep so the script's "after" matches what the LLM actually sees.
function compactDescription(description) {
  const match = description.match(/^(.*?[.!?])\s/);
  const firstSentence = match?.[1] ?? description;
  if (firstSentence.length > 80) {
    return firstSentence.slice(0, 77) + "...";
  }
  return /[.!?]$/.test(firstSentence) ? firstSentence : firstSentence + ".";
}

function estTokens(s) {
  return Math.ceil(s.length / TOKEN_RATIO);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
const rows = manifest.tools.map((t) => {
  const before = t.description ?? "";
  const after = compactDescription(before);
  return {
    name: t.name,
    beforeChars: before.length,
    afterChars: after.length,
    beforeTokens: estTokens(before),
    afterTokens: estTokens(after),
    savedChars: before.length - after.length,
    savedTokens: estTokens(before) - estTokens(after),
    untouched: before === after,
  };
});

const totals = rows.reduce(
  (acc, r) => {
    acc.beforeChars += r.beforeChars;
    acc.afterChars += r.afterChars;
    acc.beforeTokens += r.beforeTokens;
    acc.afterTokens += r.afterTokens;
    acc.untouched += r.untouched ? 1 : 0;
    return acc;
  },
  { beforeChars: 0, afterChars: 0, beforeTokens: 0, afterTokens: 0, untouched: 0 },
);

const reductionPct = totals.beforeTokens
  ? Math.round((1 - totals.afterTokens / totals.beforeTokens) * 1000) / 10
  : 0;

const report = {
  generatedAt: new Date().toISOString(),
  source: MANIFEST,
  tokenRatio: TOKEN_RATIO,
  toolCount: rows.length,
  untouchedCount: totals.untouched,
  totals: {
    chars: { before: totals.beforeChars, after: totals.afterChars },
    tokens: {
      before: totals.beforeTokens,
      after: totals.afterTokens,
      savedAbs: totals.beforeTokens - totals.afterTokens,
      savedPct: reductionPct,
    },
  },
  // Heaviest by description length BEFORE compaction (worst offenders).
  topHeaviest: [...rows]
    .sort((a, b) => b.beforeTokens - a.beforeTokens)
    .slice(0, TOP_N)
    .map((r) => ({
      name: r.name,
      beforeTokens: r.beforeTokens,
      afterTokens: r.afterTokens,
      savedTokens: r.savedTokens,
    })),
  // Best wins by absolute token savings.
  topSaved: [...rows]
    .sort((a, b) => b.savedTokens - a.savedTokens)
    .slice(0, TOP_N)
    .map((r) => ({
      name: r.name,
      beforeTokens: r.beforeTokens,
      afterTokens: r.afterTokens,
      savedTokens: r.savedTokens,
    })),
};

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

const fmt = (n) => n.toLocaleString("en-US");

console.log(`[measure-tokens] ${rows.length} tools, ${TOKEN_RATIO} chars/token heuristic`);
console.log("");
console.log(`  before compactDescription: ${fmt(totals.beforeChars)} chars / ~${fmt(totals.beforeTokens)} tokens`);
console.log(`  after  compactDescription: ${fmt(totals.afterChars)} chars / ~${fmt(totals.afterTokens)} tokens`);
console.log(
  `  saved:                     ${fmt(totals.beforeChars - totals.afterChars)} chars / ~${fmt(
    totals.beforeTokens - totals.afterTokens,
  )} tokens (${reductionPct}%)`,
);
console.log(`  untouched (already short): ${totals.untouched} of ${rows.length}`);
console.log("");
console.log(`Top ${TOP_N} heaviest descriptions (before):`);
for (const r of report.topHeaviest) {
  console.log(`  ${r.beforeTokens.toString().padStart(4)} → ${r.afterTokens.toString().padStart(3)}  ${r.name}`);
}
console.log("");
console.log(`Top ${TOP_N} largest absolute savings:`);
for (const r of report.topSaved) {
  console.log(
    `  -${r.savedTokens.toString().padStart(3)} tokens  ${r.name}  (${r.beforeTokens} → ${r.afterTokens})`,
  );
}
