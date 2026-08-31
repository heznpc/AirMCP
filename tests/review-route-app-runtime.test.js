import { afterEach, describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const scratch = [];

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" });
}

function write(path, value = "changed\n") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function createFixtureRepository() {
  const repo = mkdtempSync(join(tmpdir(), "airmcp-review-route-"));
  scratch.push(repo);
  const route = join(repo, "scripts", "review-route.mjs");
  mkdirSync(dirname(route), { recursive: true });
  cpSync(new URL("../scripts/review-route.mjs", import.meta.url), route);

  run("git", ["init", "--quiet"], repo);
  run("git", ["config", "user.name", "heznpc"], repo);
  run("git", ["config", "user.email", "heznpc@users.noreply.github.com"], repo);
  write(join(repo, "README.md"), "base\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "--quiet", "-m", "base"], repo);
  return { repo, route };
}

function commitAndRoute(repo, route, files) {
  for (const file of files) write(join(repo, file));
  run("git", ["add", "."], repo);
  run("git", ["commit", "--quiet", "-m", "runtime boundary"], repo);
  return JSON.parse(run(process.execPath, [route, "--base", "HEAD^", "--json"], repo));
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("review route for app-owned runtime trust boundaries", () => {
  test("classifies each independent boundary and accepts only its matching guard", () => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, [
      "app/Sources/AirMCPApp/NodeEnvironment.swift",
      "app/Sources/AirMCPApp/Views/OnboardingView.swift",
      "app/Sources/AirMCPApp/Resources/Info.plist",
      "scripts/bundle-app.sh",
      "scripts/notarize-app.sh",
      "scripts/verify-bundle-structure.sh",
      "plugins/airmcp/scripts/airmcp-app-stdio.mjs",
      "src/cli/connect.ts",
      "app/Tests/AirMCPAppTests/NodeEnvironmentTests.swift",
      "tests/app-onboarding-lifecycle-i18n.test.js",
      "tests/app-info-plist-usage.test.js",
      "tests/governed-acceptance-wiring.test.js",
      "tests/bundle-structure.test.js",
      "tests/chatgpt-plugin.test.js",
      "tests/cli-connect.test.js",
    ]);
    const byFile = new Map(result.changed.map((entry) => [entry.file, entry]));

    for (const file of [
      "app/Sources/AirMCPApp/NodeEnvironment.swift",
      "app/Sources/AirMCPApp/Views/OnboardingView.swift",
      "app/Sources/AirMCPApp/Resources/Info.plist",
    ]) {
      expect(byFile.get(file)).toMatchObject({ tier: 0, area: "app-native-runtime" });
    }
    expect(byFile.get("scripts/bundle-app.sh")).toMatchObject({
      tier: 0,
      area: "app-runtime-release-harness",
    });
    expect(byFile.get("scripts/notarize-app.sh")).toMatchObject({
      tier: 0,
      area: "app-runtime-release-harness",
    });
    expect(byFile.get("scripts/verify-bundle-structure.sh")).toMatchObject({
      tier: 0,
      area: "app-runtime-release-harness",
    });
    expect(byFile.get("plugins/airmcp/scripts/airmcp-app-stdio.mjs")).toMatchObject({
      tier: 0,
      area: "plugin-connector-package",
    });
    expect(byFile.get("src/cli/connect.ts")).toMatchObject({
      tier: 0,
      area: "cli-runtime-identity",
    });
    expect(result.unguardedT0).not.toEqual(
      expect.arrayContaining([
        "app-native-runtime",
        "app-runtime-release-harness",
        "plugin-connector-package",
        "cli-runtime-identity",
      ]),
    );
  });

  test.each([
    [
      "app-native-runtime",
      "trusted-node-environment",
      "app/Sources/AirMCPApp/NodeEnvironment.swift",
      "tests/chatgpt-plugin.test.js",
    ],
    [
      "app-native-runtime",
      "trusted-node-environment",
      "app/Sources/AirMCPApp/NodeEnvironment.swift",
      "tests/app-info-plist-usage.test.js",
    ],
    ["app-runtime-release-harness", "acceptance-bundle", "scripts/bundle-app.sh", "tests/cli-connect.test.js"],
    [
      "app-runtime-release-harness",
      "acceptance-bundle",
      "scripts/bundle-app.sh",
      "tests/signed-app-verify-source.test.js",
    ],
    [
      "app-runtime-release-harness",
      "signed-artifact-verification",
      "scripts/notarize-app.sh",
      "tests/governed-acceptance-wiring.test.js",
    ],
    [
      "app-runtime-release-harness",
      "bundle-structure-verification",
      "scripts/verify-bundle-structure.sh",
      "tests/widget-app-group.test.js",
    ],
    [
      "plugin-connector-package",
      "plugin-connector-package",
      "plugins/airmcp/scripts/airmcp-app-stdio.mjs",
      "tests/governed-acceptance-wiring.test.js",
    ],
    ["cli-runtime-identity", "connect-proxy", "src/cli/connect.ts", "tests/chatgpt-plugin.test.js"],
    ["cli-runtime-identity", "connect-proxy", "src/cli/connect.ts", "tests/app-runtime-identity.test.js"],
    ["jxa-escaping", "swift-bridge", "src/shared/swift.ts", "tests/jxa-scripts-ast.test.js"],
  ])("does not let an unrelated guard satisfy %s/%s", (area, group, source, unrelatedGuard) => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, [source, unrelatedGuard]);

    expect(result.unguardedT0).toContain(area);
    expect(result.unguardedGuardGroups).toContainEqual(expect.objectContaining({ area, group }));
  });

  test("maps the Swift bridge only to its direct bridge contract test", () => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, ["src/shared/swift.ts", "tests/swift.test.js"]);

    expect(result.changed.find((entry) => entry.file === "src/shared/swift.ts")).toMatchObject({
      tier: 0,
      area: "jxa-escaping",
    });
    expect(result.unguardedT0).not.toContain("jxa-escaping");
    expect(result.unguardedGuardGroups).not.toContainEqual(
      expect.objectContaining({ area: "jxa-escaping", group: "swift-bridge" }),
    );
  });

  test("maps bundle structure verification to its direct behavior test", () => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, [
      "scripts/verify-bundle-structure.sh",
      "tests/bundle-structure.test.js",
    ]);

    expect(result.changed.find((entry) => entry.file === "scripts/verify-bundle-structure.sh")).toMatchObject({
      tier: 0,
      area: "app-runtime-release-harness",
    });
    expect(result.unguardedT0).not.toContain("app-runtime-release-harness");
    expect(result.unguardedGuardGroups).not.toContainEqual(
      expect.objectContaining({ area: "app-runtime-release-harness", group: "bundle-structure-verification" }),
    );
  });

  test("maps the canonical main-app entitlement allowlist to its signing contract test", () => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, [
      "scripts/lib/main-app-entitlements.plist",
      "tests/signed-app-verify-source.test.js",
    ]);

    expect(result.changed.find((entry) => entry.file === "scripts/lib/main-app-entitlements.plist")).toMatchObject({
      tier: 0,
      area: "app-runtime-release-harness",
    });
    expect(result.unguardedGuardGroups).not.toContainEqual(
      expect.objectContaining({ area: "app-runtime-release-harness", group: "signed-artifact-verification" }),
    );
  });

  test("accepts the widget entitlement contract as a direct bundle-app guard", () => {
    const { repo, route } = createFixtureRepository();
    const result = commitAndRoute(repo, route, ["scripts/bundle-app.sh", "tests/widget-app-group.test.js"]);

    expect(result.unguardedGuardGroups).not.toContainEqual(
      expect.objectContaining({ area: "app-runtime-release-harness", group: "acceptance-bundle" }),
    );
  });
});
