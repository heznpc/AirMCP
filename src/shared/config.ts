import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { release } from "node:os";
import { HOME, PATHS } from "./constants.js";

/**
 * Return the macOS major version number.
 *
 * Darwin kernel versions map to macOS versions:
 *   Darwin 24.x → macOS 15 (Sequoia)
 *   Darwin 25.x → macOS 26 (Tahoe)
 *
 * Apple jumped from macOS 15 → 26, so the old `darwinMajor - 9` formula
 * no longer works for Darwin 25+.  We now use `sw_vers` as the primary
 * source and fall back to the Darwin formula for macOS ≤ 15.
 * Returns 0 on non-macOS platforms so version checks always pass.
 */
export function getOsVersion(): number {
  if (process.platform !== "darwin") return 0;
  try {
    const ver = execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const major = parseInt(ver.split(".")[0], 10);
    if (!isNaN(major)) return major;
  } catch { /* fall through to Darwin heuristic */ }
  const darwinMajor = parseInt(release().split(".")[0], 10);
  if (isNaN(darwinMajor)) return 0;
  // Darwin 25+ → macOS 26+ (version jump); Darwin 20-24 → macOS 11-15
  if (darwinMajor >= 25) return darwinMajor + 1;
  return darwinMajor - 9;
}

/** npm package name — single source of truth for npx/install references */
export const NPM_PACKAGE_NAME = "airmcp";

export type HitlLevel = "off" | "destructive-only" | "all-writes" | "all";

export interface HitlConfig {
  level: HitlLevel;
  whitelist: Set<string>;
  timeout: number;
  socketPath: string;
}

const HITL_LEVELS: readonly string[] = ["off", "destructive-only", "all-writes", "all"];

export const MODULE_NAMES = [
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "mail",
  "messages",
  "music",
  "finder",
  "safari",
  "system",
  "photos",
  "shortcuts",
  "intelligence",
  "tv",
  "ui",
  "screen",
  "maps",
  "podcasts",
  "weather",
  "pages",
  "numbers",
  "keynote",
  "location",
  "bluetooth",
  "google",
] as const;

/** Core modules enabled by default when no config.json exists */
export const STARTER_MODULES: ReadonlySet<string> = new Set([
  "notes",
  "reminders",
  "calendar",
  "shortcuts",
  "system",
  "finder",
  "weather",
]);

export type ModuleName = (typeof MODULE_NAMES)[number];

export interface McpClient {
  name: string;
  configPath: string;
  serversKey: string;
}

