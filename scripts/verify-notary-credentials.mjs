#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { summarizeNotarySubmission } from "./summarize-notary-submission.mjs";

// Read-only account check before expensive builds. Keep all history records and
// command output private; only the fixed diagnostic classifier reaches CI logs.
export function verifyNotaryCredentials(env = process.env, run = spawnSync) {
  const required = ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing notarization credentials: ${missing.join(", ")}`);
  const result = run("xcrun", ["notarytool", "history", "--apple-id", env.APPLE_ID,
    "--password", env.APPLE_ID_PASSWORD, "--team-id", env.APPLE_TEAM_ID, "--output-format", "json"], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const diagnostic = result.error?.code === "ETIMEDOUT" ? "network timeout" : (result.stderr ?? "");
    throw new Error(summarizeNotarySubmission(result.stdout ?? "", diagnostic, result.status ?? 1));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyNotaryCredentials();
    console.log("notarization account access verified; artifact acceptance is checked at submission");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
