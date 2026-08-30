#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHATGPT_APP_ID_PATTERN, validateChatgptPlugin } from "./validate-chatgpt-plugin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PLUGIN = join(ROOT, "plugins", "airmcp");
const DEFAULT_OUTPUT = join(ROOT, "build", "chatgpt-plugin");
const STAGE_MARKER = ".airmcp-chatgpt-plugin-stage.json";
const STAGE_MARKER_VALUE = { generatedBy: "airmcp-chatgpt-plugin-stager", schemaVersion: 3 };

function usage() {
  return [
    "Usage: node scripts/stage-chatgpt-plugin.mjs --app-id plugin_asdk_app_... [--output <dir>] [--force]",
    "",
    "Stages a local ChatGPT plugin and marketplace without changing the source package.",
  ].join("\n");
}

export function parseStageArgs(argv) {
  const options = { appId: "", outputDir: DEFAULT_OUTPUT, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--app-id") {
      options.appId = argv[++i] ?? "";
      continue;
    }
    if (arg === "--output") {
      options.outputDir = resolve(argv[++i] ?? "");
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  if (!CHATGPT_APP_ID_PATTERN.test(options.appId)) {
    throw new Error("--app-id must be a real plugin_asdk_app_... technical ID");
  }
  return options;
}

function isSameOrAncestor(candidate, target) {
  const rel = relative(candidate, target);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function assertSafeOutput(outputDir, sourcePlugin) {
  const output = resolve(outputDir);
  const forbidden = [resolve("/"), resolve(homedir()), ROOT, resolve(sourcePlugin)];
  if (
    forbidden.includes(output) ||
    isSameOrAncestor(output, ROOT) ||
    isSameOrAncestor(output, sourcePlugin) ||
    isSameOrAncestor(sourcePlugin, output)
  ) {
    throw new Error(`refusing unsafe staging output: ${output}`);
  }
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
    throw new Error(`refusing symlink staging output: ${output}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDirectoryIdentity(output) {
  const stat = lstatSync(output);
  return { device: String(stat.dev), inode: String(stat.ino) };
}

function assertOwnedStageOutput(output) {
  const markerPath = join(output, STAGE_MARKER);
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error(`refusing to replace an unowned staging output: ${output}`);
  }
  const expectedIdentity = outputDirectoryIdentity(output);
  const currentMarker =
    marker?.schemaVersion === STAGE_MARKER_VALUE.schemaVersion &&
    marker?.outputIdentity?.device === expectedIdentity.device &&
    marker?.outputIdentity?.inode === expectedIdentity.inode &&
    marker?.outputDir === undefined;
  const legacyMarker = marker?.schemaVersion === 2 && marker?.outputDir === resolve(output);
  if (
    marker?.generatedBy !== STAGE_MARKER_VALUE.generatedBy ||
    marker?.layout !== "airmcp-local-marketplace-v1" ||
    (!currentMarker && !legacyMarker)
  ) {
    throw new Error(`refusing to replace an unowned staging output: ${output}`);
  }
  const entries = readdirSync(output).sort();
  if (JSON.stringify(entries) !== JSON.stringify([".agents", STAGE_MARKER, "plugins"].sort())) {
    throw new Error(`refusing to replace staging output with unknown files: ${output}`);
  }
  for (const directory of [join(output, ".agents"), join(output, "plugins")]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`refusing to replace staging output with an unsafe layout: ${output}`);
    }
  }
}

export function makeCodexCachebuster(date = new Date()) {
  const iso = date.toISOString();
  return `local-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

export function stageChatgptPlugin({
  appId,
  outputDir = DEFAULT_OUTPUT,
  force = false,
  sourcePlugin = SOURCE_PLUGIN,
  expectedVersion,
  cachebuster = makeCodexCachebuster(),
}) {
  if (!CHATGPT_APP_ID_PATTERN.test(appId)) {
    throw new Error("appId must be a real plugin_asdk_app_... technical ID");
  }
  if (!/^local-\d{8}-\d{6}$/.test(cachebuster)) {
    throw new Error("cachebuster must use local-YYYYMMDD-HHMMSS");
  }
  const output = resolve(outputDir);
  const source = resolve(sourcePlugin);
  const sourceValidation = validateChatgptPlugin(source, { expectedVersion });
  if (!sourceValidation.ok) {
    throw new Error(
      `source plugin failed validation:\n${sourceValidation.errors.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  assertSafeOutput(output, source);

  if (existsSync(output)) {
    if (!force) throw new Error(`staging output already exists; pass --force to replace it: ${output}`);
    assertOwnedStageOutput(output);
    rmSync(output, { recursive: true, force: true });
  }

  mkdirSync(output, { recursive: true });
  const stagedPlugin = join(output, "plugins", "airmcp");
  for (const sourceFile of sourceValidation.files) {
    const target = join(stagedPlugin, relative(source, sourceFile));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(sourceFile, target);
  }

  const manifestPath = join(stagedPlugin, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const baseVersion = String(manifest.version).split("+", 1)[0];
  manifest.version = `${baseVersion}+codex.${cachebuster}`;
  manifest.apps = "./.app.json";
  writeJson(manifestPath, manifest);
  writeJson(join(stagedPlugin, ".app.json"), {
    apps: {
      airmcp: { id: appId },
    },
  });

  mkdirSync(join(output, ".agents", "plugins"), { recursive: true });
  writeJson(join(output, ".agents", "plugins", "marketplace.json"), {
    name: "airmcp-local",
    interface: { displayName: "AirMCP Local" },
    plugins: [
      {
        name: "airmcp",
        source: { source: "local", path: "./plugins/airmcp" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  });

  const validation = validateChatgptPlugin(stagedPlugin, {
    expectedVersion,
    allowCodexCachebuster: true,
    allowRegisteredApp: true,
  });
  if (!validation.ok) {
    throw new Error(`staged plugin failed validation:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  writeJson(join(output, STAGE_MARKER), {
    ...STAGE_MARKER_VALUE,
    outputIdentity: outputDirectoryIdentity(output),
    layout: "airmcp-local-marketplace-v1",
  });
  return {
    outputDir: output,
    pluginPath: stagedPlugin,
    pluginVersion: manifest.version,
    marketplacePath: join(output, ".agents", "plugins", "marketplace.json"),
  };
}

function main() {
  let options;
  try {
    options = parseStageArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const result = stageChatgptPlugin({ ...options, expectedVersion: rootPackage.version });
  console.log(`Staged AirMCP ChatGPT plugin ${result.pluginVersion}: ${result.pluginPath}`);
  console.log(`Local marketplace: ${result.marketplacePath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
