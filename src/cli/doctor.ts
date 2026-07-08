/**
 * `npx airmcp doctor` — diagnose AirMCP installation.
 *
 * Checks: Node version, config files, MCP client configs,
 * module status, and optionally probes macOS permissions.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  MODULE_NAMES,
  NPM_PACKAGE_NAME,
  MCP_CLIENTS,
  getCompatibilityEnv,
  isModuleEnabled,
  normalizeProfileName,
  parseConfig,
  type AirMcpConfig,
} from "../shared/config.js";
import { HOME, PATHS } from "../shared/constants.js";
import { CODEX_APP_OWNED_URL, codexAirmcpRuntimeShape, isCodexCliAvailable } from "./codex-mcp.js";
import { clientRuntimeShape } from "./client-config.js";
import { LOGO_LINES, typeLine } from "../shared/banner.js";
import { esc } from "../shared/esc.js";
import { MODULE_MANIFEST, getModulePackPlan } from "../shared/modules.js";
import { getModulePackStatuses, resolveModulePackSelection } from "../shared/module-packs.js";
import { getMissingAddonPackageModules } from "../shared/module-loader.js";
import { summarizeCompatibility } from "../shared/compatibility.js";
import { assessWorkflowsReadiness, summarizeWorkflowsReadiness } from "../shared/workflows.js";
import { RESET, BOLD, DIM, WHITE, GREEN, SYM, heading, line, divider, spinner, sleep } from "./style.js";
import { APP_RUNTIME_TOKEN_PATH } from "../shared/app-runtime-token.js";
import { probeAppRuntimeMcp } from "./app-runtime-probe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Package root — works in repo checkout, npm cache, and git worktrees. */
const PKG_ROOT = resolve(__dirname, "..", "..");
const APP_OWNED_HEALTH_URL = CODEX_APP_OWNED_URL.replace(/\/mcp$/, "/health");

