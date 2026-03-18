#!/usr/bin/env node
import { buildSync } from "esbuild";
import { cpSync, globSync } from "node:fs";

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
});

cpSync("src/skills/builtins", "dist/skills/builtins", { recursive: true });
