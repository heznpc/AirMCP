#!/usr/bin/env node
/**
 * count-stats.mjs — Count tools, prompts, resources, modules from source.
 *
 * Usage:
 *   node scripts/count-stats.mjs          # print current counts
 *   node scripts/count-stats.mjs --check  # verify docs match source (CI)
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

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

// Count registrations
const tools = countInDir(SRC, /server\.registerTool\(/g);
const prompts = countInDir(SRC, /server\.prompt\(/g);

// Resources: count registrations inside registerResources() only (excludes helper internals)
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

// Modules from MODULE_NAMES array
const configContent = readFileSync(join(SRC, "shared", "config.ts"), "utf-8");
const moduleBlock = configContent.match(/export const MODULE_NAMES = \[([\s\S]*?)\] as const/);
const modules = moduleBlock ? (moduleBlock[1].match(/"/g) || []).length / 2 : 0;

const stats = { tools, prompts, resources, modules };

if (process.argv.includes("--check")) {
  let ok = true;

  // Check README
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  function checkFile(name, content, patterns) {
    for (const [label, pattern, expected] of patterns) {
      const m = content.match(pattern);
      const found = m ? parseInt(m[1]) : null;
      if (found !== null && found !== expected) {
        console.error(`${name}: says ${found} ${label}, source has ${expected}`);
        ok = false;
      }
    }
  }

  checkFile("README.md", readme, [
    ["tools", /\*\*(\d+) tools\*\*/, tools],
    ["modules", /\((\d+) modules\)/, modules],
  ]);

  // Check AGENTS.md
  try {
    const agents = readFileSync(join(ROOT, ".github", "AGENTS.md"), "utf-8");
    checkFile("AGENTS.md", agents, [
      ["tools", /\*\*(\d+) tools\*\*/, tools],
      ["modules", /(\d+) modules/, modules],
      ["prompts", /\*\*(\d+) prompts\*\*/, prompts],
      ["resources", /\*\*(\d+) .*resources\*\*/, resources],
    ]);
  } catch { /* optional */ }

  if (ok) {
    console.log(`Stats OK: ${tools} tools, ${prompts} prompts, ${resources} resources, ${modules} modules`);
  } else {
    console.log(`\nActual: ${JSON.stringify(stats)}`);
    process.exit(1);
  }
} else {
  console.log(JSON.stringify(stats, null, 2));
}