interface FileConfig {
  locale?: string;
  profile?: string;
  toolExposure?: string;
  modulePacks?: string | string[];
  requireToolSession?: boolean;
  disabledModules?: string[];
  includeShared?: boolean;
  allowSendMessages?: boolean;
  allowSendMail?: boolean;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  let runtimeConfig: AirMcpConfig | null = null;
  if (existsSync(PATHS.CONFIG)) {
    try {
      fileConfig = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8")) as FileConfig;
      ok("Config file", PATHS.CONFIG.replace(HOME, "~"));
      if (fileConfig.locale) ok("Language", fileConfig.locale);
    } catch {
      meh("Config file", `${PATHS.CONFIG} (parse error)`);
    }
  } else {
    meh("Config file", `Not found — using starter profile`);
  }
  try {
    runtimeConfig = parseConfig();
    const enabledCount = MODULE_NAMES.filter((moduleName) => isModuleEnabled(runtimeConfig!, moduleName)).length;
    ok(
      "Runtime profile",
      `${runtimeConfig.profile} (${runtimeConfig.toolExposure} exposure, ${enabledCount}/${MODULE_NAMES.length} modules enabled)`,
    );
    const requestedProfile = normalizeProfileName(fileConfig?.profile);
    if (fileConfig?.profile && requestedProfile !== runtimeConfig.profile) {
      meh("Config profile", `requested "${fileConfig.profile}", effective "${runtimeConfig.profile}"`);
    }
  } catch (e) {
    meh("Runtime profile", `could not parse effective config: ${e instanceof Error ? e.message : String(e)}`);
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
          const shape = clientRuntimeShape(servers.airmcp);
          if (shape === "app-owned") {
            ok(client.name, `${GREEN}connected${RESET} ${DIM}(AirMCP.app runtime)${RESET}`);
          } else if (shape === "direct") {
            meh(client.name, `connected via direct stdio — run: npx airmcp connect-clients`);
          } else {
            meh(client.name, `airmcp entry found, runtime shape unknown`);
          }
        } else {
          meh(client.name, `found but no airmcp entry`);
        }
      } catch {
        meh(client.name, `config parse error`);
      }
    }
  }
  try {
    const output = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    anyClientFound = true;
    if (/\bairmcp\b/i.test(output)) {
      ok("Claude Code user scope", `${GREEN}connected${RESET} ${DIM}(claude mcp list)${RESET}`);
    } else {
      meh("Claude Code user scope", "CLI available but no airmcp entry found");
    }
  } catch {
    /* CLI absent or not configured; file-config checks above remain authoritative. */
  }
  if (isCodexCliAvailable()) {
    anyClientFound = true;
    const shape = codexAirmcpRuntimeShape();
    if (shape === "app-owned") {
      ok("Codex", `${GREEN}connected${RESET} ${DIM}(AirMCP.app runtime)${RESET}`);
    } else if (shape === "app-owned-pending-restart") {
      meh("Codex", `config uses AirMCP.app runtime — restart Codex to reload MCP servers`);
    } else if (shape === "direct") {
      meh("Codex", "connected via direct stdio — run: npx airmcp connect-clients");
    } else if (shape === "missing") {
      meh("Codex", `found but no airmcp entry`);
    } else {
      meh("Codex", `airmcp entry found, runtime shape unknown`);
    }
  }
  if (!anyClientFound) {
    meh("MCP Clients", `No clients found — run: npx ${NPM_PACKAGE_NAME} init`);
  }

  // ── AirMCP.app runtime ─────────────────────────────────────────────
  //
  // This is the recommended production shape: AirMCP.app owns macOS/TCC
  // permissions and exposes a local token-gated HTTP runtime for clients.
  // Doctor checks the live runtime contract instead of trusting client config.
  console.log(heading("AirMCP.app Runtime"));
  const tokenExists = existsSync(APP_RUNTIME_TOKEN_PATH);
  let appRuntimeToken: string | null = null;
  if (tokenExists) {
    try {
      const mode = statSync(APP_RUNTIME_TOKEN_PATH).mode & 0o777;
      appRuntimeToken = readFileSync(APP_RUNTIME_TOKEN_PATH, "utf8").trim();
      if (mode === 0o600 && appRuntimeToken) {
        ok("Runtime token", `${APP_RUNTIME_TOKEN_PATH.replace(HOME, "~")} (0600)`);
      } else if (!appRuntimeToken) {
        bad("Runtime token", `${APP_RUNTIME_TOKEN_PATH.replace(HOME, "~")} is empty`);
      } else {
        bad(
          "Runtime token",
          `${APP_RUNTIME_TOKEN_PATH.replace(HOME, "~")} permissions ${mode.toString(8)}; expected 600`,
        );
      }
    } catch (e) {
      meh("Runtime token", `could not inspect token: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    meh("Runtime token", `not created yet — launch AirMCP.app or copy a client config from the app`);
  }

  try {
    const healthResponse = await fetchWithTimeout(APP_OWNED_HEALTH_URL);
    if (!healthResponse.ok) {
      bad("Runtime health", `${APP_OWNED_HEALTH_URL} returned HTTP ${healthResponse.status}`);
    } else {
      const health = (await healthResponse.json()) as { status?: string; version?: string };
      const pkgPath = join(PKG_ROOT, "package.json");
      const current = JSON.parse(readFileSync(pkgPath, "utf-8")).version as string;
      if (health.status === "ok" && health.version === current) {
        ok("Runtime health", `healthy v${health.version}`);
      } else if (health.status === "ok") {
        bad("Runtime health", `version mismatch: app/package v${current}, runtime v${health.version ?? "unknown"}`);
      } else {
        bad("Runtime health", `unexpected payload: ${JSON.stringify(health)}`);
      }

      const probeBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "airmcp-doctor", version: "0" },
        },
      });
      try {
        const unauth = await fetchWithTimeout(
          CODEX_APP_OWNED_URL,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: probeBody },
          1500,
        );
        if (unauth.status === 401) {
          ok("Runtime auth", "unauthenticated /mcp rejected (401)");
        } else {
          bad("Runtime auth", `unauthenticated /mcp returned HTTP ${unauth.status}; expected 401`);
        }
      } catch (e) {
        meh("Runtime auth", `unauthenticated probe failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (appRuntimeToken) {
        try {
          const probe = await probeAppRuntimeMcp({
            url: CODEX_APP_OWNED_URL,
            token: appRuntimeToken,
            clientName: "airmcp-doctor",
            timeoutMs: 3_000,
          });
          ok("Runtime MCP", `initialize + tools/list ok (${probe.toolCount} tools)`);
        } catch (e) {
          bad(
            "Runtime MCP",
            `token-authenticated initialize/tools-list failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  } catch {
    meh("Runtime health", `not running at ${APP_OWNED_HEALTH_URL} — launch AirMCP.app or run npm run app:verify`);
  }

  // ── Modules ────────────────────────────────────────────────────────
  console.log(heading("Modules"));

  const enabledMods: string[] = [];
  const disabledMods: string[] = [];

  for (const mod of MODULE_NAMES) {
    if (runtimeConfig ? isModuleEnabled(runtimeConfig, mod) : false) enabledMods.push(mod);
    else disabledMods.push(mod);
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

  console.log(heading("Module add-ons"));
  const packSelection = resolveModulePackSelection(process.env.AIRMCP_MODULE_PACKS ?? fileConfig?.modulePacks);
  const packStatuses = getModulePackStatuses(runtimeConfig?.modulePacks ?? packSelection.packs);
  const activePacks = packStatuses.filter((pack) => pack.available);
  ok("Active packs", activePacks.map((pack) => pack.name).join(", "));
  if (runtimeConfig?.modulePacksConfigured ?? packSelection.configured)
    ok("Pack source", process.env.AIRMCP_MODULE_PACKS ? "AIRMCP_MODULE_PACKS" : "config.json");
  else meh("Pack source", "default all built-in packs");
  ok("Add-on import mode", process.env.AIRMCP_ADDON_PACKAGE_MODE ?? "prefer-installed");
  for (const pack of packStatuses) {
    const detail = `${pack.packageName} · ${pack.modules.join(", ")}`;
    if (pack.available) ok(`pack:${pack.name}`, detail);
    else meh(`pack:${pack.name}`, detail);
  }

  console.log(heading("Task harness"));
  const strictHarness = runtimeConfig?.requireToolSession ?? false;
  const harnessAdapter =
    process.env.AIRMCP_HARNESS_ADAPTER ??
    (process.env.AIRMCP_APP_OWNED_RUNTIME ? "app-runtime" : strictHarness ? "strict" : "compatible");
  ok("Harness adapter", harnessAdapter);
  if (strictHarness) ok("Hidden tool sessions", "required before run_tool dispatches hidden tools");
  else meh("Hidden tool sessions", "compatible mode — set requireToolSession=true for strict task scoping");

  console.log(heading("Workflow config readiness"));
  meh("Scope", "profile/module packs/add-on packages/write opt-ins; MCP workflow_readiness checks live tools");
  if (runtimeConfig) {
    const workflowPackPlan = getModulePackPlan(runtimeConfig);
    const workflows = assessWorkflowsReadiness({
      enabledModules: enabledMods,
      modulesMissingPacks: workflowPackPlan.modulesMissingPacks,
      modulesMissingAddonPackages: getMissingAddonPackageModules(),
      allowSendMail: runtimeConfig.allowSendMail,
      allowSendMessages: runtimeConfig.allowSendMessages,
    });
    const { ready, partial, blocked } = summarizeWorkflowsReadiness(workflows);
    if (blocked === 0 && partial === 0) {
      ok("Curated workflows", `${ready}/${workflows.length} ready`);
    } else {
      meh("Curated workflows", `${ready} ready, ${partial} partial, ${blocked} blocked`);
    }
    for (const workflow of workflows) {
      const label = `workflow:${workflow.id}`;
      if (workflow.status === "ready") {
        ok(label, workflow.summary);
      } else {
        const firstIssue = workflow.issues[0];
        const detail = firstIssue
          ? `${workflow.summary} ${firstIssue.message}${firstIssue.command ? ` Run: ${firstIssue.command}` : ""}`
          : workflow.summary;
        meh(label, detail);
      }
    }
  } else {
    meh("Curated workflows", "runtime config unavailable");
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

  // ── HTTP network policy (RFC 0002) ─────────────────────────────────
  //
  // Surface what the HTTP transport *would* do if started right now with
  // the current env. Doctor runs in stdio context so nothing is bound —
  // this is pure introspection. Matches the same resolver the server uses,
  // so mismatches between doctor output and actual startup behaviour can
  // only come from config drift, not from stale logic here.
  console.log(heading("HTTP network policy"));
  try {
    const { resolveAllowNetwork } = await import("../server/http-transport.js");
    const envPolicy = (process.env.AIRMCP_ALLOW_NETWORK ?? "").trim() || undefined;
    const bindAll = process.argv.includes("--bind-all");
    const unsafeNoAuth = process.argv.includes("--unsafe-no-auth");
    const httpToken = process.env.AIRMCP_HTTP_TOKEN ?? "";
    const allowedOrigins = (process.env.AIRMCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
    const effective = resolveAllowNetwork({
      explicit: envPolicy as never,
      bindAll,
      httpToken,
      allowedOriginsCount: allowedOrigins.length,
      unsafeNoAuth,
    });
    ok("Effective policy", effective);
    if (envPolicy) ok("AIRMCP_ALLOW_NETWORK", envPolicy);
    ok("Token", httpToken ? `set (sha256: ${httpToken.slice(0, 0)}${"…".repeat(1)})` : "not set");
    ok("Origin allow-list", allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "(empty)");
    if (effective === "unauthenticated") {
      bad(
        "Danger mode",
        "allowNetwork=unauthenticated — tool surface exposed without auth. Intended for CI/debug only.",
      );
    } else if (effective === "loopback-only" && bindAll) {
      // The runtime would refuse to start in this state; doctor should
      // surface it clearly instead of silently contradicting itself.
      bad(
        "Config conflict",
        "--bind-all is set but policy is loopback-only — HTTP server would refuse to start. Drop --bind-all or set AIRMCP_ALLOW_NETWORK=with-token.",
      );
    }
  } catch (e) {
    // Non-fatal: this section is diagnostic, don't sink the whole doctor run.
    meh("HTTP policy resolver unavailable", e instanceof Error ? e.message : String(e));
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
    meh("Swift bridge", `not built — run: npm run swift-build (optional bridge, not a module add-on package)`);
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

  // ── Deep checks (opt-in) ──────────────────────────────────────────
  // `--deep` runs slower live probes useful for user-reported triage:
  // audit-log HMAC chain integrity, Swift bridge round-trip, module
  // registry boot.
  const deepFlag = process.argv.includes("--deep");
  if (deepFlag) {
    console.log(heading("Deep checks (--deep)"));

    // 1. Audit log HMAC chain — single-line tampering probe.
    const s4 = spinner("Verifying audit log HMAC chain...");
    try {
      const auditMod = await import("../shared/audit.js");
      const summary = await auditMod.summarizeAuditEntries({});
      s4.succeed("Audit verification complete");
      if (summary.auditDisabled) {
        meh("Audit log", "currently disabled (recovery window — re-enables on next call)");
      } else if (summary.verified) {
        ok("Audit HMAC chain", `verified across ${summary.scannedFiles} file(s), ${summary.total} entries`);
      } else if (summary.verifiedFirstBreak) {
        const b = summary.verifiedFirstBreak;
        bad(
          "Audit HMAC chain",
          `break at ${b.file}:${b.lineIndex} (${b.reason}) — possible tampering or corruption. ` +
            `Inspect the surrounding lines, then call audit_summary to see the full break window.`,
        );
      } else {
        meh("Audit HMAC chain", "no chained entries on disk yet");
      }
    } catch (e) {
      s4.fail("Audit verification failed");
      meh("Audit HMAC chain", `error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Swift bridge live ping. checkSwiftBridge resolves to null when
    //    everything is fine, or a string with the human-readable reason.
    const s5 = spinner("Pinging Swift bridge...");
    try {
      const swiftMod = await import("../shared/swift.js");
      const missing = await swiftMod.checkSwiftBridge();
      s5.succeed("Swift bridge probe complete");
      if (!missing) {
        ok("Swift bridge", "responsive");
      } else {
        meh("Swift bridge", missing);
      }
    } catch (e) {
      s5.fail("Swift bridge probe failed");
      meh("Swift bridge", `error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Module registry boot smoke. Loads every module's tools.ts +
    //    optional prompts.ts the same way the runtime does and reports
    //    any module that fails to import (typo in a script.ts, missing
    //    transitive dep, etc.).
    const s6 = spinner("Loading module registry (boot smoke)...");
    try {
      const modulesMod = await import("../shared/modules.js");
      const registry = await modulesMod.loadModuleRegistry();
      s6.succeed("Module registry loaded");
      ok("Module registry", `${registry.length} of ${MODULE_NAMES.length} modules loaded successfully`);
      if (registry.length < MODULE_NAMES.length) {
        meh(
          "Module registry",
          `${MODULE_NAMES.length - registry.length} module(s) failed — see stderr for the failed names`,
        );
      }
    } catch (e) {
      s6.fail("Module registry boot failed");
      bad("Module registry", `import error: ${e instanceof Error ? e.message : String(e)}`);
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
  if (!deepFlag) {
    console.log(
      `  ${DIM}Run \`npx airmcp doctor --deep\` for audit chain + Swift bridge + module registry probes.${RESET}`,
    );
  }
  console.log("");
}
