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
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const temporaryDirectories = [];

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
    expect(bundleScript).toContain('if [ "$ACCEPTANCE_HARNESS_BUILD" = "0" ] && [ -x "$LSREGISTER" ]');
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
    expect(notarize).not.toContain("codesigning with $APPLE_DEVELOPER_ID");
    expect(notarize).not.toContain('echo "$SUBMIT_OUTPUT"');
    expect(notarize).not.toContain("preserved entitlements: $appex");
    expect(notarize).not.toContain('echo "  signing $nested"');
    expect(notarize).not.toContain('echo "  signing $appex"');
    expect(notarize).not.toContain("zipping $APP_BUNDLE");
    expect(notarize).not.toContain("✓ $APP_BUNDLE");
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