export const MCP_CLIENTS: McpClient[] = [
  { name: "Claude Desktop", configPath: join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"), serversKey: "mcpServers" },
  { name: "Claude Code", configPath: join(HOME, ".claude", "mcp.json"), serversKey: "mcpServers" },
  { name: "Cursor", configPath: join(HOME, ".cursor", "mcp.json"), serversKey: "mcpServers" },
  { name: "Windsurf", configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"), serversKey: "mcpServers" },
];

export interface AirMcpConfig {
  /** Include shared notes/folders in results. Default: false */
  includeShared: boolean;
  /** Set of disabled module names */
  disabledModules: Set<string>;
  /** Set of module names that require share approval */
  shareApprovalModules: Set<string>;
  /** Allow sending messages via Messages app. Default: true */
  allowSendMessages: boolean;
  /** Allow sending emails via Mail app. Default: true */
  allowSendMail: boolean;
  /** Human-in-the-loop confirmation config */
  hitl: HitlConfig;
}

interface FileConfig {
  includeShared?: boolean;
  allowSendMessages?: boolean;
  allowSendMail?: boolean;
  disabledModules?: string[];
  shareApproval?: string[];
  hitl?: { level?: string; whitelist?: string[]; timeout?: number };
}

interface LoadResult {
  config: FileConfig;
  /** true if config.json was found and parsed successfully */
  fileExists: boolean;
}

function loadFileConfig(): LoadResult {
  try {
    const data = readFileSync(PATHS.CONFIG, "utf-8");
    return { config: JSON.parse(data) as FileConfig, fileExists: true };
  } catch {
    return { config: {}, fileExists: false };
  }
}

/**
 * Read a boolean config value with env-var override.
 * Env var is checked with strict `=== "true"` (positive opt-in) for all booleans.
 *
 * NOTE: Prior to this refactor, allowSendMessages and allowSendMail used
 * `!== "false"` (any non-"false" value enabled the feature). This has been
 * unified to `=== "true"` for consistency and safety — these are
 * action-oriented settings (sending mail/messages), so explicit opt-in
 * is more predictable. To enable via env var, set the value to exactly "true".
 */
function envBool(envKey: string, fileValue: boolean | undefined, defaultValue: boolean): boolean {
  const env = process.env[envKey];
  if (env !== undefined) return env === "true";
  return fileValue ?? defaultValue;
}

export function parseConfig(): AirMcpConfig {
  const { config: file, fileExists } = loadFileConfig();
  const fullMode = process.env.AIRMCP_FULL === "true" || process.argv.includes("--full");

  // Disabled modules: env vars override, then JSON fallback, then starter preset
  const disabledModules = new Set<string>();
  const fileDisabled = new Set(file.disabledModules ?? []);
  for (const mod of MODULE_NAMES) {
    const envKey = `AIRMCP_DISABLE_${mod.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal === "true") {
      disabledModules.add(mod);
    } else if (envVal === undefined && !fullMode && fileDisabled.has(mod)) {
      disabledModules.add(mod);
    } else if (envVal === undefined && !fileExists && !fullMode && !STARTER_MODULES.has(mod)) {
      // No config.json & not --full: apply starter preset
      disabledModules.add(mod);
    }
  }

  // Share approval: env var overrides, then JSON fallback
  const shareApprovalModules = new Set<string>();
  const shareApprovalEnv = process.env.AIRMCP_SHARE_APPROVAL;
  if (shareApprovalEnv) {
    for (const raw of shareApprovalEnv.split(",")) {
      const mod = raw.trim().toLowerCase();
      if (mod && (MODULE_NAMES as readonly string[]).includes(mod)) {
        shareApprovalModules.add(mod);
      }
    }
  } else if (file.shareApproval) {
    for (const mod of file.shareApproval) {
      if ((MODULE_NAMES as readonly string[]).includes(mod)) {
        shareApprovalModules.add(mod);
      }
    }
  }

  // Boolean configs: env var > JSON > default
  const includeShared = envBool("AIRMCP_INCLUDE_SHARED", file.includeShared, false);
  const allowSendMessages = envBool("AIRMCP_ALLOW_SEND_MESSAGES", file.allowSendMessages, true);
  const allowSendMail = envBool("AIRMCP_ALLOW_SEND_MAIL", file.allowSendMail, true);

  // HITL config: env var > JSON > default
  const hitlLevelRaw = process.env.AIRMCP_HITL_LEVEL ?? file.hitl?.level ?? "off";
  const hitlLevel: HitlLevel = HITL_LEVELS.includes(hitlLevelRaw)
    ? (hitlLevelRaw as HitlLevel)
    : "off";
  const hitlWhitelist = new Set<string>(file.hitl?.whitelist ?? []);
  const hitlTimeout = file.hitl?.timeout ?? 30;
  const hitlSocketPath = PATHS.HITL_SOCKET;

  const hitl: HitlConfig = {
    level: hitlLevel,
    whitelist: hitlWhitelist,
    timeout: hitlTimeout,
    socketPath: hitlSocketPath,
  };

  return {
    includeShared,
    disabledModules,
    shareApprovalModules,
    allowSendMessages,
    allowSendMail,
    hitl,
  };
}

export function isModuleEnabled(config: AirMcpConfig, moduleName: string): boolean {
  return !config.disabledModules.has(moduleName);
}

export function needsShareApproval(config: AirMcpConfig, moduleName: string): boolean {
  return config.shareApprovalModules.has(moduleName);
}
