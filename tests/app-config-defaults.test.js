import { describe, test, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG_MANAGER = join(ROOT, "app", "Sources", "AirMCPApp", "ConfigManager.swift");
const source = readFileSync(CONFIG_MANAGER, "utf-8");

describe("AirMCP.app ConfigManager defaults", () => {
  test("starts on starter/progressive profile contract", () => {
    expect(source).toMatch(/profile:\s*"starter"/);
    expect(source).toMatch(/toolExposure:\s*"progressive"/);
  });

  test("keeps send actions off by default", () => {
    expect(source).toMatch(/allowSendMessages:\s*false/);
    expect(source).toMatch(/allowSendMail:\s*false/);
  });

  test("requires task sessions by default in the app-owned runtime config", () => {
    expect(source).toMatch(/requireToolSession:\s*true/);
    expect(source).toMatch(/decodeIfPresent\(Bool\.self,\s*forKey:\s*\.requireToolSession\)\s*\?\?\s*true/);
  });

  test("preserves module pack activation written by the CLI", () => {
    expect(source).toMatch(/var modulePacks:\s*\[String\]\?/);
    expect(source).toMatch(/decodeIfPresent\(\[String\]\.self,\s*forKey:\s*\.modulePacks\)/);
    expect(source).toContain("func setModulePack(_ pack: String, enabled: Bool)");
    expect(source).toContain('"core"');
  });

  test("module toggles switch the JSON config to custom profile", () => {
    expect(source).toMatch(/var disabledModules:[\s\S]*config\.profile\s*=\s*"custom"/);
  });

  test("preserves Node-owned and future JSON keys on save", () => {
    expect(source).toContain("private var rawConfig: [String: Any] = [:]");
    expect(source).toContain("mergeKnownFields(into: rawConfig)");
    expect(source).toContain('var hitlObject = merged["hitl"] as? [String: Any] ?? [:]');
  });

  test("validates and backs up before an atomic config replacement", () => {
    expect(source).toContain('configFile.appendingPathExtension("backup")');
    expect(source).toContain("JSONSerialization.jsonObject(with: data)");
    expect(source).toContain("data.write(to: Self.configFile, options: .atomic)");
    expect(source).toContain("var lastPersistenceError: String?");
  });

  test("honors the shared config-path override for isolated app validation", () => {
    expect(source).toContain('environment["AIRMCP_CONFIG_PATH"]');
    expect(source).toContain("configFile.deletingLastPathComponent()");
  });
});
