#!/usr/bin/env node
// RFC 0007 Phase A.2b.1 — Swift AppIntent code generator.
//
// Reads docs/tool-manifest.json and writes
// swift/Sources/AirMCPKit/Generated/MCPIntents.swift: one `AppIntent`
// struct per selected tool + a single `AppShortcutsProvider` (Apple's
// 10-entry cap).
//
// Scope now (A.2b.1):
//   • Selection is automatic — every tool that is eligible, read-only, and
//     not destructive. Destructive tools land in A.3 behind
//     requestConfirmation(actionName:snippetIntent:) (RFC 0007 §R2 amended
//     2026-04-23).
//   • @Parameter types: String, Int, Double, Bool, Date, [String]. Optional
//     params become `T?` unless they carry an explicit default.
//   • Top-N AppShortcutsProvider hand-picked (usage-tracker data isn't
//     available at codegen time yet).
//   • Return value stays `ReturnsValue<String>` — A.2b.2 will codegen
//     typed Codable structs from outputSchema and switch to ReturnsValue<T>.
//
// Router is live as of PR #103 (A.2a). Generated perform() calls hit
// MCPIntentRouter.shared which the host (app/AirMCPApp or
// ios/AirMCPiOS) installed at launch.
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

// ── A.2b.1 selection ─────────────────────────────────────────────────
// Automatic filter: every tool that is eligible, read-only, and not
// destructive. No more hand-picked list. Destructive tools land in A.3
// behind requestConfirmation(actionName:snippetIntent:) (see RFC 0007 §R2
// amendment 2026-04-23).
//
// An explicit SKIP list remains for specific tools that would otherwise
// generate but have known runtime issues we haven't addressed yet. Empty
// at the moment — listed here so future skips are discoverable in one place.
const SKIP_NAMES = new Set([]);

