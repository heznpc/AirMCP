#!/usr/bin/env node
/**
 * Verify the public release state for the current package version.
 *
 * This is intentionally post-publish/post-release: it checks npm, a fresh npx
 * resolution, and the GitHub Release asset instead of trusting a local build.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const args = process.argv.slice(2);
const versionArg = args.find((arg) => arg.startsWith("--version="));
const version = versionArg ? versionArg.split("=")[1] : pkg.version;
const allowNotLatest = args.includes("--allow-not-latest");
const skipNpx = args.includes("--skip-npx");
const skipGithub = args.includes("--skip-github");
const skipAddons = args.includes("--skip-addons");
const skipAddonInstall = args.includes("--skip-addon-install");

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

async function loadAddonPackages() {
  const modulePacksPath = join(ROOT, "dist", "shared", "module-packs.js");
  if (!existsSync(modulePacksPath)) {
    fail("dist/shared/module-packs.js missing; run npm run build before release:verify");
  }
  const { MODULE_PACK_MANIFEST, CORE_MODULE_PACK_NAME } = await import(pathToFileURL(modulePacksPath));
  return MODULE_PACK_MANIFEST.filter((pack) => pack.name !== CORE_MODULE_PACK_NAME);
}

function verifyPublishedPackage(packageName, packageVersion, label) {
  const publishedVersion = npmJson(["view", `${packageName}@${packageVersion}`, "version", "--json"], `${label} version`);
  if (publishedVersion !== packageVersion) {
    fail(`${label} version mismatch: expected ${packageVersion}, got ${publishedVersion}`);
  }
  const latestVersion = npmJson(["view", packageName, "dist-tags.latest", "--json"], `${label} latest`);
  if (latestVersion !== packageVersion && !allowNotLatest) {
    fail(`${label} latest points at ${latestVersion}, not ${packageVersion}`);
  }
  console.log(`ok: npm has ${packageName}@${packageVersion} (latest=${latestVersion})`);
}

function verifyAddonRegistryInstall(addonPacks) {
  const work = mkdtempSync(join(tmpdir(), "airmcp-release-addons-"));
  try {
    writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2) + "\n");
    const specs = [`${pkg.name}@${version}`, ...addonPacks.map((pack) => `${pack.packageName}@${version}`)];
    const install = run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--no-save", ...specs], {
      cwd: work,
      timeout: 180_000,
    });
    if (install.status !== 0) fail("fresh registry add-on install failed", install.stderr || install.stdout);

    const smoke = [
      "const packages = JSON.parse(process.argv[1]);",
      "for (const name of packages) {",
      "  const mod = await import(name);",
      "  if (mod.packageName !== name) throw new Error(`${name} packageName export mismatch`);",
      "}",
    ].join("\n");
    const imported = run("node", ["--input-type=module", "-e", smoke, JSON.stringify(addonPacks.map((p) => p.packageName))], {
      cwd: work,
      timeout: 60_000,
    });
    if (imported.status !== 0) fail("fresh registry add-on import smoke failed", imported.stderr || imported.stdout);
    console.log(`ok: fresh registry install/import smoke for ${addonPacks.length} add-on package(s)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`release-verify: ${pkg.name}@${version}`);

verifyPublishedPackage(pkg.name, version, "npm root");

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

if (!skipAddons) {
  const addonPacks = await loadAddonPackages();
  for (const addonPack of addonPacks) {
    verifyPublishedPackage(addonPack.packageName, version, `npm add-on ${addonPack.name}`);
  }
  if (!skipAddonInstall) {
    verifyAddonRegistryInstall(addonPacks);
  }
}

console.log("ok: public release state verified");
