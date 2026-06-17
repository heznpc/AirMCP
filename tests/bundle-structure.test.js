import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  mkdirSync(macos, { recursive: true });
  const binary = join(macos, executable);
  writeFileSync(binary, "#!/bin/sh\nexit 0\n");
  chmodSync(binary, 0o755);
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
</dict>
</plist>
`,
  );
  if (signed) {
    const signedResult = spawnSync("codesign", ["--force", "--sign", "-", bundle], { encoding: "utf8" });
    expect(signedResult.stderr).toBe("");
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
});
