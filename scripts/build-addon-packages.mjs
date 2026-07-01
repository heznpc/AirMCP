#!/usr/bin/env node
/**
 * Stage physical AirMCP add-on packages from the built dist tree.
 *
 * This is intentionally a build artifact, not checked-in package output:
 * runtime code can prefer installed add-on packages today, while prepack turns
 * the root `airmcp` artifact into a slim package that keeps non-core entrypoints
 * in these companion packages.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const BUILD_DIR = join(ROOT, "build", "addons");
const CHECK = process.argv.includes("--check");

function fail(message) {
  console.error(`addon-packages: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureBuilt() {
  if (!existsSync(join(ROOT, "dist", "index.js"))) {
    fail("dist/index.js missing; run `npm run build` before staging add-on packages");
  }
  if (!existsSync(join(ROOT, "dist", "shared", "module-packs.js"))) {
    fail("dist/shared/module-packs.js missing; run `npm run build` first");
  }
}

function packageDirName(packageName) {
  return packageName.replace(/^@/, "").replace("/", "__");
}

function copyRequiredDir(from, to, label) {
  if (!existsSync(from)) fail(`${label} missing: ${from}`);
  cpSync(from, to, { recursive: true });
}

function rewriteSharedRuntimeImports(file) {
  const before = readFileSync(file, "utf8");
  const after = before
    .replaceAll('from "../shared/', 'from "airmcp/dist/shared/')
    .replaceAll("from '../shared/", "from 'airmcp/dist/shared/")
    .replaceAll('import("../shared/', 'import("airmcp/dist/shared/')
    .replaceAll("import('../shared/", "import('airmcp/dist/shared/");
  if (after !== before) writeFileSync(file, after);
}

function rewriteSharedRuntimeImportsInDir(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      rewriteSharedRuntimeImportsInDir(path);
    } else if (entry.endsWith(".js")) {
      rewriteSharedRuntimeImports(path);
    }
  }
}

function assertNoBundledSharedRuntime(packageRoot, pack) {
  const sharedDir = join(packageRoot, "dist", "shared");
  if (existsSync(sharedDir)) fail(`${pack.name} add-on must not bundle dist/shared`);
}

function assertNoRelativeSharedImports(packageRoot, pack) {
  const offenders = [];
  function scan(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        scan(path);
      } else if (entry.endsWith(".js") && readFileSync(path, "utf8").includes("../shared/")) {
        offenders.push(path.replace(`${packageRoot}/`, ""));
      }
    }
  }
  scan(join(packageRoot, "dist"));
  if (offenders.length) {
    fail(`${pack.name} add-on still has relative shared imports: ${offenders.join(", ")}`);
  }
}

function installRootPackageSymlinkForVerification(packageRoot) {
  const nodeModules = join(packageRoot, "node_modules");
  const link = join(nodeModules, "airmcp");
  mkdirSync(nodeModules, { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(ROOT, link, "dir");
}

function makePackageJson(rootPkg, pack) {
  if (pack.packageName.includes("pack-") || pack.packageName.includes("-pack")) {
    fail(`${pack.name} package name must not contain pack-* wording: ${pack.packageName}`);
  }
  const repository =
    rootPkg.repository?.type === "git" &&
    typeof rootPkg.repository.url === "string" &&
    rootPkg.repository.url.startsWith("https://")
      ? { ...rootPkg.repository, url: `git+${rootPkg.repository.url}` }
      : rootPkg.repository;
  return {
    name: pack.packageName,
    version: rootPkg.version,
    description: `${pack.title} add-on modules for AirMCP.`,
    keywords: ["airmcp", "mcp", "macos", "module-addon", pack.name],
    homepage: rootPkg.homepage,
    bugs: rootPkg.bugs,
    repository,
    license: rootPkg.license,
    author: rootPkg.author,
    type: "module",
    main: "dist/index.js",
    files: ["dist"],
    publishConfig: { access: "public" },
    peerDependencies: {
      airmcp: rootPkg.version,
    },
    dependencies: rootPkg.dependencies,
    airmcp: {
      modulePack: pack.name,
      modules: pack.modules,
      sharedRuntime: "peer-root",
    },
    exports: {
      ".": "./dist/index.js",
      "./package.json": "./package.json",
      "./dist/*": "./dist/*",
    },
    engines: rootPkg.engines,
    os: rootPkg.os,
  };
}

function writeAddonIndex(packageDir, pack) {
  const contents = [
    `export const modulePack = ${JSON.stringify(pack.name)};`,
    `export const modules = ${JSON.stringify(pack.modules)};`,
    `export const packageName = ${JSON.stringify(pack.packageName)};`,
    "",
  ].join("\n");
  writeFileSync(join(packageDir, "dist", "index.js"), contents);
}

async function verifyAddonEntrypoints(packageRoot, pack) {
  installRootPackageSymlinkForVerification(packageRoot);
  assertNoBundledSharedRuntime(packageRoot, pack);
  assertNoRelativeSharedImports(packageRoot, pack);
  for (const moduleName of pack.modules) {
    const file = join(packageRoot, "dist", moduleName, "tools.js");
    try {
      await import(pathToFileURL(file));
    } catch (error) {
      fail(`${pack.name}/${moduleName} staged tools entrypoint is not importable: ${error.message}`);
    }
  }
}

async function main() {
  ensureBuilt();
  const rootPkg = readJson(join(ROOT, "package.json"));
  const { MODULE_PACK_MANIFEST } = await import(pathToFileURL(join(ROOT, "dist", "shared", "module-packs.js")));
  const addonPacks = MODULE_PACK_MANIFEST.filter((pack) => pack.name !== "core");

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });

  const manifest = [];
  for (const pack of addonPacks) {
    const packageRoot = join(BUILD_DIR, packageDirName(pack.packageName), "package");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });

    for (const moduleName of pack.modules) {
      copyRequiredDir(
        join(ROOT, "dist", moduleName),
        join(packageRoot, "dist", moduleName),
        `${pack.name}/${moduleName}`,
      );
      rewriteSharedRuntimeImportsInDir(join(packageRoot, "dist", moduleName));
    }

    writeAddonIndex(packageRoot, pack);
    const packageJson = makePackageJson(rootPkg, pack);
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
    await verifyAddonEntrypoints(packageRoot, pack);

    manifest.push({
      name: pack.name,
      packageName: pack.packageName,
      modules: pack.modules,
      packageDir: packageRoot.replace(`${ROOT}/`, ""),
      sharedRuntime: "peer-root",
    });
  }

  writeFileSync(
    join(BUILD_DIR, "manifest.json"),
    JSON.stringify({ version: rootPkg.version, packages: manifest }, null, 2) + "\n",
  );
  console.log(`ok: staged ${manifest.length} add-on packages in ${BUILD_DIR}`);
  if (CHECK) console.log("ok: add-on package boundary check passed");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
