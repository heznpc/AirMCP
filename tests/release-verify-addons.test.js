import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../scripts/verify-release-state.mjs", import.meta.url), "utf8");

describe("release:verify add-on registry coverage", () => {
  test("verifies all published add-on package versions unless explicitly skipped", () => {
    expect(script).toContain('const skipAddons = args.includes("--skip-addons")');
    expect(script).toContain("loadAddonPackages");
    expect(script).toContain("MODULE_PACK_MANIFEST.filter");
    expect(script).toContain("for (const addonPack of addonPacks)");
    expect(script).toMatch(/verifyPublishedPackage\(\s*addonPack\.packageName,/);
    expect(script).toContain("addonPack.packageRoot");
    expect(script).toContain("expectedGitHead");
  });

  test("fresh-installs root plus every add-on from the registry", () => {
    expect(script).toContain('const skipAddonInstall = args.includes("--skip-addon-install")');
    expect(script).toContain("verifyAddonRegistryInstall");
    expect(script).toContain("npm\", [\"install\"");
    expect(script).toContain("await import(name)");
    expect(script).toContain("packageName export mismatch");
  });

  test("runs npx smoke from a fresh directory instead of the repo root", () => {
    expect(script).toContain("function verifyNpxSmoke()");
    expect(script).toContain('mkdtempSync(join(tmpdir(), "airmcp-release-npx-"))');
    expect(script).toContain("cwd: work");
    expect(script).toContain("verifyNpxSmoke()");
  });

  test("fresh-installs the public root and boots its universal full/full surface", () => {
    expect(script).toContain('const skipRootInstall = args.includes("--skip-root-install")');
    expect(script).toContain("verifyRootRegistryInstall");
    expect(script).toContain('AIRMCP_PROFILE: "full"');
    expect(script).toContain('AIRMCP_ADDON_PACKAGE_MODE: "bundled"');
    expect(script).toContain('"numbers_set_cell"');
    expect(script).toContain('"gws_sheets_read"');
  });

  test("requires registry integrity and HTTPS tarball metadata", () => {
    expect(script).toContain('dist.integrity.startsWith("sha512-")');
    expect(script).toContain('dist.tarball.startsWith("https://")');
  });
});
