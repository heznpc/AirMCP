import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const verifier = new URL("scripts/verify-bundle-structure.sh", root).pathname;

function makeBundle({
  bundleId = "com.example.TestApp",
  executable = "TestApp",
  signed = true,
  includeRequiredEntitlements = true,
  mainEntitlementTypes = "valid",
  includeWidget = false,
  widgetEntitlements = "valid",
  widgetMetadata = {},
} = {}) {
  const temp = mkdtempSync(join(tmpdir(), "airmcp-bundle-"));
  const bundle = join(temp, `${executable}.app`);
  const contents = join(bundle, "Contents");
  const macos = join(contents, "MacOS");
  const runtimeRoot = join(contents, "Resources", "airmcp");
  const localizationBundle = join(contents, "Resources", "AirMCPApp_AirMCPApp.bundle");
  const runtimeBin = join(runtimeRoot, "runtime", "bin");
  const serverDist = join(runtimeRoot, "server", "dist");
  const bridgeBin = join(runtimeRoot, "bin");
  mkdirSync(macos, { recursive: true });
  mkdirSync(runtimeBin, { recursive: true });
  mkdirSync(serverDist, { recursive: true });
  mkdirSync(bridgeBin, { recursive: true });
  for (const locale of ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant"]) {
    const localeDir = join(localizationBundle, `${locale}.lproj`);
    mkdirSync(localeDir, { recursive: true });
    writeFileSync(join(localeDir, "Localizable.strings"), '"onboarding.windowTitle" = "AirMCP";\n');
  }
  const nativeSource = join(temp, "fixture-runtime.c");
  const bundledNode = join(runtimeBin, "node");
  writeFileSync(
    nativeSource,
    `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  const char *tripwire = getenv("AIRMCP_BUNDLED_NODE_TRIPWIRE");
  if (tripwire != NULL) {
    FILE *sentinel = fopen(tripwire, "w");
    if (sentinel != NULL) fclose(sentinel);
  }
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "-p") == 0) { puts("20"); return 0; }
    if (strcmp(argv[i], "--version") == 0) { puts("1.0.0"); return 0; }
  }
  return 0;
}
`,
  );
  const compileResult = spawnSync("cc", [nativeSource, "-o", bundledNode], { encoding: "utf8" });
  expect(compileResult.status).toBe(0);
  const binary = join(macos, executable);
  copyFileSync(bundledNode, binary);
  chmodSync(binary, 0o755);
  const bundledBridge = join(bridgeBin, "AirMcpBridge");
  copyFileSync(bundledNode, bundledBridge);
  chmodSync(bundledBridge, 0o755);
  writeFileSync(
    join(serverDist, "index.js"),
    'if (process.argv.includes("--version")) process.stdout.write("1.0.0\\n");\n',
  );
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleExecutable</key>
  <string>${executable}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleAllowMixedLocalizations</key>
  <true/>
  <key>LSMultipleInstancesProhibited</key>
  <true/>
  <key>CFBundleLocalizations</key>
  <array>
    <string>de</string>
    <string>en</string>
    <string>es</string>
    <string>fr</string>
    <string>ja</string>
    <string>ko</string>
    <string>pt-BR</string>
    <string>zh-Hans</string>
    <string>zh-Hant</string>
  </array>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>AirMCP captures your screen or app windows only when you explicitly ask it to take a screenshot or screen recording.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>AirMCP controls other Mac apps only when you explicitly ask it to read or change their data.</string>
</dict>
</plist>
`,
  );

  let widget;
  let widgetBinary;
  if (includeWidget) {
    widget = join(contents, "PlugIns", "AirMCPWidget.appex");
    const widgetContents = join(widget, "Contents");
    const widgetMacOS = join(widgetContents, "MacOS");
    widgetBinary = join(widgetMacOS, "AirMCPWidget");
    mkdirSync(widgetMacOS, { recursive: true });
    copyFileSync(bundledNode, widgetBinary);
    chmodSync(widgetBinary, 0o755);
    const widgetBundleIdentifier = widgetMetadata.bundleIdentifier ?? `${bundleId}.Widget`;
    const widgetExecutable = widgetMetadata.executable ?? "AirMCPWidget";
    const widgetPackageType = widgetMetadata.packageType ?? "XPC!";
    const widgetExtensionPoint = widgetMetadata.extensionPoint ?? "com.apple.widgetkit-extension";
    writeFileSync(
      join(widgetContents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${widgetBundleIdentifier}</string>
  <key>CFBundleExecutable</key>
  <string>${widgetExecutable}</string>
  <key>CFBundlePackageType</key>
  <string>${widgetPackageType}</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>${widgetExtensionPoint}</string>
  </dict>
</dict>
</plist>
`,
    );
  }

  if (signed) {
    for (const nested of [bundledNode, bundledBridge, binary, ...(widgetBinary ? [widgetBinary] : [])]) {
      const nestedResult = spawnSync("codesign", ["--force", "--sign", "-", nested], { encoding: "utf8" });
      expect(nestedResult.status).toBe(0);
    }

    if (widget) {
      const widgetSignArguments = ["--force", "--sign", "-"];
      if (widgetEntitlements !== "none") {
        const entitlements = join(temp, "widget.entitlements");
        const groupValue =
          widgetEntitlements === "string-types"
            ? "<string>group.app.airmcp</string>"
            : "<array><string>group.app.airmcp</string></array>";
        const capabilityValue =
          widgetEntitlements === "string-types" || widgetEntitlements === "string-booleans"
            ? "<string>true</string>"
            : "<true/>";
        const sandboxValue =
          widgetEntitlements === "string-sandbox"
            ? "<string>true</string>"
            : widgetEntitlements === "false-sandbox"
              ? "<false/>"
              : "<true/>";
        const unexpectedEntitlement =
          widgetEntitlements === "unexpected" ? "<key>com.apple.security.get-task-allow</key><true/>" : "";
        writeFileSync(
          entitlements,
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  ${sandboxValue}
  <key>com.apple.security.application-groups</key>
  ${groupValue}
  <key>com.apple.security.personal-information.calendars</key>
  ${capabilityValue}
  <key>com.apple.security.personal-information.reminders</key>
  ${capabilityValue}
  ${unexpectedEntitlement}
</dict>
</plist>
`,
        );
        widgetSignArguments.push("--entitlements", entitlements);
      }
      widgetSignArguments.push(widget);
      const widgetSignedResult = spawnSync("codesign", widgetSignArguments, { encoding: "utf8" });
      expect(widgetSignedResult.status).toBe(0);
    }

    const signArguments = ["--force", "--sign", "-"];
    if (includeRequiredEntitlements) {
      const entitlements = join(temp, "main.entitlements");
      const groupValue =
        mainEntitlementTypes === "string-types"
          ? "<string>group.app.airmcp</string>"
          : "<array><string>group.app.airmcp</string></array>";
      const automationValue =
        mainEntitlementTypes === "string-types" || mainEntitlementTypes === "string-boolean"
          ? "<string>true</string>"
          : "<true/>";
      writeFileSync(
        entitlements,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  ${groupValue}
  <key>com.apple.security.automation.apple-events</key>
  ${automationValue}
</dict>
</plist>
`,
      );
      signArguments.push("--entitlements", entitlements);
    }
    signArguments.push(bundle);
    const signedResult = spawnSync("codesign", signArguments, { encoding: "utf8" });
    expect(signedResult.status).toBe(0);
  }
  return { temp, bundle, binary, bundledNode, executable, bundleId, widget };
}

