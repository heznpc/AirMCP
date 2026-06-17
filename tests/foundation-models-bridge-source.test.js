import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const src = readFileSync(
  new URL("swift/Sources/AirMCPKit/FoundationModelsBridge.swift", root),
  "utf8",
);

describe("FoundationModelsBridge source contract", () => {
  test("defines explicit tool-loop limits", () => {
    expect(src).toContain("public struct FoundationModelsBridgeLimits");
    expect(src).toContain("maxToolCalls: Int = 6");
    expect(src).toContain("maxToolOutputCharacters: Int = 24_000");
    expect(src).toContain("maxResponseTokens: Int = 1_200");
    expect(src).toContain("FoundationModelsToolBudget");
    expect(src).toContain("toolBudgetExceeded(maxCalls:");
    expect(src).toContain("toolOutputTooLarge(tool:");
  });

  test("does not depend on FoundationModels macro expansion", () => {
    expect(src).not.toContain("@Generable");
    expect(src).not.toContain("@Guide");
    expect(src).not.toContain("FoundationModelsMacros");
    expect(src).toContain("public struct FoundationModelsNoArguments: Generable");
    expect(src).toContain("public struct Arguments: Generable");
    expect(src).toContain("public static var generationSchema: GenerationSchema");
    expect(src).toContain("public init(_ content: GeneratedContent) throws");
  });

  test("checks every read-only tool output against the shared budget", () => {
    const readToolBodies = [
      /public final class TodayEventsTool[\s\S]*?public final class DueRemindersTool/,
      /public final class DueRemindersTool[\s\S]*?public final class SearchContactsTool/,
      /public final class SearchContactsTool[\s\S]*?public final class CreateReminderTool/,
    ];

    for (const bodyPattern of readToolBodies) {
      const body = src.match(bodyPattern)?.[0] ?? "";
      expect(body).toContain("private let budget: FoundationModelsToolBudget");
      expect(body).toContain("public init(budget: FoundationModelsToolBudget)");
      expect(body).toContain("try await budget.check(tool: name, output:");
      expect(body).toContain("async throws -> String");
    }
  });

  test("registers only read-only tools with the model session", () => {
    const allToolsBody = src.match(
      /public func allTools\([\s\S]*?\n    \}/,
    )?.[0] ?? "";

    expect(allToolsBody).toContain("FoundationModelsToolBudget(limits: limits)");
    expect(allToolsBody).toContain("TodayEventsTool(budget: budget)");
    expect(allToolsBody).toContain("DueRemindersTool(budget: budget)");
    expect(allToolsBody).toContain("SearchContactsTool(budget: budget)");
    expect(allToolsBody).not.toContain("CreateReminderTool(");
    expect(allToolsBody).not.toContain("CreateNoteTool(");
  });

  test("write-capable Foundation Models tool stubs fail closed", () => {
    expect(src).toContain("case writeToolUnavailable(tool: String)");
    const createReminderBody = src.match(
      /public final class CreateReminderTool[\s\S]*?public final class CreateNoteTool/,
    )?.[0] ?? "";
    const createNoteBody = src.match(
      /public final class CreateNoteTool[\s\S]*?\/\/ MARK: - Bridge/,
    )?.[0] ?? "";

    expect(createReminderBody).toContain("throw FoundationModelsBridgeError.writeToolUnavailable(tool: name)");
    expect(createReminderBody).not.toContain("service.createReminder");
    expect(createNoteBody).toContain("throw FoundationModelsBridgeError.writeToolUnavailable(tool: name)");
    expect(createNoteBody).not.toContain("Note creation requested");
  });

  test("bounds the session response and uses the SDK initializer order", () => {
    expect(src).toContain(
      "let session = LanguageModelSession(tools: tools, instructions: instruction)",
    );
    expect(src).toContain(
      "GenerationOptions(maximumResponseTokens: limits.maxResponseTokens)",
    );
    expect(src).toContain("session.respond(to: prompt, options: options)");
  });
});
