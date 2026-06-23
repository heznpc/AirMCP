import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NPM_PACKAGE_SPECIFIER } from "../shared/config.js";
import { HOME, IDENTITY } from "../shared/constants.js";
import { ensureAppRuntimeToken } from "../shared/app-runtime-token.js";

export const CODEX_APP_OWNED_URL = `http://127.0.0.1:${IDENTITY.HTTP_PORT}/mcp`;
export type CodexAirmcpRuntimeShape = "app-owned" | "app-owned-pending-restart" | "direct" | "unknown" | "missing";
type CodexConfigFileRuntimeShape = "app-owned" | "direct" | "unknown";
const CODEX_CONFIG_PATH = process.env.AIRMCP_CODEX_CONFIG_PATH || join(HOME, ".codex", "config.toml");

function runCodex(args: string[]): string {
  return execFileSync("codex", args, {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function isCodexCliAvailable(): boolean {
  try {
    runCodex(["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function getCodexAirmcpConfig(): string | null {
  try {
    return runCodex(["mcp", "get", "airmcp"]);
  } catch {
    return null;
  }
}

export function isCodexAirmcpConfigured(): boolean {
  return getCodexAirmcpConfig() !== null;
}

function codexCliRuntimeShape(config: string | null): Exclude<CodexAirmcpRuntimeShape, "app-owned-pending-restart"> {
  if (!config) return "missing";
  if (
    config.includes(CODEX_APP_OWNED_URL) &&
    config.includes("transport: stdio") &&
    config.includes("AIRMCP_HTTP_TOKEN")
  ) {
    return "app-owned";
  }
  if (config.includes("transport: stdio") || config.includes("command: npx")) {
    return "direct";
  }
  return "unknown";
}

function sectionBody(toml: string, header: string): string {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Extract the AIRMCP_HTTP_TOKEN value from a Codex `[mcp_servers.airmcp]`
 *  block, covering BOTH the standalone `[mcp_servers.airmcp.env]` subsection
 *  form and the inline-table `env = { AIRMCP_HTTP_TOKEN = "..." }` form.
 *  Returns the literal token string, or null when absent. */
function extractCodexHttpToken(serverBody: string, envBody: string): string | null {
  // Standalone subsection: AIRMCP_HTTP_TOKEN = "value"
  const subsection = envBody.match(/AIRMCP_HTTP_TOKEN\s*=\s*"([^"]*)"/);
  if (subsection) return subsection[1] ?? null;
  // Inline table on the server block: env = { ..., AIRMCP_HTTP_TOKEN = "value", ... }
  const inline = serverBody.match(/AIRMCP_HTTP_TOKEN\s*=\s*"([^"]*)"/);
  if (inline) return inline[1] ?? null;
  return null;
}

/**
 * Classify a Codex `config.toml`. When `liveToken` is provided, an app-owned
 * proxy entry is only reported as `"app-owned"` if its stored token VALUE
 * matches the live runtime token — a stale/wrong token falls through to
 * `"unknown"` so the runtime repairs it. When `liveToken` is omitted the
 * function is a pure structural parse (token presence only).
 */
export function codexConfigTomlRuntimeShape(toml: string, liveToken?: string): CodexConfigFileRuntimeShape {
  const server = sectionBody(toml, "[mcp_servers.airmcp]");
  if (!server) return "unknown";
  const env = sectionBody(toml, "[mcp_servers.airmcp.env]");
  const configToken = extractCodexHttpToken(server, env);
  const hasToken = configToken !== null;
  if (server.includes(CODEX_APP_OWNED_URL) && server.includes('"connect"') && hasToken) {
    // Repair gate: a stale/wrong token must not pass as app-owned.
    if (liveToken !== undefined && configToken !== liveToken) return "unknown";
    return "app-owned";
  }
  if (/command\s*=\s*"npx"/.test(server) && /airmcp(@|")/.test(server)) return "direct";
  return "unknown";
}

function codexConfigFileRuntimeShape(): CodexConfigFileRuntimeShape {
  try {
    if (!existsSync(CODEX_CONFIG_PATH)) return "unknown";
    // Pass the live runtime token so a config carrying a stale/wrong token
    // is not classified app-owned — it falls through and gets repaired.
    return codexConfigTomlRuntimeShape(readFileSync(CODEX_CONFIG_PATH, "utf8"), ensureAppRuntimeToken());
  } catch {
    return "unknown";
  }
}

export function codexAirmcpRuntimeShape(): CodexAirmcpRuntimeShape {
  const cliShape = codexCliRuntimeShape(getCodexAirmcpConfig());
  if (cliShape === "app-owned") return "app-owned";

  const fileShape = codexConfigFileRuntimeShape();
  if (fileShape === "app-owned") return "app-owned-pending-restart";
  return cliShape;
}

export function configureCodexAirmcp(): "already-configured" | "configured" {
  const token = ensureAppRuntimeToken();
  const shape = codexAirmcpRuntimeShape();
  if (shape === "app-owned" || shape === "app-owned-pending-restart") {
    return "already-configured";
  }
  if (isCodexAirmcpConfigured()) {
    runCodex(["mcp", "remove", "airmcp"]);
  }
  runCodex([
    "mcp",
    "add",
    "--env",
    `AIRMCP_HTTP_TOKEN=${token}`,
    "airmcp",
    "--",
    "npx",
    "-y",
    NPM_PACKAGE_SPECIFIER,
    "connect",
    "--url",
    CODEX_APP_OWNED_URL,
  ]);
  return "configured";
}

export function codexManualSetupCommand(): string {
  return (
    "codex mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y " +
    NPM_PACKAGE_SPECIFIER +
    " connect --url " +
    CODEX_APP_OWNED_URL
  );
}

export function stdioProxyEntry(token = ensureAppRuntimeToken()): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: "npx",
    args: ["-y", NPM_PACKAGE_SPECIFIER, "connect", "--url", CODEX_APP_OWNED_URL],
    env: {
      AIRMCP_HTTP_TOKEN: token,
    },
  };
}
