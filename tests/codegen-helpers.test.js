// scripts/lib/codegen-helpers.mjs — unit tests.
//
// The helpers here drive every AppIntent struct name, parameter
// label, enum case name, and Shortcuts display string the Swift
// codegen emits. Output drift is already caught by gen:intents:check
// in CI, but a pure-function test at this layer fails faster + gives
// a specific error message when someone tweaks a helper without
// realising it also changes the wire-facing struct name for all 229
// intents.

import { describe, test, expect } from "@jest/globals";
import {
  SWIFT_RESERVED,
  swiftIdent,
  toPascalCase,
  intentStructName,
  swiftLit,
  humanizeKey,
  enumCaseName,
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
} from "../scripts/lib/codegen-helpers.mjs";

describe("toPascalCase", () => {
  test("snake_case joins without underscore", () => {
    expect(toPascalCase("audit_log")).toBe("AuditLog");
    expect(toPascalCase("list_events")).toBe("ListEvents");
    expect(toPascalCase("today_events")).toBe("TodayEvents");
  });

  test("single-word stays title-cased", () => {
    expect(toPascalCase("doctor")).toBe("Doctor");
    expect(toPascalCase("SCREAMING")).toBe("Screaming");
  });

  test("non-word separators split (skill_focus-guardian → SkillFocusGuardian)", () => {
    expect(toPascalCase("skill_focus-guardian")).toBe("SkillFocusGuardian");
    expect(toPascalCase("gws.calendar.create")).toBe("GwsCalendarCreate");
  });

  test("digits preserved", () => {
    expect(toPascalCase("rfc_0007_intent")).toBe("Rfc0007Intent");
  });

  test("empty string → empty string", () => {
    expect(toPascalCase("")).toBe("");
  });
});

describe("intentStructName", () => {
  test("wraps toPascalCase with Intent suffix", () => {
    expect(intentStructName("list_events")).toBe("ListEventsIntent");
    expect(intentStructName("read_note")).toBe("ReadNoteIntent");
    expect(intentStructName("playback_control")).toBe("PlaybackControlIntent");
  });
});

describe("swiftIdent", () => {
  test("passes non-reserved names through", () => {
    expect(swiftIdent("id")).toBe("id");
    expect(swiftIdent("chatId")).toBe("chatId");
    expect(swiftIdent("startDate")).toBe("startDate");
  });

  test("suffixes reserved words with _", () => {
    expect(swiftIdent("default")).toBe("default_");
    expect(swiftIdent("class")).toBe("class_");
    expect(swiftIdent("case")).toBe("case_");
    expect(swiftIdent("switch")).toBe("switch_");
    expect(swiftIdent("in")).toBe("in_");
  });

  test("SWIFT_RESERVED contains expected core keywords", () => {
    // Spot-check the set — if any of these disappear a wire-contract
    // change slipped in.
    expect(SWIFT_RESERVED.has("default")).toBe(true);
    expect(SWIFT_RESERVED.has("case")).toBe(true);
    expect(SWIFT_RESERVED.has("func")).toBe(true);
    expect(SWIFT_RESERVED.has("typealias")).toBe(true);
  });
});

describe("swiftLit", () => {
  test("escapes backslashes and double-quotes", () => {
    expect(swiftLit('say "hi"')).toBe('say \\"hi\\"');
    expect(swiftLit("path\\with\\backslash")).toBe("path\\\\with\\\\backslash");
  });

  test("strips newlines (single-line literal form)", () => {
    expect(swiftLit("line 1\nline 2")).toBe("line 1 line 2");
    expect(swiftLit("line 1\r\nline 2")).toBe("line 1 line 2");
  });

  test("trims surrounding whitespace", () => {
    expect(swiftLit("  padded  ")).toBe("padded");
  });

  test("handles null / undefined without throwing", () => {
    expect(swiftLit(null)).toBe("");
    expect(swiftLit(undefined)).toBe("");
  });
});

describe("humanizeKey", () => {
  test("camelCase → spaced title case", () => {
    expect(humanizeKey("stepsToday")).toBe("Steps Today");
    expect(humanizeKey("sleepHoursLastNight")).toBe("Sleep Hours Last Night");
    expect(humanizeKey("id")).toBe("Id");
  });

  test("snake_case → spaced title case", () => {
    expect(humanizeKey("sleep_hours")).toBe("Sleep Hours");
    expect(humanizeKey("heart_rate_avg_7d")).toBe("Heart Rate Avg 7d");
  });

  test("kebab-case → spaced title case", () => {
    expect(humanizeKey("next-track")).toBe("Next Track");
  });

  test("single words stay title-cased", () => {
    expect(humanizeKey("temperature")).toBe("Temperature");
  });
});