// Top-N selection for AppShortcutsProvider (Apple caps the provider at
// 10 entries per app). A.2b.1 uses a hand-picked subset instead of
// usage-tracker-derived data because the tracker runs on the user's
// laptop and isn't available at codegen time. A future pass can read a
// checked-in top-N hint file that's refreshed nightly from usage data.
const APP_SHORTCUTS_TOP = [
  "today_events",
  "list_calendars",
  "search_notes",
  "search_contacts",
  "list_reminder_lists",
  "list_shortcuts",
  "list_bookmarks",
  "get_current_weather",
  "summarize_context",
  "recent_files",
];

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
const picked = manifest.tools
  .filter(
    (t) =>
      t.appIntentEligible && t.annotations.readOnlyHint && !t.annotations.destructiveHint && !SKIP_NAMES.has(t.name),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

// Validate the AppShortcutsProvider top list — all names must be in the
// picked set, else Swift compilation fails with "cannot find type".
const appShortcutsPicks = [];
for (const name of APP_SHORTCUTS_TOP) {
  const tool = byName.get(name);
  if (!tool) {
    console.error(`[gen-intents] APP_SHORTCUTS_TOP references missing tool: ${name}`);
    process.exit(2);
  }
  if (!picked.includes(tool)) {
    console.error(
      `[gen-intents] APP_SHORTCUTS_TOP references ineligible tool: ${name}` +
        ` (readOnly=${tool.annotations.readOnlyHint}, destructive=${tool.annotations.destructiveHint}, eligible=${tool.appIntentEligible})`,
    );
    process.exit(2);
  }
  appShortcutsPicks.push(tool);
}

// ── Swift codegen helpers ────────────────────────────────────────────

function toPascalCase(snake) {
  // Skills may arrive with dashes (e.g. `skill_focus-guardian`); Swift
  // identifiers require alphanumeric only, so split on any non-word char.
  return snake
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
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
 * Pick the Swift type for a JSON-Schema property.
 * Returns null if the type isn't representable as a single @Parameter.
 */
function swiftTypeFor(propSchema) {
  if (propSchema.type === "string") {
    // Enums stay as String at the @Parameter layer — AppEntity-based
    // enum rendering needs per-type Swift code we don't codegen yet.
    // The allowed values are surfaced in the description.
    if (propSchema.format === "date-time") return "Date";
    return "String";
  }
  if (propSchema.type === "integer") return "Int";
  if (propSchema.type === "number") return "Double";
  if (propSchema.type === "boolean") return "Bool";
  if (propSchema.type === "array" && propSchema.items?.type === "string") return "[String]";
  return null;
}

/**
 * Map a JSON-Schema property to a Swift `@Parameter` declaration.
 * Optional properties (not in inputSchema.required) become Optional<T>.
 * Non-primitive or composite shapes return null; callers must filter
 * the property out of the generated intent entirely.
 */
function swiftParamDecl(propName, propSchema, isRequired) {
  const baseType = swiftTypeFor(propSchema);
  if (baseType === null) return null;

  const descParts = [];
  if (propSchema.description) descParts.push(propSchema.description);
  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    descParts.push(`Allowed: ${propSchema.enum.join(", ")}`);
  }
  const title = descParts.join(" · ") || propName;
  const safeTitle = swiftLit(title.slice(0, 80));

  const optsParts = [`title: "${safeTitle}"`];

  // Default values: only applied when the schema advertises one and the
  // field is present in required OR is a plain non-optional value.
  if (
    propSchema.default !== undefined &&
    (baseType === "Int" || baseType === "Double") &&
    typeof propSchema.default === "number"
  ) {
    optsParts.push(`default: ${propSchema.default}`);
  } else if (propSchema.default !== undefined && baseType === "Bool" && typeof propSchema.default === "boolean") {
    optsParts.push(`default: ${propSchema.default}`);
  } else if (propSchema.default !== undefined && baseType === "String" && typeof propSchema.default === "string") {
    optsParts.push(`default: "${swiftLit(propSchema.default)}"`);
  }

  if (
    (baseType === "Int" || baseType === "Double") &&
    typeof propSchema.minimum === "number" &&
    typeof propSchema.maximum === "number"
  ) {
    optsParts.push(`inclusiveRange: (${propSchema.minimum}, ${propSchema.maximum})`);
  }

  // Optional fields without an explicit default become `T?` so AppIntent
  // treats them as optional. Fields with a default stay non-optional.
  const hasDefault = optsParts.some((p) => p.startsWith("default:"));
  const typeName = isRequired || hasDefault ? baseType : `${baseType}?`;

  return `    @Parameter(${optsParts.join(", ")})\n    public var ${propName}: ${typeName}`;
}

/**
 * Emit the Swift statements that build the `args` dict for a router call.
 * Returns an object with:
 *   `prelude`: zero or more Swift statements to place before the call
 *   `argsExpr`: the expression to pass as `args:` to `MCPIntentRouter.call`
 *
 * Optional properties use `if let ... { args[...] = ... }` so nil fields
 * don't cross the wire as JSON `null` — Node's JSON-Schema validator
 * treats absent-vs-null differently for optionals.
 */
function buildArgsBlock(decls) {
  if (decls.length === 0) {
    return { prelude: "", argsExpr: "[String: any Sendable]()" };
  }

  const allRequired = decls.every((d) => !d.optional);
  if (allRequired) {
    const pairs = decls
      .map((d) => {
        const rhs = d.type === "Date" ? `ISO8601DateFormatter().string(from: ${d.name})` : d.name;
        return `"${d.wireName}": ${rhs}`;
      })
      .join(", ");
    return { prelude: "", argsExpr: `[${pairs}]` };
  }

  const lines = [`var args: [String: any Sendable] = [:]`];
  for (const d of decls) {
    if (!d.optional) {
      lines.push(
        d.type === "Date"
          ? `args["${d.wireName}"] = ISO8601DateFormatter().string(from: ${d.name})`
          : `args["${d.wireName}"] = ${d.name}`,
      );
    } else {
      const rhs = d.type === "Date" ? `ISO8601DateFormatter().string(from: v)` : `v`;
      lines.push(`if let v = ${d.name} { args["${d.wireName}"] = ${rhs} }`);
    }
  }
  return { prelude: lines.map((l) => `        ${l}`).join("\n"), argsExpr: "args" };
}

/**
 * Swift identifiers can't use `default`, `class`, `init`, etc. Map any
 * collision to a `_`-suffixed name; the JSON-Schema property name stays
 * the wire contract, the Swift variable just dodges the keyword.
 */
const SWIFT_RESERVED = new Set([
  "default",
  "class",
  "struct",
  "init",
  "public",
  "private",
  "extension",
  "import",
  "static",
  "return",
  "self",
  "func",
  "case",
  "switch",
  "if",
  "else",
  "for",
  "while",
  "in",
  "where",
  "operator",
  "protocol",
  "typealias",
]);
function swiftIdent(name) {
  return SWIFT_RESERVED.has(name) ? `${name}_` : name;
}

function generateIntent(tool) {
  const structName = intentStructName(tool.name);
  const title = swiftLit(tool.title ?? tool.name);
  const description = swiftLit(tool.description ?? "");
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);

  // Collect property decls in a stable order. Skip properties whose type
  // we don't know how to map — the @Parameter layer can't represent them.
  const decls = [];
  for (const wireName of Object.keys(props)) {
    const prop = props[wireName];
    const baseType = swiftTypeFor(prop);
    if (baseType === null) continue; // silently dropped — codegen will still compile
    const swiftName = swiftIdent(wireName);
    decls.push({
      name: swiftName,
      wireName,
      type: baseType,
      optional: !required.has(wireName) && prop.default === undefined,
    });
  }

  const paramDecls = decls
    .map((d) => swiftParamDecl(d.name, props[d.wireName], required.has(d.wireName)))
    .filter(Boolean)
    .join("\n\n");
  const { prelude, argsExpr } = buildArgsBlock(decls);

  const body = prelude
    ? `${prelude}
        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`
    : `        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`;

  return `// Tool: ${tool.name}
public struct ${structName}: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "${title}"
    nonisolated(unsafe) public static var description = IntentDescription("${description}")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

${paramDecls ? paramDecls + "\n\n" : ""}    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
${body}
        return .result(value: result)
    }
}`;
}

