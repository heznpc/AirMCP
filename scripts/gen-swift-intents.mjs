#!/usr/bin/env node
// RFC 0007 Phase A.2b.2 — Swift AppIntent code generator.
//
// Reads docs/tool-manifest.json and writes
// swift/Sources/AirMCPKit/Generated/MCPIntents.swift: Codable output
// structs for every codable-safe tool + one `AppIntent` struct per
// selected tool + a single `AppShortcutsProvider` (Apple's 10-entry cap).
//
// Scope now (A.2b.2):
//   • Selection: automatic. Every tool that is eligible, read-only, and
//     not destructive. Destructive tools land in A.3 behind
//     requestConfirmation(actionName:snippetIntent:) (RFC 0007 §R2
//     amended 2026-04-23).
//   • @Parameter types: String, Int, Double, Bool, Date, [String].
//     Optional params become `T?` unless they carry an explicit default.
//   • outputSchema → Codable struct (MCP<PascalName>Output) for every
//     codable-safe tool. Used as a **drift guard** at perform() time —
//     JSONDecoder throws on mismatch before the caller sees stale shape.
//     Return type stays `ReturnsValue<String>` because AppIntent only
//     accepts `_IntentValue`-conforming types (plain Codable needs an
//     AppEntity wrapper, deferred). Axis 4 consumes these structs to
//     render Interactive Snippets.
//   • Top-N AppShortcutsProvider hand-picked (usage-tracker data isn't
//     available at codegen time yet).
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
//
// AskAirMCPIntent (natural-language agent, axis 6) is pinned as the
// first entry on iOS 26+/macOS 26+ — it's the most prominent surface
// AirMCP has on those OS versions. The codegen emits the rest of the
// 10-slot cap from APP_SHORTCUTS_TOP, so a max of 9 tool-based entries
// co-exist with it. The hand-written intent lives in
// swift/Sources/AirMCPKit/AskAirMCPIntent.swift.
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
const pickedSet = new Set(picked);

// Validate the AppShortcutsProvider top list — all names must be in the
// picked set, else Swift compilation fails with "cannot find type".
const appShortcutsPicks = [];
for (const name of APP_SHORTCUTS_TOP) {
  const tool = byName.get(name);
  if (!tool) {
    console.error(`[gen-intents] APP_SHORTCUTS_TOP references missing tool: ${name}`);
    process.exit(2);
  }
  if (!pickedSet.has(tool)) {
    console.error(
      `[gen-intents] APP_SHORTCUTS_TOP references ineligible tool: ${name}` +
        ` (readOnly=${tool.annotations.readOnlyHint}, destructive=${tool.annotations.destructiveHint}, eligible=${tool.appIntentEligible})`,
    );
    process.exit(2);
  }
  appShortcutsPicks.push(tool);
}

// ── Swift codegen helpers ────────────────────────────────────────────

// Keep @Parameter titles short enough to render well in Shortcuts picker
// UIs. 80 is conservative; Apple doesn't publish a hard limit but longer
// strings wrap awkwardly.
const MAX_TITLE_LEN = 80;

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
 * Format a JSON-Schema `default` value as a Swift literal suitable for
 * `@Parameter(default: ...)`. Returns null when the default is absent or
 * doesn't match the target type — caller drops the `default:` clause.
 */
function swiftDefaultLiteral(value, baseType) {
  if (value === undefined) return null;
  if ((baseType === "Int" || baseType === "Double") && typeof value === "number") return String(value);
  if (baseType === "Bool" && typeof value === "boolean") return String(value);
  if (baseType === "String" && typeof value === "string") return `"${swiftLit(value)}"`;
  return null;
}

