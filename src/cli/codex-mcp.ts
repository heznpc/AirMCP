import { execFileSync } from "node:child_process";
import { NPM_PACKAGE_SPECIFIER } from "../shared/config.js";
import { IDENTITY } from "../shared/constants.js";
import { ensureAppRuntimeToken } from "../shared/app-runtime-token.js";

export const CODEX_APP_OWNED_URL = `http://127.0.0.1:${IDENTITY.HTTP_PORT}/mcp`;
export type CodexAirmcpRuntimeShape = "app-owned" | "direct" | "unknown" | "missing";

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

export function codexAirmcpRuntimeShape(): CodexAirmcpRuntimeShape {
  const config = getCodexAirmcpConfig();
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

export function configureCodexAirmcp(): "already-configured" | "configured" {
  const token = ensureAppRuntimeToken();
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
