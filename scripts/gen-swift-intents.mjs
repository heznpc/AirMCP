#!/usr/bin/env node
// RFC 0007 Phase A.1 — Swift AppIntent code generator.
//
// Reads docs/tool-manifest.json and writes
// swift/Sources/AirMCPKit/Generated/MCPIntents.swift, emitting one Swift
// `AppIntent` struct per selected tool.
//
// A.1 scope: a hand-picked list of 10 read-only tools with a small parameter
// surface. Every selected tool MUST have `appIntentEligible: true` in the
// manifest. A.2 broadens this to all read-only + idempotent eligible tools
// (~150/282) and switches ReturnsValue from String to the tool's typed
// outputSchema payload.
//
// Generated intents call `MCPIntentRouter.shared.call(...)` — see
// swift/Sources/AirMCPKit/MCPIntentRouter.swift. Phase A.1 ships a stub
// router (throws) so the file compiles and the system can still index the
// intents for Shortcuts / Spotlight / golden-sample regression. A.2 lands
// the macOS stdio + iOS in-process implementations.
//
// Env knobs:
//   AIRMCP_INTENTS_OUT     — output path (default: swift/Sources/AirMCPKit/Generated/MCPIntents.swift)
//   AIRMCP_INTENTS_MANIFEST — input manifest (default: docs/tool-manifest.json)
//
// Usage:
//   node scripts/gen-swift-intents.mjs            # write
//   node scripts/gen-swift-intents.mjs --check    # exit 1 if drift

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = process.env.AIRMCP_INTENTS_MANIFEST ?? join(ROOT, "docs", "tool-manifest.json");
const OUT_PATH =
  process.env.AIRMCP_INTENTS_OUT ?? join(ROOT, "swift", "Sources", "AirMCPKit", "Generated", "MCPIntents.swift");
const CHECK_ONLY = process.argv.includes("--check");

// ── A.1 selection ────────────────────────────────────────────────────
// Ten hand-picked read-only tools. Chosen for:
//   (a) match with existing hand-written intents in
//       app/Sources/AirMCPApp/AppIntents.swift (5 of the 10 have a golden
//       sample we can diff against later)
//   (b) small parameter surface (zero or one primitive @Parameter)
//   (c) outputSchema already present (PR #95/97/98)
// If A.2 broadens the list it can read from a declarative allow-list in the
// manifest itself or skip this constant entirely and take every eligible.
const SELECTED = [
  "list_calendars",
  "today_events",
  "list_reminder_lists",
  "list_folders",
  "list_shortcuts",
  "list_accounts",
  "list_bookmarks",
  "search_notes",
  "search_contacts",
  "get_upcoming_events",
];
// Note: health_summary was a natural fit (matches hand-written HealthSummaryIntent)
// but the `health` module requires Apple Silicon + HealthKit at compat-resolve
// time, so it's absent from the CI-generated manifest. list_bookmarks takes
// its slot — same shape (no parameters, read-only, outputSchema present).

// ── Load manifest ────────────────────────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  console.error(`[gen-intents] cannot read ${MANIFEST_PATH}: ${e.message}`);
  console.error("[gen-intents] run `npm run gen:manifest` first");
  process.exit(2);
}

const byName = new Map(manifest.tools.map((t) => [t.name, t]));
const picked = [];
for (const name of SELECTED) {
  const tool = byName.get(name);
  if (!tool) {
    console.error(`[gen-intents] selected tool not in manifest: ${name}`);
    process.exit(2);
  }
  if (!tool.appIntentEligible) {
    console.error(`[gen-intents] selected tool not AppIntent-eligible: ${name}`);
    process.exit(2);
  }
  picked.push(tool);
}

// ── Swift codegen helpers ────────────────────────────────────────────

