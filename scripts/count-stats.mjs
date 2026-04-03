#!/usr/bin/env node
/**
 * count-stats.mjs — Single source of truth for tool/module/prompt/resource counts.
 *
 * Counts are derived from source code, then propagated to all documentation.
 *
 * Usage:
 *   node scripts/count-stats.mjs          # print current counts
 *   node scripts/count-stats.mjs --check  # verify docs match source (CI)
 *   node scripts/count-stats.mjs --sync   # update all docs to match source
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const mode = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--sync")
    ? "sync"
    : "print";

// ── Count from source ──────────────────────────────────────────────

function countInDir(dir, pattern) {
  let count = 0;
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(full, "utf-8");
        const matches = content.match(pattern);
        if (matches) count += matches.length;
      }
    }
  }
  walk(dir);
  return count;
}

const tools = countInDir(SRC, /server\.registerTool\(/g);
const prompts = countInDir(SRC, /server\.prompt\(/g);

const resContent = readFileSync(join(SRC, "shared", "resources.ts"), "utf-8");
const resLines = resContent.split("\n");
let resources = 0;
let inRegisterFn = false;
for (const line of resLines) {
  if (/^export function registerResources/.test(line)) inRegisterFn = true;
  if (inRegisterFn) {
    if (/jsonResource\(server,/.test(line)) resources++;
    else if (/server\.registerResource\(/.test(line)) resources++;
  }
}

const configContent = readFileSync(join(SRC, "shared", "config.ts"), "utf-8");
const moduleBlock = configContent.match(
  /export const MODULE_NAMES = \[([\s\S]*?)\] as const/,
);
const modules = moduleBlock
  ? (moduleBlock[1].match(/"/g) || []).length / 2
  : 0;

const stats = { tools, prompts, resources, modules };

// ── Print mode ─────────────────────────────────────────────────────

if (mode === "print") {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

// ── Shared helpers for check & sync ────────────────────────────────

let dirty = false;

/**
 * Apply numeric replacements to a file.
 *  - check mode: report mismatches
 *  - sync mode: rewrite file with correct values
 *
 * Each replacement: { pattern: RegExp with capture group, value: number }
 * The pattern MUST have exactly one capture group around the number to replace.
 */
function syncFile(relPath, replacements) {
  const absPath = join(ROOT, relPath);
  if (!existsSync(absPath)) return;

  let content = readFileSync(absPath, "utf-8");
  let changed = false;

  for (const { pattern, value, group } of replacements) {
    const numGroup = group ?? 1; // which capture group holds the number
    const updated = content.replace(pattern, (...args) => {
      const match = args[0];
      const num = args[numGroup];
      const current = parseInt(num);
      if (current !== value) {
        changed = true;
        return match.replace(num, String(value));
      }
      return match;
    });
    content = updated;
  }

  if (changed) {
    if (mode === "check") {
      console.error(`  STALE: ${relPath}`);
      dirty = true;
    } else {
      writeFileSync(absPath, content);
      console.log(`  sync: ${relPath}`);
    }
  } else if (mode === "check" || mode === "sync") {
    console.log(`  ok:   ${relPath}`);
  }
}

/**
 * Sync locale JSON files. Each locale uses different words for "modules",
 * so we match the number preceding any known module-word.
 */
function syncLocales() {
  const localeDir = join(ROOT, "docs", "locales");
  if (!existsSync(localeDir)) return;

  const moduleWords =
    /(\d+)([\s\u00a0]*(?:modules?|개 모듈|モジュール|个模块|個模組|Modulen|módulos))/g;

  for (const f of readdirSync(localeDir).filter((f) => f.endsWith(".json"))) {
    const absPath = join(localeDir, f);
    let content = readFileSync(absPath, "utf-8");
    let changed = false;

    const updated = content.replace(moduleWords, (match, num, rest) => {
      const current = parseInt(num);
      if (current !== modules) {
        changed = true;
        return `${modules}${rest}`;
      }
      return match;
    });
    content = updated;

    if (changed) {
      if (mode === "check") {
        console.error(`  STALE: docs/locales/${f}`);
        dirty = true;
      } else {
        writeFileSync(absPath, content);
        console.log(`  sync: docs/locales/${f}`);
      }
    } else {
      console.log(`  ok:   docs/locales/${f}`);
    }
  }
}

// ── Run ────────────────────────────────────────────────────────────

console.log(
  `\nStats ${mode}: ${tools} tools, ${prompts} prompts, ${resources} resources, ${modules} modules\n`,
);

// README.md — "**N tools** (N modules)"
syncFile("README.md", [
  { pattern: /\*\*(\d+) tools\*\*/, value: tools },
  { pattern: /(\d+) modules\)/g, value: modules },
  { pattern: /(\d+) Apple apps/g, value: modules },
]);

// AGENTS.md
syncFile(".github/AGENTS.md", [
  { pattern: /\*\*(\d+) tools\*\*/, value: tools },
  { pattern: /(\d+) modules/, value: modules },
  { pattern: /\*\*(\d+) prompts\*\*/, value: prompts },
  { pattern: /\*\*(\d+) [\w-]*resources\*\*/, value: resources },
]);

// Docs site pages
const docsPages = [
  "docs/site/src/content/docs/modules/overview.md",
  "docs/site/src/content/docs/architecture/overview.md",
  "docs/site/src/content/docs/getting-started/installation.md",
  "docs/site/src/content/docs/getting-started/configuration.md",
  "docs/site/src/content/docs/contributing/testing.md",
];
for (const page of docsPages) {
  syncFile(page, [{ pattern: /(\d+) modules/g, value: modules }]);
}

// Other docs
syncFile("docs/skills.md", [
  { pattern: /(\d+) tools/g, value: tools },
  { pattern: /(\d+) modules/g, value: modules },
]);
syncFile("docs/TERMS_OF_SERVICE.md", [
  { pattern: /(\d+) tools/g, value: tools },
  { pattern: /(\d+) modules/g, value: modules },
]);

// Landing page — only match aggregate counts in meta tags, hero subtitle, and footer.
// Per-module "N tools" badges have their own specific counts and must not be touched.
syncFile("docs/index.html", [
  { pattern: /with (\d+) tools across/g, value: tools },
  { pattern: /across (\d+) modules/g, value: modules },
  { pattern: /(hero_sub">)(\d+)( tools)/g, value: tools, group: 2 },
  { pattern: /(tryit_footer">)(\d+)( tools)/g, value: tools, group: 2 },
]);

// Registry metadata files (mcp.json, glama.json, smithery.yaml)
const registryPattern = [
  { pattern: /(\d+) tools across/g, value: tools },
  { pattern: /across (\d+) modules/g, value: modules },
];
syncFile("mcp.json", registryPattern);
syncFile("glama.json", registryPattern);
syncFile("smithery.yaml", registryPattern);

// Locale files
syncLocales();

console.log("");

if (mode === "check" && dirty) {
  console.error(
    "Stats mismatch detected. Run: node scripts/count-stats.mjs --sync",
  );
  process.exit(1);
}

if (mode === "sync" && !dirty) {
  console.log("All files already in sync.");
}
