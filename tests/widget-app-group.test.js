/** The widget reads a shared App Group container the main app writes. That only
 *  works if BOTH signed targets declare the SAME app-group entitlement AND it
 *  matches the id the Swift code uses. codesign --verify does NOT catch a
 *  missing or mismatched group (it passes with none), so this static gate does. */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_GROUP = "group.app.airmcp";

const bundleSh = readFileSync(join(ROOT, "scripts/bundle-app.sh"), "utf-8");
const mainEntitlements = readFileSync(join(ROOT, "scripts/lib/main-app-entitlements.plist"), "utf-8");
// WidgetSnapshotConfig (appGroupID) moved from WidgetSnapshot.swift into the
// store file when the I/O layer was split out of the pure data model.
const snapshotSwift = readFileSync(join(ROOT, "app/widget/SnapshotKit/WidgetSnapshotStore.swift"), "utf-8");

describe("widget App Group entitlement agreement", () => {
  test("bundle-app.sh declares the app group for BOTH the widget appex and the main app", () => {
    expect(bundleSh).toContain(APP_GROUP);
    expect(mainEntitlements).toContain(`<string>${APP_GROUP}</string>`);
    expect(bundleSh).toContain('MAIN_APP_ENTITLEMENTS="$SCRIPT_DIR/lib/main-app-entitlements.plist"');
    expect(bundleSh).toContain("com.apple.security.application-groups");
  });

  test("both entitlement blocks use application-groups (widget appex + main app)", () => {
    expect(bundleSh).toContain("com.apple.security.application-groups");
    expect(mainEntitlements).toContain("com.apple.security.application-groups");
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
});
