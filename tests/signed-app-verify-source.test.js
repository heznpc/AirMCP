import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scriptPath = new URL("../scripts/verify-signed-app.sh", import.meta.url);
const script = readFileSync(scriptPath, "utf8");
const notarize = readFileSync(new URL("../scripts/notarize-app.sh", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("signed app artifact verification script", () => {
  test("is valid bash", () => {
    expect(() => execFileSync("bash", ["-n", scriptPath.pathname], { stdio: "pipe" })).not.toThrow();
  });

  test("verifies an existing signed artifact instead of rebuilding it", () => {
    expect(script).toContain("codesign --verify --deep --strict");
    expect(script).toContain("Authority=Developer ID Application:");
    expect(script).toContain("spctl --assess --type execute");
    expect(script).toContain("xcrun stapler validate");
    expect(script).toContain("probe-app-runtime.mjs");
    expect(script).toContain("Error registering app with intents");
    expect(script).not.toContain("swift build");
    expect(script).not.toContain("bundle-app.sh");
  });

  test("package.json exposes the signed artifact gate", () => {
    expect(pkg.scripts["app:verify:signed"]).toBe("./scripts/verify-signed-app.sh");
  });

  test("notarization signs embedded runtime code and runs the final artifact gate", () => {
    expect(notarize).toContain("Contents/Resources/airmcp/runtime/bin/node");
    expect(notarize).toContain("Contents/Resources/airmcp/bin/AirMcpBridge");
    expect(notarize).toContain('bash "$SCRIPT_DIR/verify-signed-app.sh"');
  });
});
