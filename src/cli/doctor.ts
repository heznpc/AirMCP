/**
 * `npx airmcp doctor` — diagnose AirMCP installation.
 *
 * Checks: Node version, config files, MCP client configs,
 * module status, and optionally probes macOS permissions.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { MODULE_NAMES, STARTER_MODULES, NPM_PACKAGE_NAME, MCP_CLIENTS, getCompatibilityEnv } from "../shared/config.js";
import { HOME, PATHS } from "../shared/constants.js";
import { LOGO_LINES, typeLine } from "../shared/banner.js";
import { esc } from "../shared/esc.js";
import { MODULE_MANIFEST } from "../shared/modules.js";
import { summarizeCompatibility } from "../shared/compatibility.js";
import { RESET, BOLD, DIM, WHITE, GREEN, SYM, heading, line, divider, spinner, sleep } from "./style.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Package root — works in repo checkout, npm cache, and git worktrees. */
const PKG_ROOT = resolve(__dirname, "..", "..");

interface FileConfig {
  locale?: string;
  disabledModules?: string[];
  includeShared?: boolean;
  allowSendMessages?: boolean;
  allowSendMail?: boolean;
}

export async function runDoctor(): Promise<void> {
  // Banner
  console.log("");
  for (const l of LOGO_LINES) await typeLine(l, 2, "stdout");
  console.log("");
  await typeLine(`  ${BOLD}${WHITE}AirMCP Doctor${RESET}`, 8, "stdout");
  console.log("");
  await sleep(200);

  let pass = 0;
  let warn = 0;
  let fail = 0;

  function ok(label: string, detail: string) {
    console.log(line(SYM.ok, label, detail));
    pass++;
  }
  function bad(label: string, detail: string) {
    console.log(line(SYM.fail, label, detail));
    fail++;
  }
  function meh(label: string, detail: string) {
    console.log(line(SYM.warn, label, detail));
    warn++;
  }

  // ── Environment ────────────────────────────────────────────────────
  console.log(heading("Environment"));

  const s1 = spinner("Checking environment...");
  await sleep(300);

  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1), 10);
  s1.succeed("Environment checked");

  if (major >= 18) ok("Node.js", `${nodeVer}`);
  else bad("Node.js", `${nodeVer} — upgrade required (>= 18)`);

  const platform = process.platform;
  if (platform === "darwin") ok("Platform", "macOS");
  else bad("Platform", `${platform} — AirMCP requires macOS`);

  // macOS version
  if (platform === "darwin") {
    try {
      const ver = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 3000 }).trim();
      ok("macOS Version", ver);
    } catch {
      meh("macOS Version", "Could not detect");
    }
  }

  // npm version check
  try {
    const latest = execFileSync("npm", ["view", NPM_PACKAGE_NAME, "version"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    const pkgPath = join(PKG_ROOT, "package.json");
    let current = "unknown";
    try {
      current = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch {
      /* ignore */
    }
    if (current === latest) ok("AirMCP Version", `v${current} ${DIM}(latest)${RESET}`);
    else if (current !== "unknown" && latest && current > latest)
      ok("AirMCP Version", `v${current} ${DIM}(ahead of npm v${latest})${RESET}`);
    else meh("AirMCP Version", `v${current} → v${latest} available`);
  } catch {
    meh("AirMCP Version", "Could not check npm registry");
  }

  // ── Configuration ──────────────────────────────────────────────────
  console.log(heading("Configuration"));

  let fileConfig: FileConfig | null = null;
  if (existsSync(PATHS.CONFIG)) {
    try {
      fileConfig = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8")) as FileConfig;
      ok("Config file", PATHS.CONFIG.replace(HOME, "~"));
      if (fileConfig.locale) ok("Language", fileConfig.locale);
    } catch {
      meh("Config file", `${PATHS.CONFIG} (parse error)`);
    }
  } else {
    meh("Config file", `Not found — using starter preset`);
  }

  // ── MCP Clients ────────────────────────────────────────────────────
  console.log(heading("MCP Clients"));

  const s2 = spinner("Scanning for MCP clients...");
  await sleep(400);
  s2.succeed("Client scan complete");

  let anyClientFound = false;
  for (const client of MCP_CLIENTS) {
    if (existsSync(client.configPath)) {
      anyClientFound = true;
      try {
        const raw = JSON.parse(readFileSync(client.configPath, "utf-8"));
        const servers = raw?.[client.serversKey] ?? {};
        if (servers.airmcp) {
          ok(client.name, `${GREEN}connected${RESET}`);
        } else {
          meh(client.name, `found but no airmcp entry`);
        }
      } catch {
        meh(client.name, `config parse error`);
      }
    }
  }
  if (!anyClientFound) {
    meh("MCP Clients", `No clients found — run: npx ${NPM_PACKAGE_NAME} init`);
  }

  // ── Modules ────────────────────────────────────────────────────────
  console.log(heading("Modules"));

  const disabledSet = new Set(fileConfig?.disabledModules ?? []);
  const enabledMods: string[] = [];
  const disabledMods: string[] = [];

  for (const mod of MODULE_NAMES) {
    if (fileConfig) {
      if (disabledSet.has(mod)) disabledMods.push(mod);
      else enabledMods.push(mod);
    } else {
      if (STARTER_MODULES.has(mod)) enabledMods.push(mod);
      else disabledMods.push(mod);
    }
  }

  console.log(`  ${BOLD}${enabledMods.length}${RESET} enabled  ${DIM}${disabledMods.length} disabled${RESET}\n`);

  // Show in compact columns
  const cols = 4;
  const rows = Math.ceil(MODULE_NAMES.length / cols);
  for (let r = 0; r < rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r + c * rows;
      if (idx >= MODULE_NAMES.length) break;
      const mod = MODULE_NAMES[idx]!;
      const on = enabledMods.includes(mod);
      const icon = on ? SYM.ok : `${DIM}·${RESET}`;
      const label = on ? mod : `${DIM}${mod}${RESET}`;
      parts.push(`  ${icon} ${label}`.padEnd(on ? 20 : 30));
    }
    console.log(parts.join(""));
  }

  // ── Compatibility (RFC 0004) ───────────────────────────────────────
  //
  // Run the pure resolver against the current host env so users can see
  // *why* a given module won't register (macOS too old, HealthKit missing,
  // module flagged broken for this point release, etc.). The section is
  // intentionally terse — it only surfaces non-trivial outcomes (deprecated
  // / unsupported / broken). A fully-green host sees a single ok line.
  console.log(heading("Compatibility"));
  const compatEnv = getCompatibilityEnv();
  const compatSummary = summarizeCompatibility(
    MODULE_MANIFEST.map((m) => ({ name: m.name, compatibility: m.compatibility })),
    compatEnv,
  );
  const envLine =
    compatEnv.osVersion === 0
      ? `arch=${compatEnv.cpu}  (non-darwin — version checks bypassed)`
      : `macOS ${compatEnv.osVersion}  arch=${compatEnv.cpu}  healthkit=${compatEnv.healthkitAvailable ? "yes" : "no"}`;
  ok("Host env", envLine);

  if (
    compatSummary.deprecated.length === 0 &&
    compatSummary.unsupported.length === 0 &&
    compatSummary.broken.length === 0
  ) {
    ok("All modules compatible", `${compatSummary.register.length} register cleanly`);
  } else {
    for (const d of compatSummary.deprecated) meh(`⚠ ${d.name}`, d.reason);
    for (const u of compatSummary.unsupported) meh(`↷ ${u.name}`, u.reason);
    for (const b of compatSummary.broken) bad(`✖ ${b.name}`, b.reason);
  }

  // ── Permissions ────────────────────────────────────────────────────
  if (platform === "darwin" && enabledMods.length > 0) {
    console.log(heading("Permissions"));

    const s3 = spinner("Probing app permissions...");

    const APP_MAP: Record<string, string> = {
      notes: "Notes",
      reminders: "Reminders",
      calendar: "Calendar",
      contacts: "Contacts",
      mail: "Mail",
      messages: "Messages",
      music: "Music",
      finder: "Finder",
      safari: "Safari",
      system: "System Events",
      photos: "Photos",
      shortcuts: "Shortcuts",
      tv: "TV",
      maps: "Maps",
    };

    const permResults: Array<{ app: string; ok: boolean }> = [];
    for (const mod of enabledMods) {
      const appName = APP_MAP[mod];
      if (!appName) continue;
      try {
        execFileSync(
          "osascript",
          ["-l", "JavaScript", "-e", `Application('${esc(appName)}'); JSON.stringify({ok:true})`],
          { timeout: 5000, stdio: "pipe" },
        );
        permResults.push({ app: appName, ok: true });
      } catch {
        permResults.push({ app: appName, ok: false });
      }
    }

    s3.succeed("Permission check complete");

    for (const r of permResults) {
      if (r.ok) ok(r.app, "accessible");
      else meh(r.app, "needs permission — System Settings > Privacy");
    }
  }

  // ── Swift Bridge ───────────────────────────────────────────────────
  console.log(heading("Optional"));

  const swiftBridgePath = join(PKG_ROOT, "swift", ".build", "release", "AirMcpBridge");
  if (existsSync(swiftBridgePath)) {
    ok("Swift bridge", "built");
  } else {
    meh("Swift bridge", `not built — run: npm run swift-build`);
  }

  // GWS CLI
  try {
    execFileSync("which", ["gws"], { stdio: "pipe", timeout: 3000 });
    ok("Google Workspace CLI", "installed");
  } catch {
    try {
      execFileSync("npx", ["-y", "@googleworkspace/cli", "--version"], { stdio: "pipe", timeout: 10000 });
      ok("Google Workspace CLI", "available via npx");
    } catch {
      meh("Google Workspace CLI", `not installed — npm i -g @googleworkspace/cli`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log("");
  console.log(divider());
  console.log("");
  console.log(
    `  ${BOLD}Summary${RESET}  ${SYM.ok} ${pass} passed  ${warn > 0 ? `${SYM.warn} ${warn} warnings  ` : ""}${fail > 0 ? `${SYM.fail} ${fail} failed` : ""}`,
  );

  if (fail > 0) {
    console.log(`\n  ${DIM}Fix the issues above, then run: npx airmcp doctor${RESET}`);
  } else if (warn > 0) {
    console.log(`\n  ${DIM}Warnings are optional. AirMCP will work with current setup.${RESET}`);
  } else {
    console.log(`\n  ${GREEN}${BOLD}  All checks passed. AirMCP is ready.${RESET}`);
  }
  console.log("");
}
