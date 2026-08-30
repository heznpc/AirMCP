#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PLUGIN = join(ROOT, "plugins", "airmcp");
export const CHATGPT_APP_ID_PATTERN = /^plugin_asdk_app_[A-Za-z0-9]{16,}$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesExpectedVersion(version, expectedVersion, allowCodexCachebuster) {
  if (version === expectedVersion) return true;
  if (!allowCodexCachebuster) return false;
  const expectedBase = expectedVersion.split("+", 1)[0];
  return new RegExp(`^${escapeRegExp(expectedBase)}\\+codex\\.local-\\d{8}-\\d{6}$`).test(version);
}

function readJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function requireFile(path, label, errors) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    errors.push(`${label} is missing: ${path}`);
    return false;
  }
  return true;
}

function resolvePluginPath(pluginRoot, value, label, errors) {
  if (typeof value !== "string" || !value.startsWith("./")) {
    errors.push(`${label} must be a plugin-relative path beginning with ./`);
    return null;
  }
  const target = resolve(pluginRoot, value);
  const rel = relative(pluginRoot, target);
  if (rel.startsWith("..") || rel === "") {
    errors.push(`${label} must stay inside the plugin root`);
    return null;
  }
  return target;
}

function listSkillFiles(skillsRoot) {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name, "SKILL.md"))
    .filter((path) => existsSync(path));
}

function listPluginTextFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /(?:^|\.)(?:json|md|mjs|js|sh|ya?ml)$/i.test(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files;
}

