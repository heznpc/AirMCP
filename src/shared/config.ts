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
    const major = parseInt(ver.split(".")[0]!, 10);
    if (!isNaN(major)) return major;
  } catch {
    /* fall through to Darwin heuristic */
  }
  const darwinMajor = parseInt(release().split(".")[0]!, 10);
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
  "speech",
  "health",
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
  {
    name: "Claude Desktop",
    configPath: join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    serversKey: "mcpServers",
  },
  { name: "Claude Code", configPath: join(HOME, ".claude", "mcp.json"), serversKey: "mcpServers" },
  { name: "Cursor", configPath: join(HOME, ".cursor", "mcp.json"), serversKey: "mcpServers" },
  { name: "Windsurf", configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"), serversKey: "mcpServers" },
];

export interface FeaturesConfig {
  /** Enable audit log (~/.airmcp/audit.jsonl). Default: true */
  auditLog: boolean;
  /** Enable usage pattern tracking (~/.airmcp/profile.json). Default: true */
  usageTracking: boolean;
  /** Enable semantic tool search (requires embedding provider). Default: true */
  semanticToolSearch: boolean;
  /** Enable proactive context suggestions. Default: true */
  proactiveContext: boolean;
}

export interface AirMcpConfig {
  /** Include shared notes/folders in results. Default: false */
  includeShared: boolean;
  /** Set of disabled module names */
  disabledModules: Set<string>;
  /** Set of module names that require share approval */
  shareApprovalModules: Set<string>;
  /** Allow sending messages via Messages app. Default: false */
  allowSendMessages: boolean;
  /** Allow sending emails via Mail app. Default: false */
  allowSendMail: boolean;
  /** Allow running arbitrary JavaScript in Safari tabs. Default: false */
  allowRunJavascript: boolean;
  /** Human-in-the-loop confirmation config */
  hitl: HitlConfig;
  /** Feature toggles for intelligence layer */
  features: FeaturesConfig;
}

interface FileConfig {
  includeShared?: boolean;
  allowSendMessages?: boolean;
  allowSendMail?: boolean;
  allowRunJavascript?: boolean;
  disabledModules?: string[];
  shareApproval?: string[];
  hitl?: { level?: string; whitelist?: string[]; timeout?: number };
  /** Feature toggles — disable individual intelligence features */
  features?: {
    auditLog?: boolean;
    usageTracking?: boolean;
    semanticToolSearch?: boolean;
    proactiveContext?: boolean;
  };
  /** Performance tuning — all fields optional, env vars take precedence */
  performance?: {
    /** Embedding provider: "gemini" | "swift" | "hybrid" | "none" */
    embeddingProvider?: string;
    /** Max parallel JXA processes (default: 3) */
    jxaConcurrency?: number;
    /** Circuit breaker: failures before open (default: 3) */
    circuitBreakerThreshold?: number;
    /** Circuit breaker: open duration in ms (default: 60000) */
    circuitBreakerOpenMs?: number;
  };
}

interface LoadResult {
  config: FileConfig;
  /** true if config.json was found and parsed successfully */
  fileExists: boolean;
}

