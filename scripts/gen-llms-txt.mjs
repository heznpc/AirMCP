#!/usr/bin/env node
/**
 * gen-llms-txt.mjs — Generate llms.txt and llms-full.txt from source.
 *
 * Usage: node scripts/gen-llms-txt.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/**
 * Canonical module list parsed from `src/shared/config.ts`'s
 * `MODULE_NAMES` const. Read at script start so the module count stays
 * aligned with `count-stats.mjs` (which counts the same array). Without
 * this we used to show "32 modules" — `walkDir` happily groups every
 * dir under src/ that has a `registerTool` call, including
 * cross/semantic/audit/server which aren't user-visible "modules" in
 * the config sense. The strict module list is what registry submissions
 * + README counts already use.
 */
const CANONICAL_MODULE_COUNT = (() => {
  try {
    const config = readFileSync(join(SRC, "shared", "config.ts"), "utf-8");
    const m = config.match(/export const MODULE_NAMES = \[([\s\S]*?)\] as const;/);
    if (!m) return null;
    return (m[1].match(/"([^"]+)"/g) || []).length;
  } catch {
    return null;
  }
})();

// Extract tool registrations from a file
function extractTools(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const tools = [];
  // Match tool name and title (robust: handles multi-line descriptions)
  const re = /server\.registerTool\(\s*\n?\s*"([^"]+)",\s*\n?\s*\{[\s\S]*?title:\s*"([^"]+)",[\s\S]*?description:\s*(?:"([^"]*)"|\s*\n\s*"([^"]*)")/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    tools.push({ name: m[1], title: m[2], description: m[3] || m[4] || "" });
  }
  // Fallback: count any missed registrations
  const allNames = [...content.matchAll(/server\.registerTool\(\s*\n?\s*"([^"]+)"/g)].map(m => m[1]);
  for (const name of allNames) {
    if (!tools.find(t => t.name === name)) {
      tools.push({ name, title: name.replace(/_/g, " "), description: "" });
    }
  }
  return tools;
}

// Extract prompt registrations
function extractPrompts(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const prompts = [];
  const re = /server\.prompt\(\s*\n?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    prompts.push({ name: m[1], description: "" });
  }
  return prompts;
}

// Module display names
const MODULE_NAMES = {
  notes: "Notes", reminders: "Reminders", calendar: "Calendar",
  contacts: "Contacts", mail: "Mail", messages: "Messages",
  music: "Music", finder: "Finder", safari: "Safari",
  system: "System", photos: "Photos", shortcuts: "Shortcuts",
  intelligence: "Apple Intelligence", tv: "TV", ui: "UI Automation",
  screen: "Screen Capture", maps: "Maps", podcasts: "Podcasts",
  weather: "Weather", pages: "Pages", numbers: "Numbers",
  keynote: "Keynote", location: "Location", bluetooth: "Bluetooth",
  google: "Google Workspace", semantic: "Semantic Search",
  cross: "Cross-Module", apps: "App Management", shared: "Setup",
};

// Collect all tools by module
const modules = {};
// Authoritative counts use the same regex `count-stats.mjs` does. The
// per-module list (built by `extractTools`) uses a stricter regex that
// requires title + description to be co-located so we can render the
// detailed per-tool entries in `llms-full.txt`. Drift between the two
// (a tool whose registration spans the strict regex boundary so only
// the broad regex catches it) used to push the headline numbers below
// the canonical count — fixed by deriving totals from the broad pass
// and treating `extractTools`'s output as a presentation projection.
const TOOL_REGEX = /server\.registerTool\(/g;
const PROMPT_REGEX = /server\.prompt\(/g;
let totalTools = 0;
let totalPrompts = 0;
function walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith(".ts")) {
      const modDir = basename(dirname(full));
      const content = readFileSync(full, "utf-8");
      totalTools += (content.match(TOOL_REGEX) || []).length;
      totalPrompts += (content.match(PROMPT_REGEX) || []).length;
      const tools = extractTools(full);
      if (tools.length > 0) {
        const key = modDir === "src" ? "core" : modDir;
        modules[key] = modules[key] || { tools: [], prompts: [] };
        modules[key].tools.push(...tools);
      }
      const prompts = extractPrompts(full);
      if (prompts.length > 0) {
        const key = modDir === "src" ? "core" : modDir;
        modules[key] = modules[key] || { tools: [], prompts: [] };
        modules[key].prompts.push(...prompts);
      }
    }
  }
}
walkDir(SRC);