/**
 * Map a JSON-Schema property to a Swift `@Parameter` declaration.
 * Optional properties (not in inputSchema.required) become Optional<T>
 * unless the schema carries an explicit default.
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
  const safeTitle = swiftLit(title.slice(0, MAX_TITLE_LEN));

  const optsParts = [`title: "${safeTitle}"`];
  const defaultLiteral = swiftDefaultLiteral(propSchema.default, baseType);
  if (defaultLiteral !== null) optsParts.push(`default: ${defaultLiteral}`);

  if (
    (baseType === "Int" || baseType === "Double") &&
    typeof propSchema.minimum === "number" &&
    typeof propSchema.maximum === "number"
  ) {
    optsParts.push(`inclusiveRange: (${propSchema.minimum}, ${propSchema.maximum})`);
  }

  // Optional fields without an explicit default become `T?` so AppIntent
  // treats them as optional. Fields with a default stay non-optional.
  const hasDefault = defaultLiteral !== null;
  const typeName = isRequired || hasDefault ? baseType : `${baseType}?`;

  return `    @Parameter(${optsParts.join(", ")})\n    public var ${propName}: ${typeName}`;
}

/**
 * Render `varName` as the Swift expression the wire accepts for this
 * param's type (Date → ISO-8601 string, else identity). Keeps the
 * required-path and optional-path of `buildArgsBlock` from duplicating
 * the Date special-case.
 */
function wireExpr(type, varName) {
  return type === "Date" ? `ISO8601DateFormatter().string(from: ${varName})` : varName;
}

/**
 * Emit the Swift statements that build the `args` dict for a router call.
 * Returns `{ prelude, argsExpr }` — callers drop `prelude` into the
 * `perform()` body before the call, then pass `argsExpr` to `args:`.
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
    const pairs = decls.map((d) => `"${d.wireName}": ${wireExpr(d.type, d.name)}`).join(", ");
    return { prelude: "", argsExpr: `[${pairs}]` };
  }

  const lines = [`var args: [String: any Sendable] = [:]`];
  for (const d of decls) {
    if (!d.optional) {
      lines.push(`args["${d.wireName}"] = ${wireExpr(d.type, d.name)}`);
    } else {
      lines.push(`if let v = ${d.name} { args["${d.wireName}"] = ${wireExpr(d.type, "v")} }`);
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

// ── outputSchema → Swift Codable (A.2b.2) ────────────────────────────
//
// A tool's outputSchema is JSON Schema that describes the shape of its
// primary text payload (result.ts:ok() serializes the payload into
// content[0].text with JSON.stringify). We codegen a matching Codable
// struct so the generated AppIntent can decode the router's String
// result into a typed value.
//
// Limits (A.2b.2 scope):
//   • Supports type: string / number / integer / boolean
//   • Nullable union {type: [X, "null"]} → Optional<SwiftX>
//   • array → [Element] (with Element recursively mapped)
//   • nested object → nested Swift struct (e.g. ListCalendarsOutput.CalendarsItem)
//   • additionalProperties: true OR {} → the tool is flagged not-codable-safe
//     and falls back to ReturnsValue<String>. Exactly one tool today
//     (audit_log, because of the free-form 'args' field).
//
// Everything else (oneOf, allOf, recursive refs) would require AnyCodable
// or more elaborate machinery — out of A.2b.2 scope.

function isNullableUnion(schema) {
  if (!Array.isArray(schema.type)) return false;
  return schema.type.length === 2 && schema.type.includes("null");
}

function nonNullType(schema) {
  return schema.type.find((t) => t !== "null");
}

function isCodableSafe(schema) {
  if (!schema || typeof schema !== "object") return true;
  if (schema.type === "object") {
    if (schema.additionalProperties === true) return false;
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object" &&
      Object.keys(schema.additionalProperties).length === 0
    ) {
      return false;
    }
    for (const p of Object.values(schema.properties ?? {})) {
      if (!isCodableSafe(p)) return false;
    }
    return true;
  }
  if (schema.type === "array") return isCodableSafe(schema.items);
  return true;
}

/**
 * Map a JSON-Schema node to a Swift type expression, recording any
 * inline-nested object as a sub-struct declaration on `nested`.
 *
 * `path` is the PascalCased path from the outer struct down to this
 * node — used to name nested structs deterministically.
 */