/**
 * Emit the single AppShortcutsProvider block. Apple caps this at 10.
 * Each phrase uses `\(.applicationName)` so the trigger reads naturally
 * ("list calendars in AirMCP"). systemImage is a stable SF Symbol per
 * tool family — conservative choices that compile against iOS 17+.
 */
const SYSTEM_IMAGE_BY_PREFIX = [
  [/^(list|search)_events|today_events|get_upcoming_events/, "calendar"],
  [/^list_calendars/, "calendar.badge.plus"],
  [/^(list|search|read)_notes|list_folders/, "note.text"],
  [/^(list|search|read)_reminders|list_reminder_lists/, "checklist"],
  [/^(list|search|read)_contacts|list_groups|list_group_members/, "person.crop.circle"],
  [/^list_accounts|list_messages/, "envelope"],
  [/^list_chats|list_participants/, "message"],
  [/^list_shortcuts|search_shortcuts|get_shortcut_detail/, "square.stack.3d.up"],
  [/^list_bookmarks|list_reading_list|list_tabs/, "safari"],
  [/^get_current_weather|get_daily_forecast|get_hourly_forecast/, "cloud.sun"],
  [/^summarize_context|proactive_context/, "sparkles"],
  [/^recent_files|list_directory|search_files|get_file_info/, "folder"],
];
function systemImageFor(toolName) {
  for (const [re, img] of SYSTEM_IMAGE_BY_PREFIX) {
    if (re.test(toolName)) return img;
  }
  return "app.connected.to.app.below.fill";
}

function generateAppShortcuts() {
  const entries = appShortcutsPicks.map((tool) => {
    const structName = intentStructName(tool.name);
    const title = swiftLit(tool.title ?? tool.name);
    const img = systemImageFor(tool.name);
    // Two phrases per shortcut keeps suggestions broad enough for natural
    // Siri invocation. Apple recommends each phrase use .applicationName.
    const phrase1 = swiftLit(title);
    const phrase2 = swiftLit(tool.name.replace(/_/g, " "));
    return `        AppShortcut(
            intent: ${structName}(),
            phrases: [
                "${phrase1} in \\(.applicationName)",
                "${phrase2} with \\(.applicationName)",
            ],
            shortTitle: "${phrase1}",
            systemImageName: "${img}"
        )`;
  });
  return `public struct AirMCPGeneratedShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
${entries.join("\n")}
    }
}`;
}

// ── Assemble output ──────────────────────────────────────────────────

const header = `// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.2b.1 — ${picked.length} auto-selected read-only tools +
// ${appShortcutsPicks.length} AppShortcutsProvider entries (Apple's 10-entry cap).
// Run \`npm run gen:intents\` to refresh after tool metadata changes.
// CI guards against drift via \`npm run gen:intents:check\`.
//
// Router runtime is live as of PR #103 (A.2a): macOS execFile stdio and
// iOS in-process MCPServer.callToolText. Every generated intent's
// \`perform()\` hits that router.

#if canImport(AppIntents)
import AppIntents
import Foundation

`;

const intents = picked.map(generateIntent).join("\n\n");
const appShortcuts = generateAppShortcuts();

const footer = `

#endif
`;

const source = header + intents + "\n\n" + appShortcuts + footer;

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