function verifyBundle(bundle, bundleId, executable, env = {}) {
  return spawnSync("bash", [verifier, bundle, bundleId, executable], {
    encoding: "utf8",
    env: { ...process.env, AIRMCP_EXPECTED_SIGNING_MODE: "adhoc", ...env },
  });
}

describe("macOS bundle structure verifier", () => {
  test("accepts a signed bundle with matching executable and plist contract", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle();
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects malformed bundles with real process failures", () => {
    if (process.platform !== "darwin") return;
    const missingExecutable = makeBundle({ signed: false });
    const wrongBundleId = makeBundle({ bundleId: "com.example.WrongApp" });
    const unsigned = makeBundle({ signed: false });
    try {
      rmSync(missingExecutable.binary);
      const missingResult = verifyBundle(
        missingExecutable.bundle,
        missingExecutable.bundleId,
        missingExecutable.executable,
      );
      expect(missingResult.status).toBe(1);
      expect(missingResult.stderr).toContain("app executable missing");

      const wrongIdResult = verifyBundle(wrongBundleId.bundle, "com.example.ExpectedApp", wrongBundleId.executable);
      expect(wrongIdResult.status).toBe(1);
      expect(wrongIdResult.stderr).toContain("expected com.example.ExpectedApp");

      const unsignedResult = verifyBundle(unsigned.bundle, unsigned.bundleId, unsigned.executable);
      expect(unsignedResult.status).toBe(1);
      expect(unsignedResult.stderr).toContain("did not pass strict code-sign verification");
    } finally {
      rmSync(missingExecutable.temp, { recursive: true, force: true });
      rmSync(wrongBundleId.temp, { recursive: true, force: true });
      rmSync(unsigned.temp, { recursive: true, force: true });
    }
  });

  test("rejects a tampered signature before executing the bundled Node runtime", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle();
    const sentinel = join(fixture.temp, "bundled-node-executed");
    try {
      writeFileSync(fixture.bundledNode, `#!/bin/sh\n: > ${JSON.stringify(sentinel)}\nexit 97\n`);
      chmodSync(fixture.bundledNode, 0o755);

      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("did not pass strict code-sign verification");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects an attacker re-signed bundle before executing its bundled Node runtime", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle();
    const sentinel = join(fixture.temp, "attacker-node-executed");
    const environment = { ...process.env, AIRMCP_BUNDLED_NODE_TRIPWIRE: sentinel };
    delete environment.AIRMCP_EXPECTED_SIGNING_MODE;
    delete environment.AIRMCP_EXPECTED_SIGNING_AUTHORITY;
    delete environment.AIRMCP_EXPECTED_SIGNING_TEAM_ID;
    try {
      const result = spawnSync("bash", [verifier, fixture.bundle, fixture.bundleId, fixture.executable], {
        encoding: "utf8",
        env: environment,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("does not match the published Developer ID and team");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a stale localization left by an incremental SwiftPM build", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle();
    try {
      const staleLocale = join(fixture.bundle, "Contents", "Resources", "AirMCPApp_AirMCPApp.bundle", "pt.lproj");
      mkdirSync(staleLocale, { recursive: true });
      writeFileSync(join(staleLocale, "Localizable.strings"), '"onboarding.windowTitle" = "AirMCP";\n');
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("packaged localization is not declared");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("requires the widget when building a signed distribution", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle();
    const withWidget = makeBundle({ includeWidget: true });
    try {
      const optional = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(optional.status).toBe(0);

      const required = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(required.status).toBe(1);
      expect(required.stderr).toContain("requires a complete AirMCPWidget.appex");

      const validWidget = verifyBundle(withWidget.bundle, withWidget.bundleId, withWidget.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(validWidget.stderr).toBe("");
      expect(validWidget.status).toBe(0);
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
      rmSync(withWidget.temp, { recursive: true, force: true });
    }
  });

  test.each([
    ["identifier", { bundleIdentifier: "example.invalid.Widget" }, ":CFBundleIdentifier", true],
    ["executable", { executable: "WrongWidget" }, ":CFBundleExecutable", false],
    ["package type", { packageType: "APPL" }, ":CFBundlePackageType", true],
    [
      "extension point",
      { extensionPoint: "example.invalid-extension" },
      ":NSExtension:NSExtensionPointIdentifier",
      true,
    ],
  ])("rejects a widget with the wrong %s", (_label, widgetMetadata, expectedKey, signed) => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, signed, widgetMetadata });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expectedKey);
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a valid signature whose main-app entitlements were dropped", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeRequiredEntitlements: false });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("signed main app has no valid entitlements");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects string-typed main-app entitlements that only look valid in text output", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ mainEntitlementTypes: "string-types" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("application-groups entitlement must be an array");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a string-typed main-app automation flag even when the app group is a valid array", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ mainEntitlementTypes: "string-boolean" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Apple Events automation entitlement must be a boolean");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a valid widget signature whose required entitlements were dropped", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, widgetEntitlements: "none" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("signed widget has no valid entitlements");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects string-typed widget entitlements that codesign accepts", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, widgetEntitlements: "string-types" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("signed widget application-groups entitlement must be an array");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects string-typed widget capability flags even when the app group is a valid array", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, widgetEntitlements: "string-booleans" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("signed widget calendars entitlement must be a boolean");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a signed widget that disables the App Sandbox", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, widgetEntitlements: "false-sandbox" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must enable the App Sandbox");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  test("rejects a signed widget with an unexpected entitlement", () => {
    if (process.platform !== "darwin") return;
    const fixture = makeBundle({ includeWidget: true, widgetEntitlements: "unexpected" });
    try {
      const result = verifyBundle(fixture.bundle, fixture.bundleId, fixture.executable, {
        AIRMCP_REQUIRE_WIDGET: "1",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("contains an unexpected entitlement");
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });
});