export function validateChatgptPlugin(pluginPath = DEFAULT_PLUGIN, options = {}) {
  const pluginRoot = resolve(pluginPath);
  const errors = [];
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  if (!requireFile(manifestPath, "plugin manifest", errors)) return { ok: false, errors };

  const manifest = readJson(manifestPath, "plugin manifest", errors);
  if (!manifest) return { ok: false, errors };
  const expectedVersion = options.expectedVersion;

  if (manifest.name !== "airmcp") errors.push("plugin manifest name must be airmcp");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
    errors.push("plugin manifest version must be semver");
  }
  if (
    expectedVersion &&
    !matchesExpectedVersion(manifest.version, expectedVersion, options.allowCodexCachebuster === true)
  ) {
    errors.push(`plugin manifest version ${manifest.version} does not match ${expectedVersion}`);
  }
  if (manifest.author?.name !== "Heznpc" || manifest.interface?.developerName !== "Heznpc") {
    errors.push("plugin publisher identity must be Heznpc");
  }
  if (manifest.license !== "MIT") errors.push("plugin license must be MIT");
  if (typeof manifest.description !== "string" || manifest.description.length < 20) {
    errors.push("plugin description is missing or too short");
  }
  if (/\b(?:TODO|TBD|Local developer)\b/i.test(JSON.stringify(manifest))) {
    errors.push("plugin manifest contains placeholder text");
  }

  for (const path of listPluginTextFiles(pluginRoot)) {
    const rel = relative(pluginRoot, path);
    const body = readFileSync(path, "utf8");
    if (/\/Users\/[^\s"']+/.test(body)) {
      errors.push(`plugin contains a hard-coded personal path: ${rel}`);
    }
    if (rel !== ".app.json" && /plugin_asdk_app_[A-Za-z0-9]{16,}/.test(body)) {
      errors.push(`ChatGPT connection id must appear only in staged .app.json: ${rel}`);
    }
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(body)) {
      errors.push(`plugin contains an API-key-shaped value: ${rel}`);
    }
    if (/AIRMCP_HTTP_TOKEN\s*[:=]\s*["'][A-Za-z0-9_-]{32,}["']/.test(body)) {
      errors.push(`plugin contains a hard-coded app runtime token: ${rel}`);
    }
  }

  const skillsRoot = resolvePluginPath(pluginRoot, manifest.skills, "skills", errors);
  const skillFiles = skillsRoot ? listSkillFiles(skillsRoot) : [];
  if (skillFiles.length === 0) errors.push("plugin must include at least one SKILL.md");
  for (const skillFile of skillFiles) {
    const body = readFileSync(skillFile, "utf8");
    if (!body.startsWith("---\n") || !body.includes("\ndescription:")) {
      errors.push(`skill frontmatter is incomplete: ${skillFile}`);
    }
  }

  const mcpPath = resolvePluginPath(pluginRoot, manifest.mcpServers, "mcpServers", errors);
  if (mcpPath && requireFile(mcpPath, "bundled MCP config", errors)) {
    const mcp = readJson(mcpPath, "bundled MCP config", errors);
    const server = mcp?.mcpServers?.airmcp;
    if (
      server?.command !== "/usr/bin/env" ||
      server?.cwd !== "." ||
      JSON.stringify(server?.args) !==
        JSON.stringify(["-i", "PATH=/usr/bin:/bin:/usr/sbin:/sbin", "/bin/sh", "./scripts/launch-airmcp-connector.sh"])
    ) {
      errors.push("bundled MCP config must launch the app-owned stdio connector through a clean environment");
    }
    const launcherPath = join(pluginRoot, "scripts", "launch-airmcp-connector.sh");
    if (requireFile(launcherPath, "clean connector launcher", errors)) {
      const launcher = readFileSync(launcherPath, "utf8");
      if (
        !launcher.includes("codesign --verify --deep --strict --requirement") ||
        !launcher.includes('anchor apple generic and identifier "app.airmcp"') ||
        !launcher.includes('certificate leaf[subject.OU] = "XS7HJJN7GC"') ||
        !launcher.includes("exec /usr/bin/env -i")
      ) {
        errors.push(
          "clean connector launcher must verify the Apple-anchored app before starting Node with an empty environment",
        );
      }
    }
    if (/AIRMCP_HTTP_TOKEN|\/Users\//.test(JSON.stringify(mcp))) {
      errors.push("bundled MCP config must not contain a token or personal path");
    }
  }

  for (const [field, label] of [
    [manifest.interface?.composerIcon, "composer icon"],
    [manifest.interface?.logo, "logo"],
  ]) {
    const assetPath = resolvePluginPath(pluginRoot, field, label, errors);
    if (assetPath) requireFile(assetPath, label, errors);
  }

  if (manifest.apps !== undefined) {
    if (options.allowRegisteredApp !== true) {
      errors.push("source plugin manifest must omit apps; add the registered mapping only while staging");
    }
    const appPath = resolvePluginPath(pluginRoot, manifest.apps, "apps", errors);
    if (appPath && requireFile(appPath, "app mapping", errors)) {
      const appManifest = readJson(appPath, "app mapping", errors);
      const app = appManifest?.apps?.airmcp;
      if (!CHATGPT_APP_ID_PATTERN.test(app?.id ?? "")) {
        errors.push("app mapping must contain a valid plugin_asdk_app_... id");
      }
      if (Object.keys(app ?? {}).some((key) => !["id", "category"].includes(key))) {
        errors.push("app mapping contains unsupported fields");
      }
    }
  } else if (existsSync(join(pluginRoot, ".app.json"))) {
    errors.push("source plugin has .app.json but manifest does not reference it");
  }

  const evalPath = join(pluginRoot, "evals", "chatgpt.json");
  if (requireFile(evalPath, "ChatGPT evaluation set", errors)) {
    const evaluation = readJson(evalPath, "ChatGPT evaluation set", errors);
    const cases = Array.isArray(evaluation?.cases) ? evaluation.cases : [];
    const positives = cases.filter((item) => (item?.kind ?? item?.type) === "positive");
    const negatives = cases.filter((item) => (item?.kind ?? item?.type) === "negative");
    if (positives.length < 5 || negatives.length < 3) {
      errors.push("evaluation set must include at least five positive and three negative cases");
    }
    if (positives.some((item) => item?.expected?.pluginSelected !== true)) {
      errors.push("every positive evaluation must select the AirMCP plugin");
    }
    if (negatives.some((item) => item?.expected?.pluginSelected !== false)) {
      errors.push("every negative evaluation must leave the AirMCP plugin unselected");
    }
  }

  return { ok: errors.length === 0, errors, manifest, pluginRoot };
}

function main() {
  const pluginPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PLUGIN;
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const result = validateChatgptPlugin(pluginPath, { expectedVersion: rootPackage.version });
  if (!result.ok) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`AirMCP plugin ${result.manifest.version} is structurally ready: ${result.pluginRoot}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