function swiftOutputType(schema, path, nested) {
  if (isNullableUnion(schema)) {
    const inner = nonNullType(schema);
    return swiftOutputType({ ...schema, type: inner }, path, nested) + "?";
  }
  if (schema.type === "string") return "String";
  if (schema.type === "number") return "Double";
  if (schema.type === "integer") return "Int";
  if (schema.type === "boolean") return "Bool";
  if (schema.type === "array") {
    const itemSchema = schema.items ?? {};
    const itemName = `${path}Item`;
    const itemType = swiftOutputType(itemSchema, itemName, nested);
    return `[${itemType}]`;
  }
  if (schema.type === "object") {
    nested.push({ name: path, schema });
    return path;
  }
  // Fallback — shouldn't occur for codable-safe schemas.
  return "String";
}

/**
 * Render an object-typed schema into a Swift struct declaration.
 * Nested object fields are rendered as inner structs (Swift doesn't
 * require forward declarations, so order within the file doesn't matter).
 */
function renderStruct(name, schema, indent = "    ") {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const nested = [];
  const fieldLines = [];

  for (const wireName of Object.keys(props)) {
    const fieldSchema = props[wireName];
    const fieldName = swiftIdent(wireName);
    const pascal = toPascalCase(wireName);
    let fieldType = swiftOutputType(fieldSchema, pascal, nested);
    if (!required.has(wireName) && !fieldType.endsWith("?")) {
      fieldType += "?";
    }
    fieldLines.push(`${indent}public let ${fieldName}: ${fieldType}`);
  }

  const nestedLines = nested.map((n) => renderStruct(n.name, n.schema, indent + "    ")).join("\n");

  // Swift synthesizes CodingKeys from property names unless we override.
  // We override only when at least one wire key had to be escaped (e.g.
  // `class` → `class_`); in that case *every* key must be listed or the
  // compiler rejects the partial enum.
  const anyKeyEscaped = Object.keys(props).some((k) => swiftIdent(k) !== k);
  const codingKeysBlock = anyKeyEscaped
    ? `\n${indent}enum CodingKeys: String, CodingKey {\n` +
      Object.keys(props)
        .map((k) => {
          const ident = swiftIdent(k);
          return `${indent}    case ${ident}${ident !== k ? ` = "${k}"` : ""}`;
        })
        .join("\n") +
      `\n${indent}}`
    : "";

  const body = [nestedLines ? nestedLines + "\n" : "", fieldLines.join("\n"), codingKeysBlock]
    .filter(Boolean)
    .join("\n");

  return `${indent.slice(4)}public struct ${name}: Codable, Sendable {
${body}
${indent.slice(4)}}`;
}

function outputTypeNameFor(tool) {
  // Prefix avoids collisions with existing hand-written types in
  // AirMCPKit (e.g. EventKitService.swift already declares
  // TodayEventsOutput / SearchEventsOutput / SearchRemindersOutput
  // as native EventKit-backed shapes). Generated types are a separate
  // transport layer, not the EventKit-native one.
  return `MCP${toPascalCase(tool.name)}Output`;
}

/**
 * Does this tool ship A.2b.2-level typed output? Requires:
 *   • outputSchema present
 *   • top-level is `type: object` (everything else is too free-form)
 *   • no record-like additionalProperties anywhere in the tree
 */
