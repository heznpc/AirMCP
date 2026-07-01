import { describe, test, expect } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("add-on package staging", () => {
  test("stages physical package directories for non-core module packs", () => {
    const output = execFileSync(process.execPath, ["scripts/build-addon-packages.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toContain("add-on package boundary check passed");

    const manifestPath = join(process.cwd(), "build", "addons", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const productivity = manifest.packages.find((pack) => pack.name === "productivity");
    expect(productivity.packageName).toBe("@heznpc/airmcp-productivity");

    const packageRoot = join(process.cwd(), productivity.packageDir);
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(packageJson.name).toBe("@heznpc/airmcp-productivity");
    expect(packageJson.name).not.toContain("pack-");
    expect(packageJson.airmcp.modules).toEqual(["pages", "numbers", "keynote"]);
    expect(packageJson.airmcp.sharedRuntime).toBe("peer-root");
    expect(productivity.sharedRuntime).toBe("peer-root");
    expect(existsSync(join(packageRoot, "dist", "pages", "tools.js"))).toBe(true);
    expect(existsSync(join(packageRoot, "dist", "shared", "mcp.js"))).toBe(false);

    const pagesTools = readFileSync(join(packageRoot, "dist", "pages", "tools.js"), "utf8");
    expect(pagesTools).toContain('from "airmcp/dist/shared/');
    expect(pagesTools).not.toContain("../shared/");
  });
});
