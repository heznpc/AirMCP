import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedSpecifier = `airmcp@${pkg.version}`;

const menuContent = readFileSync(
  new URL("../app/Sources/AirMCPApp/Views/MenuContent.swift", import.meta.url),
  "utf8",
);
const serverManager = readFileSync(new URL("../app/Sources/AirMCPApp/ServerManager.swift", import.meta.url), "utf8");
const appIntents = readFileSync(new URL("../app/Sources/AirMCPApp/AppIntents.swift", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../app/Sources/AirMCPApp/Views/OnboardingView.swift", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/shared/config.ts", import.meta.url), "utf8");

describe("app-owned runtime npm package pin", () => {
  test("Swift constants pin app-owned npx commands to the bundle/package version", () => {
    expect(menuContent).toContain(`static let npmPackageVersion = "${pkg.version}"`);
    expect(menuContent).toContain('ProcessInfo.processInfo.environment["AIRMCP_NPM_PACKAGE_SPECIFIER"]');
    expect(menuContent).toContain('"\\(npmPackageName)@\\(npmPackageVersion)"');
    expect(menuContent).toContain("npmPackageSpecifier");
    expect(menuContent).not.toContain('["-y", npmPackageName, "connect"');
  });

  test("app runtime, AppIntents, and onboarding use the pinned specifier", () => {
    expect(serverManager).toContain("AirMcpConstants.npmPackageSpecifier");
    expect(appIntents).toContain("AirMcpConstants.npmPackageSpecifier");
    expect(onboarding).toContain("AirMcpConstants.npmPackageSpecifier");
  });

  test("TypeScript app-owned proxy helper uses the same pinned package specifier", () => {
    expect(config).toContain(`export const NPM_PACKAGE_SPECIFIER = "${expectedSpecifier}"`);
  });

  test("local app verification can override npx to the checkout instead of unpublished npm versions", () => {
    const bundleScript = readFileSync(new URL("../scripts/bundle-app.sh", import.meta.url), "utf8");
    expect(bundleScript).toContain('AIRMCP_NPM_PACKAGE_SPECIFIER="${AIRMCP_NPM_PACKAGE_SPECIFIER:-$PROJECT_DIR}"');
  });
});
