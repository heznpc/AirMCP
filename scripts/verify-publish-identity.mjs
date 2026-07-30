#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPublishedIdentity } from "./lib/publish-identity.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

function currentSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not resolve the current Git commit");
  return result.stdout.trim();
}

const packageRoot = resolve(valueArg("--package-root") || ROOT);
const expectedGitHead = valueArg("--expected-sha") || process.env.AIRMCP_RELEASE_SHA || currentSha();
const allowMissing = process.argv.includes("--allow-missing");
const retrySecondsValue = valueArg("--retry-seconds") || "0";
const retrySeconds = Number(retrySecondsValue);

// Upper bound raised from 300 to 900 after the v2.16.2 release: the registry
// read path (`npm view`, which resolves the packument) lagged a SUCCESSFUL
// immutable publish by well over five minutes for a brand-new scoped package
// name, while the version-specific endpoint already served the tarball. A cap
// below that lag turns a shipped artifact into a red release.
if (!Number.isInteger(retrySeconds) || retrySeconds < 0 || retrySeconds > 900) {
  console.error("publish-identity: --retry-seconds must be an integer from 0 to 900");
  process.exit(1);
}

try {
  const result = verifyPublishedIdentity({
    packageRoot,
    expectedGitHead,
    allowMissing,
    retryTimeoutMs: retrySeconds * 1_000,
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `published=${result.published ? "true" : "false"}\n`);
  }
  console.log(
    result.published
      ? `ok: ${result.local.name}@${result.local.version} registry SRI and gitHead match the release source`
      : `ok: ${result.local.name}@${result.local.version} is not published yet`,
  );
} catch (error) {
  console.error(`publish-identity: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
