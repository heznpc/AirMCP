import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const buildMcpb = readFileSync(new URL("../scripts/build-mcpb.mjs", import.meta.url), "utf8");
const verifyPackage = readFileSync(new URL("../scripts/verify-published-package.mjs", import.meta.url), "utf8");
const verifyMcpb = readFileSync(new URL("../scripts/verify-mcpb-artifact.mjs", import.meta.url), "utf8");
const preflight = readFileSync(new URL("../scripts/release-preflight.mjs", import.meta.url), "utf8");
const moduleLoader = readFileSync(new URL("../src/shared/module-loader.ts", import.meta.url), "utf8");

describe("universal shipped distribution", () => {
  test("npm lifecycle no longer strips non-core module entrypoints", () => {
    expect(pkg.scripts.prepack).toBe("npm run build");
    expect(pkg.scripts.postpack).toBeUndefined();
    expect(pkg.scripts.prepack).not.toContain("slim-root-package");
  });

  test("universal bundled loading is the default so stale add-ons cannot shadow the root", () => {
    expect(moduleLoader).toContain('process.env.AIRMCP_ADDON_PACKAGE_MODE ?? "bundled"');
    expect(moduleLoader).toContain('return "bundled";');
  });

  test("MCPB copies the complete dist tree without applying the slim-root transform", () => {
    expect(buildMcpb).toContain('cpSync(join(ROOT, "dist"), join(serverDir, "dist"), { recursive: true })');
    expect(buildMcpb).not.toContain('"scripts/slim-root-package.mjs"');
  });

  test("npm and MCPB artifact gates boot full/full and assert cross-pack tools", () => {
    for (const script of [verifyPackage, verifyMcpb]) {
      expect(script).toContain("const MIN_FULL_TOOLS = 290;");
      expect(script).toContain('AIRMCP_PROFILE: "full"');
      expect(script).toContain('AIRMCP_TOOL_EXPOSURE: "full"');
      expect(script).toContain('AIRMCP_ADDON_PACKAGE_MODE: "bundled"');
      expect(script).toContain('"numbers_set_cell"');
      expect(script).toContain('"gws_sheets_read"');
      expect(script).toContain('"memory_query"');
    }
  });

  test("release preflight verifies both self-contained artifacts", () => {
    expect(preflight).toContain('run("npm", ["run", "verify:package"]);');
    expect(preflight).toContain('run("npm", ["run", "verify:mcpb"]);');
    expect(preflight).toContain("universal publish surface");
    expect(preflight).toContain("universal .mcpb");
  });
});
