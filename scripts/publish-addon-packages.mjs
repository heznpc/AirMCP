#!/usr/bin/env node
/**
 * Publish staged AirMCP add-on packages.
 *
 * The default mode is a dry-run. A real publish requires `--publish`, and the
 * script always stages packages plus clean-installs them before publish unless
 * the caller explicitly skips those gates.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "build", "addons", "manifest.json");

function fail(message) {
  console.error(`[addons:publish] FAIL — ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    fail(`command failed (${result.status ?? "signal"}): ${cmd} ${args.join(" ")}`);
  }
}

function runCaptured(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const parsed = {
    publish: false,
    noBuild: false,
    skipVerify: false,
    tag: "latest",
    access: "public",
    provenance: true,
    packs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish") {
      parsed.publish = true;
    } else if (arg === "--dry-run") {
      parsed.publish = false;
    } else if (arg === "--no-build") {
      parsed.noBuild = true;
    } else if (arg === "--skip-verify") {
      parsed.skipVerify = true;
    } else if (arg === "--no-provenance") {
      parsed.provenance = false;
    } else if (arg === "--all") {
      parsed.packs = [];
    } else if (arg === "--pack") {
      const value = argv[i + 1];
      if (!value) fail("--pack requires a pack name");
      parsed.packs.push(...parseList(value));
      i += 1;
    } else if (arg.startsWith("--pack=")) {
      parsed.packs.push(...parseList(arg.slice("--pack=".length)));
    } else if (arg === "--tag") {
      const value = argv[i + 1];
      if (!value) fail("--tag requires a value");
      parsed.tag = value;
      i += 1;
    } else if (arg.startsWith("--tag=")) {
      parsed.tag = arg.slice("--tag=".length);
    } else if (arg === "--access") {
      const value = argv[i + 1];
      if (!value) fail("--access requires a value");
      parsed.access = value;
      i += 1;
    } else if (arg.startsWith("--access=")) {
      parsed.access = arg.slice("--access=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("");
      console.log("  AirMCP add-on publish");
      console.log("");
      console.log("    npm run addons:publish");
      console.log("    npm run addons:publish -- --pack productivity");
      console.log("    npm run addons:publish -- --publish --all");
      console.log("");
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function packageDirName(packageName) {
  return packageName.replace(/^@/, "").replace("/", "__");
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    fail("build/addons/manifest.json missing; run `npm run addons:build` first");
  }
  const manifest = readJson(MANIFEST_PATH);
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    fail("build/addons/manifest.json has no staged packages");
  }
  return manifest;
}

function selectPackages(manifest, requestedPacks) {
  if (!requestedPacks.length) return manifest.packages;
  const requested = new Set(requestedPacks);
  const selected = manifest.packages.filter((pack) => requested.has(pack.name));
  const missing = [...requested].filter((name) => !selected.some((pack) => pack.name === name));
  if (missing.length) fail(`unknown or unstaged add-on pack(s): ${missing.join(", ")}`);
  return selected;
}

function verifyStagedPackage(manifest, pack) {
  const packageRoot = join(ROOT, pack.packageDir ?? "build/addons", "");
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) fail(`${pack.name} package.json missing: ${packageJsonPath}`);
  const pkg = readJson(packageJsonPath);
  if (pkg.name !== pack.packageName) fail(`${pack.name} package name mismatch: ${pkg.name} != ${pack.packageName}`);
  if (pkg.version !== manifest.version) fail(`${pack.name} version mismatch: ${pkg.version} != ${manifest.version}`);
  if (String(pkg.name).includes("pack-") || String(pkg.name).includes("-pack")) {
    fail(`${pack.name} package name must not contain pack-* wording: ${pkg.name}`);
  }
  if (pkg.peerDependencies?.airmcp !== manifest.version) {
    fail(`${pack.name} peerDependency must pin airmcp@${manifest.version}`);
  }
  if (!existsSync(join(packageRoot, "dist", "index.js"))) {
    fail(`${pack.name} missing dist/index.js`);
  }
  return packageRoot;
}

function verifyPackageDirFallback(pack) {
  return join(ROOT, "build", "addons", packageDirName(pack.packageName), "package");
}

function isVersionPublished(packageName, version) {
  const result = runCaptured("npm", ["view", `${packageName}@${version}`, "version"]);
  return result.status === 0 && result.stdout.trim() === version;
}

function publishPackage({ packageRoot, pack, args, version }) {
  const npmArgs = ["publish", "--access", args.access, "--tag", args.tag];
  if (!args.publish) npmArgs.push("--dry-run");
  if (args.publish && args.provenance) npmArgs.push("--provenance");

  if (isVersionPublished(pack.packageName, version)) {
    console.log(`[addons:publish] skip ${pack.packageName}@${version} — already published`);
    return;
  }

  console.log(`[addons:publish] ${args.publish ? "publish" : "dry-run"} ${pack.packageName}`);
  const result = runCaptured("npm", npmArgs, { cwd: packageRoot });
  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return;
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.includes(`previously published versions: ${version}`)) {
    console.log(`[addons:publish] skip ${pack.packageName}@${version} — already published`);
    return;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  fail(`command failed (${result.status ?? "signal"}): npm ${npmArgs.join(" ")}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.noBuild) {
    run("npm", ["run", "build"]);
    run(process.execPath, ["scripts/build-addon-packages.mjs", "--check"]);
  } else if (!existsSync(MANIFEST_PATH)) {
    fail("cannot use --no-build without build/addons/manifest.json");
  }

  const manifest = loadManifest();
  const selected = selectPackages(manifest, args.packs);
  if (!selected.length) fail("no add-on packages selected");

  if (!args.skipVerify) {
    const verifyArgs = args.packs.length
      ? ["run", "addons:verify-install", "--", ...args.packs.flatMap((pack) => ["--pack", pack])]
      : ["run", "addons:verify-install", "--", "--all"];
    run("npm", verifyArgs);
  }

  console.log(
    `[addons:publish] mode=${args.publish ? "publish" : "dry-run"} version=${manifest.version} tag=${args.tag}`,
  );
  console.log(`[addons:publish] packages=${selected.map((pack) => pack.packageName).join(", ")}`);

  for (const pack of selected) {
    let packageRoot = verifyStagedPackage(manifest, pack);
    if (!existsSync(packageRoot)) packageRoot = verifyPackageDirFallback(pack);
    publishPackage({ packageRoot, pack, args, version: manifest.version });
  }

  console.log(`ok: ${args.publish ? "published" : "dry-run checked"} ${selected.length} add-on package(s)`);
}

main();
