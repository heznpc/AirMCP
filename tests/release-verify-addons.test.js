import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../scripts/verify-release-state.mjs", import.meta.url), "utf8");

describe("release:verify add-on registry coverage", () => {
  test("verifies all published add-on package versions unless explicitly skipped", () => {
    expect(script).toContain('const skipAddons = args.includes("--skip-addons")');
    expect(script).toContain("loadAddonPackages");
    expect(script).toContain("MODULE_PACK_MANIFEST.filter");
    expect(script).toContain("verifyPublishedPackage(addonPack.packageName");
  });

  test("fresh-installs root plus every add-on from the registry", () => {
    expect(script).toContain('const skipAddonInstall = args.includes("--skip-addon-install")');
    expect(script).toContain("verifyAddonRegistryInstall");
    expect(script).toContain("npm\", [\"install\"");
    expect(script).toContain("await import(name)");
    expect(script).toContain("packageName export mismatch");
  });
});
