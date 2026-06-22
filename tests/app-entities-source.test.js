import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const src = readFileSync(new URL("swift/Sources/AirMCPKit/AppEntities.swift", root), "utf8");
const generated = readFileSync(new URL("swift/Sources/AirMCPKit/Generated/MCPIntents.swift", root), "utf8");

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

  test("keeps workflow entities plain until matching schema constants are usable", () => {
    expect(src).not.toMatch(/@AppEntity\s*\(\s*schema:/);
    expect(generated).not.toMatch(/@AppIntent\s*\(\s*schema:/);
    expect(src).not.toMatch(/AssistantSchema\.(?:IntentSchema|EntitySchema)\s*\(/);
  });

  test("compiles and rejects synthetic entities for write intent routing", () => {
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
    let synthetic = AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticEntity(id: " reminder-1 ")
    precondition(synthetic.id == "reminder-1")
    precondition(synthetic.isSynthetic)
    precondition(synthetic.subtitle == AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticSubtitle)
    do {
        _ = try requireResolvedAirMCPEntityId(synthetic, tool: "complete_reminder")
        preconditionFailure("synthetic entity should be rejected for write routing")
    } catch AirMCPAppEntityResolutionError.unresolvedEntity(let type, let id, let tool) {
        precondition(type.contains("AirMCPReminderEntity"))
        precondition(id == "reminder-1")
        precondition(tool == "complete_reminder")
    }
    let resolved = AirMCPReminderEntity(id: "reminder-1", title: "Pay invoice", subtitle: "Today")
    precondition(!resolved.isSynthetic)
    let resolvedId = try requireResolvedAirMCPEntityId(resolved, tool: "complete_reminder")
    precondition(resolvedId == "reminder-1")
    _ = AirMCPCalendarEventEntity.defaultQuery
    _ = AirMCPReminderEntity.defaultQuery
    _ = AirMCPContactEntity.defaultQuery
    _ = AirMCPContactEntity(id: "contact-1", title: "Ren", subtitle: nil)
}

@main
struct ProbeMain {
    static func main() async throws {
        try await probeAirMCPEntities()
    }
}
#endif
`;

    const temp = mkdtempSync(join(tmpdir(), "airmcp-appentities-"));
    const exe = join(temp, "probe");
    const probePath = join(temp, "Probe.swift");
    writeFileSync(probePath, probe);
    try {
      const result = spawnSync(
        "xcrun",
        [
          "swiftc",
          "-target",
          "arm64-apple-macos14.0",
          "-sdk",
          sdk.stdout.trim(),
          "swift/Sources/AirMCPKit/Types.swift",
          "swift/Sources/AirMCPKit/EventKitService.swift",
          "swift/Sources/AirMCPKit/ContactsService.swift",
          "swift/Sources/AirMCPKit/AppEntities.swift",
          probePath,
          "-o",
          exe,
        ],
        {
          cwd: new URL(".", root),
          encoding: "utf8",
        },
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const run = spawnSync(exe, [], { encoding: "utf8" });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("generated AppIntents use entity parameters and guard write routes", () => {
    expect(generated).toContain("public var id: AirMCPCalendarEventEntity");
    expect(generated).toContain("public var id: AirMCPReminderEntity");
    expect(generated).toContain("public var id: AirMCPContactEntity");
    expect(generated).toContain('args: ["id": id.id]');
    expect(generated).toContain('args["id"] = try requireResolvedAirMCPEntityId(id, tool: "complete_reminder")');
    expect(generated).toContain('args["id"] = try requireResolvedAirMCPEntityId(id, tool: "add_contact_email")');
    expect(generated).toContain('args["id"] = try requireResolvedAirMCPEntityId(id, tool: "add_contact_phone")');
    expect(generated).toContain(
      "intent.id = AirMCPStringEntityQuery<AirMCPCalendarEventEntity>.syntheticEntity(id: id)",
    );
    expect(generated).toContain("intent.id = AirMCPStringEntityQuery<AirMCPReminderEntity>.syntheticEntity(id: id)");
    expect(generated).toContain("intent.id = AirMCPStringEntityQuery<AirMCPContactEntity>.syntheticEntity(id: id)");
  });
});
