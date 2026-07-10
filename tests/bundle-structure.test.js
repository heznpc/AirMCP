import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const verifier = new URL("scripts/verify-bundle-structure.sh", root).pathname;

function makeBundle({ bundleId = "com.example.TestApp", executable = "TestApp", signed = true } = {}) {
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
#include <string.h>
int main(int argc, char **argv) {
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
</dict>
</plist>
`,
  );
  if (signed) {
    for (const nested of [bundledNode, bundledBridge, binary]) {
      const nestedResult = spawnSync("codesign", ["--force", "--sign", "-", nested], { encoding: "utf8" });
      expect(nestedResult.status).toBe(0);
    }
    const signedResult = spawnSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { encoding: "utf8" });
    expect(signedResult.status).toBe(0);
  }
  return { temp, bundle, binary, executable, bundleId };
}

function verifyBundle(bundle, bundleId, executable) {
  return spawnSync("bash", [verifier, bundle, bundleId, executable], { encoding: "utf8" });
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
});
