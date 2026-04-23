#!/usr/bin/env node
// RFC 0007 §3.6 — golden-sample regression check.
//
// The 4+ hand-written intents in app/Sources/AirMCPApp/AppIntents.swift
// serve as the canonical reference for what codegen output should look
// like for their respective tools. This script ensures:
//
//   1. Every `runAirMCPTool("<name>", ...)` call-site references a tool
//      that actually exists in the manifest (catches renames / deletions
//      that silently break the menubar app's Shortcuts entries).
//   2. For every such tool, the generated MCPIntents.swift contains a
//      corresponding `public struct <PascalName>Intent: AppIntent` —
//      assuming the tool is AppIntent-eligible per the manifest.
//      Ineligible tools (composite inputs) are acceptable misses; the
//      hand-written golden samples cover those manually.
//
// The hand-written golden stays the tighter contract: tool names,
// @Parameter shapes, and description wording don't have to match
// byte-for-byte — this check is a floor, not a byte-comparison, so
// refinements to codegen (better titles, reordered params) don't
// constantly break CI. The goal is to catch the class of bug where a
// tool gets deleted or renamed and nobody notices until a Shortcut
// silently breaks.
//
// Usage:
//   node scripts/verify-golden-intents.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GOLDEN_PATH = join(ROOT, "app", "Sources", "AirMCPApp", "AppIntents.swift");
const MANIFEST_PATH = join(ROOT, "docs", "tool-manifest.json");
const GENERATED_PATH = join(ROOT, "swift", "Sources", "AirMCPKit", "Generated", "MCPIntents.swift");
const SRC_DIR = join(ROOT, "src");

/**
 * Return the set of tool names registered anywhere in src/**\/tools.ts
 * via `server.registerTool("<name>", ...)`. Some modules are hardware-
 * gated (HealthKit needs Apple Silicon + HK permissions) and therefore
 * absent from the dump-generated manifest, but they're real tools in
 * production — the golden check should treat them as valid references.
 */
function collectRegisteredToolNames() {
  const tools = new Set();
  const toolRegex = /registerTool\(\s*["']([a-z0-9_]+)["']/g;
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        const content = readFileSync(p, "utf8");
        let m;
        while ((m = toolRegex.exec(content))) {
          tools.add(m[1]);
        }
      }
    }
  }
  walk(SRC_DIR);
  return tools;
}

function die(msg) {
  console.error(`[golden] ${msg}`);
  process.exit(1);
}

let golden;
let manifest;
let generated;
try {
  golden = readFileSync(GOLDEN_PATH, "utf8");
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  generated = readFileSync(GENERATED_PATH, "utf8");
} catch (e) {
  die(`cannot read required files: ${e.message}`);
}

const manifestByName = new Map(manifest.tools.map((t) => [t.name, t]));
const srcRegisteredTools = collectRegisteredToolNames();

// Extract every `runAirMCPTool("name", ...)` call from golden. The regex
// is intentionally tight — we want to miss if someone ever renames the
// helper so the check notices instead of going stale.
const callRegex = /runAirMCPTool\("([a-z0-9_]+)"/g;
const goldenTools = new Set();
let m;
while ((m = callRegex.exec(golden))) {
  goldenTools.add(m[1]);
}

if (goldenTools.size === 0) {
  die(`no runAirMCPTool("...") calls found in ${GOLDEN_PATH} — regex drift?`);
}

// toPascalCase mirror of gen-swift-intents.mjs so we can predict the
// codegen struct name for a given tool. Must stay in sync; a future
// refactor of either side should delete one copy and import the other.
function toPascalCase(snake) {
  return snake
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

const failures = [];
const skips = [];

for (const toolName of [...goldenTools].sort()) {
  const entry = manifestByName.get(toolName);
  if (!entry) {
    // Some tools are hardware-gated (health_*, apple-silicon-only modules)
    // and therefore absent from the manifest dump env (which forces
    // AIRMCP_FAKE_OS_VERSION=0 for reproducibility). They still exist at
    // runtime on real hardware, so don't fail on a manifest miss if src
    // registers the tool. Fail only if src doesn't either — that's a real
    // rename/deletion regression.
    if (srcRegisteredTools.has(toolName)) {
      skips.push(`${toolName}: hardware-gated — present in src, absent from manifest dump (expected)`);
      continue;
    }
    failures.push(
      `tool "${toolName}" referenced by a golden-sample intent but not present in ${MANIFEST_PATH} and not registered in src/ — rename/deletion without updating app/Sources/AirMCPApp/AppIntents.swift?`,
    );
    continue;
  }
  if (!entry.appIntentEligible) {
    // Ineligible tools (composite inputs) can't be auto-generated; the
    // hand-written golden is the authoritative implementation. OK to skip.
    skips.push(`${toolName}: appIntentEligible=false — hand-written golden is authoritative`);
    continue;
  }
  const expectedStruct = `${toPascalCase(toolName)}Intent`;
  // Match the struct on its own line to avoid matching a comment / doc
  // reference.
  const structRegex = new RegExp(`^public struct ${expectedStruct}\\b`, "m");
  if (!structRegex.test(generated)) {
    failures.push(
      `tool "${toolName}" is AppIntent-eligible but ${expectedStruct} is missing from ${GENERATED_PATH} — did the filter drop it unintentionally?`,
    );
  }
}

if (skips.length > 0) {
  console.error(`[golden] skipped (ineligible):`);
  for (const s of skips) console.error(`  ${s}`);
}

if (failures.length > 0) {
  console.error(`[golden] ${failures.length} regression(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.error(`[golden] OK — ${goldenTools.size} tools referenced by golden samples, all present in manifest + generated`);
