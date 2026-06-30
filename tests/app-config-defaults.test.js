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
  });

  test("module toggles switch the JSON config to custom profile", () => {
    expect(source).toMatch(/var disabledModules:[\s\S]*config\.profile\s*=\s*"custom"/);
  });
});
