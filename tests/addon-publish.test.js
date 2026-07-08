import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const script = readFileSync(new URL("../scripts/publish-addon-packages.mjs", import.meta.url), "utf8");
const cdWorkflow = readFileSync(new URL("../.github/workflows/cd.yml", import.meta.url), "utf8");
const cd = parseYaml(cdWorkflow);

function publishStep(name) {
  const step = cd.jobs.publish.steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step;
}

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

  test("publish command can resume when an add-on version already exists", () => {
    expect(script).toContain("function isVersionPublished(packageName, version)");
    expect(script).toContain('["view", `${packageName}@${version}`, "version"]');
    expect(script).toContain("already published");
    expect(script).toContain("previously published versions");
  });

  test("CD publishes the slim root before add-ons and releases the preflight mcpb", () => {
    expect(cdWorkflow).toContain("npm run release:preflight");
    expect(cdWorkflow).toContain('git show-ref --tags --verify --quiet "refs/tags/v${{ steps.pkg.outputs.version }}"');
    expect(cdWorkflow.indexOf("Publish root with provenance")).toBeLessThan(
      cdWorkflow.indexOf("Publish add-ons with provenance"),
    );
    expect(cdWorkflow).toContain("npm publish --provenance --access public");
    expect(cdWorkflow).toContain("is already published; skipping root publish");
    expect(cdWorkflow).toContain("npm run addons:publish -- --publish --all --no-build --skip-verify");
    expect(cdWorkflow).toContain("build/release-preflight/airmcp-${{ steps.pkg.outputs.version }}.mcpb");
  });

  test("CD defaults to trusted publishing and isolates NPM_TOKEN fallback", () => {
    const input = cd.on.workflow_dispatch.inputs.npm_auth_mode;
    expect(input.default).toBe("trusted-publishing");
    expect(input.options).toEqual(["trusted-publishing", "token"]);

    const selectAuth = publishStep("Select npm auth mode");
    expect(selectAuth.id).toBe("npm-auth");
    expect(selectAuth.env.NPM_AUTH_MODE).toBe("${{ inputs.npm_auth_mode || 'trusted-publishing' }}");
    expect(selectAuth.run).toContain("NPM_TOKEN is ignored even if the secret is set");
    expect(selectAuth.run).toContain("npm_auth_mode=token requires the NPM_TOKEN secret");

    const preflight = publishStep("npm auth preflight");
    expect(preflight.if).toBe("steps.npm-auth.outputs.mode == 'token'");
    expect(preflight.env.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");

    for (const stepName of ["Publish root with provenance", "Publish add-ons with provenance"]) {
      const publish = publishStep(stepName);
      expect(publish.if).toBe("steps.npm-auth.outputs.mode == 'trusted-publishing'");
      expect(publish.env?.NODE_AUTH_TOKEN).toBeUndefined();
    }

    for (const stepName of [
      "Publish root with provenance (token fallback)",
      "Publish add-ons with provenance (token fallback)",
    ]) {
      const publish = publishStep(stepName);
      expect(publish.if).toBe("steps.npm-auth.outputs.mode == 'token'");
      expect(publish.env.NODE_AUTH_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
    }
  });
});
