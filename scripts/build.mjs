#!/usr/bin/env node
import { buildSync } from "esbuild";
import {
  globSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

const entryPoints = globSync("src/**/*.ts", {
  ignore: ["**/*.test.ts", "**/*.spec.ts"],
});

buildSync({
  entryPoints,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "es2022",
  packages: "external",
  sourcemap: false,
});

// Copy built-in skill YAML files one-by-one — more resilient than
// cpSync({recursive:true}) when the destination directory already exists
// with stale entries (e.g. on sandboxed/shadowed filesystems).
const srcDir = "src/skills/builtins";
const destDir = "dist/skills/builtins";
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true, force: true });
}
mkdirSync(destDir, { recursive: true });
for (const entry of readdirSync(srcDir)) {
  if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
  copyFileSync(join(srcDir, entry), join(destDir, entry));
}
