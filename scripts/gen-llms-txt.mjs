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
function walkDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith(".ts")) {
      const modDir = basename(dirname(full));
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

// Count totals
let totalTools = 0;
let totalPrompts = 0;
for (const mod of Object.values(modules)) {
  totalTools += mod.tools.length;
  totalPrompts += mod.prompts.length;
}

// Generate llms.txt (summary)
const REPO = "https://github.com/heznpc/AirMCP";
let llmsTxt = `# AirMCP

> MCP server for the entire Apple ecosystem. ${totalTools} tools across ${Object.keys(modules).length} modules.

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

> ${totalTools} tools, ${totalPrompts} prompts across ${Object.keys(modules).length} modules.
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
    `[gen-llms --check] OK — ${totalTools} tools / ${totalPrompts} prompts / ${Object.keys(modules).length} modules`,
  );
} else {
  writeFileSync(llmsPath, llmsTxt);
  writeFileSync(llmsFullPath, fullTxt);
  console.log(`Generated llms.txt (${llmsTxt.length} bytes) and llms-full.txt (${fullTxt.length} bytes)`);
  console.log(`${totalTools} tools, ${totalPrompts} prompts across ${Object.keys(modules).length} modules`);
}
