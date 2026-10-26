import { afterEach, describe, expect, test } from "@jest/globals";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const cd = parseYaml(readFileSync(join(root, ".github/workflows/cd.yml"), "utf8"));
const historicalSha = "e22e07a5484175a857fa861bbda2aa8325402dee";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(historical = false) {
  const directory = mkdtempSync(join(tmpdir(), "airmcp-release-resume-"));
  temporaryDirectories.push(directory);
  if (historical) {
    // Use the actual v2.16.6 release workflow. CI fetches full history, so this
    // fixture cannot silently drift into the new protocol as main advances.
    const archive = spawnSync("git", ["archive", historicalSha, ".github/workflows/release-app.yml"], { cwd: root });
    expect(archive.status).toBe(0);
    const dispatcher = spawnSync("git", ["cat-file", "-e", `${historicalSha}:scripts/dispatch-signed-app-release.mjs`], { cwd: root });
    expect(dispatcher.status).not.toBe(0);
    const unpack = spawnSync("tar", ["-x", "-C", directory], { input: archive.stdout });
    expect(unpack.status).toBe(0);
  } else {
    for (const path of ["scripts/dispatch-signed-app-release.mjs", "scripts/lib/release-assets.mjs", ".github/workflows/release-app.yml"]) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      copyFileSync(join(root, path), join(directory, path));
    }
  }
  return directory;
}

function runGate(directory, releaseSha = historicalSha) {
  const gate = cd.jobs.publish.steps.find((step) => step.name === "Verify release resume protocol");
  expect(gate).toBeDefined();
  return spawnSync("bash", ["-c", `set -euo pipefail\n${gate.run}`], {
    cwd: directory, encoding: "utf8",
    env: { ...process.env, RELEASE_SHA: releaseSha, WORKFLOW_SHA: "a".repeat(40) },
  });
}

describe("release resume protocol compatibility", () => {
  test("rejects the actual pre-protocol release checkout before publishing anything", () => {
    const directory = fixture(true);
    expect(existsSync(join(directory, "scripts/dispatch-signed-app-release.mjs"))).toBe(false);
    const lateFailure = spawnSync("node", ["scripts/dispatch-signed-app-release.mjs"], { cwd: directory, encoding: "utf8" });
    expect(lateFailure.status).not.toBe(0);
    expect(lateFailure.stderr).toContain("MODULE_NOT_FOUND");

    const result = runGate(directory);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not support the signed app release resume protocol");
    expect(result.stdout).toContain("Publish a new version from current main");
    const steps = cd.jobs.publish.steps;
    const gateIndex = steps.findIndex((step) => step.name === "Verify release resume protocol");
    expect(gateIndex).toBeGreaterThan(steps.findIndex((step) => step.name === "Verify release source"));
    expect(gateIndex).toBeLessThan(steps.findIndex((step) => step.name === "Extract package info"));
    expect(gateIndex).toBeLessThan(steps.findIndex((step) => step.name === "Inspect root registry identity"));
  });

  test("allows both a fresh release and an older SHA with the current protocol without node_modules", () => {
    const directory = fixture();
    for (const sha of [historicalSha, "a".repeat(40)]) {
      const result = runGate(directory, sha);
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    }
    expect(existsSync(join(directory, "node_modules"))).toBe(false);
  });

  test("rejects a checkout whose workflow cannot correlate the signed release run", () => {
    const directory = fixture();
    const workflowPath = join(directory, ".github/workflows/release-app.yml");
    writeFileSync(workflowPath, readFileSync(workflowPath, "utf8").replace(/^run-name:.*$/m, "run-name: Signed app"));
    expect(runGate(directory).status).toBe(1);
  });

  test("rejects a checkout whose workflow does not accept the correlation input", () => {
    const directory = fixture();
    const workflowPath = join(directory, ".github/workflows/release-app.yml");
    writeFileSync(workflowPath, readFileSync(workflowPath, "utf8").replace(/^ {6}release_request_id:/m, "      old_request_id:"));
    expect(runGate(directory).status).toBe(1);
  });

  test("rejects an incomplete dispatcher module graph", () => {
    const directory = fixture();
    rmSync(join(directory, "scripts/lib/release-assets.mjs"));
    expect(runGate(directory).status).toBe(1);
  });
});