// Generate llms.txt (summary)
const REPO = "https://github.com/heznpc/AirMCP";
const moduleCount = CANONICAL_MODULE_COUNT ?? Object.keys(modules).length;
let llmsTxt = `# AirMCP

> MCP server for the entire Apple ecosystem. ${totalTools} tools across ${moduleCount} modules.

## Links

- [Source Code](${REPO})
- [npm Package](https://www.npmjs.com/package/airmcp)
- [Full Tool Reference](${REPO}/blob/main/llms-full.txt)
- [Contributing Guide](${REPO}/blob/main/CONTRIBUTING.md)
- [Security Policy](${REPO}/blob/main/SECURITY.md)

## Modules

`;

for (const [key, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
  const name = MODULE_NAMES[key] || key;
  llmsTxt += `- **${name}** (${mod.tools.length} tools): ${mod.tools.map(t => t.name).join(", ")}\n`;
}

// Generate llms-full.txt (complete reference)
let fullTxt = `# AirMCP — Full Tool Reference

> ${totalTools} tools, ${totalPrompts} prompts across ${moduleCount} modules.
> Auto-generated from source by scripts/gen-llms-txt.mjs

`;

for (const [key, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
  const name = MODULE_NAMES[key] || key;
  if (mod.tools.length > 0) {
    fullTxt += `## ${name}\n\n`;
    for (const tool of mod.tools) {
      fullTxt += `### ${tool.name}\n\n${tool.description}\n\n`;
    }
  }
  if (mod.prompts.length > 0) {
    fullTxt += `### Prompts\n\n`;
    for (const prompt of mod.prompts) {
      fullTxt += `- **${prompt.name}**: ${prompt.description}\n`;
    }
    fullTxt += "\n";
  }
}

const llmsPath = join(ROOT, "llms.txt");
const llmsFullPath = join(ROOT, "llms-full.txt");
const checkMode = process.argv.includes("--check");

if (checkMode) {
  // Drift guard: regenerate llms.txt in-memory and diff against checked-in
  // file. CI runs this so any tool/prompt/module addition without
  // `npm run llms` fails the build instead of silently shipping a stale
  // catalog (the long-standing "258 tools / 30 modules" drift bug that
  // survived multiple releases). llms-full.txt is `.gitignore`d
  // (oversize for review diffs) so we skip it in check mode and only
  // pin the public-facing llms.txt summary.
  let existing = "";
  try {
    existing = readFileSync(llmsPath, "utf-8");
  } catch {
    console.error(`[gen-llms --check] ${llmsPath} missing — run \`npm run llms\``);
    process.exit(1);
  }
  if (existing !== llmsTxt) {
    console.error(`[gen-llms --check] STALE: ${llmsPath} — run \`npm run llms\``);
    process.exit(1);
  }
  console.log(
    `[gen-llms --check] OK — ${totalTools} tools / ${totalPrompts} prompts / ${moduleCount} modules`,
  );
} else {
  writeFileSync(llmsPath, llmsTxt);
  writeFileSync(llmsFullPath, fullTxt);
  console.log(`Generated llms.txt (${llmsTxt.length} bytes) and llms-full.txt (${fullTxt.length} bytes)`);
  console.log(`${totalTools} tools, ${totalPrompts} prompts across ${moduleCount} modules`);
}
