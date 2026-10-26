#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { verifyReleaseAssets } from "./lib/release-assets.mjs";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Correlate by a unique dispatch input, never by "latest run". In particular,
// an older successful run must not hide a failed or approval-waiting release.
export async function dispatchSignedAppRelease({
  repository, tag, expectedSha, run = gh, wait = delay, now = Date.now,
  requestId = randomUUID(), timeoutMs = 2 * 60 * 60 * 1000, pollMs = 15_000,
  log = console.log,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid repository");
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "")) throw new Error("Invalid release tag");
  if (!/^[0-9a-f]{40}$/i.test(expectedSha ?? "")) throw new Error("Expected release SHA is required");
  const title = `Signed app ${tag} (${requestId})`;
  const deadline = now() + timeoutMs;
  run(["workflow", "run", "release-app.yml", "--repo", repository, "--ref", tag,
    "--field", `tag=${tag}`, "--field", "require_signing=true", "--field", `release_request_id=${requestId}`]);
  log(`Waiting for signed app release ${tag}; environment approval may be required.`);
  let runId;
  while (now() < deadline) {
    let workflow;
    if (runId) {
      workflow = JSON.parse(run(["api", `repos/${repository}/actions/runs/${runId}`]));
    } else {
      const runs = JSON.parse(run(["api", `repos/${repository}/actions/workflows/release-app.yml/runs?event=workflow_dispatch&per_page=100`]));
      workflow = runs.workflow_runs?.find((candidate) => candidate.display_title === title);
    }
    if (workflow) {
      if (workflow.head_sha !== expectedSha || workflow.head_branch !== tag || workflow.event !== "workflow_dispatch") {
        throw new Error("Signed app workflow does not match the immutable release source");
      }
      if (!runId) {
        runId = workflow.id;
        if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("Invalid signed app workflow run ID");
        log(`Signed app run: https://github.com/${repository}/actions/runs/${runId}`);
      }
      if (workflow.status === "completed") {
        if (workflow.conclusion !== "success") {
          throw new Error(`Signed app workflow ${runId} finished with ${workflow.conclusion}; release is incomplete`);
        }
        const release = JSON.parse(run(["release", "view", tag, "--repo", repository,
          "--json", "tagName,targetCommitish,assets"]));
        if (release.tagName !== tag || release.targetCommitish !== expectedSha) {
          throw new Error("Signed app release identity differs from the requested source");
        }
        verifyReleaseAssets(release, tag.slice(1));
        log(`Signed app workflow ${runId} succeeded; both release artifacts are uploaded.`);
        return runId;
      }
    }
    await wait(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Timed out waiting for signed app release${runId ? ` ${runId}` : ""}; release is incomplete`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await dispatchSignedAppRelease({
      repository: process.env.GITHUB_REPOSITORY,
      tag: process.env.RELEASE_TAG,
      expectedSha: process.env.RELEASE_SHA,
    });
  } catch (error) {
    // Child-process errors may contain account or credential output. Only our
    // own fixed diagnostics are public; gh's raw stderr is never forwarded.
    console.error(`signed-release: ${error?.status !== undefined ? "GitHub command failed; release is incomplete" : error.message}`);
    process.exitCode = 1;
  }
}