function loadFileConfig(): LoadResult {
  try {
    const data = readFileSync(PATHS.CONFIG, "utf-8");
    const raw: unknown = JSON.parse(data);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      console.error("[AirMCP] config.json must be a JSON object — using defaults");
      return { config: {}, fileExists: true };
    }
    const obj = raw as Record<string, unknown>;
    const config: FileConfig = {};
    if (typeof obj.includeShared === "boolean") config.includeShared = obj.includeShared;
    if (typeof obj.allowSendMessages === "boolean") config.allowSendMessages = obj.allowSendMessages;
    if (typeof obj.allowSendMail === "boolean") config.allowSendMail = obj.allowSendMail;
    if (typeof obj.allowRunJavascript === "boolean") config.allowRunJavascript = obj.allowRunJavascript;
    if (Array.isArray(obj.disabledModules)) {
      config.disabledModules = obj.disabledModules.filter((m): m is string => typeof m === "string");
    }
    if (Array.isArray(obj.shareApproval)) {
      config.shareApproval = obj.shareApproval.filter((m): m is string => typeof m === "string");
    }
    if (obj.hitl && typeof obj.hitl === "object" && !Array.isArray(obj.hitl)) {
      const h = obj.hitl as Record<string, unknown>;
      config.hitl = {
        level: typeof h.level === "string" ? h.level : undefined,
        whitelist: Array.isArray(h.whitelist)
          ? h.whitelist.filter((s): s is string => typeof s === "string")
          : undefined,
        timeout: typeof h.timeout === "number" ? h.timeout : undefined,
      };
    }
    if (obj.features && typeof obj.features === "object" && !Array.isArray(obj.features)) {
      const f = obj.features as Record<string, unknown>;
      config.features = {
        auditLog: typeof f.auditLog === "boolean" ? f.auditLog : undefined,
        usageTracking: typeof f.usageTracking === "boolean" ? f.usageTracking : undefined,
        semanticToolSearch: typeof f.semanticToolSearch === "boolean" ? f.semanticToolSearch : undefined,
        proactiveContext: typeof f.proactiveContext === "boolean" ? f.proactiveContext : undefined,
      };
    }
    if (obj.performance && typeof obj.performance === "object" && !Array.isArray(obj.performance)) {
      const p = obj.performance as Record<string, unknown>;
      config.performance = {
        embeddingProvider: typeof p.embeddingProvider === "string" ? p.embeddingProvider : undefined,
        jxaConcurrency: typeof p.jxaConcurrency === "number" ? p.jxaConcurrency : undefined,
        circuitBreakerThreshold: typeof p.circuitBreakerThreshold === "number" ? p.circuitBreakerThreshold : undefined,
        circuitBreakerOpenMs: typeof p.circuitBreakerOpenMs === "number" ? p.circuitBreakerOpenMs : undefined,
      };
    }
    return { config, fileExists: true };
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
  const allowSendMessages = envBool("AIRMCP_ALLOW_SEND_MESSAGES", file.allowSendMessages, false);
  const allowSendMail = envBool("AIRMCP_ALLOW_SEND_MAIL", file.allowSendMail, false);
  const allowRunJavascript = envBool("AIRMCP_ALLOW_RUN_JAVASCRIPT", file.allowRunJavascript, false);

  // Performance config: write to env vars so constants.ts picks them up.
  // KNOWN LIMITATION: constants.ts evaluates envInt() at import time (before
  // parseConfig runs), so JSON config values for jxaConcurrency / CB thresholds
  // only take effect if set as env vars BEFORE the process starts. The JSON
  // config path works for embeddingProvider (read lazily) but not for values
  // CONCURRENCY getters now read env vars lazily, so JSON config values work
  // for CB_THRESHOLD, CB_OPEN_MS, and JXA_SLOTS. Note: the Semaphore in
  // jxa.ts is still created once at import time with the initial JXA_SLOTS value.
  const perf = file.performance;
  if (perf) {
    if (perf.embeddingProvider && !process.env.AIRMCP_EMBEDDING_PROVIDER) {
      process.env.AIRMCP_EMBEDDING_PROVIDER = perf.embeddingProvider;
    }
    if (perf.jxaConcurrency && !process.env.AIRMCP_JXA_CONCURRENCY) {
      process.env.AIRMCP_JXA_CONCURRENCY = String(perf.jxaConcurrency);
    }
    if (perf.circuitBreakerThreshold !== undefined && !process.env.AIRMCP_CB_THRESHOLD) {
      process.env.AIRMCP_CB_THRESHOLD = String(perf.circuitBreakerThreshold);
    }
    if (perf.circuitBreakerOpenMs !== undefined && !process.env.AIRMCP_CB_OPEN_MS) {
      process.env.AIRMCP_CB_OPEN_MS = String(perf.circuitBreakerOpenMs);
    }
  }

  // HITL config: env var > JSON > default
  const hitlLevelRaw = process.env.AIRMCP_HITL_LEVEL ?? file.hitl?.level ?? "destructive-only";
  const hitlLevel: HitlLevel = HITL_LEVELS.includes(hitlLevelRaw) ? (hitlLevelRaw as HitlLevel) : "destructive-only";
  const hitlWhitelist = new Set<string>(file.hitl?.whitelist ?? []);
  const hitlTimeout = file.hitl?.timeout ?? 30;
  const hitlSocketPath = PATHS.HITL_SOCKET;

  const hitl: HitlConfig = {
    level: hitlLevel,
    whitelist: hitlWhitelist,
    timeout: hitlTimeout,
    socketPath: hitlSocketPath,
  };

  // Feature toggles: env var > JSON > default (all on by default)
  const features: FeaturesConfig = {
    auditLog: envBool("AIRMCP_AUDIT_LOG", file.features?.auditLog, true),
    usageTracking: envBool("AIRMCP_USAGE_TRACKING", file.features?.usageTracking, true),
    semanticToolSearch: envBool("AIRMCP_SEMANTIC_SEARCH", file.features?.semanticToolSearch, true),
    proactiveContext: envBool("AIRMCP_PROACTIVE_CONTEXT", file.features?.proactiveContext, true),
  };

  return {
    includeShared,
    disabledModules,
    shareApprovalModules,
    allowSendMessages,
    allowSendMail,
    allowRunJavascript,
    hitl,
    features,
  };
}

export function isModuleEnabled(config: AirMcpConfig, moduleName: string): boolean {
  return !config.disabledModules.has(moduleName);
}

export function needsShareApproval(config: AirMcpConfig, moduleName: string): boolean {
  return config.shareApprovalModules.has(moduleName);
}
