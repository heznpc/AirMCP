#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectFoundationModels } from "./lib/foundation-models-status.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = resolve(root, "swift", ".build", "release", "AirMcpBridge");

async function checkSwiftBridge() {
  try {
    await access(binary);
    return null;
  } catch {
    return "Swift bridge not found.";
  }
}

async function runSwift(command, input) {
  const probe = spawnSync(binary, [command], { input, encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error(probe.stderr || probe.stdout || `Swift bridge exited with ${probe.status}`);
  }
  return JSON.parse(probe.stdout.trim());
}

const result = await inspectFoundationModels({ checkSwiftBridge, runSwift });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const mark = result.ready ? "ready" : "blocked";
  console.log(`Foundation Models preview: ${mark} (${result.classification})`);
  console.log(result.message);
  if (result.action) console.log(`Next: ${result.action}`);
}

process.exit(result.ready ? 0 : 2);
