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
    expect(script).toContain("SIGN_AUTHORITY=");
    expect(script).toContain("Developer\\ ID\\ Application:\\ Heznpc");
    expect(script).toContain("TeamIdentifier=");
    expect(script).toContain("spctl --assess --type execute");
    expect(script).toContain("xcrun stapler validate");
    expect(script).toContain("probe-app-runtime.mjs");
    expect(script).toContain("/app/runtime-state");
    expect(script).toContain("AIRMCP_APP_RUNTIME_OWNER_PATH");
    expect(script).toContain('--env "AIRMCP_APP_RUNTIME_TOKEN_PATH=$AIRMCP_APP_RUNTIME_TOKEN_PATH"');
    expect(script).toContain('--env "AIRMCP_FORCE_APP_RUNTIME=$AIRMCP_FORCE_APP_RUNTIME"');
    expect(script).toContain("ownerFingerprint");
    expect(script).toContain("pid_matches_prefix");
    expect(script).toContain('--token-file "$TOKEN_FILE"');
    expect(script).toContain("processIdentifier == $APP_PID");
    expect(script).toContain("AIRMCP_REQUIRE_WIDGET=1");
    expect(script).toContain("bundle structure verification failed");
    expect(script).toContain('"$APP_BUNDLE" >/dev/null 2>&1');
    expect(script).toContain("Error registering app with intents");
    expect(script).not.toContain("pkill");
    expect(script).not.toContain('--token "$TOKEN"');
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
    expect(notarize).toContain('bash "$SCRIPT_DIR/verify-signing-identity.sh"');
    expect(notarize).not.toContain('codesigning with $APPLE_DEVELOPER_ID');
    expect(notarize).not.toContain('echo "$SUBMIT_OUTPUT"');
    expect(notarize).not.toContain("preserved entitlements: $appex");
    expect(notarize).not.toContain('echo "  signing $nested"');
    expect(notarize).not.toContain('echo "  signing $appex"');
    expect(notarize).not.toContain('zipping $APP_BUNDLE');
    expect(notarize).not.toContain('✓ $APP_BUNDLE');
  });
});
