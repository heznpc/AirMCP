import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const src = readFileSync(
  new URL("swift/Sources/AirMCPKit/AppEntities.swift", root),
  "utf8",
);
const generated = readFileSync(
  new URL("swift/Sources/AirMCPKit/Generated/MCPIntents.swift", root),
  "utf8",
);

describe("AirMCP AppEntity scaffold", () => {
  test("defines workflow-domain entities backed by EntityStringQuery", () => {
    expect(src).toContain("public protocol AirMCPStringBackedEntity: AppEntity");
    expect(src).toContain("public struct AirMCPStringEntityQuery");
    expect(src).toContain("public struct AirMCPCalendarEventQuery");
    expect(src).toContain("public struct AirMCPReminderQuery");
    expect(src).toContain("public struct AirMCPContactQuery");
    expect(src).toContain("EntityStringQuery");
    expect(src).toContain("public struct AirMCPCalendarEventEntity");
    expect(src).toContain("public struct AirMCPReminderEntity");
    expect(src).toContain("public struct AirMCPContactEntity");
  });

  test("does not use deprecated Assistant schema macros", () => {
    expect(src).not.toMatch(/@Assistant(?:Intent|Entity|Enum)\b/);
    expect(src).not.toMatch(/Assistant(?:Intent|Entity|Enum)\(schema:/);
  });

  test("does not invent unsupported AppEntity schema annotations", () => {
    expect(src).not.toMatch(/@AppEntity\s*\(\s*schema:/);
    expect(src).not.toMatch(/AssistantSchema\.(?:IntentSchema|EntitySchema)\s*\(/);
  });

  test("typechecks against the local AppIntents SDK", () => {
    if (process.platform !== "darwin") return;

    const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
      encoding: "utf8",
    });
    expect(sdk.status).toBe(0);

    const probe = `
#if canImport(AppIntents)
import AppIntents
import Foundation

func probeAirMCPEntities() async throws {
    let query = AirMCPStringEntityQuery<AirMCPCalendarEventEntity>()
    let events = try await query.entities(for: ["event-1"])
    _ = events.first?.displayRepresentation
    _ = AirMCPCalendarEventEntity.defaultQuery
    _ = AirMCPReminderEntity.defaultQuery
    _ = AirMCPContactEntity.defaultQuery
    _ = AirMCPReminderEntity(id: "reminder-1", title: "Pay invoice", subtitle: "Today")
    _ = AirMCPContactEntity(id: "contact-1", title: "Ren", subtitle: nil)
}
#endif
`;

    const result = spawnSync(
      "xcrun",
      [
        "swiftc",
        "-typecheck",
        "-target",
        "arm64-apple-macos14.0",
        "-sdk",
        sdk.stdout.trim(),
        "swift/Sources/AirMCPKit/Types.swift",
        "swift/Sources/AirMCPKit/EventKitService.swift",
        "swift/Sources/AirMCPKit/ContactsService.swift",
        "swift/Sources/AirMCPKit/AppEntities.swift",
        "-",
      ],
      {
        cwd: new URL(".", root),
        input: probe,
        encoding: "utf8",
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("generated AppIntents use entity parameters but send string ids", () => {
    expect(generated).toContain("public var id: AirMCPCalendarEventEntity");
    expect(generated).toContain("public var id: AirMCPReminderEntity");
    expect(generated).toContain("public var id: AirMCPContactEntity");
    expect(generated).toContain('args: ["id": id.id]');
    expect(generated).toContain('args: ["id": id.id, "completed": completed]');
    expect(generated).toContain(
      'intent.id = AirMCPCalendarEventEntity(id: id, title: id, subtitle: "AirMCP ID")',
    );
    expect(generated).toContain(
      'intent.id = AirMCPReminderEntity(id: id, title: id, subtitle: "AirMCP ID")',
    );
    expect(generated).toContain(
      'intent.id = AirMCPContactEntity(id: id, title: id, subtitle: "AirMCP ID")',
    );
  });
});