describe("enumCaseName", () => {
  test("passes identifier-safe values through", () => {
    expect(enumCaseName("play")).toBe("play");
    expect(enumCaseName("nextTrack")).toBe("nextTrack");
    expect(enumCaseName("ok")).toBe("ok");
    expect(enumCaseName("AXConfirm")).toBe("AXConfirm");
  });

  test("reserved words get _ suffix", () => {
    expect(enumCaseName("default")).toBe("default_");
  });

  test("throws on identifier-unsafe values", () => {
    expect(() => enumCaseName("next-track")).toThrow(/not a safe Swift identifier/);
    expect(() => enumCaseName("2fast")).toThrow(/not a safe Swift identifier/);
    expect(() => enumCaseName("with space")).toThrow(/not a safe Swift identifier/);
    expect(() => enumCaseName("")).toThrow(/not a safe Swift identifier/);
  });
});

describe("enumCaseDisplayLabel", () => {
  test("camelCase → title-cased with spaces", () => {
    expect(enumCaseDisplayLabel("nextTrack")).toBe("Next Track");
    expect(enumCaseDisplayLabel("previousTrack")).toBe("Previous Track");
  });

  test("single-word values get first letter capitalised", () => {
    expect(enumCaseDisplayLabel("play")).toBe("Play");
    expect(enumCaseDisplayLabel("selection")).toBe("Selection");
    expect(enumCaseDisplayLabel("ok")).toBe("Ok");
  });

  test("preserves acronym boundaries (AXConfirm stays readable)", () => {
    // Only splits on lowercase-uppercase boundary. AXConfirm has no
    // such boundary at the start, so it stays as "AXConfirm" with
    // first letter already uppercase.
    expect(enumCaseDisplayLabel("AXConfirm")).toBe("AXConfirm");
  });
});

describe("enumTypeName", () => {
  test("tool + param combined into scoped name", () => {
    expect(enumTypeName("playback_control", "action")).toBe("PlaybackControlActionOption");
    expect(enumTypeName("memory_query", "kind")).toBe("MemoryQueryKindOption");
  });

  test("avoids collision when two tools share a param name", () => {
    expect(enumTypeName("memory_put", "kind")).toBe("MemoryPutKindOption");
    expect(enumTypeName("memory_query", "kind")).toBe("MemoryQueryKindOption");
    expect(enumTypeName("memory_put", "kind")).not.toBe(enumTypeName("memory_query", "kind"));
  });
});

describe("intentActionNameFor", () => {
  test("send_* / reply_* / post_* → .send", () => {
    expect(intentActionNameFor("send_mail")).toBe(".send");
    expect(intentActionNameFor("send_message")).toBe(".send");
    expect(intentActionNameFor("reply_mail")).toBe(".send");
    expect(intentActionNameFor("post_status")).toBe(".send");
  });

  test("everything else → .go (ConfirmationActionName limitation)", () => {
    expect(intentActionNameFor("delete_event")).toBe(".go");
    expect(intentActionNameFor("trash_file")).toBe(".go");
    expect(intentActionNameFor("update_reminder")).toBe(".go");
    expect(intentActionNameFor("system_power")).toBe(".go");
    expect(intentActionNameFor("quit_app")).toBe(".go");
  });

  test("non-destructive names also map (function is only called on destructive, but mapping is pure)", () => {
    expect(intentActionNameFor("list_events")).toBe(".go");
    expect(intentActionNameFor("read_note")).toBe(".go");
  });
});

describe("swiftTypeFor", () => {
  test("primitive scalars", () => {
    expect(swiftTypeFor({ type: "string" })).toBe("String");
    expect(swiftTypeFor({ type: "integer" })).toBe("Int");
    expect(swiftTypeFor({ type: "number" })).toBe("Double");
    expect(swiftTypeFor({ type: "boolean" })).toBe("Bool");
  });

  test("date-time format → Date", () => {
    expect(swiftTypeFor({ type: "string", format: "date-time" })).toBe("Date");
  });

  test("string array → [String]", () => {
    expect(swiftTypeFor({ type: "array", items: { type: "string" } })).toBe("[String]");
  });

  test("composite shapes → null (silently dropped by caller)", () => {
    expect(swiftTypeFor({ type: "object" })).toBeNull();
    expect(swiftTypeFor({ type: "array", items: { type: "object" } })).toBeNull();
    expect(swiftTypeFor({ type: "unknown" })).toBeNull();
  });
});