function hasTypedOutput(tool) {
  const s = tool.outputSchema;
  if (!s || s.type !== "object") return false;
  return isCodableSafe(s);
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
    const isRequired = required.has(wireName);
    decls.push({
      name: swiftIdent(wireName),
      wireName,
      type: baseType,
      isRequired,
      optional: !isRequired && prop.default === undefined,
    });
  }

  const paramDecls = decls
    .map((d) => swiftParamDecl(d.name, props[d.wireName], d.isRequired))
    .filter(Boolean)
    .join("\n\n");
  const { prelude, argsExpr } = buildArgsBlock(decls);

  const callBlock = prelude
    ? `${prelude}
        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`
    : `        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`;

  // A.2b.2 scope note:
  // AppIntent's `ReturnsValue<T>` only accepts Apple's `_IntentValue`-
  // conforming types (String/Int/Date/URL/AppEntity/AppEnum/etc.);
  // plain Codable structs are not acceptable return values without a
  // full AppEntity wrapper. That wrapper has query/display/id facets
  // too big for this phase.
  //
  // Instead, when a tool has a codable-safe outputSchema we *decode*
  // the router's String result through the generated struct as a
  // runtime drift guard — mismatches throw before the user sees an
  // out-of-contract response — but still hand the raw String to
  // `.result(value:)`. The generated struct is also the input shape
  // for axis 4's Interactive Snippets renderer, which will consume
  // `_ = decoded` explicitly. Until then the decode is "validate and
  // discard".
  const typed = hasTypedOutput(tool);
  const returnClause = "some IntentResult & ReturnsValue<String>";
  const tailBlock = typed
    ? `        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "${tool.name}", message: "empty result from router")
        }
        _ = try JSONDecoder().decode(${outputTypeNameFor(tool)}.self, from: data)
        return .result(value: result)`
    : `        return .result(value: result)`;

  return `// Tool: ${tool.name}
public struct ${structName}: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "${title}"
    nonisolated(unsafe) public static var description = IntentDescription("${description}")
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

${paramDecls ? paramDecls + "\n\n" : ""}    public func perform() async throws -> ${returnClause} {
${callBlock}
${tailBlock}
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
  const toolEntries = appShortcutsPicks.map((tool) => {
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

  // AskAirMCPIntent is the natural-language agent entry (axis 6 /
  // FoundationModelsBridge). Pinned as the first Shortcuts suggestion
  // on iOS 26+/macOS 26+ where FoundationModels is available. The
  // #if guard matches AskAirMCPIntent.swift's availability conditions
  // so the provider stays compileable on older SDKs.
  const askShortcut = `        #if canImport(FoundationModels) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            AppShortcut(
                intent: AskAirMCPIntent(),
                phrases: [
                    "Ask \\(.applicationName)",
                    "Ask \\(.applicationName) about my day",
                ],
                shortTitle: "Ask AirMCP",
                systemImageName: "brain.head.profile"
            )
        }
        #endif`;

  return `public struct AirMCPGeneratedShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder public static var appShortcuts: [AppShortcut] {
${askShortcut}
${toolEntries.join("\n")}
    }
}`;
}

// ── outputSchema → Interactive Snippet SwiftUI view (A.4.1) ──────────
//
// RFC 0007 §3.7 renderer. Produces a small SwiftUI view per codable-safe
// tool so Interactive Snippets (iOS 26+ / macOS 26+) can display the
// tool's result inline in Shortcuts / Spotlight / Siri.
//
// A.4.1 scope: view struct only. Wiring the view into each AppIntent's
// `perform()` result (the `.result(value:, view:)` overload) lands in
// A.4.2 so this PR can't regress the iOS 17-compatible baseline.
//
// Shape detection
//   list-object: outputSchema has exactly one `type: array` property
//     whose items are `type: object`. Rendered as a ForEach over the
//     array, each row showing the first string-typed field of the item.
//   list-string: same but items are `type: string`. Rendered ForEach
//     with the raw string.
//   scalar: everything else. Rendered as a VStack of key-value rows.
//
// All views gated on `canImport(SwiftUI) && canImport(AppIntents) &&
// compiler(>=6.3)` + `@available(macOS 26, iOS 26, *)`.

function detectSnippetShape(schema) {
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  const arrayKeys = keys.filter((k) => props[k].type === "array");
  if (arrayKeys.length === 1) {
    const arrayKey = arrayKeys[0];
    const items = props[arrayKey].items ?? {};
    if (items.type === "object") {
      const firstString = Object.keys(items.properties ?? {}).find((k) => items.properties[k].type === "string");
      return { shape: "list-object", arrayField: arrayKey, primaryField: firstString ?? null };
    }
    if (items.type === "string") {
      return { shape: "list-string", arrayField: arrayKey };
    }
  }
  return { shape: "scalar" };
}

