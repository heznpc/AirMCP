import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const root = new URL("..", import.meta.url);
const script = readFileSync(new URL("scripts/bundle-app.sh", root), "utf8");

describe("macOS bundle script source contract", () => {
  test("hard-fails malformed bundles before launch or AppIntents verification", () => {
    expect(script).toContain("verify_bundle_structure()");
    expect(script).toContain('if [ ! -x "$APP_BINARY" ]; then');
    expect(script).toContain('/usr/bin/plutil -lint "$PLIST"');
    expect(script).toContain('require_plist_value ":CFBundleIdentifier" "$BUNDLE_ID"');
    expect(script).toContain('require_plist_value ":CFBundleExecutable" "$APP_EXECUTABLE"');
    expect(script).toContain('require_plist_value ":CFBundlePackageType" "APPL"');
    expect(script).toContain('codesign --verify --deep --strict "$BUNDLE_DIR"');
  });

  test("signed AppIntents verification still fails fast without an identity", () => {
    const identityCheck = script.slice(
      script.indexOf('if [ "$MODE" = "verify-appintents" ]; then'),
      script.indexOf('if [ "$MODE" = "widget-debug" ]'),
    );
    expect(identityCheck).toContain("AIRMCP_SIGN_IDENTITY is required");
    expect(identityCheck).toContain("security find-identity -v -p codesigning");
    expect(identityCheck).toContain("exit 1");
  });
});
