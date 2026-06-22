import { execFileSync } from "node:child_process";
import { NPM_PACKAGE_NAME } from "../shared/config.js";
import { IDENTITY } from "../shared/constants.js";

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
  if (config.includes(CODEX_APP_OWNED_URL) || config.includes("transport: streamable-http")) {
    return "app-owned";
  }
  if (config.includes("transport: stdio") || config.includes("command: npx")) {
    return "direct";
  }
  return "unknown";
}

export function configureCodexAirmcp(): "already-configured" | "configured" {
  if (isCodexAirmcpConfigured()) {
    runCodex(["mcp", "remove", "airmcp"]);
  }
  runCodex(["mcp", "add", "airmcp", "--url", CODEX_APP_OWNED_URL]);
  return "configured";
}

export function codexManualSetupCommand(): string {
  return `codex mcp add airmcp --url ${CODEX_APP_OWNED_URL}`;
}

export function stdioProxyArgs(): string[] {
  return ["-y", NPM_PACKAGE_NAME, "connect", "--url", CODEX_APP_OWNED_URL];
}