describe("swiftDefaultLiteral", () => {
  test("numeric defaults round-trip as Swift literals", () => {
    expect(swiftDefaultLiteral(50, "Int")).toBe("50");
    expect(swiftDefaultLiteral(3.14, "Double")).toBe("3.14");
  });

  test("bool defaults render as true/false", () => {
    expect(swiftDefaultLiteral(true, "Bool")).toBe("true");
    expect(swiftDefaultLiteral(false, "Bool")).toBe("false");
  });

  test("string default gets quoted + escaped via swiftLit", () => {
    expect(swiftDefaultLiteral("hello", "String")).toBe('"hello"');
    expect(swiftDefaultLiteral('say "hi"', "String")).toBe('"say \\"hi\\""');
  });

  test("undefined default → null (caller drops default: clause)", () => {
    expect(swiftDefaultLiteral(undefined, "Int")).toBeNull();
  });

  test("type mismatch → null (e.g. number default on a Bool field)", () => {
    expect(swiftDefaultLiteral(1, "Bool")).toBeNull();
    expect(swiftDefaultLiteral("text", "Int")).toBeNull();
  });
});

describe("enumDefaultLiteral", () => {
  test("returns .caseName when value is in enumValues", () => {
    expect(enumDefaultLiteral("play", ["play", "pause"])).toBe(".play");
    expect(enumDefaultLiteral("nextTrack", ["play", "nextTrack"])).toBe(".nextTrack");
  });

  test("value outside enum → null", () => {
    expect(enumDefaultLiteral("stop", ["play", "pause"])).toBeNull();
  });

  test("missing enumValues → null", () => {
    expect(enumDefaultLiteral("play", undefined)).toBeNull();
    expect(enumDefaultLiteral("play", null)).toBeNull();
  });

  test("non-string default → null", () => {
    expect(enumDefaultLiteral(0, ["play"])).toBeNull();
  });
});

describe("wireExpr", () => {
  test("passthrough for plain types", () => {
    expect(wireExpr("String", "name", false)).toBe("name");
    expect(wireExpr("Int", "limit", false)).toBe("limit");
  });

  test("Date → ISO8601 format call", () => {
    expect(wireExpr("Date", "startDate", false)).toBe(
      "ISO8601DateFormatter().string(from: startDate)",
    );
  });

  test("enum → .rawValue regardless of underlying type name", () => {
    expect(wireExpr("PlaybackControlActionOption", "action", true)).toBe("action.rawValue");
    // isEnum takes precedence over the Date branch (won't happen in practice,
    // but locks the priority)
    expect(wireExpr("Date", "v", true)).toBe("v.rawValue");
  });
});

describe("isNullableUnion / nonNullType", () => {
  test("detects type: [X, null] union", () => {
    expect(isNullableUnion({ type: ["string", "null"] })).toBe(true);
    expect(isNullableUnion({ type: ["null", "string"] })).toBe(true);
    expect(isNullableUnion({ type: ["integer", "null"] })).toBe(true);
  });

  test("plain types are not unions", () => {
    expect(isNullableUnion({ type: "string" })).toBe(false);
    expect(isNullableUnion({ type: "integer" })).toBe(false);
  });

  test("3-way or non-null unions don't count (out of scope)", () => {
    expect(isNullableUnion({ type: ["string", "integer"] })).toBe(false);
    expect(isNullableUnion({ type: ["string", "null", "integer"] })).toBe(false);
  });

  test("nonNullType extracts the non-null member", () => {
    expect(nonNullType({ type: ["string", "null"] })).toBe("string");
    expect(nonNullType({ type: ["null", "integer"] })).toBe("integer");
  });

  test("nonNullType on non-union returns null", () => {
    expect(nonNullType({ type: "string" })).toBeNull();
    expect(nonNullType({})).toBeNull();
  });
});

describe("outputTypeNameFor / snippetViewNameFor", () => {
  test("output struct uses MCP prefix + Output suffix", () => {
    expect(outputTypeNameFor({ name: "list_events" })).toBe("MCPListEventsOutput");
    expect(outputTypeNameFor({ name: "get_current_weather" })).toBe("MCPGetCurrentWeatherOutput");
  });

  test("snippet view uses MCP prefix + SnippetView suffix", () => {
    expect(snippetViewNameFor({ name: "list_events" })).toBe("MCPListEventsSnippetView");
    expect(snippetViewNameFor({ name: "audit_summary" })).toBe("MCPAuditSummarySnippetView");
  });

  test("prefixes avoid EventKit collisions (the motivating case)", () => {
    // AirMCPKit's EventKitService.swift declares plain TodayEventsOutput.
    // Generated type must not collide.
    expect(outputTypeNameFor({ name: "today_events" })).toBe("MCPTodayEventsOutput");
    expect(outputTypeNameFor({ name: "today_events" })).not.toBe("TodayEventsOutput");
  });
});