function toPascalCase(snake) {
  return snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function intentStructName(toolName) {
  // audit_log → AuditLogIntent; avoids collision with hand-written
  // intents that live in app/Sources/AirMCPApp (different Swift module).
  return `${toPascalCase(toolName)}Intent`;
}

/**
 * Swift-safe string literal for a LocalizedStringResource / description.
 * Escapes backslashes and double-quotes. Strips newlines to avoid breaking
 * the single-line literal form AppIntent accepts.
 */
function swiftLit(s) {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
}

/**
 * Map a JSON-Schema property to a Swift `@Parameter` declaration.
 * A.1 only supports primitive types the 10 selected tools actually use
 * (String, Int). A.2 adds Double/Bool/Date/enum/Array<String>.
 */
function swiftParamDecl(propName, propSchema) {
  const title = propSchema.description ?? propName;
  const safeTitle = swiftLit(title.slice(0, 60));

  if (propSchema.type === "string") {
    return `    @Parameter(title: "${safeTitle}")\n    public var ${propName}: String`;
  }
  if (propSchema.type === "integer") {
    const dflt = typeof propSchema.default === "number" ? propSchema.default : undefined;
    const range =
      typeof propSchema.minimum === "number" && typeof propSchema.maximum === "number"
        ? `, inclusiveRange: (${propSchema.minimum}, ${propSchema.maximum})`
        : "";
    if (dflt !== undefined) {
      return `    @Parameter(title: "${safeTitle}", default: ${dflt}${range})\n    public var ${propName}: Int`;
    }
    return `    @Parameter(title: "${safeTitle}"${range})\n    public var ${propName}: Int`;
  }
  // Fallback — should not happen for the A.1 selected set; guards the
  // codegen if the manifest drifts to add an unsupported type.
  throw new Error(`[gen-intents] unsupported @Parameter type for ${propName}: ${JSON.stringify(propSchema)}`);
}

function buildArgsDict(properties) {
  const keys = Object.keys(properties);
  if (keys.length === 0) return "[:]";
  const entries = keys.map((k) => `"${k}": ${k}`).join(", ");
  return `[${entries}]`;
}

function generateIntent(tool) {
  const structName = intentStructName(tool.name);
  const title = swiftLit(tool.title ?? tool.name);
  const description = swiftLit(tool.description ?? "");
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);

  // Only emit `@Parameter` for required properties in A.1. Optionals add
  // a whole mapping layer (Optional<T>, nil defaults) that isn't needed
  // for the 10 selected tools; A.2 adds full optional support.
  const requiredKeys = Object.keys(props).filter((k) => required.has(k));
  const paramDecls = requiredKeys.map((k) => swiftParamDecl(k, props[k])).join("\n\n");
  const argsDict = buildArgsDict(Object.fromEntries(requiredKeys.map((k) => [k, props[k]])));

  return `// Tool: ${tool.name}
public struct ${structName}: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "${title}"
    nonisolated(unsafe) public static var description = IntentDescription("${description}")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

${paramDecls ? paramDecls + "\n\n" : ""}    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsDict}
        )
        return .result(value: result)
    }
}`;
}

// ── Assemble output ──────────────────────────────────────────────────

const header = `// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.1 — ${picked.length} hand-picked read-only tools.
// Run \`npm run gen:intents\` to refresh after tool metadata changes.
// CI guards against drift via \`npm run gen:intents:check\`.
//
// Runtime behavior is stubbed in MCPIntentRouter until Phase A.2; these
// structs compile and register with the system (for Shortcuts / Spotlight
// indexing + golden-sample regression) but \`perform()\` will throw a
// \`MCPIntentError.notImplementedOnPlatform\` until A.2 lands the macOS
// execFile bridge and iOS in-process path.

#if canImport(AppIntents)
import AppIntents
import Foundation

`;

const intents = picked.map(generateIntent).join("\n\n");

const footer = `

#endif
`;

const source = header + intents + footer;

// ── Write / check ────────────────────────────────────────────────────

if (CHECK_ONLY) {
  let existing = "";
  try {
    existing = readFileSync(OUT_PATH, "utf8");
  } catch {
    console.error(`[gen-intents --check] ${OUT_PATH} missing — run \`npm run gen:intents\``);
    process.exit(1);
  }
  if (existing !== source) {
    console.error(`[gen-intents --check] drift detected in ${OUT_PATH} — run \`npm run gen:intents\``);
    // For easier debugging on CI, write the intended output to /tmp so the
    // failing job can diff against the checked-in file.
    try {
      writeFileSync("/tmp/airmcp-intents-expected.swift", source);
      console.error(`[gen-intents --check] expected output written to /tmp/airmcp-intents-expected.swift`);
    } catch {
      /* best-effort */
    }
    process.exit(1);
  }
  console.error(`[gen-intents --check] OK — ${picked.length} intents`);
} else {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, source);
  console.error(`[gen-intents] wrote ${OUT_PATH} — ${picked.length} intents`);
}
