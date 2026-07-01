import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const menuContent = readFileSync(new URL("../app/Sources/AirMCPApp/Views/MenuContent.swift", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/Sources/AirMCPApp/AirMCPApp.swift", import.meta.url), "utf8");
const addonManager = readFileSync(new URL("../app/Sources/AirMCPApp/AddonManager.swift", import.meta.url), "utf8");
const enStrings = readFileSync(
  new URL("../app/Sources/AirMCPApp/Resources/en.lproj/Localizable.strings", import.meta.url),
  "utf8",
);

describe("AirMCP.app module add-on management", () => {
  test("menubar app wires an add-on manager into MenuContent", () => {
    expect(app).toContain("@State private var addonManager = AddonManager()");
    expect(app).toContain("addonManager: addonManager");
    expect(app).toContain("addonManager.refreshIfNeeded()");
    expect(menuContent).toContain("let addonManager: AddonManager");
    expect(menuContent).toContain(".onAppear");
    expect(menuContent).toContain("addonManager.refreshIfNeeded()");
  });

  test("module menu exposes pack-level add-on controls", () => {
    expect(menuContent).toContain('Menu(L("addons.menu"))');
    expect(menuContent).toContain('Button(L("addons.refresh"))');
    expect(menuContent).toContain('Button(L("addons.install"))');
    expect(menuContent).toContain('Button(L("addons.repair"))');
    expect(menuContent).toContain('Button(L("addons.uninstall"))');
    expect(menuContent).toContain('Button(L("addons.copyInstallCommand"))');
    expect(menuContent).toContain("addonManager.isInstalled(pack: pack.id)");
    expect(menuContent).toContain("addonManager.isUpdateAvailable(pack: pack.id)");
    expect(menuContent).toContain("addonManager.versionSummary(pack: pack.id)");
    expect(menuContent).toContain("addonManager.sizeSummary(pack: pack.id)");
    expect(menuContent).toContain('"addons.activeButMissing"');
    expect(menuContent).toContain("@heznpc/airmcp-productivity");
    expect(menuContent).toContain("@heznpc/airmcp-spatial");
  });

  test("app install path invokes the pinned AirMCP package specifier", () => {
    expect(addonManager).toContain("AirMcpConstants.npmPackageSpecifier");
    expect(addonManager).toContain('"modules"');
    expect(addonManager).toContain('"--install"');
    expect(addonManager).toContain('"list"');
    expect(addonManager).toContain('"--json"');
    expect(addonManager).toContain("installedPacks");
    expect(addonManager).toContain("updateAvailable");
    expect(addonManager).toContain("installedSizeBytes");
  });

  test("localized strings cover the add-on controls", () => {
    expect(enStrings).toContain('"addons.menu" = "Module Add-ons"');
    expect(enStrings).toContain('"addons.refresh" = "Refresh Add-on Status"');
    expect(enStrings).toContain('"addons.activeButMissing" = "Active but not installed"');
    expect(enStrings).toContain('"addons.repair" = "Update or Repair"');
    expect(enStrings).toContain('"addons.versionMismatch" = "Installed %@, expected %@"');
    expect(enStrings).toContain('"addon.spatial" = "Spatial"');
  });
});
