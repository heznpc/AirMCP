import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const script = readFileSync(new URL("../scripts/publish-addon-packages.mjs", import.meta.url), "utf8");
const cdWorkflow = readFileSync(new URL("../.github/workflows/cd.yml", import.meta.url), "utf8");

describe("add-on publish release lane", () => {
  test("package scripts expose a publish command that is dry-run by default", () => {
    expect(pkg.scripts["addons:publish"]).toBe("node scripts/publish-addon-packages.mjs");
    expect(script).toContain("publish: false");
    expect(script).toContain('arg === "--publish"');
    expect(script).toContain('arg === "--dry-run"');
  });

  test("publish command keeps verification in front of npm publish", () => {
    expect(script).toContain('run("npm", ["run", "build"])');
    expect(script).toContain('"scripts/build-addon-packages.mjs", "--check"');
    expect(script).toContain('"addons:verify-install"');
    expect(script).toContain('"--all"');
    expect(script).toContain('"--pack"');
    expect(script).toContain('"--provenance"');
  });

  test("CD publishes add-ons before the slim root and releases the preflight mcpb", () => {
    expect(cdWorkflow).toContain("npm run release:preflight");
    expect(cdWorkflow).toContain("npm run addons:publish -- --publish --all --no-build --skip-verify");
    expect(cdWorkflow.indexOf("Publish add-ons with provenance")).toBeLessThan(
      cdWorkflow.indexOf("Publish root with provenance"),
    );
    expect(cdWorkflow).toContain("npm publish --provenance --access public");
    expect(cdWorkflow).toContain("build/release-preflight/airmcp-${{ steps.pkg.outputs.version }}.mcpb");
  });
});
