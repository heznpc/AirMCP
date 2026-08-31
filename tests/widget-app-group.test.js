/** The widget reads a shared App Group container the main app writes. That only
 *  works if BOTH signed targets declare the SAME app-group entitlement AND it
 *  matches the id the Swift code uses. codesign --verify does NOT catch a
 *  missing or mismatched group (it passes with none), so this static gate does. */
import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_GROUP = "group.app.airmcp";

const bundleSh = readFileSync(join(ROOT, "scripts/bundle-app.sh"), "utf-8");
const mainEntitlements = readFileSync(join(ROOT, "scripts/lib/main-app-entitlements.plist"), "utf-8");
const widgetEntitlements = readFileSync(join(ROOT, "scripts/lib/widget-entitlements.plist"), "utf-8");
const registrationFunction = bundleSh.match(/register_bundle_with_launch_services\(\) \{[\s\S]*?\n\}/)?.[0];
const temporaryDirectories = [];
// WidgetSnapshotConfig (appGroupID) moved from WidgetSnapshot.swift into the
// store file when the I/O layer was split out of the pure data model.
const snapshotSwift = readFileSync(join(ROOT, "app/widget/SnapshotKit/WidgetSnapshotStore.swift"), "utf-8");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runRegistration({
  launchServicesExit = 0,
  pluginAddExit = 0,
  pluginState = "",
  widgetRegistered = true,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-widget-registration-"));
  temporaryDirectories.push(directory);
  const bundle = join(directory, "AirMCP.app");
  const widget = join(bundle, "Contents", "PlugIns", "AirMCPWidget.appex");
  const launchServices = join(directory, "lsregister");
  const pluginkit = join(directory, "pluginkit");
  const harness = join(directory, "register.sh");
  mkdirSync(widget, { recursive: true });
  writeFileSync(launchServices, `#!/bin/sh\nexit ${launchServicesExit}\n`);
  writeFileSync(
    pluginkit,
    `#!/bin/sh
if [ "$1" = "-a" ]; then exit ${pluginAddExit}; fi
${
  widgetRegistered
    ? `printf '%s\\t%s\\t%s\\t%s\\n' ${JSON.stringify(`${pluginState}    app.airmcp.Widget(2.16.6)`)} "UUID" "timestamp" ${JSON.stringify(widget)}`
    : ":"
}
`,
  );
  chmodSync(launchServices, 0o700);
  chmodSync(pluginkit, 0o700);
  writeFileSync(
    harness,
    `#!/bin/bash
set -euo pipefail
BUNDLE_DIR=${JSON.stringify(bundle)}
WIDGET_BUNDLE_ID="app.airmcp.Widget"
WIDGET_APPEX=${JSON.stringify(widget)}
LSREGISTER=${JSON.stringify(launchServices)}
PLUGINKIT=${JSON.stringify(pluginkit)}
REGISTRATION_ATTEMPTS=1
REGISTRATION_SLEEP_SECONDS=0
${registrationFunction}
register_bundle_with_launch_services
`,
  );
  return spawnSync("bash", [harness], { encoding: "utf8" });
}

describe("widget App Group entitlement agreement", () => {
  test("bundle-app.sh declares the app group for BOTH the widget appex and the main app", () => {
    expect(mainEntitlements).toContain(`<string>${APP_GROUP}</string>`);
    expect(widgetEntitlements).toContain(`<string>${APP_GROUP}</string>`);
    expect(bundleSh).toContain('MAIN_APP_ENTITLEMENTS="$SCRIPT_DIR/lib/main-app-entitlements.plist"');
    expect(bundleSh).toContain('WIDGET_ENTITLEMENTS="$SCRIPT_DIR/lib/widget-entitlements.plist"');
  });

  test("both entitlement blocks use application-groups (widget appex + main app)", () => {
    expect(mainEntitlements).toContain("com.apple.security.application-groups");
    expect(widgetEntitlements).toContain("com.apple.security.application-groups");
  });

  test("the widget uses the exact sandboxed release entitlement allowlist", () => {
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
    expect(widgetEntitlements).not.toMatch(
      /get-task-allow|disable-library-validation|allow-dyld-environment-variables/,
    );
    expect(bundleSh).toContain('--entitlements "$WIDGET_ENTITLEMENTS"');
  });

  test("the main app declares Apple Events automation without inventing a screen-capture entitlement", () => {
    expect(mainEntitlements).toMatch(
      /<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>group\.app\.airmcp<\/string>\s*<\/array>/,
    );
    expect(mainEntitlements).toMatch(/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\/>/);
    expect(mainEntitlements).not.toMatch(/<key>com\.apple\.security\.[^<]*(?:screen|capture)[^<]*<\/key>/i);
  });

  test("the Swift WidgetSnapshotConfig.appGroupID matches the entitlement id", () => {
    expect(snapshotSwift).toContain(`appGroupID = "${APP_GROUP}"`);
  });

  test("the briefing widget's kind string is consistent between reader and writer", () => {
    const widgetSwift = readFileSync(join(ROOT, "app/widget/Sources/AirMCPWidget.swift"), "utf-8");
    const writerSwift = readFileSync(join(ROOT, "app/Sources/AirMCPApp/WidgetSnapshotWriter.swift"), "utf-8");
    const kind = "app.airmcp.BriefingWidget";
    expect(widgetSwift).toContain(kind);
    expect(writerSwift).toContain(kind);
  });

  test("the trust-status widget's kind is consistent between the widget and the writer's reload", () => {
    const trustSwift = readFileSync(join(ROOT, "app/widget/Sources/TrustStatusWidget.swift"), "utf-8");
    const writerSwift = readFileSync(join(ROOT, "app/Sources/AirMCPApp/WidgetSnapshotWriter.swift"), "utf-8");
    const kind = "app.airmcp.TrustStatusWidget";
    expect(trustSwift).toContain(`kind = "${kind}"`);
    expect(writerSwift).toContain(kind);
  });

  test("fails closed when Launch Services or WidgetKit registration fails", () => {
    expect(registrationFunction).toBeDefined();

    const launchServicesFailure = runRegistration({ launchServicesExit: 17 });
    expect(launchServicesFailure.status).toBe(1);
    expect(launchServicesFailure.stderr).toContain("Launch Services rejected");

    const missingWidgetRegistration = runRegistration({ widgetRegistered: false });
    expect(missingWidgetRegistration.status).toBe(1);
    expect(missingWidgetRegistration.stderr).toContain("WidgetKit extension registration failed");

    const rejectedWidgetRegistration = runRegistration({ pluginAddExit: 23 });
    expect(rejectedWidgetRegistration.status).toBe(1);
    expect(rejectedWidgetRegistration.stderr).toContain("WidgetKit rejected extension registration");

    const ignoredWidgetRegistration = runRegistration({ pluginState: "-" });
    expect(ignoredWidgetRegistration.status).toBe(1);
    expect(ignoredWidgetRegistration.stderr).toContain("WidgetKit extension registration failed");

    for (const pluginState of ["?", "!"]) {
      const ineligibleWidgetRegistration = runRegistration({ pluginState });
      expect(ineligibleWidgetRegistration.status).toBe(1);
      expect(ineligibleWidgetRegistration.stderr).toContain("WidgetKit extension registration failed");
    }

    const supersededButDiscoverable = runRegistration({ pluginState: "=" });
    expect(supersededButDiscoverable.stderr).toBe("");
    expect(supersededButDiscoverable.status).toBe(0);

    const registered = runRegistration();
    expect(registered.stderr).toBe("");
    expect(registered.status).toBe(0);
  });
});
