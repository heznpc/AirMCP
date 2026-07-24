import { afterEach, describe, expect, test } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const cdSource = read("../.github/workflows/cd.yml");
const appSource = read("../.github/workflows/release-app.yml");
const preflightSource = read("../scripts/release-preflight.mjs");
const bundleSource = read("../scripts/bundle-app.sh");
const addonPublishSource = read("../scripts/publish-addon-packages.mjs");
const releaseVerifySource = read("../scripts/verify-release-state.mjs");
const bundlePath = new URL("../scripts/bundle-app.sh", import.meta.url).pathname;
const cd = parseYaml(cdSource);
const app = parseYaml(appSource);
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function namedStep(workflow, job, name) {
  const step = workflow.jobs[job].steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step;
}

function runTagResolver(requestedTag) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-release-tag-"));
  temporaryDirectories.push(directory);
  const output = join(directory, "github-output");
  const resolver = namedStep(app, "resolve-release", "Resolve and validate release tag");
  const result = spawnSync("bash", ["-c", `set -euo pipefail\n${resolver.run}`], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output, REQUESTED_TAG: requestedTag },
  });
  const values = existsSync(output)
    ? Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split("=", 2)),
      )
    : {};
  return { ...result, values, directory };
}

describe("release workflow source and identity hardening", () => {
  test("validates and canonicalizes a non-interpolated stable SemVer tag", () => {
    for (const input of ["2.16.0", "v2.16.0"]) {
      const result = runTagResolver(input);
      expect(result.status).toBe(0);
      expect(result.values).toEqual({ tag: "v2.16.0", version: "2.16.0" });
    }

    expect(runTagResolver("v02.16.0").status).not.toBe(0);
    expect(runTagResolver("v2.16").status).not.toBe(0);
    const injection = runTagResolver('v2.16.0"; touch injected; #');
    expect(injection.status).not.toBe(0);
    expect(existsSync(join(injection.directory, "injected"))).toBe(false);

    const resolver = namedStep(app, "resolve-release", "Resolve and validate release tag");
    expect(resolver.env.REQUESTED_TAG).toContain("inputs.tag");
    expect(resolver.run).not.toContain("${{");
  });

  test("checks out the resolved tag and binds tag, HEAD, package, app, and widget versions", () => {
    const sourceCheckout = app.jobs["resolve-release"].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(sourceCheckout.with.ref).toBe("refs/tags/${{ steps.release.outputs.tag }}");
    expect(sourceCheckout.with["fetch-depth"]).toBe(0);

    const checkout = app.jobs["release-app"].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("refs/tags/${{ needs.resolve-release.outputs.tag }}");
    expect(checkout.with["fetch-depth"]).toBe(0);

    const identity = namedStep(app, "resolve-release", "Verify immutable release source identity");
    expect(identity.run).toContain('git rev-parse "refs/tags/$RELEASE_TAG^{commit}"');
    expect(identity.run).toContain("git rev-parse HEAD");
    expect(identity.run).toContain("require('./package.json').version");
    expect(identity.run).toContain("CFBundleShortVersionString");
    expect(identity.run).toContain("app/widget/Info.plist");
    expect(identity.run).toContain("git merge-base --is-ancestor");
    expect(identity.run).toContain("releases/tags/$RELEASE_TAG");

    const protectedCheckout = namedStep(app, "release-app", "Verify protected release checkout");
    expect(protectedCheckout.env.EXPECTED_SHA).toBe("${{ needs.resolve-release.outputs.sha }}");
    expect(protectedCheckout.run).toContain("Release tag moved or checkout drifted");

    const builtIdentity = namedStep(app, "release-app", "Verify release bundle identity");
    expect(builtIdentity.run).toContain("AirMCP.app/Contents/Info.plist");
    expect(builtIdentity.run).toContain("AirMCPWidget.appex/Contents/Info.plist");
    const certificateImport = namedStep(app, "release-app", "Import signing certificate");
    expect(app.jobs["release-app"].steps.indexOf(builtIdentity)).toBeLessThan(
      app.jobs["release-app"].steps.indexOf(certificateImport),
    );
  });

  test("keeps every Apple secret behind the protected release environment", () => {
    expect(app.jobs["release-app"].environment).toBe("release");
    expect(JSON.stringify(app.jobs["resolve-release"])).not.toContain("secrets.");

    const signing = namedStep(app, "release-app", "Preflight — required secrets present");
    expect(signing.env.APPLE_CERT_P12_BASE64).toBe("${{ secrets.APPLE_CERT_P12_BASE64 }}");
    const signingIndex = app.jobs["release-app"].steps.indexOf(signing);
    for (const step of app.jobs["release-app"].steps.slice(signingIndex + 1)) {
      expect(step.if).toBe("steps.signing.outputs.ready == 'true'");
    }

    const outerGate = namedStep(app, "resolve-release", "Verify release environment protection");
    const innerGate = namedStep(app, "release-app", "Re-verify release environment protection");
    expect(outerGate.run).toContain("verify-release-environment.mjs");
    expect(innerGate.run).toContain("verify-release-environment.mjs");
    expect(app.jobs["release-app"].steps.indexOf(innerGate)).toBeLessThan(signingIndex);
  });

  test("binds CD to main and the workflow SHA, then dispatches the signed lane explicitly", () => {
    expect(cd.jobs.publish.permissions.actions).toBe("write");
    const checkout = cd.jobs.publish.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout.with.ref).toBe("${{ github.sha }}");
    expect(checkout.with["fetch-depth"]).toBe(0);

    const source = namedStep(cd, "publish", "Verify release source");
    expect(source.env.RELEASE_REF).toBe("${{ github.ref }}");
    expect(source.env.RELEASE_SHA).toBe("${{ github.sha }}");
    expect(source.run).toContain("refs/heads/main");
    expect(source.run).toContain("git rev-parse HEAD");

    const release = namedStep(cd, "publish", "Create GitHub Release");
    expect(release.with.target_commitish).toBe("${{ github.sha }}");
    const dispatch = namedStep(cd, "publish", "Dispatch signed app release");
    expect(dispatch.run).toContain("gh workflow run release-app.yml");
    expect(dispatch.run).toContain('--ref "$RELEASE_TAG"');
    expect(dispatch.run).toContain('--field tag="$RELEASE_TAG"');
    expect(cd.jobs.publish.steps.indexOf(release)).toBeLessThan(cd.jobs.publish.steps.indexOf(dispatch));
  });

  test("fails before the first npm publish when the signed lane is not protected", () => {
    const gate = namedStep(cd, "publish", "Verify signed release environment protection");
    const inspect = namedStep(cd, "publish", "Inspect root registry identity");
    const rootPublish = namedStep(cd, "publish", "Publish root with provenance");
    expect(gate.env.GH_TOKEN).toBe("${{ github.token }}");
    expect(gate.env.RELEASE_TAG).toBe("v${{ steps.pkg.outputs.version }}");
    expect(gate.run).toContain("verify-release-environment.mjs");
    expect(cd.jobs.publish.steps.indexOf(gate)).toBeLessThan(cd.jobs.publish.steps.indexOf(inspect));
    expect(cd.jobs.publish.steps.indexOf(gate)).toBeLessThan(cd.jobs.publish.steps.indexOf(rootPublish));
  });

  test("resumes an occupied npm version only after SRI and gitHead verification", () => {
    const inspect = namedStep(cd, "publish", "Inspect root registry identity");
    const verify = namedStep(cd, "publish", "Verify root registry identity");
    expect(inspect.run).toContain("verify-publish-identity.mjs --allow-missing");
    expect(inspect.env.AIRMCP_RELEASE_SHA).toBe("${{ github.sha }}");
    expect(verify.run).toContain("verify-publish-identity.mjs --retry-seconds=60");

    for (const name of ["Publish root with provenance", "Publish root with provenance (token fallback)"]) {
      expect(namedStep(cd, "publish", name).if).toContain("steps.root-identity.outputs.published != 'true'");
    }
    expect(addonPublishSource).toContain("assertPublishedIdentity");
    expect(addonPublishSource).toContain("inspectLocalPackage");
    expect(addonPublishSource).toContain("waitForPublishedIdentity");
    expect(addonPublishSource).not.toContain("isVersionPublished");
    expect(releaseVerifySource).toContain("expectedGitHead");
    expect(releaseVerifySource).toContain("release.targetCommitish !== expectedGitHead");
  });

  test("requires the Heznpc certificate subject before signing and suppresses raw notary identity output", () => {
    const identity = namedStep(app, "release-app", "Verify public signing identity");
    const certificateImport = namedStep(app, "release-app", "Import signing certificate");
    const signing = namedStep(app, "release-app", "Sign + notarize + staple");
    expect(identity.run).toBe("bash scripts/verify-signing-identity.sh");
    expect(app.jobs["release-app"].steps.indexOf(certificateImport)).toBeLessThan(
      app.jobs["release-app"].steps.indexOf(identity),
    );
    expect(app.jobs["release-app"].steps.indexOf(identity)).toBeLessThan(app.jobs["release-app"].steps.indexOf(signing));
    expect(certificateImport.run).toContain("umask 077");
    expect(certificateImport.run).toContain("trap 'rm -f cert.p12' EXIT");
    expect(certificateImport.run).toContain("set-key-partition-list");
    expect(certificateImport.run).toContain(">/dev/null 2>&1");
  });

  test("requires the widget only in the signed lane while local app preflight stays fast", () => {
    expect(app.jobs["release-app"].env.AIRMCP_REQUIRE_WIDGET).toBe("1");
    expect(preflightSource).toContain('const REQUIRE_WIDGET = process.env.AIRMCP_REQUIRE_WIDGET === "1"');
    expect(preflightSource).toContain('AIRMCP_SKIP_WIDGET: REQUIRE_WIDGET ? "0" : "1"');
    expect(bundleSource).toContain('AIRMCP_REQUIRE_WIDGET="${AIRMCP_REQUIRE_WIDGET:-0}"');
    expect(bundleSource).toContain("Widget build failed and AIRMCP_REQUIRE_WIDGET=1");
    expect(bundleSource).toContain("signed distribution requires a complete AirMCPWidget.appex");

    const conflictingFlags = spawnSync("bash", [bundlePath, "bundle"], {
      encoding: "utf8",
      env: { ...process.env, AIRMCP_REQUIRE_WIDGET: "1", AIRMCP_SKIP_WIDGET: "1" },
    });
    expect(conflictingFlags.status).toBe(2);
    expect(conflictingFlags.stderr).toContain("AIRMCP_SKIP_WIDGET=1 is not allowed");
  });
});
