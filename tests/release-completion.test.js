import { afterEach, describe, expect, test } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dispatchSignedAppRelease } from "../scripts/dispatch-signed-app-release.mjs";
import { verifyReleaseAssets } from "../scripts/lib/release-assets.mjs";

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const sha = "e22e07a5484175a857fa861bbda2aa8325402dee";
const version = "2.16.6";
const tag = `v${version}`;
const completeRelease = () => ({
  tagName: tag, targetCommitish: sha,
  assets: [
    { name: `airmcp-${version}.mcpb`, size: 6408503, state: "uploaded" },
    { name: `AirMCP-${version}.zip`, size: 50000000, state: "uploaded" },
  ],
});
const workflow = (extra = {}) => ({
  id: 123, display_title: `Signed app ${tag} (request-1)`, head_sha: sha,
  head_branch: tag, event: "workflow_dispatch", status: "completed", conclusion: "success", ...extra,
});

function observer({ runs = [workflow()], detail = workflow(), release = completeRelease(), ...options } = {}) {
  const calls = [];
  let time = 0;
  return {
    calls,
    result: dispatchSignedAppRelease({
      repository: "heznpc/AirMCP", tag, expectedSha: sha, requestId: "request-1",
      now: () => time, wait: async (ms) => { time += ms; }, timeoutMs: 20, pollMs: 10, log: () => {},
      run: (args) => {
        calls.push(args);
        if (args[0] === "workflow") return "";
        if (args[0] === "release") return JSON.stringify(release);
        return JSON.stringify(args[1].includes("/workflows/") ? { workflow_runs: runs } : detail);
      },
      ...options,
    }),
  };
}

describe("desktop release completion", () => {
  test("rejects the actual MCPB-only v2.16.6 release shape", () => {
    const release = completeRelease();
    release.assets.pop();
    expect(() => verifyReleaseAssets(release, version)).toThrow("missing AirMCP-2.16.6.zip");
    expect(readFileSync(new URL("../scripts/verify-release-state.mjs", import.meta.url), "utf8"))
      .toContain("verifyReleaseAssets(release, version)");
  });

  test.each([0, -1, 1.5, undefined])("rejects an incomplete app size %s", (size) => {
    const release = completeRelease();
    release.assets[1].size = size;
    expect(() => verifyReleaseAssets(release, version)).toThrow("invalid size");
  });

  test("requires finished uploads for both install paths", () => {
    const release = completeRelease();
    release.assets[1].state = "starter";
    expect(() => verifyReleaseAssets(release, version)).toThrow("not finished uploading");
    expect(verifyReleaseAssets(completeRelease(), version)).toHaveLength(2);
  });

  test("waits through environment approval and verifies assets after the exact run succeeds", async () => {
    const { result, calls } = observer({ runs: [workflow({ status: "waiting", conclusion: null })] });
    await expect(result).resolves.toBe(123);
    expect(calls[0]).toEqual(["workflow", "run", "release-app.yml", "--repo", "heznpc/AirMCP", "--ref", tag,
      "--field", `tag=${tag}`, "--field", "require_signing=true", "--field", "release_request_id=request-1"]);
    expect(calls.some((args) => args[1] === "repos/heznpc/AirMCP/actions/runs/123")).toBe(true);
  });

  test.each(["failure", "cancelled", "skipped", "timed_out"])("propagates a %s app workflow", async (conclusion) => {
    await expect(observer({ runs: [workflow({ conclusion })] }).result).rejects.toThrow(`finished with ${conclusion}`);
  });

  test("an unrelated green run cannot satisfy this dispatch", async () => {
    await expect(observer({ runs: [workflow({ display_title: `Signed app ${tag} (older-request)` })] }).result)
      .rejects.toThrow("Timed out");
  });

  test("rejects source drift and a green workflow without the app artifact", async () => {
    await expect(observer({ runs: [workflow({ head_sha: "a".repeat(40) })] }).result).rejects.toThrow("immutable release source");
    const release = completeRelease();
    release.assets.pop();
    await expect(observer({ release }).result).rejects.toThrow("missing AirMCP-2.16.6.zip");
  });

  test("the publishing command exits nonzero on the notarization-run failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-release-observer-"));
    directories.push(directory);
    writeFileSync(join(directory, "gh"), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'workflow') {
  require('fs').writeFileSync(process.env.RELEASE_TEST_REQUEST, args.find(a => a.startsWith('release_request_id=')).split('=')[1]);
} else {
  const request = require('fs').readFileSync(process.env.RELEASE_TEST_REQUEST, 'utf8');
  process.stdout.write(JSON.stringify({workflow_runs:[{...${JSON.stringify(workflow({ conclusion: "failure" }))},display_title:'Signed app v2.16.6 ('+request+')'}]}));
}
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [new URL("../scripts/dispatch-signed-app-release.mjs", import.meta.url).pathname], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_REPOSITORY: "heznpc/AirMCP",
        RELEASE_TAG: tag, RELEASE_SHA: sha, RELEASE_TEST_REQUEST: join(directory, "request") },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("finished with failure; release is incomplete");
  });
});
