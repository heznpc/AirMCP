import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { McpClient } from "../shared/config.js";
import { MCP_CLIENTS } from "../shared/config.js";
import { isPlainObject } from "../shared/validate.js";
import {
  CODEX_APP_OWNED_URL,
  type CodexAirmcpRuntimeShape,
  configureCodexAirmcp,
  codexAirmcpRuntimeShape,
  isCodexCliAvailable,
  stdioProxyEntry,
} from "./codex-mcp.js";

export type ClientRuntimeShape = "app-owned" | "direct" | "unknown";
export type ClientConfigStatus = "configured" | "already-configured" | "would-configure" | "skipped" | "failed";

export interface ClientConfigResult {
  name: string;
  status: ClientConfigStatus;
  detail: string;
  configPath?: string;
}

export interface ClientConfigOptions {
  clients?: readonly McpClient[];
  dryRun?: boolean;
  includeSkipped?: boolean;
  token?: string;
  now?: () => number;
  configureCodex?: boolean;
  codex?: {
    isAvailable: () => boolean;
    shape: () => CodexAirmcpRuntimeShape;
    configure: () => "already-configured" | "configured";
  };
}

export function clientRuntimeShape(entry: unknown): ClientRuntimeShape {
  if (!entry || typeof entry !== "object") return "unknown";
  const record = entry as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command : "";
  const args = Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : [];
  const env = record.env && typeof record.env === "object" ? (record.env as Record<string, unknown>) : {};
  const hasToken = typeof env.AIRMCP_HTTP_TOKEN === "string" && env.AIRMCP_HTTP_TOKEN.length > 0;
  if (args.includes("connect") && args.includes(CODEX_APP_OWNED_URL) && hasToken) return "app-owned";
  if (args.includes("connect") && args.includes(CODEX_APP_OWNED_URL)) return "unknown";
  if (command === "npx" && args.some((arg) => arg === "airmcp" || arg.startsWith("airmcp@"))) return "direct";
  return "unknown";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function configureFileClient(
  client: McpClient,
  options: Required<Pick<ClientConfigOptions, "dryRun" | "now">> & {
    token?: string;
  },
): ClientConfigResult {
  const configExists = existsSync(client.configPath);
  const parentExists = existsSync(dirname(client.configPath));
  if (!configExists && !parentExists) {
    return {
      name: client.name,
      status: "skipped",
      detail: "client config directory not found",
      configPath: client.configPath,
    };
  }

  const targetEntry = stdioProxyEntry(options.dryRun ? "<app-runtime-token>" : options.token);

  try {
    let existing: Record<string, unknown> = {};
    if (configExists) {
      const parsed: unknown = JSON.parse(readFileSync(client.configPath, "utf-8"));
      if (!isPlainObject(parsed)) throw new Error("existing config is not a JSON object");
      existing = parsed;
    }

    const rawServers = existing[client.serversKey];
    const servers: Record<string, unknown> = isPlainObject(rawServers) ? rawServers : {};
    const currentEntry = servers.airmcp;
    if (!options.dryRun && deepEqual(currentEntry, targetEntry)) {
      return {
        name: client.name,
        status: "already-configured",
        detail: "token-gated AirMCP.app runtime",
        configPath: client.configPath,
      };
    }
    if (options.dryRun && clientRuntimeShape(currentEntry) === "app-owned") {
      return {
        name: client.name,
        status: "already-configured",
        detail: "token-gated AirMCP.app runtime",
        configPath: client.configPath,
      };
    }

    if (options.dryRun) {
      return {
        name: client.name,
        status: "would-configure",
        detail: configExists ? "would replace airmcp with the app-owned runtime proxy" : "would create config file",
        configPath: client.configPath,
      };
    }

    servers.airmcp = targetEntry;
    existing[client.serversKey] = servers;

    if (configExists) copyFileSync(client.configPath, `${client.configPath}.bak.${options.now()}`);
    mkdirSync(dirname(client.configPath), { recursive: true });
    writeFileSync(client.configPath, JSON.stringify(existing, null, 2) + "\n");

    return {
      name: client.name,
      status: "configured",
      detail: "token-gated AirMCP.app runtime",
      configPath: client.configPath,
    };
  } catch (error) {
    return {
      name: client.name,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
      configPath: client.configPath,
    };
  }
}

function configureCodexClient(
  options: Required<Pick<ClientConfigOptions, "dryRun">> & {
    codex: NonNullable<ClientConfigOptions["codex"]>;
  },
): ClientConfigResult {
  if (!options.codex.isAvailable()) {
    return { name: "Codex", status: "skipped", detail: "codex CLI not found" };
  }

  try {
    const shape = options.codex.shape();
    if (shape === "app-owned" || shape === "app-owned-pending-restart") {
      return { name: "Codex", status: "already-configured", detail: "AirMCP.app runtime" };
    }
    if (options.dryRun) {
      return {
        name: "Codex",
        status: "would-configure",
        detail: shape === "missing" ? "would add airmcp MCP server" : "would replace existing airmcp MCP server",
      };
    }
    options.codex.configure();
    return { name: "Codex", status: "configured", detail: "token-gated AirMCP.app runtime" };
  } catch (error) {
    return { name: "Codex", status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function configureMcpClients(options: ClientConfigOptions = {}): ClientConfigResult[] {
  const dryRun = options.dryRun ?? false;
  const includeSkipped = options.includeSkipped ?? true;
  const clients = options.clients ?? MCP_CLIENTS;
  const now = options.now ?? Date.now;
  const codex = options.codex ?? {
    isAvailable: isCodexCliAvailable,
    shape: codexAirmcpRuntimeShape,
    configure: configureCodexAirmcp,
  };

  const results = clients.map((client) => configureFileClient(client, { dryRun, now, token: options.token }));
  if (options.configureCodex ?? true) {
    results.push(configureCodexClient({ dryRun, codex }));
  }
  return includeSkipped ? results : results.filter((result) => result.status !== "skipped");
}