describe("detectSnippetShape", () => {
  test("list-object when single array property has object items with id", () => {
    const shape = detectSnippetShape({
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              summary: { type: "string" },
              startDate: { type: "string" },
            },
          },
        },
      },
    });
    expect(shape.shape).toBe("list-object");
    expect(shape.arrayField).toBe("events");
    expect(shape.primaryField).toBe("summary"); // first non-id string
    expect(shape.hasId).toBe(true);
    expect(shape.primaryFieldOptional).toBe(false);
  });

  test("primaryField prefers non-id even when id is first", () => {
    const shape = detectSnippetShape({
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    });
    expect(shape.primaryField).toBe("name");
  });

  test("nullable-union string fields are valid primaryField candidates", () => {
    const shape = detectSnippetShape({
      properties: {
        chats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: ["string", "null"] },
            },
          },
        },
      },
    });
    expect(shape.primaryField).toBe("name");
    expect(shape.primaryFieldOptional).toBe(true);
  });

  test("list-string when single array of strings", () => {
    const shape = detectSnippetShape({
      properties: { tags: { type: "array", items: { type: "string" } } },
    });
    expect(shape.shape).toBe("list-string");
    expect(shape.arrayField).toBe("tags");
  });

  test("scalar when multiple top-level fields", () => {
    const shape = detectSnippetShape({
      properties: {
        temperature: { type: "number" },
        humidity: { type: "number" },
      },
    });
    expect(shape.shape).toBe("scalar");
  });

  test("scalar when no array properties", () => {
    const shape = detectSnippetShape({
      properties: { value: { type: "string" } },
    });
    expect(shape.shape).toBe("scalar");
  });

  test("scalar when two array properties (multi-array fallthrough)", () => {
    const shape = detectSnippetShape({
      properties: {
        events: { type: "array", items: { type: "object", properties: {} } },
        reminders: { type: "array", items: { type: "object", properties: {} } },
      },
    });
    expect(shape.shape).toBe("scalar");
  });

  test("list-object without id field still lands on list-object but hasId false", () => {
    const shape = detectSnippetShape({
      properties: {
        rows: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" } } },
        },
      },
    });
    expect(shape.shape).toBe("list-object");
    expect(shape.hasId).toBe(false);
    expect(shape.primaryField).toBe("label");
  });

  test("undefined schema → scalar (defensive)", () => {
    expect(detectSnippetShape(undefined).shape).toBe("scalar");
    expect(detectSnippetShape(null).shape).toBe("scalar");
    expect(detectSnippetShape({}).shape).toBe("scalar");
  });
});

describe("systemImageFor", () => {
  test("calendar tools → calendar symbol", () => {
    expect(systemImageFor("list_events")).toBe("calendar");
    expect(systemImageFor("today_events")).toBe("calendar");
    expect(systemImageFor("search_events")).toBe("calendar");
    expect(systemImageFor("get_upcoming_events")).toBe("calendar");
  });

  test("list_calendars gets the plus variant (specific before fuzzy)", () => {
    expect(systemImageFor("list_calendars")).toBe("calendar.badge.plus");
  });

  test("notes / reminders / contacts mappings", () => {
    expect(systemImageFor("read_notes")).toBe("note.text");
    expect(systemImageFor("list_folders")).toBe("note.text");
    expect(systemImageFor("list_reminders")).toBe("checklist");
    expect(systemImageFor("list_reminder_lists")).toBe("checklist");
    expect(systemImageFor("search_contacts")).toBe("person.crop.circle");
  });

  test("messages / chats / shortcuts / safari / weather / files", () => {
    expect(systemImageFor("list_messages")).toBe("envelope");
    expect(systemImageFor("list_chats")).toBe("message");
    expect(systemImageFor("list_shortcuts")).toBe("square.stack.3d.up");
    expect(systemImageFor("list_bookmarks")).toBe("safari");
    expect(systemImageFor("get_current_weather")).toBe("cloud.sun");
    expect(systemImageFor("recent_files")).toBe("folder");
    expect(systemImageFor("summarize_context")).toBe("sparkles");
  });

  test("unknown tool → default catch-all SF Symbol", () => {
    expect(systemImageFor("unknown_tool_name")).toBe("app.connected.to.app.below.fill");
    expect(systemImageFor("")).toBe("app.connected.to.app.below.fill");
  });
});
