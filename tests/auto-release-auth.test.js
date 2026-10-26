import { afterEach, describe, expect, test } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(readFileSync(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8"));
const dispatch = workflow.jobs["trigger-cd"].steps.find((step) => step.name === "Dispatch CD workflow");
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runDispatch(repositoryAuthMode, ghExit = 0) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-auto-release-auth-"));
  directories.push(directory);
  const callsPath = join(directory, "gh-calls.json");
  writeFileSync(join(directory, "gh"), `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.FAKE_GH_EXIT));
`, { mode: 0o755 });

  const env = {
    PATH: `${directory}:${process.env.PATH}`,
    GITHUB_REPOSITORY: "heznpc/AirMCP",
    GH_TOKEN: "test-token",
    FAKE_GH_CALLS: callsPath,
    FAKE_GH_EXIT: String(ghExit),
  };
  // Model the actual Actions env binding, so dropping the repository variable
  // from the workflow also breaks the explicit-mode cases.
  if (dispatch.env.NPM_AUTH_MODE === "${{ vars.NPM_AUTH_MODE }}") {
    env.NPM_AUTH_MODE = repositoryAuthMode ?? "";
  } else if (dispatch.env.NPM_AUTH_MODE !== undefined) {
    throw new Error(`Unexpected npm auth env binding: ${dispatch.env.NPM_AUTH_MODE}`);
  }
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", dispatch.run], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
  return {
    ...result,
    args: existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : null,
  };
}

describe("automatic release npm authentication", () => {
  test.each([
    ["unset", undefined, "token"],
    ["empty", "", "token"],
    ["explicit token", "token", "token"],
    ["explicit trusted publishing", "trusted-publishing", "trusted-publishing"],
  ])("dispatches the selected mode when the repository variable is %s", (_label, configured, expected) => {
    const result = runDispatch(configured);
    expect(result.status).toBe(0);
    expect(result.args).toEqual([
      "workflow", "run", "cd.yml", "--ref", "main", "--repo", "heznpc/AirMCP",
      "--field", `npm_auth_mode=${expected}`,
    ]);
  });

  test.each(["invalid", "TOKEN", " token ", "trusted-publishing\ntoken", "token; gh workflow run other.yml"])(
    "rejects invalid mode %j before dispatching",
    (configured) => {
      const result = runDispatch(configured);
      expect(result.status).not.toBe(0);
      expect(result.args).toBeNull();
      expect(result.stdout + result.stderr).toContain("NPM_AUTH_MODE must be token or trusted-publishing");
    },
  );

  test("propagates a failed gh dispatch", () => {
    const result = runDispatch("token", 17);
    expect(result.status).toBe(17);
  });
});
