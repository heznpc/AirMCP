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
import {
  swiftIdent,
  toPascalCase,
  intentStructName,
  swiftLit,
  humanizeKey,
  enumCaseName as _enumCaseName,
  enumCaseDisplayLabel,
  enumTypeName,
  intentActionNameFor,
  swiftTypeFor,
  swiftDefaultLiteral,
  enumDefaultLiteral,
  wireExpr,
  isNullableUnion,
  nonNullType,
  outputTypeNameFor,
  snippetViewNameFor,
  detectSnippetShape,
  systemImageFor,
  collectEnums,
  renderAppEnum as _renderAppEnum,
  swiftParamDecl,
  buildArgsBlock,
  resolveFollowUpMap as _resolveFollowUpMap,
  deriveFollowUpFactorySpecs,
} from "./lib/codegen-helpers.mjs";

// CLI wrappers: the lib throws on invalid enum value so tests can
// assert the specific error, but the CLI wants the historic process.exit(2)
// contract (caller expects "codegen failed, stop").
function enumCaseName(value) {
  try {
    return _enumCaseName(value);
  } catch (e) {
    console.error(`[gen-intents] ${e.message}`);
    process.exit(2);
  }
}
function renderAppEnum(entry) {
  try {
    return _renderAppEnum(entry);
  } catch (e) {
    console.error(`[gen-intents] rendering ${entry?.typeName}: ${e.message}`);
    process.exit(2);
  }
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = process.env.AIRMCP_INTENTS_MANIFEST ?? join(ROOT, "docs", "tool-manifest.json");
const OUT_PATH =
  process.env.AIRMCP_INTENTS_OUT ?? join(ROOT, "swift", "Sources", "AirMCPKit", "Generated", "MCPIntents.swift");
const CHECK_ONLY = process.argv.includes("--check");

// ── A.2b.1 + A.3 + A.4 selection ─────────────────────────────────────
// Automatic filter: every AppIntent-eligible tool.
//   • readOnly → direct call, no confirmation
//   • write (non-destructive) → direct call, no confirmation
//   • destructive → gated behind AIRMCP_APPINTENTS_DESTRUCTIVE=true (A.4).
//     Default OFF per RFC 0007 §6 — destructive tools don't appear in
//     Shortcuts / Siri unless explicitly opted in, which yields a safer
//     default surface for users who haven't reviewed the tool inventory.
//     When enabled the A.3 code path runs: `requestConfirmation(
//     actionName:dialog:)` before the router call, `@available(iOS 18,
//     macOS 15, *)` on the struct.
//
// The checked-in Generated/MCPIntents.swift reflects the default
// (destructive OFF). Developers enabling the flag must regenerate
// locally and are expected NOT to commit the expanded file unless
// they also flip the CI step to match.
//
// An explicit SKIP list remains for specific tools that would otherwise
// generate but have known runtime issues we haven't addressed yet. Empty
// at the moment — listed here so future skips are discoverable in one place.
const SKIP_NAMES = new Set([]);

// A.4: opt-in for destructive tools. Accept common truthy strings so
// `AIRMCP_APPINTENTS_DESTRUCTIVE=1` / `=true` / `=yes` / `=on` all
// enable. Anything else (including unset, empty, "false", "0") leaves
// destructive tools filtered out of codegen entirely.
const INCLUDE_DESTRUCTIVE = /^(1|true|yes|on)$/i.test(process.env.AIRMCP_APPINTENTS_DESTRUCTIVE ?? "");

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
// A.3 + A.4: accept every eligible tool unless it's destructive and
// the opt-in flag is off. Destructive tools, when included, still go
// through `generateIntent`'s confirmation dialog path.
const picked = manifest.tools
  .filter((t) => {
    if (!t.appIntentEligible) return false;
    if (SKIP_NAMES.has(t.name)) return false;
    if (t.annotations.destructiveHint && !INCLUDE_DESTRUCTIVE) return false;
    return true;
  })
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

// toPascalCase, intentStructName, intentActionNameFor, swiftLit,
// humanizeKey, enumCaseDisplayLabel, enumTypeName, swiftIdent,
// SWIFT_RESERVED are imported from scripts/lib/codegen-helpers.mjs.
// `enumCaseName` is the top-of-file CLI wrapper that converts the
// library's thrown error into process.exit(2).

// swiftTypeFor imported from scripts/lib/codegen-helpers.mjs.
// enumCaseName (CLI wrapper at top), enumCaseDisplayLabel, enumTypeName
// also imported from there.

/**
 * Scan every picked tool's input schema and collect string enums. Returns
 * a Map<toolName, Map<paramName, {typeName, values, title}>>. Caller uses
 * this to override @Parameter types inside generateIntent and to emit the
 * AppEnum struct block.
 */
// collectEnums imported from scripts/lib/codegen-helpers.mjs.
// renderAppEnum (CLI wrapper at top) wraps the throwing lib version.

// swiftDefaultLiteral imported from scripts/lib/codegen-helpers.mjs.

// swiftParamDecl, buildArgsBlock imported from scripts/lib/codegen-helpers.mjs
// (incl. MAX_TITLE_LEN which swiftParamDecl encapsulates).
// enumDefaultLiteral, wireExpr also imported from there.

// SWIFT_RESERVED, swiftIdent imported from scripts/lib/codegen-helpers.mjs.

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

// isNullableUnion, nonNullType imported from scripts/lib/codegen-helpers.mjs.

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

// outputTypeNameFor imported from scripts/lib/codegen-helpers.mjs.

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
  const toolEnums = enumsByTool.get(tool.name);
  const decls = [];
  for (const wireName of Object.keys(props)) {
    const prop = props[wireName];
    const enumInfo = toolEnums?.get(wireName);
    const baseType = enumInfo?.typeName ?? swiftTypeFor(prop);
    if (baseType === null) continue; // silently dropped — codegen will still compile
    const isRequired = required.has(wireName);
    decls.push({
      name: swiftIdent(wireName),
      wireName,
      type: baseType,
      isEnum: Boolean(enumInfo),
      isRequired,
      optional: !isRequired && prop.default === undefined,
    });
  }

  const paramDecls = decls
    .map((d) => swiftParamDecl(d.name, props[d.wireName], d.isRequired, d.isEnum ? d.type : undefined))
    .filter(Boolean)
    .join("\n\n");
  const { prelude, argsExpr } = buildArgsBlock(decls);

  // A.3: destructive tools block on a `requestConfirmation` call before
  // reaching the router. The `(actionName:dialog:)` overload we use is
  // iOS 18+/macOS 15+, so the whole destructive intent struct carries
  // `@available(iOS 18, macOS 15, *)` below — on iOS 17 / macOS 14 the
  // destructive intent simply doesn't exist, which is the correct
  // security posture (better than shipping an unconfirmed destructive
  // path to paper over the availability gap).
  //
  // Parameter values — the interesting structured part (which event,
  // which file) — are rendered by Shortcuts automatically next to the
  // dialog, so we don't try to inject them into the prose.
  const confirmBlock = tool.annotations.destructiveHint
    ? `        try await requestConfirmation(
            actionName: ${intentActionNameFor(tool.name)},
            dialog: IntentDialog("Run ${title} with AirMCP? This action is destructive and cannot be undone.")
        )
`
    : "";

  const callBlock = prelude
    ? `${prelude}
${confirmBlock}        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`
    : `${confirmBlock}        let result = try await MCPIntentRouter.shared.call(
            tool: "${tool.name}",
            args: ${argsExpr}
        )`;

  // A.2b.2 + A.4.2 scope note:
  // AppIntent's `ReturnsValue<T>` only accepts Apple's `_IntentValue`-
  // conforming types (String/Int/Date/URL/AppEntity/AppEnum/etc.);
  // plain Codable structs are not acceptable return values without a
  // full AppEntity wrapper. That wrapper has query/display/id facets
  // too big for this phase.
  //
  // When a tool has a codable-safe outputSchema we *decode* the router's
  // String result through the generated struct. This serves two purposes:
  //   1. Drift guard — JSONDecoder throws on schema mismatch before the
  //      user sees an out-of-contract response.
  //   2. A.4.2: the decoded payload feeds the matching Interactive
  //      Snippet view via `.result(value:, view:)`. That path is gated
  //      on `canImport(SwiftUI) && compiler(>=6.3)` + `#available(macOS
  //      26, iOS 26, *)` — matching the view's own gate. On older OS /
  //      compilers we fall through to plain `.result(value:)`, so the
  //      decode still runs (drift guard stays) and `_ = decoded` swallows
  //      the unused-variable warning.
  const typed = hasTypedOutput(tool);
  const returnClause = "some IntentResult & ReturnsValue<String>";
  const tailBlock = typed
    ? `        guard let data = result.data(using: .utf8) else {
            throw MCPIntentError.toolCallFailed(tool: "${tool.name}", message: "empty result from router")
        }
        let decoded = try JSONDecoder().decode(${outputTypeNameFor(tool)}.self, from: data)
        #if canImport(SwiftUI) && compiler(>=6.3)
        if #available(macOS 26, iOS 26, *) {
            return .result(value: result, view: ${snippetViewNameFor(tool)}(data: decoded))
        }
        #endif
        _ = decoded
        return .result(value: result)`
    : `        return .result(value: result)`;

  // @available gate for destructive intents — see `confirmBlock` comment.
  const availability = tool.annotations.destructiveHint ? "@available(iOS 18, macOS 15, *)\n" : "";

  return `// Tool: ${tool.name}
${availability}public struct ${structName}: AppIntent {
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

// SYSTEM_IMAGE_BY_PREFIX, systemImageFor imported from scripts/lib/codegen-helpers.mjs.

/**
 * Emit the single AppShortcutsProvider block. Apple caps this at 10.
 * Each phrase uses `\(.applicationName)` so the trigger reads naturally
 * ("list calendars in AirMCP"). systemImage is a stable SF Symbol per
 * tool family — conservative choices that compile against iOS 17+.
 */
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

// ── outputSchema → Interactive Snippet SwiftUI view (A.4.1 + A.4.3) ──
//
// RFC 0007 §3.7 renderer. Produces a small SwiftUI view per codable-safe
// tool so Interactive Snippets (iOS 26+ / macOS 26+) can display the
// tool's result inline in Shortcuts / Spotlight / Siri.
//
// Shape detection
//   list-object: outputSchema has exactly one `type: array` property
//     whose items are `type: object`. Rendered as a ForEach over the
//     array. If the tool is in FOLLOW_UP_MAP (A.4.3), each row is wrapped
//     in `Button(intent: ReadFooIntent(id: row.id))` so tapping a list
//     entry dispatches the follow-up read intent without opening the app
//     — the Interactive Snippet chain promised in RFC §3.7. Otherwise
//     the row stays as a plain Text (A.4.1 baseline).
//   list-string: same but items are `type: string`. Rendered ForEach
//     with the raw string.
//   scalar: everything else. Rendered as a VStack of key-value rows.
//
// All views gated on `canImport(SwiftUI) && canImport(AppIntents) &&
// compiler(>=6.3)` + `@available(macOS 26, iOS 26, *)`.

// A.4.3: list → read follow-up map. Tools in this map render each row
// as `Button(intent: _mkRead<Target>Intent(<targetParam>: row.<itemField>))`
// so taps dispatch the follow-up AppIntent in-place. The
// itemField/targetParam split handles the common case where the list
// result's `id` needs to be plumbed into a target tool whose @Parameter
// has a different name (e.g. list_chats.id → read_chat.chatId).
//
// Validation at load time:
//   • list tool exists in manifest
//   • target tool exists in manifest
//   • list output items have a string field named `itemField`
//   • target input has a @Parameter named `targetParam`
//
// Extending the map is adding one line + re-running codegen.
const FOLLOW_UP_MAP = {
  list_events: { target: "read_event", itemField: "id", targetParam: "id" },
  today_events: { target: "read_event", itemField: "id", targetParam: "id" },
  get_upcoming_events: { target: "read_event", itemField: "id", targetParam: "id" },
  search_events: { target: "read_event", itemField: "id", targetParam: "id" },
  list_notes: { target: "read_note", itemField: "id", targetParam: "id" },
  search_notes: { target: "read_note", itemField: "id", targetParam: "id" },
  list_reminders: { target: "read_reminder", itemField: "id", targetParam: "id" },
  search_reminders: { target: "read_reminder", itemField: "id", targetParam: "id" },
  list_contacts: { target: "read_contact", itemField: "id", targetParam: "id" },
  search_contacts: { target: "read_contact", itemField: "id", targetParam: "id" },
  // Messages: list_messages.id → read_message.id (clean match).
  list_messages: { target: "read_message", itemField: "id", targetParam: "id" },
  // Chats: list output uses `id`, read expects `chatId`. The mapping
  // here lets the codegen plumb row.id → chatId: without changing the
  // wire contract.
  list_chats: { target: "read_chat", itemField: "id", targetParam: "chatId" },
  search_chats: { target: "read_chat", itemField: "id", targetParam: "chatId" },
};

// humanizeKey imported from scripts/lib/codegen-helpers.mjs.

/**
 * Render one row of the scalar snippet view VStack. Value rendering is
 * type-aware:
 *   • Bool                      → "Yes" / "No"
 *   • Int / Double              → `.formatted()` (locale separators)
 *   • String w/ format=date-time → ISO parse, then `.formatted(date:time:)`
 *   • String (default)          → raw, `.lineLimit(1)` tail-truncated
 *   • everything else           → String(describing:)
 *
 * Optional fields get an `?? "—"` fallback so nil values render as an em
 * dash rather than disappearing (keeps the row stable).
 */
function renderScalarRow(key, propSchema) {
  const ident = swiftIdent(key);
  const label = humanizeKey(key);
  const schema = isNullableUnion(propSchema) ? { ...propSchema, type: nonNullType(propSchema) } : propSchema;
  const isOptional = isNullableUnion(propSchema);
  const accessor = `data.${ident}`;

  let valueExpr;
  if (schema.type === "boolean") {
    valueExpr = isOptional
      ? `(${accessor}.map { $0 ? "Yes" : "No" } ?? "—")`
      : `(${accessor} ? "Yes" : "No")`;
  } else if (schema.type === "integer" || schema.type === "number") {
    valueExpr = isOptional
      ? `(${accessor}?.formatted() ?? "—")`
      : `${accessor}.formatted()`;
  } else if (schema.type === "string" && schema.format === "date-time") {
    // ISO8601DateFormatter is Sendable on modern SDKs and cheap to
    // instantiate once per render. The `?? raw` fallback keeps the UI
    // working when the wire value isn't parseable (should never happen
    // but better than rendering "nil").
    const raw = isOptional ? `(${accessor} ?? "")` : accessor;
    valueExpr = `(ISO8601DateFormatter().date(from: ${raw}).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ${raw})`;
  } else if (schema.type === "string") {
    valueExpr = isOptional ? `(${accessor} ?? "—")` : accessor;
  } else {
    valueExpr = `String(describing: ${accessor})`;
  }

  return `            HStack {
                Text("${swiftLit(label)}")
                Spacer()
                Text(${valueExpr})
                    .lineLimit(1)
                    .truncationMode(.tail)
            }`;
}

// detectSnippetShape imported from scripts/lib/codegen-helpers.mjs.

// CLI wrapper: lib's resolveFollowUpMap throws on any invariant
// violation so tests can assert the specific error; the CLI needs
// the historic process.exit(2) contract.
let followUpMap;
try {
  followUpMap = _resolveFollowUpMap(FOLLOW_UP_MAP, byName);
} catch (e) {
  console.error(`[gen-intents] ${e.message}`);
  process.exit(2);
}
const followUpFactorySpecs = deriveFollowUpFactorySpecs(followUpMap);

// snippetViewNameFor imported from scripts/lib/codegen-helpers.mjs.

function renderSnippetView(tool) {
  const viewName = snippetViewNameFor(tool);
  const outputType = outputTypeNameFor(tool);
  const info = detectSnippetShape(tool.outputSchema);

  let body;
  if (info.shape === "list-object") {
    // Optional string fields decode to `String?`; render with `?? ""`
    // so SwiftUI sees a non-optional for Text().
    const primaryAccess = info.primaryField
      ? info.primaryFieldOptional
        ? `(row.${swiftIdent(info.primaryField)} ?? "")`
        : `row.${swiftIdent(info.primaryField)}`
      : `"(row)"`;
    const followUp = followUpMap[tool.name];
    // A.4.3: wrap the row in Button(intent:) when the tool has a list→read
    // pairing AND the list items carry the expected itemField. Uses
    // `id: \.id` for the ForEach key (items with string `id` always exist
    // when a follow-up is configured) so SwiftUI diffs correctly across
    // follow-up taps — the old `id: \.offset` was safe only for
    // static-display rows. The factory argument label is the follow-up
    // target's @Parameter name (may differ from itemField, e.g.
    // list_chats.id → read_chat.chatId).
    if (followUp && info.hasId) {
      const factory = `_mk${followUp.factoryKey}`;
      body = `        VStack(alignment: .leading, spacing: 4) {
            ForEach(data.${swiftIdent(info.arrayField)}, id: \\.id) { row in
                Button(intent: ${factory}(${swiftIdent(followUp.targetParam)}: row.${swiftIdent(followUp.itemField)})) {
                    Text(${primaryAccess})
                        .font(.body)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding()`;
    } else {
      body = `        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(data.${swiftIdent(info.arrayField)}.enumerated()), id: \\.offset) { _, row in
                Text(${primaryAccess})
                    .font(.body)
                    .lineLimit(1)
            }
        }
        .padding()`;
    }
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
    // scalar: show every top-level field as a key-value row. Each row
    // renders with a humanized key label ("stepsToday" → "Steps Today"),
    // type-aware value formatting (booleans as Yes/No, numbers via
    // `.formatted()` for locale-aware separators, ISO date strings
    // parsed to `Date.formatted(.abbreviated time: .shortened)` when
    // the schema declares `format: date-time`), and a `.lineLimit(1)`
    // tail truncation so long strings don't blow out the snippet card.
    const props = tool.outputSchema.properties ?? {};
    const rows = Object.keys(props).map((k) => renderScalarRow(k, props[k]));
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

// Enum collection must run before generateIntent — per-tool lookup is
// read there to override @Parameter types. Collected from every picked
// tool (including destructive); AppEnum structs are iOS 16+/macOS 13+
// and the @available on each struct matches.
const enumsByTool = collectEnums(picked);
const appEnumStructs = [];
for (const params of enumsByTool.values()) {
  for (const entry of params.values()) {
    appEnumStructs.push(renderAppEnum(entry));
  }
}

const typedTools = picked.filter(hasTypedOutput);
const outputStructs = typedTools.map((tool) => {
  const name = outputTypeNameFor(tool);
  return `// Output type for: ${tool.name}\n${renderStruct(name, tool.outputSchema)}`;
});
const snippetViews = typedTools.map((tool) => renderSnippetView(tool));

// A.4.3: one factory per (target intent, target param) pair so the
// snippet view can construct a parameterized intent instance (AppIntent
// requires a no-arg init + property set — a plain `Read<Foo>Intent(
// id:)` call site doesn't compile). File-private keeps the helpers out
// of the public surface. Factory name = `_mk<Intent>_<param>` so
// list_chats (→ read_chat.chatId) and list_events (→ read_event.id)
// each get their own helper even when they share a target intent.
const followUpFactories = followUpFactorySpecs.map(
  ({ targetIntentName, targetParam }) => {
    const paramIdent = swiftIdent(targetParam);
    return `@available(macOS 26, iOS 26, *)
fileprivate func _mk${targetIntentName}_${targetParam}(${paramIdent}: String) -> ${targetIntentName} {
    var intent = ${targetIntentName}()
    intent.${paramIdent} = ${paramIdent}
    return intent
}`;
  },
);

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

const appEnumsHeader = "\n\n// MARK: - AppEnum types\n\n";
const intentsHeader = "\n\n// MARK: - AppIntents\n\n";
const shortcutsHeader = "\n\n// MARK: - AppShortcutsProvider\n\n";
const snippetsHeader = `

#endif

// MARK: - Interactive Snippet views (RFC 0007 §3.7, A.4.1 + A.4.3)

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
  (appEnumStructs.length > 0 ? appEnumsHeader + appEnumStructs.join("\n\n") : "") +
  intentsHeader +
  intents +
  shortcutsHeader +
  appShortcuts +
  snippetsHeader +
  (followUpFactories.length > 0 ? followUpFactories.join("\n\n") + "\n\n" : "") +
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
