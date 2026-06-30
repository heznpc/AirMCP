#!/usr/bin/env node
/**
 * Verify the public release state for the current package version.
 *
 * This is intentionally post-publish/post-release: it checks npm, a fresh npx
 * resolution, and the GitHub Release asset instead of trusting a local build.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const args = process.argv.slice(2);
const versionArg = args.find((arg) => arg.startsWith("--version="));
const version = versionArg ? versionArg.split("=")[1] : pkg.version;
const allowNotLatest = args.includes("--allow-not-latest");
const skipNpx = args.includes("--skip-npx");
const skipGithub = args.includes("--skip-github");

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function fail(message, detail = "") {
  console.error(`release-verify: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function parseJson(label, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} did not return parseable JSON`, `${error.message}\n${text.slice(0, 2000)}`);
  }
}

function npmJson(argsForNpm, label) {
  const result = run("npm", argsForNpm);
  if (result.status !== 0) fail(`${label} failed`, result.stderr || result.stdout);
  return parseJson(label, result.stdout);
}

console.log(`release-verify: ${pkg.name}@${version}`);

const publishedVersion = npmJson(["view", `${pkg.name}@${version}`, "version", "--json"], "npm version");
if (publishedVersion !== version) {
  fail(`npm version mismatch: expected ${version}, got ${publishedVersion}`);
}
console.log(`ok: npm has ${pkg.name}@${version}`);

const latestVersion = npmJson(["view", pkg.name, "dist-tags.latest", "--json"], "npm latest");
if (latestVersion !== version && !allowNotLatest) {
  fail(`npm latest points at ${latestVersion}, not ${version} (pass --allow-not-latest for historical verification)`);
}
console.log(`ok: npm latest=${latestVersion}`);

if (!skipNpx) {
  const npx = run("npx", ["-y", `${pkg.name}@${version}`, "--version"], { timeout: 120_000 });
  if (npx.status !== 0) fail(`npx smoke failed for ${pkg.name}@${version}`, npx.stderr || npx.stdout);
  if (npx.stdout !== version) fail(`npx --version mismatch: expected ${version}, got ${npx.stdout}`);
  console.log(`ok: npx -y ${pkg.name}@${version} --version`);
}

if (!skipGithub) {
  const gh = run("gh", ["release", "view", `v${version}`, "--json", "tagName,targetCommitish,url,assets"]);
  if (gh.status !== 0) fail(`GitHub Release v${version} not found`, gh.stderr || gh.stdout);
  const release = parseJson("gh release view", gh.stdout);
  const expectedAsset = `airmcp-${version}.mcpb`;
  const asset = release.assets?.find((candidate) => candidate.name === expectedAsset);
  if (!asset) {
    fail(`GitHub Release v${version} is missing ${expectedAsset}`);
  }
  if (!Number.isFinite(asset.size) || asset.size <= 0) {
    fail(`${expectedAsset} has invalid size: ${asset.size}`);
  }
  console.log(`ok: GitHub Release ${release.tagName} has ${expectedAsset} (${asset.size} bytes)`);
  console.log(`ok: ${release.url}`);
}

console.log("ok: public release state verified");