function snippetViewNameFor(tool) {
  return `MCP${toPascalCase(tool.name)}SnippetView`;
}

function renderSnippetView(tool) {
  const viewName = snippetViewNameFor(tool);
  const outputType = outputTypeNameFor(tool);
  const info = detectSnippetShape(tool.outputSchema);

  let body;
  if (info.shape === "list-object") {
    const primaryAccess = info.primaryField ? `row.${swiftIdent(info.primaryField)}` : `"(row)"`;
    body = `        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.${swiftIdent(info.arrayField)}.enumerated()), id: \\.offset) { _, row in
                Text(${primaryAccess})
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()`;
  } else if (info.shape === "list-string") {
    body = `        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.${swiftIdent(info.arrayField)}.enumerated()), id: \\.offset) { _, row in
                Text(row)
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()`;
  } else {
    // scalar: show every top-level string/number field as key-value rows.
    const props = tool.outputSchema.properties ?? {};
    const rows = Object.keys(props).map((k) => {
      const ident = swiftIdent(k);
      return `            HStack { Text("${k}"); Spacer(); Text(String(describing: data.${ident})) }`;
    });
    body = `        VStack(alignment: .leading, spacing: 2) {
${rows.join("\n")}
        }
        .padding()`;
  }

  return `// Snippet view for: ${tool.name}  (shape: ${info.shape})
@available(macOS 26, iOS 26, *)
public struct ${viewName}: View {
    public let data: ${outputType}
    public init(data: ${outputType}) { self.data = data }
    public var body: some View {
${body}
    }
}`;
}

// ── Assemble output ──────────────────────────────────────────────────

const typedTools = picked.filter(hasTypedOutput);
const outputStructs = typedTools.map((tool) => {
  const name = outputTypeNameFor(tool);
  return `// Output type for: ${tool.name}\n${renderStruct(name, tool.outputSchema)}`;
});
const snippetViews = typedTools.map((tool) => renderSnippetView(tool));

const header = `// GENERATED — do not edit.
//
// Source: docs/tool-manifest.json
// Generator: scripts/gen-swift-intents.mjs
// RFC 0007 Phase A.2b.2 + A.4.1 — ${picked.length} auto-selected read-only
// tools (${typedTools.length} with typed drift-guards + Interactive Snippet
// SwiftUI views) + ${appShortcutsPicks.length} AppShortcutsProvider entries.
// Run \`npm run gen:intents\` to refresh after tool metadata changes.
// CI guards against drift via \`npm run gen:intents:check\`.
//
// Router runtime is live as of PR #103 (A.2a): macOS execFile stdio and
// iOS in-process MCPServer.callToolText. Every generated intent's
// \`perform()\` hits that router. Typed intents additionally decode the
// router's String result through JSONDecoder.
//
// Snippet views (§3.7) are SwiftUI View structs matching each typed
// output shape. A.4.1 ships the views; A.4.2 will plug them into the
// intents' \`.result(value:, view:)\` overloads. Kept in a separate
// #if so iOS 17 builds stay green.

#if canImport(AppIntents)
import AppIntents
import Foundation

// MARK: - Typed output structs

`;

const intentsHeader = "\n\n// MARK: - AppIntents\n\n";
const shortcutsHeader = "\n\n// MARK: - AppShortcutsProvider\n\n";
const snippetsHeader = `

#endif

// MARK: - Interactive Snippet views (RFC 0007 §3.7, A.4.1)

#if canImport(SwiftUI) && canImport(AppIntents) && compiler(>=6.3)
import SwiftUI

`;

const intents = picked.map(generateIntent).join("\n\n");
const appShortcuts = generateAppShortcuts();

const footer = `

#endif
`;

const source =
  header +
  outputStructs.join("\n\n") +
  intentsHeader +
  intents +
  shortcutsHeader +
  appShortcuts +
  snippetsHeader +
  snippetViews.join("\n\n") +
  footer;

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
