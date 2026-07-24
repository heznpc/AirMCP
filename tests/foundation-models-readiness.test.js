import { readFileSync } from "node:fs";
import { describe, expect, jest, test } from "@jest/globals";
import { classifyFoundationModelsStatus, inspectFoundationModels } from "../scripts/lib/foundation-models-status.mjs";

const root = new URL("..", import.meta.url);
const packageJSON = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const buildScript = readFileSync(new URL("scripts/build-swift-fm.mjs", root), "utf8");
const evalScript = readFileSync(new URL("scripts/eval-plans.mjs", root), "utf8");
const bridge = readFileSync(new URL("swift/Sources/AirMcpBridge/main.swift", root), "utf8");
const service = readFileSync(new URL("swift/Sources/AirMCPKit/IntelligenceService.swift", root), "utf8");

describe("Foundation Models preview readiness", () => {
  test("keeps the default build opt-in and provides a verified FM build command", () => {
    expect(packageJSON.scripts["swift-build"]).not.toContain("AIRMCP_ENABLE_FOUNDATION_MODELS");
    expect(packageJSON.scripts["swift-build:fm"]).toBe("node scripts/build-swift-fm.mjs");
    expect(buildScript).toContain('"-DAIRMCP_ENABLE_FOUNDATION_MODELS"');
    expect(buildScript).toContain("status.foundationModelsSupported !== true");
    expect(service).toContain("#if AIRMCP_ENABLE_FOUNDATION_MODELS && canImport(FoundationModels) && compiler(>=6.2)");
  });

  test("classifies disabled, unsupported, unavailable, and ready states", () => {
    expect(
      classifyFoundationModelsStatus({
        available: false,
        foundationModelsSupported: false,
        hasAppleSilicon: true,
        macOSVersion: "26.2.0",
      }).classification,
    ).toBe("disabled_at_compile_time");
    expect(
      classifyFoundationModelsStatus({
        available: false,
        foundationModelsSupported: true,
        hasAppleSilicon: false,
        macOSVersion: "26.2.0",
      }).classification,
    ).toBe("unsupported_architecture");
    expect(
      classifyFoundationModelsStatus({
        available: false,
        foundationModelsSupported: true,
        hasAppleSilicon: true,
        macOSVersion: "26.2.0",
      }).classification,
    ).toBe("model_unavailable");
    expect(
      classifyFoundationModelsStatus({
        available: true,
        foundationModelsSupported: true,
        hasAppleSilicon: true,
        macOSVersion: "26.2.0",
      }).ready,
    ).toBe(true);
  });

  test("classifies a missing bridge before attempting ai-status", async () => {
    const runSwift = jest.fn();
    const result = await inspectFoundationModels({
      checkSwiftBridge: async () => "bridge missing",
      runSwift,
    });

    expect(result.classification).toBe("bridge_missing");
    expect(result.action).toContain("npm run swift-build:fm");
    expect(runSwift).not.toHaveBeenCalled();
  });

  test("eval performs ai-status preflight and one smoke before the sweep", () => {
    expect(packageJSON.scripts["ai-status"]).toBe("node scripts/ai-status.mjs");
    expect(evalScript).toContain("inspectFoundationModels({ checkSwiftBridge, runSwift })");
    expect(evalScript).toContain("const smoke = await runSmoke()");
    expect(evalScript.indexOf("const smoke = await runSmoke()")).toBeLessThan(
      evalScript.indexOf("for (const [i, g] of cases.entries())"),
    );
    expect(evalScript).toContain('classification: "smoke_failed"');
    expect(evalScript).toContain('status: "blocked"');
  });

  test("bridge ai-status reports a runtime classification", () => {
    expect(bridge).toContain('classification = "ready"');
    expect(bridge).toContain('classification = "model_unavailable"');
    expect(bridge).toContain('classification = "disabled_at_compile_time"');
    expect(bridge).toContain("SystemLanguageModel.default.availability");
  });
});
