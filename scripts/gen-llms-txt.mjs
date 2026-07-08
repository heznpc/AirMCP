#!/usr/bin/env node
/**
 * gen-llms-txt.mjs — Generate llms.txt and llms-full.txt from source.
 *
 * Usage: node scripts/gen-llms-txt.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/**
 * Canonical module list parsed from `src/shared/modules.ts`.
 * `count-stats.mjs` uses this same manifest so opt-in modules such as
 * webhooks/powerautomate stay visible in public headline counts while
 * non-module source dirs such as semantic/shared/apps stay out.
 */
const CANONICAL_MODULE_COUNT = (() => {
  try {
    const modules = readFileSync(join(SRC, "shared", "modules.ts"), "utf-8");
    return (modules.match(/\bname:\s*"[a-z0-9_-]+"/g) || []).length;
  } catch {
    return null;
  }
})();

const OPT_IN_MODULES = (() => {
  try {
    const profiles = readFileSync(join(SRC, "shared", "profiles.ts"), "utf-8");
    const m = profiles.match(/export const OPT_IN_MODULE_NAMES = \[([\s\S]*?)\] as const;/);
    if (!m) return new Set();
    return new Set((m[1].match(/"([^"]+)"/g) || []).map((s) => JSON.parse(s)));
  } catch {
    return new Set();
  }
})();

/**
 * Headline tool count — the FULL runtime surface from the generated manifest
 * (docs/tool-manifest.json), the same single source of truth count-stats.mjs
 * uses. It includes the dynamically-registered + skill_* + MCP-app tools a
 * `registerTool(` source regex undercounts, so this headline matches README /
 * the registry manifests instead of drifting below them. Null (fresh checkout
 * pre-codegen) falls back to the broad source count below.
 */
const HEADLINE_TOOL_COUNT = (() => {
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, "docs", "tool-manifest.json"), "utf-8"));
    return typeof manifest.toolCount === "number" ? manifest.toolCount : null;
  } catch {
    return null;
  }
})();

// Extract tool registrations from a file
export function decodeStringLiteralExpression(expr) {
  return [...expr.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join("");
}

export function extractTools(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const tools = [];
  // Match tool name, title, and a string-literal description expression.
  // Descriptions often wrap across lines as `"first " + "second"`; parse the
  // full literal expression so honesty caveats do not disappear from llms-full.
  const re =
    /server\.registerTool\(\s*\n?\s*"([^"]+)",\s*\n?\s*\{[\s\S]*?title:\s*"([^"]+)",[\s\S]*?description:\s*((?:"(?:\\.|[^"\\])*"\s*(?:\+\s*)?)+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    tools.push({ name: m[1], title: m[2], description: decodeStringLiteralExpression(m[3]) });
  }
  // Fallback: count any missed registrations
  const allNames = [...content.matchAll(/server\.registerTool\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const name of allNames) {
    if (!tools.find((t) => t.name === name)) {
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
  notes: "Notes",
  reminders: "Reminders",
  calendar: "Calendar",
  contacts: "Contacts",
  mail: "Mail",
  messages: "Messages",
  music: "Music",
  finder: "Finder",
  safari: "Safari",
  system: "System",
  photos: "Photos",
  shortcuts: "Shortcuts",
  intelligence: "Apple Intelligence",
  tv: "TV",
  ui: "UI Automation",
  screen: "Screen Capture",
  maps: "Maps",
  podcasts: "Podcasts",
  weather: "Weather",
  pages: "Pages",
  numbers: "Numbers",
  keynote: "Keynote",
  location: "Location",
  bluetooth: "Bluetooth",
  google: "Google Workspace",
  semantic: "Semantic Search",
  cross: "Cross-Module",
  apps: "App Management",
  shared: "Setup",
};

// Collect all tools by module for the per-module breakdown.
// The HEADLINE count comes from the manifest (HEADLINE_TOOL_COUNT above) — the
// full runtime surface count-stats.mjs also uses. The per-module list built by
// `extractTools` is a presentation projection of the statically-defined catalog
// (stricter regex requiring title + description co-located, also used for the
// detailed `llms-full.txt` entries); it can sum to fewer than the headline
// because dynamically-registered tools (skill_* runners, MCP-app views) have no
// static registration the regex sees. `totalTools` (broad pass) is retained only
// as the fresh-checkout fallback when the manifest isn't present.
const TOOL_REGEX = /server\.registerTool\(/g;
const PROMPT_REGEX = /server\.prompt\(/g;
function walkDir(dir, modules, counts) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, modules, counts);
    else if (entry.name.endsWith(".ts")) {
      const modDir = basename(dirname(full));
      if (OPT_IN_MODULES.has(modDir)) continue;
      const content = readFileSync(full, "utf-8");
      counts.totalTools += (content.match(TOOL_REGEX) || []).length;
      counts.totalPrompts += (content.match(PROMPT_REGEX) || []).length;
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

export function generateLlmsText() {
  const modules = {};
  const counts = { totalTools: 0, totalPrompts: 0 };
  walkDir(SRC, modules, counts);
  const moduleCount = CANONICAL_MODULE_COUNT ?? Object.keys(modules).length;
  const headlineTools = HEADLINE_TOOL_COUNT ?? counts.totalTools;

  // Generate llms.txt (summary)
  const REPO = "https://github.com/heznpc/AirMCP";
  let llmsTxt = `# AirMCP

> Approval-gated local action runtime for Apple workspaces. ${headlineTools} tools across ${moduleCount} modules.

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
    llmsTxt += `- **${name}** (${mod.tools.length} tools): ${mod.tools.map((t) => t.name).join(", ")}\n`;
  }

  // Generate llms-full.txt (complete reference)
  let fullTxt = `# AirMCP — Full Tool Reference

> ${headlineTools} tools, ${counts.totalPrompts} prompts across ${moduleCount} modules.
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

  return { llmsTxt, fullTxt, headlineTools, totalPrompts: counts.totalPrompts, moduleCount };
}

const llmsPath = join(ROOT, "llms.txt");
const llmsFullPath = join(ROOT, "llms-full.txt");
const checkMode = process.argv.includes("--check");

function main() {
  const { llmsTxt, fullTxt, headlineTools, totalPrompts, moduleCount } = generateLlmsText();

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
    console.log(`[gen-llms --check] OK — ${headlineTools} tools / ${totalPrompts} prompts / ${moduleCount} modules`);
  } else {
    writeFileSync(llmsPath, llmsTxt);
    writeFileSync(llmsFullPath, fullTxt);
    console.log(`Generated llms.txt (${llmsTxt.length} bytes) and llms-full.txt (${fullTxt.length} bytes)`);
    console.log(`${headlineTools} tools, ${totalPrompts} prompts across ${moduleCount} modules`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
