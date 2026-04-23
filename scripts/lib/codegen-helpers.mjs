// RFC 0007 Swift codegen — pure helper functions.
//
// Extracted from scripts/gen-swift-intents.mjs so they can be
// exercised by unit tests (see tests/codegen-helpers.test.js)
// without spinning up the full manifest → codegen pipeline. Every
// function here is input → output with no I/O, no process.env read,
// no filesystem access.
//
// Keeping these in a shared module also prepares the ground for a
// future split of gen-swift-intents.mjs into focused files — that
// refactor is deferred until the RFC 0007 stack merges (see the
// PR chain 112 → 123).

// Swift reserved words — Swift identifiers can't use `default`,
// `class`, `init`, etc. Map any collision to a `_`-suffixed name;
// the JSON-Schema property name stays the wire contract, the Swift
// variable just dodges the keyword.
export const SWIFT_RESERVED = new Set([
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

export function swiftIdent(name) {
  return SWIFT_RESERVED.has(name) ? `${name}_` : name;
}

// snake_case / kebab-case / mixed → PascalCase. Skills may arrive
// with dashes (e.g. `skill_focus-guardian`); Swift identifiers
// require alphanumeric only, so split on any non-word char.
export function toPascalCase(snake) {
  return snake
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

// audit_log → AuditLogIntent. Avoids collision with hand-written
// intents that live in app/Sources/AirMCPApp (different Swift module).
export function intentStructName(toolName) {
  return `${toPascalCase(toolName)}Intent`;
}

// Swift-safe string literal for a LocalizedStringResource /
// description. Escapes backslashes and double-quotes. Strips newlines
// to avoid breaking the single-line literal form AppIntent accepts.
export function swiftLit(s) {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
}

// Humanize a camelCase / snake_case property name into a display
// label. "stepsToday" → "Steps Today", "sleep_hours" → "Sleep Hours".
export function humanizeKey(key) {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Swift identifier for an enum case value. JSON-Schema enum values
// we currently carry are all pure [A-Za-z_][A-Za-z0-9_]* (verified
// via the manifest). Non-identifier-safe values throw — this forces
// a future manifest slip to surface at codegen time, not as Swift
// compile errors.
export function enumCaseName(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`enum value "${value}" is not a safe Swift identifier`);
  }
  return SWIFT_RESERVED.has(value) ? `${value}_` : value;
}

// Human-readable display label for an enum case, shown in the
// Shortcuts picker. "nextTrack" → "Next Track", "selection" →
// "Selection".
export function enumCaseDisplayLabel(value) {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Per-tool, per-param AppEnum type name. Using a tool-scoped name
// avoids cross-tool collision when two tools define the same param
// name with different enum value sets.
export function enumTypeName(toolName, paramName) {
  return `${toPascalCase(toolName)}${toPascalCase(paramName)}Option`;
}

// Pick a `ConfirmationActionName` literal for a destructive tool.
// Apple only exposes `.go` and `.send` on this type as of iOS 26
// (checked with `swiftc -typecheck` — `.delete`/`.save` don't compile,
// and `ConfirmationActionName` has no public initializers), so we map:
//   send/reply/post → `.send` (renders as "Send")
//   everything else → `.go`  (generic verb)
export function intentActionNameFor(toolName) {
  if (/^(send|reply|post)_/.test(toolName)) return ".send";
  return ".go";
}

// ── JSON-Schema type mapping ───────────────────────────────────────────

// Pick the Swift type for a JSON-Schema property. Returns null if the
// type isn't representable as a single @Parameter (callers silently
// drop such properties from intent codegen). String enums are handled
// at generateIntent time via `collectEnums` — this function sees the
// primitive only.
export function swiftTypeFor(propSchema) {
  if (propSchema.type === "string") {
    if (propSchema.format === "date-time") return "Date";
    return "String";
  }
  if (propSchema.type === "integer") return "Int";
  if (propSchema.type === "number") return "Double";
  if (propSchema.type === "boolean") return "Bool";
  if (propSchema.type === "array" && propSchema.items?.type === "string") return "[String]";
  return null;
}

// Format a JSON-Schema `default` value as a Swift literal suitable for
// `@Parameter(default: ...)`. Returns null when the default is absent
// or doesn't match the target type — caller drops the `default:` clause.
export function swiftDefaultLiteral(value, baseType) {
  if (value === undefined) return null;
  if ((baseType === "Int" || baseType === "Double") && typeof value === "number") return String(value);
  if (baseType === "Bool" && typeof value === "boolean") return String(value);
  if (baseType === "String" && typeof value === "string") return `"${swiftLit(value)}"`;
  return null;
}

// Format a JSON-Schema `default` value for an AppEnum-backed param.
// Returns `.caseName` or null if the value isn't one of the declared
// enum values (in which case the generator drops the `default:` clause).
export function enumDefaultLiteral(value, enumValues) {
  if (typeof value !== "string" || !enumValues?.includes(value)) return null;
  return `.${enumCaseName(value)}`;
}

// Render `varName` as the Swift expression the wire accepts for this
// param's type. Date → ISO 8601 string. AppEnum → `.rawValue`.
// Everything else → identity.
export function wireExpr(type, varName, isEnum) {
  if (isEnum) return `${varName}.rawValue`;
  return type === "Date" ? `ISO8601DateFormatter().string(from: ${varName})` : varName;
}

// JSON Schema supports nullable via `type: ["string", "null"]` — we
// treat anything matching that shape as optional. Alternate null
// encodings (anyOf, oneOf) need explicit support if they ever appear
// in the manifest.
export function isNullableUnion(schema) {
  if (!schema || !Array.isArray(schema.type)) return false;
  return schema.type.length === 2 && schema.type.includes("null");
}

export function nonNullType(schema) {
  if (!schema || !Array.isArray(schema.type)) return null;
  return schema.type.find((t) => t !== "null");
}

// ── Naming helpers for generated Swift types ───────────────────────────

// Codable output struct name: `list_events` → `MCPListEventsOutput`.
// Prefix avoids collision with hand-written types in AirMCPKit
// (EventKitService.swift declares `TodayEventsOutput` etc. as separate
// EventKit-backed shapes).
export function outputTypeNameFor(tool) {
  return `MCP${toPascalCase(tool.name)}Output`;
}

// SwiftUI snippet view name: `list_events` → `MCPListEventsSnippetView`.
export function snippetViewNameFor(tool) {
  return `MCP${toPascalCase(tool.name)}SnippetView`;
}

// ── Snippet shape detection ────────────────────────────────────────────

// Decide how a tool's outputSchema renders as an Interactive Snippet.
// Three shapes:
//   • list-object: exactly one `type: array` property whose items are
//     objects. Row rendering uses the first non-`id` string field for
//     display; optional primary fields (`type: ["string", "null"]`)
//     render with `?? ""`.
//   • list-string: exactly one `type: array` of strings.
//   • scalar: everything else — key/value row per top-level field.
export function detectSnippetShape(schema) {
  const props = schema?.properties ?? {};
  const arrayKeys = Object.keys(props).filter((k) => props[k].type === "array");
  if (arrayKeys.length === 1) {
    const arrayKey = arrayKeys[0];
    const items = props[arrayKey].items ?? {};
    if (items.type === "object") {
      const itemProps = items.properties ?? {};
      // `type: "string"` and `type: ["string", "null"]` both count.
      const isStringish = (p) =>
        p != null && (p.type === "string" || (Array.isArray(p.type) && p.type.includes("string")));
      const stringKeys = Object.keys(itemProps).filter((k) => isStringish(itemProps[k]));
      const primaryField = stringKeys.find((k) => k !== "id") ?? stringKeys[0] ?? null;
      const primaryFieldOptional = primaryField ? Array.isArray(itemProps[primaryField].type) : false;
      const hasId = isStringish(itemProps.id);
      return { shape: "list-object", arrayField: arrayKey, primaryField, primaryFieldOptional, hasId };
    }
    if (items.type === "string") {
      return { shape: "list-string", arrayField: arrayKey };
    }
  }
  return { shape: "scalar" };
}

// ── AppShortcutsProvider SF Symbol mapping ─────────────────────────────

// Regex-prefix → SF Symbol for the AppShortcutsProvider's `systemImageName`.
// Conservative picks that compile against iOS 17+. Order matters — the
// first match wins, so specific patterns (list_calendars) come before
// fuzzier catch-alls.
export const SYSTEM_IMAGE_BY_PREFIX = [
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

export function systemImageFor(toolName) {
  for (const [re, img] of SYSTEM_IMAGE_BY_PREFIX) {
    if (re.test(toolName)) return img;
  }
  return "app.connected.to.app.below.fill";
}

// ── @Parameter declaration + args dict synthesis ───────────────────────

// Keep @Parameter titles short enough to render well in Shortcuts
// picker UIs. 80 is conservative; Apple doesn't publish a hard limit
// but longer strings wrap awkwardly.
export const MAX_TITLE_LEN = 80;

// Render a Swift `@Parameter(...) public var foo: T` declaration from a
// JSON-Schema property. Optional properties (not in `inputSchema.required`)
// become `Optional<T>` unless the schema carries an explicit default.
// Non-primitive or composite shapes return null; callers filter the
// property out of the generated intent entirely.
//
// `enumTypeOverride` — when the caller has pre-resolved an AppEnum
// type for this param (via `collectEnums`), the declaration uses that
// type and skips the redundant "Allowed: a, b, c" description tail.
export function swiftParamDecl(propName, propSchema, isRequired, enumTypeOverride) {
  const baseType = enumTypeOverride ?? swiftTypeFor(propSchema);
  if (baseType === null) return null;

  const descParts = [];
  if (propSchema.description) descParts.push(propSchema.description);
  if (!enumTypeOverride && Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    descParts.push(`Allowed: ${propSchema.enum.join(", ")}`);
  }
  const title = descParts.join(" · ") || propName;
  const safeTitle = swiftLit(title.slice(0, MAX_TITLE_LEN));

  const optsParts = [`title: "${safeTitle}"`];
  const defaultLiteral = enumTypeOverride
    ? enumDefaultLiteral(propSchema.default, propSchema.enum)
    : swiftDefaultLiteral(propSchema.default, baseType);
  if (defaultLiteral !== null) optsParts.push(`default: ${defaultLiteral}`);

  if (
    (baseType === "Int" || baseType === "Double") &&
    typeof propSchema.minimum === "number" &&
    typeof propSchema.maximum === "number"
  ) {
    optsParts.push(`inclusiveRange: (${propSchema.minimum}, ${propSchema.maximum})`);
  }

  const hasDefault = defaultLiteral !== null;
  const typeName = isRequired || hasDefault ? baseType : `${baseType}?`;

  return `    @Parameter(${optsParts.join(", ")})\n    public var ${propName}: ${typeName}`;
}

// Emit the Swift statements that build the `args` dict passed to
// `MCPIntentRouter.shared.call(tool:, args:)`. Returns `{ prelude,
// argsExpr }` — the caller drops `prelude` into the `perform()` body
// before the call, then passes `argsExpr` to `args:`.
//
// Optional properties render as `if let ... { args[...] = ... }` so
// nil fields don't cross the wire as JSON `null` — the Node-side
// JSON-Schema validator treats absent-vs-null differently for optionals.
//
// decls is an array of `{ name, wireName, type, isEnum, optional, ... }`
// objects produced by the generator when iterating `inputSchema.properties`.
export function buildArgsBlock(decls) {
  if (decls.length === 0) {
    return { prelude: "", argsExpr: "[String: any Sendable]()" };
  }

  const allRequired = decls.every((d) => !d.optional);
  if (allRequired) {
    const pairs = decls.map((d) => `"${d.wireName}": ${wireExpr(d.type, d.name, d.isEnum)}`).join(", ");
    return { prelude: "", argsExpr: `[${pairs}]` };
  }

  const lines = [`var args: [String: any Sendable] = [:]`];
  for (const d of decls) {
    if (!d.optional) {
      lines.push(`args["${d.wireName}"] = ${wireExpr(d.type, d.name, d.isEnum)}`);
    } else {
      lines.push(`if let v = ${d.name} { args["${d.wireName}"] = ${wireExpr(d.type, "v", d.isEnum)} }`);
    }
  }
  return { prelude: lines.map((l) => `        ${l}`).join("\n"), argsExpr: "args" };
}

// ── AppEnum collection + rendering ─────────────────────────────────────

// Scan every tool's input schema and collect string enums. Returns
// Map<toolName, Map<paramName, { typeName, values, title }>>. Caller
// uses this to override @Parameter types inside generateIntent and to
// emit the AppEnum struct block.
export function collectEnums(tools) {
  const perTool = new Map();
  for (const tool of tools) {
    const props = tool.inputSchema?.properties ?? {};
    for (const [paramName, schema] of Object.entries(props)) {
      if (schema.type !== "string" || !Array.isArray(schema.enum) || schema.enum.length === 0) continue;
      let params = perTool.get(tool.name);
      if (!params) {
        params = new Map();
        perTool.set(tool.name, params);
      }
      params.set(paramName, {
        typeName: enumTypeName(tool.name, paramName),
        values: schema.enum,
        title: schema.description ?? paramName,
      });
    }
  }
  return perTool;
}

// Render one entry from `collectEnums` output as a Swift AppEnum
// declaration. AppEnum's protocol requirements are `static var { get
// set }` so we can't use `let`; `nonisolated(unsafe)` matches the
// pattern on generated intent struct statics — Swift 6 strict
// concurrency sees the var as mutable, but in practice AppEnum
// metadata is set-once-at-load framework state.
//
// Throws via `enumCaseName` if any value is not a Swift-identifier-safe
// string. Callers in the CLI path wrap with process.exit(2); tests can
// assert the exact error.
export function renderAppEnum(entry) {
  const { typeName, values, title } = entry;
  const caseList = values.map(enumCaseName).join(", ");
  const caseMap = values
    .map((v) => `        .${enumCaseName(v)}: "${enumCaseDisplayLabel(v)}"`)
    .join(",\n");
  return `@available(iOS 16, macOS 13, *)
public enum ${typeName}: String, AppEnum {
    case ${caseList}
    nonisolated(unsafe) public static var typeDisplayRepresentation: TypeDisplayRepresentation = "${swiftLit(title).slice(0, 80)}"
    nonisolated(unsafe) public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
${caseMap}
    ]
}`;
}

// ── Follow-up intent resolution (RFC 0007 §3.7 / A.4.3) ────────────────

// Validate a FOLLOW_UP_MAP config against the manifest and produce a
// resolved map keyed by list tool. Throws on any invariant violation so
// codegen fails fast with a specific error; CLI callers wrap with
// process.exit(2).
//
//   config    = { [listToolName]: { target, itemField, targetParam } }
//   byName    = Map<toolName, manifestToolEntry>
//
// Returns `{ [listToolName]: { target, itemField, targetParam,
//   targetIntentName, factoryKey } }` where `factoryKey` is the dedupe
// key for per-`(target, targetParam)` SwiftUI Button factories.
//
// Invariants checked:
//   • list tool exists in manifest
//   • target tool exists
//   • list's output schema is a list-object shape (via detectSnippetShape)
//   • list items have a string field named `itemField`
//   • target tool has an @Parameter named `targetParam`
export function resolveFollowUpMap(config, byName) {
  const resolved = {};
  for (const [listName, entry] of Object.entries(config)) {
    const listTool = byName.get(listName);
    if (!listTool) {
      throw new Error(`FOLLOW_UP_MAP: list tool missing: ${listName}`);
    }
    const target = byName.get(entry.target);
    if (!target) {
      throw new Error(`FOLLOW_UP_MAP: target tool missing: ${entry.target}`);
    }

    const info = detectSnippetShape(listTool.outputSchema ?? {});
    if (info.shape !== "list-object") {
      throw new Error(
        `FOLLOW_UP_MAP: ${listName} is not a list-object shape (got ${info.shape})`,
      );
    }

    const itemProps = listTool.outputSchema?.properties?.[info.arrayField]?.items?.properties ?? {};
    if (itemProps[entry.itemField]?.type !== "string") {
      throw new Error(
        `FOLLOW_UP_MAP: ${listName} items have no string field "${entry.itemField}" (fields: ${Object.keys(itemProps).join(", ")})`,
      );
    }

    const targetParams = Object.keys(target.inputSchema?.properties ?? {});
    if (!targetParams.includes(entry.targetParam)) {
      throw new Error(
        `FOLLOW_UP_MAP: target ${entry.target} has no @Parameter named "${entry.targetParam}" (params: ${targetParams.join(", ")})`,
      );
    }

    const targetIntentName = intentStructName(entry.target);
    resolved[listName] = {
      ...entry,
      targetIntentName,
      // Factory key by (target, targetParam). Two list tools pointing
      // at the same read target with the same param share one factory;
      // two list tools pointing at the same target via different params
      // (unlikely but possible) each get their own.
      factoryKey: `${targetIntentName}_${entry.targetParam}`,
    };
  }
  return resolved;
}

// Deduplicate resolved follow-up entries by `(targetIntentName,
// targetParam)` so the codegen emits one factory per unique signature
// even when multiple list tools point at the same target.
export function deriveFollowUpFactorySpecs(resolvedMap) {
  return Array.from(
    new Map(
      Object.values(resolvedMap).map((e) => [
        e.factoryKey,
        { targetIntentName: e.targetIntentName, targetParam: e.targetParam },
      ]),
    ).values(),
  );
}
