#!/usr/bin/env node
/**
 * Apply or restore the slim-root npm package surface.
 *
 * `npm pack` / `npm publish` should ship the root package without non-core
 * module entrypoints. The companion add-on packages carry those entrypoints.
 * Local builds stay universal: prepack backs up dist, removes non-core
 * tools/prompts, and postpack restores the universal dist tree.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const BACKUP_DIR = join(ROOT, "build", "slim-root-backup");
const BACKUP_DIST = join(BACKUP_DIR, "dist");
const MARKER = join(DIST, ".airmcp-slim-root.json");

function fail(message) {
  console.error(`slim-root-package: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureBuilt() {
  if (!existsSync(join(DIST, "index.js"))) fail("dist/index.js missing; run npm run build first");
  if (!existsSync(join(DIST, "shared", "module-packs.js"))) {
    fail("dist/shared/module-packs.js missing; run npm run build first");
  }
}

function restore() {
  if (!existsSync(BACKUP_DIST)) return;
  rmSync(DIST, { recursive: true, force: true });
  cpSync(BACKUP_DIST, DIST, { recursive: true });
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  console.log("slim-root-package: restored universal dist");
}

async function applySlimRoot() {
  ensureBuilt();
  restore();
  mkdirSync(BACKUP_DIR, { recursive: true });
  cpSync(DIST, BACKUP_DIST, { recursive: true });

  const rootPkg = readJson(join(ROOT, "package.json"));
  const { MODULE_PACK_MANIFEST } = await import(pathToFileURL(join(DIST, "shared", "module-packs.js")).href);
  const removed = [];
  for (const pack of MODULE_PACK_MANIFEST) {
    if (pack.name === "core") continue;
    for (const moduleName of pack.modules) {
      for (const fileName of ["tools.js", "prompts.js"]) {
        const filePath = join(DIST, moduleName, fileName);
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
          removed.push(`dist/${moduleName}/${fileName}`);
        }
      }
    }
  }

  writeFileSync(
    MARKER,
    JSON.stringify(
      {
        version: rootPkg.version,
        slimRoot: true,
        removedModuleEntrypoints: removed,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`slim-root-package: removed ${removed.length} non-core module entrypoints`);
}

const mode = process.argv[2];
if (mode === "--apply") {
  applySlimRoot().catch((error) => fail(error instanceof Error ? error.message : String(error)));
} else if (mode === "--restore") {
  restore();
} else {
  fail("usage: node scripts/slim-root-package.mjs --apply|--restore");
}
