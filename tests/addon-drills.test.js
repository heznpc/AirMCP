import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const firstUserDrill = readFileSync(new URL("../scripts/first-user-addon-drill.mjs", import.meta.url), "utf8");
const killTest = readFileSync(new URL("../scripts/modular-distribution-kill-test.mjs", import.meta.url), "utf8");
const preflight = readFileSync(new URL("../scripts/release-preflight.mjs", import.meta.url), "utf8");

describe("add-on first-user drills and modular kill-test", () => {
  test("package scripts expose local first-user and kill-test gates", () => {
    expect(pkg.scripts["addons:first-user-drill"]).toBe("node scripts/first-user-addon-drill.mjs");
    expect(pkg.scripts["addons:kill-test"]).toBe("node scripts/modular-distribution-kill-test.mjs");
  });

  test("first-user drill proves prompt, activation, prefix install, and confirm gating", () => {
    expect(firstUserDrill).toContain("missingPackInstallHints");
    expect(firstUserDrill).toContain('"install_module_pack"');
    expect(firstUserDrill).toContain("dryRun: true");
    expect(firstUserDrill).toContain("confirmRequired: true");
    expect(firstUserDrill).toContain("AIRMCP_ADDON_PACKAGE_MODE");
    expect(firstUserDrill).toContain("--ignore-scripts");
  });

  test("kill-test consumes measured artifacts and blocks weak evidence", () => {
    expect(killTest).toContain("split-measurement.json");
    expect(killTest).toContain("first-user-addon-drill.json");
    expect(killTest).toContain('"kill-or-hold"');
    expect(killTest).toContain("weak-size-win");
    expect(killTest).toContain("confirm-gated-install");
    expect(killTest).toContain("installed-addon-load-bearing");
  });

  test("release preflight copies first-user and kill-test artifacts", () => {
    expect(preflight).toContain('run("npm", ["run", "addons:first-user-drill"');
    expect(preflight).toContain('run("npm", ["run", "addons:kill-test"');
    expect(preflight).toContain("first-user-addon-drill.json");
    expect(preflight).toContain("modular-distribution-kill-test.json");
  });
});
