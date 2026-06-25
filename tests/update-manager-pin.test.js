/**
 * Self-update supply-chain pin (source contract).
 *
 * The macOS app's auto-update must (a) install the EXACT version resolved at
 * check time — never `@latest` (closes the check→install TOCTOU / unpinned
 * redirect), and (b) pass `--ignore-scripts` so a compromised package can't
 * run npm lifecycle hooks during a privileged global install.
 *
 * UpdateManager.swift is not exercised by the JS runtime, so this pins the
 * contract by scanning the source — the same pattern as
 * app-owned-runtime-version-pin.test.js. (Closes the "self-update pin —
 * UNTESTED" gap from the security audit.)
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const updateManager = readFileSync(new URL("../app/Sources/AirMCPApp/UpdateManager.swift", import.meta.url), "utf8");

describe("self-update version pin", () => {
  test("performUpdate installs the version resolved during the check (TOCTOU close)", () => {
    expect(updateManager).toContain("let target = availableVersion");
    expect(updateManager).toContain("runNpmInstall(version: target)");
  });

  test("runNpmInstall pins an exact version and never installs @latest", () => {
    // Pinned specifier interpolates the passed `version`, not a floating tag.
    expect(updateManager).toContain('"\\(AirMcpConstants.npmPackageName)@\\(version)"');

    // Scope the negative to the actual install arguments array so the
    // explanatory comments (which legitimately mention `@latest`) don't
    // produce a false pass.
    const installFn = updateManager.slice(updateManager.indexOf("func runNpmInstall"));
    const argsStart = installFn.indexOf("process.arguments = [");
    const argsBlock = installFn.slice(argsStart, installFn.indexOf("]", argsStart) + 1);
    expect(argsBlock).toContain('"install", "-g"');
    expect(argsBlock).toContain("@\\(version)");
    expect(argsBlock.toLowerCase()).not.toContain("latest");
  });

  test("runNpmInstall skips npm lifecycle scripts (--ignore-scripts)", () => {
    expect(updateManager).toContain('"--ignore-scripts"');
  });
});
