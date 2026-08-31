import { afterEach, describe, expect, test } from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = new URL("../scripts/verify-signed-app.sh", import.meta.url);
const script = readFileSync(scriptPath, "utf8");
const notarizePath = new URL("../scripts/notarize-app.sh", import.meta.url);
const notarize = readFileSync(notarizePath, "utf8");
const bundleScript = readFileSync(new URL("../scripts/bundle-app.sh", import.meta.url), "utf8");
const mainEntitlements = readFileSync(new URL("../scripts/lib/main-app-entitlements.plist", import.meta.url), "utf8");
const widgetEntitlements = readFileSync(new URL("../scripts/lib/widget-entitlements.plist", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const temporaryDirectories = [];
const mainValidatorStart = notarize.indexOf("MAIN_ALLOWED_ENTITLEMENTS=(");
const mainValidatorEnd = notarize.indexOf("\nverify_widget_entitlements()");
const mainValidatorSource = notarize.slice(mainValidatorStart, mainValidatorEnd);
const widgetValidatorStart = notarize.indexOf("WIDGET_ALLOWED_ENTITLEMENTS=(");
const widgetValidatorEnd = notarize.indexOf("\n# Inspect the source signature");
const widgetValidatorSource = notarize.slice(widgetValidatorStart, widgetValidatorEnd);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createAcceptanceHarnessBundle() {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-marked-app-"));
  temporaryDirectories.push(directory);
  const bundle = join(directory, "AirMCP.app");
  const contents = join(bundle, "Contents");
  mkdirSync(contents, { recursive: true });
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>app.airmcp</string>
  <key>AirMCPAcceptanceHarnessBuild</key>
  <true/>
</dict>
</plist>
`,
    { mode: 0o600 },
  );
  return bundle;
}

function artifactGateEnvironment(bundle) {
  const environment = { ...process.env, APP_BUNDLE_PATH: bundle };
  for (const name of [
    "APPLE_DEVELOPER_ID",
    "APPLE_API_KEY_PATH",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
    "NOTARY_KEYCHAIN_PROFILE",
    "APPLE_ID",
    "APPLE_ID_PASSWORD",
    "APPLE_TEAM_ID",
  ]) {
    delete environment[name];
  }
  return environment;
}

function validateMainEntitlements(contents) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-main-entitlements-"));
  temporaryDirectories.push(directory);
  const entitlements = join(directory, "candidate.plist");
  const harness = join(directory, "validate.sh");
  writeFileSync(entitlements, contents);
  writeFileSync(
    harness,
    `#!/bin/bash
set -euo pipefail
ENT_DIR="$1"
${mainValidatorSource}
verify_main_entitlements "$2" "contract"
`,
  );
  return spawnSync("bash", [harness, directory, entitlements], { encoding: "utf8" });
}

function validateWidgetEntitlements(contents) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-widget-entitlements-"));
  temporaryDirectories.push(directory);
  const entitlements = join(directory, "candidate.plist");
  const harness = join(directory, "validate.sh");
  writeFileSync(entitlements, contents);
  writeFileSync(
    harness,
    `#!/bin/bash
set -euo pipefail
ENT_DIR="$1"
${widgetValidatorSource}
verify_widget_entitlements "$2" "contract"
`,
  );
  return spawnSync("bash", [harness, directory, entitlements], { encoding: "utf8" });
}

describe("signed app artifact verification script", () => {
  test("is valid bash", () => {
    expect(() => execFileSync("bash", ["-n", scriptPath.pathname], { stdio: "pipe" })).not.toThrow();
  });

  test("verifies an existing signed artifact instead of rebuilding it", () => {
    expect(script).toContain("codesign --verify --deep --strict");
    expect(script).toContain("SIGN_AUTHORITY=");
    // The expected Developer ID subject is centralised in
    // scripts/lib/signing-identity.sh, so the check here is that the script
    // compares against that single source of truth rather than carrying its own
    // copy of the identity.
    expect(script).toContain("lib/signing-identity.sh");
    expect(script).toContain('"$AIRMCP_SIGNING_COMMON_NAME"');
    expect(script).toContain('"$AIRMCP_SIGNING_TEAM_ID"');
    expect(script).toContain("TeamIdentifier=");
    expect(script).toContain("spctl --assess --type execute");
    expect(script).toContain("xcrun stapler validate");
    expect(script).toContain("probe-app-runtime.mjs");
    expect(script).toContain("/app/runtime-state");
    expect(script).toContain('CONFIG_FILE="$ISOLATED_HOME/.config/airmcp/config.json"');
    expect(script).toContain('TOKEN_FILE="$ISOLATED_HOME/Library/Application Support/AirMCP/http-token"');
    expect(script).toContain("features");
    expect(script).toContain('"auditLog": false');
    expect(script).toContain('"usageTracking": false');
    expect(script).toContain('defaults write "$ISOLATED_HOME/Library/Preferences/app.airmcp"');
    expect(script).toContain("autoStartServer -bool true");
    expect(script).toContain("onboardingPresented -bool true");
    expect(script).toContain('--env "HOME=$ISOLATED_HOME"');
    expect(script).toContain('--env "CFFIXED_USER_HOME=$ISOLATED_HOME"');
    expect(script).not.toContain('--env "AIRMCP_');
    expect(script).not.toContain("AIRMCP_FORCE_APP_RUNTIME");
    expect(script).toContain("ownerFingerprint");
    expect(script).toContain("pid_matches_prefix");
    expect(script).toContain('--owner-secret-file "$OWNER_FILE"');
    expect(script).toContain("airmcp-app-generation-bearer-v1");
    expect(script).toContain("tokenFingerprint");
    expect(script).toContain("processIdentifier == $APP_PID");
    expect(script).toContain("AIRMCP_REQUIRE_WIDGET=1");
    expect(script).toContain("AIRMCP_EXPECTED_SIGNING_MODE=developer-id");
    expect(script).toContain('AIRMCP_EXPECTED_SIGNING_AUTHORITY="$AIRMCP_SIGNING_COMMON_NAME"');
    expect(script).toContain('AIRMCP_EXPECTED_SIGNING_TEAM_ID="$AIRMCP_SIGNING_TEAM_ID"');
    expect(script).toContain("bundle structure verification failed");
    expect(script).toContain("Print :AirMCPAcceptanceHarnessBuild");
    expect(script).toContain("refusing an acceptance-harness build");
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

  test("does not leave the hidden acceptance bundle registered as the app.airmcp launch target", () => {
    expect(bundleScript).toContain('if [ "$ACCEPTANCE_HARNESS_BUILD" = "0" ]; then');
    expect(bundleScript).toContain("register_bundle_with_launch_services");
    expect(bundleScript).toContain('"$LSREGISTER" -u "$BUNDLE_DIR"');
    expect(bundleScript).toContain("cannot select test-only launch wiring");
  });

  test("rejects an acceptance bundle before signature checks or app execution", () => {
    const bundle = createAcceptanceHarnessBundle();
    const tripwireDirectory = join(bundle, "Contents", "tripwire-bin");
    const tripwire = join(tripwireDirectory, "node");
    const tripwireSentinel = join(bundle, "node-was-executed");
    mkdirSync(tripwireDirectory);
    writeFileSync(tripwire, '#!/bin/sh\n: > "$AIRMCP_TRIPWIRE_SENTINEL"\nexit 97\n');
    chmodSync(tripwire, 0o700);
    const environment = artifactGateEnvironment(bundle);
    environment.AIRMCP_TRIPWIRE_SENTINEL = tripwireSentinel;
    environment.PATH = `${tripwireDirectory}:${environment.PATH ?? "/usr/bin:/bin"}`;
    const result = spawnSync("bash", [scriptPath.pathname], {
      encoding: "utf8",
      env: environment,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("verify-signed-app: refusing an acceptance-harness build");
    expect(existsSync(tripwireSentinel)).toBe(false);
    expect(result.stdout).not.toContain("checking signature tree");
    expect(result.stdout).not.toContain("launching isolated artifact generation");
  });

  test("notarization signs embedded runtime code and runs the final artifact gate", () => {
    expect(notarize).toContain("Contents/Resources/airmcp/runtime/bin/node");
    expect(notarize).toContain("Contents/Resources/airmcp/bin/AirMcpBridge");
    expect(notarize).toContain('find "$APP_BUNDLE/Contents/Resources/airmcp/runtime/lib"');
    expect(notarize).toContain('"${NOTARY_AUTH[@]}"');
    expect(notarize).toContain('bash "$SCRIPT_DIR/verify-signed-app.sh"');
    expect(notarize).toContain('bash "$SCRIPT_DIR/verify-signing-identity.sh"');
    expect(notarize).toContain("Print :AirMCPAcceptanceHarnessBuild");
    expect(notarize).toContain("refusing to sign an acceptance-harness build");
    expect(notarize).toContain('SOURCE_MAIN_ENTITLEMENTS="$ENT_DIR/source-main-app.plist"');
    expect(notarize).toContain('MAIN_ENTITLEMENTS="$SCRIPT_DIR/lib/main-app-entitlements.plist"');
    expect(notarize).toContain('verify_main_entitlements "$SOURCE_MAIN_ENTITLEMENTS" "source"');
    expect(notarize).toContain('verify_main_entitlements "$MAIN_ENTITLEMENTS" "allowlisted"');
    const outerBundleSigning = notarize.match(
      /# Finally sign the outer bundle[\s\S]*?if ! codesign --force --options=runtime --timestamp \\\n[\s\S]*?\nfi/,
    )?.[0];
    expect(outerBundleSigning).toContain('--entitlements "$MAIN_ENTITLEMENTS"');
    expect(outerBundleSigning).not.toContain("SOURCE_MAIN_ENTITLEMENTS");
    expect(notarize).toContain('FINAL_MAIN_ENTITLEMENTS="$ENT_DIR/final-main-app.plist"');
    expect(notarize).toContain('verify_main_entitlements "$FINAL_MAIN_ENTITLEMENTS" "re-signed"');
    expect(notarize).toContain('verify_widget_entitlements "$ent_file" "source"');
    expect(notarize).toContain('verify_widget_entitlements "$WIDGET_ENTITLEMENTS" "allowlisted"');
    expect(notarize).toContain('verify_widget_entitlements "$final_ent_file" "re-signed"');
    expect(notarize).toContain('WIDGET_ENTITLEMENTS="$SCRIPT_DIR/lib/widget-entitlements.plist"');
    const extensionSigning = notarize.match(
      /# Sign embedded extensions first[\s\S]*?(?=# Finally sign the outer bundle)/,
    )?.[0];
    expect(extensionSigning).toContain('--entitlements "$WIDGET_ENTITLEMENTS"');
    expect(extensionSigning).not.toContain('--entitlements "$ent_file"');
    expect(notarize).toContain("com.apple.security.application-groups");
    expect(notarize).toContain("com.apple.security.automation.apple-events");
    expect(notarize).toContain("for capability in calendars reminders");
    expect(notarize).toContain("personal-information\\.$capability");
    expect(notarize).toContain("application-groups entitlement must be an array");
    expect(notarize).toContain("application-groups must contain only group.app.airmcp");
    expect(notarize).toContain("main-app contains an unexpected entitlement");
    expect(notarize).toContain("main-app sandbox entitlement must be a boolean");
    expect(notarize).toContain("main-app must remain outside the App Sandbox");
    expect(notarize).toContain("widget contains an unexpected entitlement");
    expect(notarize).toContain("widget must enable the App Sandbox");
    expect(notarize).not.toContain("codesigning with $APPLE_DEVELOPER_ID");
    expect(notarize).not.toContain('echo "$SUBMIT_OUTPUT"');
    expect(notarize).not.toContain("preserved entitlements: $appex");
    expect(notarize).not.toContain('echo "  signing $nested"');
    expect(notarize).not.toContain('echo "  signing $appex"');
    expect(notarize).not.toContain("zipping $APP_BUNDLE");
    expect(notarize).not.toContain("✓ $APP_BUNDLE");
  });

  test("uses one exact main-app entitlement allowlist for the baseline and Developer ID signatures", () => {
    const keys = [...mainEntitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();
    expect(keys).toEqual(
      [
        "com.apple.security.app-sandbox",
        "com.apple.security.application-groups",
        "com.apple.security.automation.apple-events",
      ].sort(),
    );
    expect(mainEntitlements).toMatch(/<key>com\.apple\.security\.app-sandbox<\/key>\s*<false\/>/);
    expect(mainEntitlements).toMatch(
      /<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>group\.app\.airmcp<\/string>\s*<\/array>/,
    );
    expect(mainEntitlements).toMatch(/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\/>/);
    expect(mainEntitlements).not.toMatch(/get-task-allow|disable-library-validation|allow-dyld-environment-variables/);
    expect(bundleScript).toContain('MAIN_APP_ENTITLEMENTS="$SCRIPT_DIR/lib/main-app-entitlements.plist"');
    expect(bundleScript).toContain('--entitlements "$MAIN_APP_ENTITLEMENTS"');
  });

  test("resolves a codesign selector to the signed authority and team before verification", () => {
    expect(bundleScript).toContain('SIGNED_BUNDLE_INFO="$(codesign -dv --verbose=4 "$BUNDLE_DIR" 2>&1)"');
    expect(bundleScript).toContain("SIGNED_AUTHORITY=");
    expect(bundleScript).toContain("SIGNED_TEAM_ID=");
    expect(bundleScript).toContain('AIRMCP_EXPECTED_SIGNING_AUTHORITY="$SIGNED_AUTHORITY"');
    expect(bundleScript).toContain('AIRMCP_EXPECTED_SIGNING_TEAM_ID="$SIGNED_TEAM_ID"');
    expect(bundleScript).not.toContain('AIRMCP_EXPECTED_SIGNING_AUTHORITY="$SIGN_IDENTITY"');
  });

  test("fails closed when a source signature adds a debug entitlement or another app group", () => {
    expect(mainValidatorStart).toBeGreaterThanOrEqual(0);
    expect(mainValidatorEnd).toBeGreaterThan(mainValidatorStart);
    expect(validateMainEntitlements(mainEntitlements).status).toBe(0);

    const withDebugEntitlement = mainEntitlements.replace(
      "</dict>",
      "\t<key>com.apple.security.get-task-allow</key>\n\t<true/>\n</dict>",
    );
    const debugResult = validateMainEntitlements(withDebugEntitlement);
    expect(debugResult.status).toBe(1);
    expect(debugResult.stderr).toContain("contains an unexpected entitlement");

    const withAnotherGroup = mainEntitlements.replace(
      "\t\t<string>group.app.airmcp</string>",
      "\t\t<string>group.app.airmcp</string>\n\t\t<string>group.attacker</string>",
    );
    const groupResult = validateMainEntitlements(withAnotherGroup);
    expect(groupResult.status).toBe(1);
    expect(groupResult.stderr).toContain("application-groups must contain only group.app.airmcp");
  });

  test("uses and enforces one exact sandboxed widget entitlement allowlist", () => {
    const keys = [...widgetEntitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();
    expect(keys).toEqual(
      [
        "com.apple.security.app-sandbox",
        "com.apple.security.application-groups",
        "com.apple.security.personal-information.calendars",
        "com.apple.security.personal-information.reminders",
      ].sort(),
    );
    expect(widgetEntitlements).toMatch(/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/);
    expect(validateWidgetEntitlements(widgetEntitlements).status).toBe(0);

    const withDebugEntitlement = widgetEntitlements.replace(
      "</dict>",
      "\t<key>com.apple.security.get-task-allow</key>\n\t<true/>\n</dict>",
    );
    const debugResult = validateWidgetEntitlements(withDebugEntitlement);
    expect(debugResult.status).toBe(1);
    expect(debugResult.stderr).toContain("widget contains an unexpected entitlement");

    const withoutSandbox = widgetEntitlements.replace(
      /(<key>com\.apple\.security\.app-sandbox<\/key>\s*)<true\/>/,
      "$1<false/>",
    );
    const sandboxResult = validateWidgetEntitlements(withoutSandbox);
    expect(sandboxResult.status).toBe(1);
    expect(sandboxResult.stderr).toContain("widget must enable the App Sandbox");

    const withAnotherGroup = widgetEntitlements.replace(
      "\t\t<string>group.app.airmcp</string>",
      "\t\t<string>group.app.airmcp</string>\n\t\t<string>group.attacker</string>",
    );
    const groupResult = validateWidgetEntitlements(withAnotherGroup);
    expect(groupResult.status).toBe(1);
    expect(groupResult.stderr).toContain("application-groups must contain only group.app.airmcp");
  });

  test("rejects an acceptance bundle before reading signing or notarization credentials", () => {
    const bundle = createAcceptanceHarnessBundle();
    const result = spawnSync("bash", [notarizePath.pathname], {
      encoding: "utf8",
      env: artifactGateEnvironment(bundle),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notarize-app: refusing to sign an acceptance-harness build");
    expect(result.stderr).not.toContain("required env var");
    expect(result.stdout).not.toContain("codesigning with the verified Heznpc Developer ID");
    expect(result.stdout).not.toContain("submitting to Apple");
  });
});
