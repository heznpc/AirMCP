import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const bundle = readFileSync(new URL("../scripts/bundle-app.sh", import.meta.url), "utf8");
const verify = readFileSync(new URL("../scripts/verify-bundle-structure.sh", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/Sources/AirMCPApp/Views/MenuContent.swift", import.meta.url), "utf8");
const server = readFileSync(new URL("../app/Sources/AirMCPApp/ServerManager.swift", import.meta.url), "utf8");

describe("self-contained macOS app bundle", () => {
  test("embeds a fixed Node runtime, universal server, production dependencies, and Swift bridge", () => {
    expect(bundle).toContain("Contents/Resources/airmcp");
    expect(bundle).toContain("npm ci --omit=dev --ignore-scripts");
    expect(bundle).toContain("runtime/bin");
    expect(bundle).toContain("AirMcpBridge");
    expect(bundle).toContain(
      'codesign --force --sign "$SIGN_IDENTITY" "$BUNDLE_DIR/Contents/Resources/airmcp/runtime/bin/node"',
    );
  });

  test("app runtime and generated client configs prefer bundled executables", () => {
    expect(menu).toContain("static var bundledServerRuntime: (node: String, entry: String)?");
    expect(menu).toContain('bundledServerRuntime?.node ?? "npx"');
    expect(server).toContain("if let runtime = AirMcpConstants.bundledServerRuntime");
    expect(server).toContain('env["AIRMCP_BRIDGE_PATH"] = bridge');
  });

  test("bundle verification proves runtime, architecture, and widget version parity", () => {
    expect(verify).toContain("RUNTIME_VERSION=");
    expect(verify).toContain("bundled runtime version");
    expect(verify).toContain('APP_ARCHS="$(lipo -archs "$APP_BINARY")"');
    expect(verify).toContain("widget version/build");
    expect(verify).toContain("CFBundleAllowMixedLocalizations");
    expect(verify).toContain("LSMultipleInstancesProhibited");
    expect(verify).toContain("SUPPORTED_LOCALES");
    expect(verify).toContain("packaged localization missing");
    expect(verify).toContain("packaged localization is not declared");
    expect(bundle).toContain('rm -rf "$PREVIOUS_APP_BUILD_DIR/AirMCPApp_AirMCPApp.bundle"');
  });

  test("non-interactive verification cleans up only this checkout app and runtime", () => {
    expect(bundle).toContain("trap cleanup_verification EXIT");
    expect(bundle).toContain("cleanup_verification()");
    expect(bundle).toContain("stop_bundle_processes");
    expect(bundle).toContain('terminate_matching_command prefix "$APP_BINARY"');
    expect(bundle).toContain('terminate_matching_command exact "$bundled_runtime"');
    expect(bundle).not.toContain('pkill -x "$APP_EXECUTABLE"');
    expect(bundle).not.toContain('pgrep -x "$APP_EXECUTABLE"');
    expect(bundle).toContain('"$APP_BINARY"|"$APP_BINARY "*');
  });
});
