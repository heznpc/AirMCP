/** The widget reads a shared App Group container the main app writes. That only
 *  works if BOTH signed targets declare the SAME app-group entitlement AND it
 *  matches the id the Swift code uses. codesign --verify does NOT catch a
 *  missing or mismatched group (it passes with none), so this static gate does. */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_GROUP = "group.com.heznpc.AirMCP";

const bundleSh = readFileSync(join(ROOT, "scripts/bundle-app.sh"), "utf-8");
// WidgetSnapshotConfig (appGroupID) moved from WidgetSnapshot.swift into the
// store file when the I/O layer was split out of the pure data model.
const snapshotSwift = readFileSync(join(ROOT, "app/widget/SnapshotKit/WidgetSnapshotStore.swift"), "utf-8");

describe("widget App Group entitlement agreement", () => {
  test("bundle-app.sh declares the app group for BOTH the widget appex and the main app", () => {
    // One occurrence in the widget-appex entitlements heredoc, one in the main
    // app entitlements heredoc.
    const occurrences = bundleSh.split(APP_GROUP).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(bundleSh).toContain("com.apple.security.application-groups");
  });

  test("both entitlement blocks use application-groups (widget appex + main app)", () => {
    const groupBlocks = bundleSh.split("com.apple.security.application-groups").length - 1;
    expect(groupBlocks).toBeGreaterThanOrEqual(2);
  });

  test("the Swift WidgetSnapshotConfig.appGroupID matches the entitlement id", () => {
    expect(snapshotSwift).toContain(`appGroupID = "${APP_GROUP}"`);
  });

  test("the briefing widget's kind string is consistent between reader and writer", () => {
    const widgetSwift = readFileSync(join(ROOT, "app/widget/Sources/AirMCPWidget.swift"), "utf-8");
    const writerSwift = readFileSync(join(ROOT, "app/Sources/AirMCPApp/WidgetSnapshotWriter.swift"), "utf-8");
    const kind = "com.heznpc.AirMCP.BriefingWidget";
    expect(widgetSwift).toContain(kind);
    expect(writerSwift).toContain(kind);
  });

  test("the trust-status widget's kind is consistent between the widget and the writer's reload", () => {
    const trustSwift = readFileSync(join(ROOT, "app/widget/Sources/TrustStatusWidget.swift"), "utf-8");
    const writerSwift = readFileSync(join(ROOT, "app/Sources/AirMCPApp/WidgetSnapshotWriter.swift"), "utf-8");
    const kind = "com.heznpc.AirMCP.TrustStatusWidget";
    expect(trustSwift).toContain(`kind = "${kind}"`);
    expect(writerSwift).toContain(kind);
  });
});
