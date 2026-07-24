#!/usr/bin/env node
/**
 * Verify the built MCPB as an installed, self-contained universal artifact.
 *
 * Structural manifest tests are necessary but insufficient: this extracts the
 * exact archive users install, boots its embedded server in full/full mode,
 * and proves representative modules from every major pack registered without
 * reaching back into the repository or optional add-on packages.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBootEnv } from "./lib/clean-boot-env.mjs";
import {
  expectNoWireError,
  MCP_PROTOCOL_VERSION,
  parseStructuredResult,
  startMcp,
} from "./lib/mcp-stdio-client.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const pathArg = process.argv.find((arg) => arg.startsWith("--path="));
const artifact = resolve(
  ROOT,
  pathArg ? pathArg.slice("--path=".length) : join("build", "mcpb", `airmcp-${pkg.version}.mcpb`),
);
const TIMEOUT_MS = Number(process.env.MCPB_VERIFY_TIMEOUT_MS ?? 45_000);
const MIN_FULL_TOOLS = 290;

const REQUIRED_FILES = [
  "server/dist/index.js",
  "server/dist/notes/tools.js",
  "server/dist/mail/tools.js",
  "server/dist/safari/tools.js",
  "server/dist/photos/tools.js",
  "server/dist/numbers/tools.js",
  "server/dist/google/tools.js",
  "server/dist/bluetooth/tools.js",
  "server/dist/memory/tools.js",
];

const REQUIRED_MODULES = [
  "notes",
  "contacts",
  "mail",
  "safari",
  "photos",
  "numbers",
  "google",
  "bluetooth",
  "memory",
];

const REQUIRED_TOOLS = [
  "list_notes",
  "list_contacts",
  "send_mail",
  "list_tabs",
  "list_photos",
  "numbers_set_cell",
  "gws_sheets_read",
  "get_bluetooth_state",
  "memory_query",
];

function fail(message, detail = "") {
  console.error(`[mcpb-verify] FAIL — ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

if (!existsSync(artifact)) fail(`artifact not found: ${artifact}`);

const work = mkdtempSync(join(tmpdir(), "airmcp-mcpb-verify-"));
let client;
try {
  const unzip = spawnSync("unzip", ["-q", artifact, "-d", work], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (unzip.status !== 0) fail("archive extraction failed", unzip.stderr || unzip.stdout);

  const missingFiles = REQUIRED_FILES.filter((path) => !existsSync(join(work, path)));
  if (missingFiles.length) fail(`universal archive is missing: ${missingFiles.join(", ")}`);
  if (!existsSync(join(work, "server", "node_modules"))) {
    fail("archive is missing bundled production dependencies");
  }

  const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8"));
  if (manifest.version !== pkg.version) {
    fail(`manifest version mismatch: expected ${pkg.version}, got ${manifest.version}`);
  }

  const entry = join(work, "server", "dist", "index.js");
  const env = {
    ...cleanBootEnv(),
    AIRMCP_PROFILE: "full",
    AIRMCP_TOOL_EXPOSURE: "full",
    AIRMCP_MODULE_PACKS: "all",
    AIRMCP_ADDON_PACKAGE_MODE: "bundled",
    AIRMCP_FAKE_OS_VERSION: "0",
    AIRMCP_SEMANTIC_SEARCH: "false",
    AIRMCP_AUDIT_LOG: "false",
    AIRMCP_USAGE_TRACKING: "false",
    AIRMCP_PROACTIVE_CONTEXT: "false",
  };

  client = startMcp({ entry, cwd: join(work, "server"), env, timeoutMs: TIMEOUT_MS });
  const initResp = await client.request(
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "airmcp-mcpb-artifact-verify", version: "0.0.0" },
    },
    1,
  );
  if (!initResp.result) throw new Error(`initialize failed: ${JSON.stringify(initResp)}`);
  client.notify("notifications/initialized");

  const listResp = await client.request("tools/list", {}, 2);
  const tools = listResp.result?.tools;
  if (!Array.isArray(tools)) throw new Error(`tools/list malformed: ${JSON.stringify(listResp)}`);
  if (tools.length < MIN_FULL_TOOLS) {
    throw new Error(`full/full exposed only ${tools.length} tools (floor ${MIN_FULL_TOOLS})`);
  }

  const toolNames = new Set(tools.map((tool) => tool.name));
  const missingTools = REQUIRED_TOOLS.filter((name) => !toolNames.has(name));
  if (missingTools.length) throw new Error(`full/full is missing representative tools: ${missingTools.join(", ")}`);

  const statusResp = await client.request("tools/call", { name: "profile_status", arguments: {} }, 3);
  expectNoWireError(statusResp, "profile_status");
  const status = parseStructuredResult(statusResp);
  if (!status) throw new Error(`profile_status was not parseable: ${JSON.stringify(statusResp)}`);
  const enabled = new Set(status.modulesEnabled ?? []);
  const missingModules = REQUIRED_MODULES.filter((name) => !enabled.has(name));
  if (missingModules.length) throw new Error(`full/full is missing modules: ${missingModules.join(", ")}`);

  const stderr = client.stderr();
  if (/ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/.test(stderr)) {
    throw new Error(`bundle emitted a missing-module error:\n${stderr.slice(-4000)}`);
  }

  console.log(
    `ok: MCPB v${pkg.version} boots self-contained full/full (${tools.length} tools, ${enabled.size} modules)`,
  );
} catch (error) {
  console.error(`[mcpb-verify] FAIL — ${error instanceof Error ? error.message : String(error)}`);
  const stderr = client?.stderr?.().slice(-4000) ?? "";
  if (stderr) console.error(stderr);
  process.exitCode = 1;
} finally {
  if (client) await client.stop();
  rmSync(work, { recursive: true, force: true });
}
