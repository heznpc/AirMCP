import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const generated = readFileSync(new URL("swift/Sources/AirMCPKit/Generated/MCPIntents.swift", root), "utf8");
const server = readFileSync(new URL("ios/Sources/AirMCPServer/MCPServer.swift", root), "utf8");
const preview = readFileSync(new URL("ios/Sources/AirMCPServer/PreviewTools.swift", root), "utf8");
const app = readFileSync(new URL("ios/Sources/AirMCPiOS/App.swift", root), "utf8");
const architectureDoc = readFileSync(new URL("docs/ios-architecture.md", root), "utf8");
const shortcutsDoc = readFileSync(new URL("docs/shortcuts.md", root), "utf8");
const releaseChecklist = readFileSync(new URL("docs/RELEASE_CHECKLIST.md", root), "utf8");
const toolSources = ["CalendarTools.swift", "ReminderTools.swift", "ContactsTools.swift", "LocationTools.swift"]
  .map((file) => readFileSync(new URL(`ios/Sources/AirMCPServer/${file}`, root), "utf8"))
  .join("\n");

const expected = [
  "get_location_permission",
  "list_calendars",
  "list_contacts",
  "list_reminder_lists",
  "list_reminders",
  "search_contacts",
  "search_reminders",
  "today_events",
];

function stringLiterals(source) {
  return [...source.matchAll(/"([a-z][a-z0-9_]+)"/g)].map((match) => match[1]);
}

describe("iOS preview boundary", () => {
  test("has a non-empty exact intersection with generated AppIntent tool names", () => {
    const generatedNames = new Set([...generated.matchAll(/tool:\s*"([a-z0-9_]+)"/g)].map((match) => match[1]));
    const contractBody = preview.match(/public static let toolNames:[\s\S]*?\n    \]/)?.[0] ?? "";
    const contractNames = [...new Set(stringLiterals(contractBody))].sort();
    const intersection = contractNames.filter((name) => generatedNames.has(name));

    expect(contractNames).toEqual(expected);
    expect(intersection).toEqual(expected);
    expect(intersection.length).toBeGreaterThan(0);
  });

  test("advertises exactly the preview catalog as iOS App Shortcuts", () => {
    const provider = generated.match(
      /public struct AirMCPGeneratedShortcuts: AppShortcutsProvider[\s\S]*?\n    }\n}/,
    )?.[0] ?? "";
    const advertisedStructs = [...provider.matchAll(/intent: ([A-Za-z0-9]+Intent)\(\)/g)].map(
      (match) => match[1],
    );
    const expectedStructs = expected.map((name) =>
      `${name.replace(/(?:^|_)([a-z0-9])/g, (_, char) => char.toUpperCase())}Intent`,
    );

    expect(advertisedStructs).toEqual(expectedStructs);
    expect(provider).not.toContain("AskAirMCPIntent");
  });

  test("keeps technical docs and the App Store HOLD gate on the exact catalog", () => {
    const currentStatus = architectureDoc.match(/## Current Status[\s\S]*?\n---/)?.[0] ?? "";
    const architectureNames = [...currentStatus.matchAll(/^\d+\. `([a-z0-9_]+)`$/gm)].map(
      (match) => match[1],
    );
    const shortcutsNames = [...shortcutsDoc.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map(
      (match) => match[1],
    );

    expect(architectureNames).toEqual(expected);
    expect(shortcutsNames).toEqual(expected);
    expect(architectureDoc).toContain("App Store submission is HOLD");
    expect(shortcutsDoc).toContain("macOS app can route its generated actions");
    expect(shortcutsDoc).toContain("They are not registered by the\nmacOS app");

    expect(releaseChecklist).toContain("현재 판정: HOLD");
    expect(releaseChecklist).toContain("tests/ios-preview-boundary.test.js");
    expect(releaseChecklist).toContain("AppShortcutsProvider`/Siri phrase");
    expect(releaseChecklist).toContain("HOLD: App Store assets claim capabilities outside");
    for (const name of expected) expect(releaseChecklist).toContain(`\`${name}\``);
  });

  test("registers only the exact preview catalog and gates direct AppIntent calls", () => {
    const registrationBody = preview.match(/public func registerIOSPreviewTools[\s\S]*?\n\}/)?.[0] ?? "";
    expect(registrationBody.match(/server\.registerTool\(/g)).toHaveLength(expected.length);
    expect(app).toContain("await registerIOSPreviewTools(on: mcp)");
    expect(app).not.toMatch(/register(?:Calendar|Reminder|Contacts|Location|Health)Tools/);
    expect(server).toContain("IOSPreviewContract.allows(");
    expect(server).toContain("IOSPreviewContract.toolNames.contains(name)");
    expect(server).toContain("previewToolNotAllowed");
  });

  test("every preview implementation is declared read-only and non-destructive", () => {
    for (const name of expected) {
      const start = toolSources.indexOf(`public static let name = "${name}"`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = toolSources.indexOf("public struct ", start + 1);
      const body = toolSources.slice(start, next < 0 ? undefined : next);
      expect(body).toContain("public static let readOnly = true");
      expect(body).toContain("public static let destructive = false");
    }
  });

  test("the preview contract contains no write-capable iOS handler name", () => {
    const writeBlocks = [...toolSources.matchAll(/public struct [\s\S]*?(?=public struct |$)/g)]
      .map((match) => match[0])
      .filter((body) => body.includes("public static let readOnly = false"));
    const writeNames = new Set(
      writeBlocks.flatMap((body) =>
        [...body.matchAll(/public static let name = "([a-z0-9_]+)"/g)].map((match) => match[1]),
      ),
    );

    expect(expected.filter((name) => writeNames.has(name))).toEqual([]);
  });
});
