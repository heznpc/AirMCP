#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const swiftRoot = resolve(root, "swift");
const binary = resolve(swiftRoot, ".build", "release", "AirMcpBridge");

if (process.platform !== "darwin") {
  console.error("[swift-build:fm] Foundation Models preview builds require macOS.");
  process.exit(2);
}

const build = spawnSync("swift", ["build", "-c", "release", "-Xswiftc", "-DAIRMCP_ENABLE_FOUNDATION_MODELS"], {
  cwd: swiftRoot,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

// A compile guard can otherwise make an opt-in build appear successful while
// still producing the stub path. Probe the resulting binary and require proof
// that the FoundationModels branch was compiled.
const probe = spawnSync(binary, ["ai-status"], {
  cwd: root,
  input: "{}\n",
  encoding: "utf8",
});
if (probe.status !== 0) {
  process.stderr.write(probe.stderr || probe.stdout || "[swift-build:fm] ai-status probe failed.\n");
  process.exit(probe.status ?? 1);
}

let status;
try {
  status = JSON.parse(probe.stdout.trim());
} catch {
  console.error(`[swift-build:fm] ai-status returned invalid JSON: ${probe.stdout.trim().slice(0, 300)}`);
  process.exit(1);
}

if (status.foundationModelsSupported !== true || status.classification === "disabled_at_compile_time") {
  console.error(
    "[swift-build:fm] Swift completed but the Foundation Models branch was not compiled. " +
      "Use a toolchain with the macOS 26 SDK and Swift 6.2 or later.",
  );
  process.exit(2);
}

console.log(
  `[swift-build:fm] Opt-in Foundation Models preview compiled (${status.classification}; macOS ${status.macOSVersion}).`,
);
