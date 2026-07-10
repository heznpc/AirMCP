#!/usr/bin/env node
/**
 * sync-version.mjs — Single source of truth version sync.
 *
 * Reads version from package.json and propagates to:
 *   1. server.json                          (MCP registry manifest — all packages)
 *   2. app/.../UpdateManager.swift          (menubar app update checker)
 *   3. src/shared/constants.ts              (User-Agent header)
 *   4. scripts/bundle-app.sh               (CFBundleShortVersionString)
 *   5. app/.../MenuContent.swift            (pinned app-owned npm runtime)
 *   6. src/shared/config.ts                 (pinned app-owned npm proxy)
 *   7. docs/PRIVACY_POLICY.md              (version header)
 *   8. .github/ISSUE_TEMPLATE/bug_report.yml (placeholder version)
 *   9. mcp.json                            (MCP Registry submission manifest)
 *   10. .claude-plugin/plugin.json         (Claude Code plugin manifest)
 *   11. .mcp.json                          (Claude Code project/plugin MCP config — pinned npm version)
 *   12. docs/index.html                    (structured data softwareVersion)
 *   13. app/widget/Info.plist              (widget short version)
 *
 * Usage:
 *   node scripts/sync-version.mjs           # sync all files
 *   node scripts/sync-version.mjs --check   # verify all in sync (CI)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { syncFile as syncAnchoredFile } from "./lib/sync-file.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const VERSION = pkg.version;
const MAJOR_MINOR = VERSION.split(".").slice(0, 2).join(".");

const checkMode = process.argv.includes("--check");
let dirty = false;
let fatal = false;

function syncFile(relPath, replacements) {
  const requiredReplacements = replacements.map((replacement) => ({ required: true, ...replacement }));
  const result = syncAnchoredFile(root, relPath, requiredReplacements, { mode: checkMode ? "check" : "sync" });
  dirty ||= result.dirty;
  fatal ||= result.fatal;
}

console.log(`\nVersion sync: ${VERSION}\n`);

// 1. server.json
const serverJsonPath = resolve(root, "server.json");
if (existsSync(serverJsonPath)) {
  const sj = JSON.parse(readFileSync(serverJsonPath, "utf8"));
  let sjChanged = false;
  if (sj.version !== VERSION) {
    sj.version = VERSION;
    sjChanged = true;
  }
  for (const pkg of sj.packages ?? []) {
    if (pkg.version !== VERSION) {
      pkg.version = VERSION;
      sjChanged = true;
    }
  }
  if (sjChanged) {
    if (checkMode) {
      console.error("  STALE: server.json");
      dirty = true;
    } else {
      writeFileSync(serverJsonPath, JSON.stringify(sj, null, 2) + "\n");
      console.log("  sync: server.json");
    }
  } else {
    console.log("  ok:   server.json");
  }
}

// 2. UpdateManager.swift — currentVersion = "x.y.z"
syncFile("app/Sources/AirMCPApp/UpdateManager.swift", [
  {
    pattern: /private let currentVersion = "[^"]+"/,
    replacement: `private let currentVersion = "${VERSION}"`,
    label: "currentVersion",
  },
]);

// 3. constants.ts — User-Agent AirMCP/x.y
syncFile("src/shared/constants.ts", [
  {
    pattern: /AirMCP\/[\d.]+ \(/,
    replacement: `AirMCP/${MAJOR_MINOR} (`,
    label: "USER_AGENT",
  },
]);

// 4. bundle-app.sh — CFBundleShortVersionString
syncFile("scripts/bundle-app.sh", [
  {
    pattern: /CFBundleShortVersionString string [\d.]+/,
    replacement: `CFBundleShortVersionString string ${VERSION}`,
    label: "CFBundleShortVersionString",
  },
]);

syncFile("app/widget/Info.plist", [
  {
    pattern: /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
    replacement: `$1${VERSION}$2`,
    label: "widget CFBundleShortVersionString",
  },
]);

// 5. MenuContent.swift — app-owned npx runtime pin.
syncFile("app/Sources/AirMCPApp/Views/MenuContent.swift", [
  {
    pattern: /static let npmPackageVersion = "[^"]+"/,
    replacement: `static let npmPackageVersion = "${VERSION}"`,
    label: "app npmPackageVersion",
  },
]);

// 6. config.ts — app-owned proxy/runtime package pin.
syncFile("src/shared/config.ts", [
  {
    pattern: /export const NPM_PACKAGE_SPECIFIER = process\.env\.AIRMCP_NPM_PACKAGE_SPECIFIER \|\| "airmcp@[^"]+"/,
    replacement: `export const NPM_PACKAGE_SPECIFIER = process.env.AIRMCP_NPM_PACKAGE_SPECIFIER || "airmcp@${VERSION}"`,
    label: "NPM_PACKAGE_SPECIFIER",
  },
]);

// 7. PRIVACY_POLICY.md — AirMCP vX.Y.Z
syncFile("docs/PRIVACY_POLICY.md", [
  {
    pattern: /AirMCP v[\d.]+/,
    replacement: `AirMCP v${VERSION}`,
    label: "privacy policy version",
  },
]);

// 8. bug_report.yml — placeholder version
syncFile(".github/ISSUE_TEMPLATE/bug_report.yml", [
  {
    pattern: /placeholder: "[\d.]+"/,
    replacement: `placeholder: "${VERSION}"`,
    label: "bug report placeholder",
  },
]);

// 9. mcp.json — MCP Registry submission manifest (top-level "version" field).
const mcpJsonPath = resolve(root, "mcp.json");
if (existsSync(mcpJsonPath)) {
  const mj = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
  if (mj.version !== VERSION) {
    if (checkMode) {
      console.error("  STALE: mcp.json");
      dirty = true;
    } else {
      mj.version = VERSION;
      writeFileSync(mcpJsonPath, JSON.stringify(mj, null, 2) + "\n");
      console.log("  sync: mcp.json");
    }
  } else {
    console.log("  ok:   mcp.json");
  }
}

// 10. .claude-plugin/plugin.json — Claude Code plugin manifest.
const pluginJsonPath = resolve(root, ".claude-plugin/plugin.json");
if (existsSync(pluginJsonPath)) {
  const pj = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
  if (pj.version !== VERSION) {
    if (checkMode) {
      console.error("  STALE: .claude-plugin/plugin.json");
      dirty = true;
    } else {
      pj.version = VERSION;
      writeFileSync(pluginJsonPath, JSON.stringify(pj, null, 2) + "\n");
      console.log("  sync: .claude-plugin/plugin.json");
    }
  } else {
    console.log("  ok:   .claude-plugin/plugin.json");
  }
}

// 11. .mcp.json — Claude Code plugin MCP config. The npx invocation is
//    pinned to the current package version so a marketplace install at
//    plugin version X runs the npm tarball at version X (not whatever
//    `dist-tags.latest` happens to point at).
syncFile(".mcp.json", [
  {
    pattern: /"airmcp@[\d.]+"/,
    replacement: `"airmcp@${VERSION}"`,
    label: ".mcp.json airmcp version pin",
  },
]);

// 12. docs/index.html — Schema.org SoftwareApplication softwareVersion.
syncFile("docs/index.html", [
  {
    pattern: /"softwareVersion": "[^"]+"/,
    replacement: `"softwareVersion": "${VERSION}"`,
    label: "structured data softwareVersion",
  },
]);

console.log("");

if (dirty) {
  if (fatal) {
    console.error("Version sync anchors missing. Restore the anchors or update scripts/sync-version.mjs.");
  } else {
    console.error("Version mismatch detected. Run: node scripts/sync-version.mjs");
  }
  process.exit(1);
}
