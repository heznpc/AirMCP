#!/usr/bin/env node
// RFC 0007 — structural validator for docs/tool-manifest.json.
//
// Byte-level drift is already caught by `gen:manifest:check`. This
// script is the complementary schema-level contract check: the manifest's
// top-level shape and per-tool fields are what downstream codegen
// depends on, and a silent shape regression (e.g. a future refactor of
// `dump-tool-manifest.mjs` that drops the `annotations` field) would
// slip past drift when the *content* changes in sync.
//
// The validator is intentionally independent from the codegen — it
// doesn't import from scripts/lib/codegen-helpers.mjs. If someone
// changes the helpers in a way that widens what the codegen accepts,
// this file stays at the old contract until explicitly updated, so a
// regression of "codegen silently accepts garbage" can't happen.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "docs", "tool-manifest.json");

// Known reason codes the dumper may emit. Adding a new code here is
// intentional — surfacing a new ineligibility class should force an
// explicit test update.
const KNOWN_INELIGIBLE_REASONS = new Set([
  "record-input",
  // object-param:<name> and array-of-object:<name> are pattern-matched below
]);
const INELIGIBLE_REASON_PATTERN = /^(record-input|object-param:[\w-]+|array-of-object:[\w-]+)$/;

const errors = [];

function fail(path, msg) {
  errors.push(`${path}: ${msg}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
} catch (e) {
  console.error(`[manifest-schema] cannot read ${MANIFEST_PATH}: ${e.message}`);
  process.exit(1);
}

// ── Top-level shape ─────────────────────────────────────────────────
const REQUIRED_TOP_FIELDS = [
  ["generatedAt", "string"],
  ["protocolVersion", "string"],
  ["toolCount", "number"],
  ["eligibleCount", "number"],
  ["ineligibleCount", "number"],
  ["ineligibleByReason", "object"],
  ["tools", "array"],
];
for (const [key, wantType] of REQUIRED_TOP_FIELDS) {
  const got = manifest[key];
  if (wantType === "array") {
    if (!Array.isArray(got)) fail(key, `missing or not array (got ${typeof got})`);
  } else if (typeof got !== wantType) {
    fail(key, `expected ${wantType}, got ${got === null ? "null" : typeof got}`);
  }
}

if (manifest.toolCount !== undefined && Array.isArray(manifest.tools) && manifest.toolCount !== manifest.tools.length) {
  fail("toolCount", `${manifest.toolCount} does not match tools.length ${manifest.tools.length}`);
}

// Cross-check eligibleCount + ineligibleCount against actual per-tool flags.
if (Array.isArray(manifest.tools)) {
  const eligible = manifest.tools.filter((t) => t.appIntentEligible).length;
  const ineligible = manifest.tools.length - eligible;
  if (manifest.eligibleCount !== eligible) {
    fail("eligibleCount", `header ${manifest.eligibleCount} but per-tool count ${eligible}`);
  }
  if (manifest.ineligibleCount !== ineligible) {
    fail("ineligibleCount", `header ${manifest.ineligibleCount} but per-tool count ${ineligible}`);
  }

  // ineligibleByReason histogram should match per-tool reasons.
  const reasonCounts = {};
  for (const t of manifest.tools) {
    if (t.appIntentEligible) continue;
    const r = t.ineligibleReason ?? "unknown";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const expected = JSON.stringify(reasonCounts, Object.keys(reasonCounts).sort());
  const actual = JSON.stringify(manifest.ineligibleByReason, Object.keys(manifest.ineligibleByReason ?? {}).sort());
  if (expected !== actual) {
    fail("ineligibleByReason", `histogram mismatch: expected ${expected}, got ${actual}`);
  }
}

// ── Per-tool shape ───────────────────────────────────────────────────
if (Array.isArray(manifest.tools)) {
  for (const [i, tool] of manifest.tools.entries()) {
    const path = `tools[${i}]${tool?.name ? ` (${tool.name})` : ""}`;
    // Skills arrive with hyphens (e.g. `skill_focus-block-planner`);
    // Swift codegen's toPascalCase splits on any non-word char, so
    // hyphens are fine at the wire layer too. Reject anything else
    // that could leak into a Swift identifier boundary.
    if (typeof tool.name !== "string" || !/^[a-z0-9_-]+$/.test(tool.name)) {
      fail(path, `invalid name (expected /^[a-z0-9_-]+$/, got ${JSON.stringify(tool.name)})`);
    }
    if (typeof tool.title !== "string") fail(path, `title missing or non-string`);
    if (typeof tool.description !== "string") fail(path, `description missing or non-string`);

    if (typeof tool.inputSchema !== "object" || tool.inputSchema === null) {
      fail(path, `inputSchema missing or not object`);
    }
    if (tool.outputSchema !== null && (typeof tool.outputSchema !== "object" || Array.isArray(tool.outputSchema))) {
      fail(path, `outputSchema must be null or an object`);
    }

    // annotations — all 4 boolean hints required
    const a = tool.annotations;
    if (typeof a !== "object" || a === null) {
      fail(path, `annotations missing`);
    } else {
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        if (typeof a[key] !== "boolean") {
          fail(`${path}.annotations.${key}`, `expected boolean, got ${typeof a[key]}`);
        }
      }
    }

    if (typeof tool.appIntentEligible !== "boolean") {
      fail(path, `appIntentEligible must be boolean`);
    }

    // ineligibleReason contract:
    //   • null when eligible
    //   • non-null known-pattern string when ineligible
    if (tool.appIntentEligible === true) {
      if (tool.ineligibleReason !== null) {
        fail(path, `eligible tool should have ineligibleReason: null (got ${JSON.stringify(tool.ineligibleReason)})`);
      }
    } else if (tool.appIntentEligible === false) {
      if (typeof tool.ineligibleReason !== "string") {
        fail(path, `ineligible tool must have a string ineligibleReason (got ${JSON.stringify(tool.ineligibleReason)})`);
      } else if (
        !KNOWN_INELIGIBLE_REASONS.has(tool.ineligibleReason) &&
        !INELIGIBLE_REASON_PATTERN.test(tool.ineligibleReason)
      ) {
        fail(
          path,
          `ineligibleReason "${tool.ineligibleReason}" is not a known code — update KNOWN_INELIGIBLE_REASONS / INELIGIBLE_REASON_PATTERN to acknowledge a new class`,
        );
      }
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error(`[manifest-schema] ${errors.length} contract violation(s) in ${MANIFEST_PATH}:`);
  for (const err of errors) console.error(`  ${err}`);
  process.exit(1);
}

console.error(
  `[manifest-schema] OK — ${manifest.toolCount} tools (${manifest.eligibleCount} eligible, ${manifest.ineligibleCount} ineligible) match the expected shape`,
);
