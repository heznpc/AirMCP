import { execFileSync } from "node:child_process";
import { NPM_PACKAGE_NAME } from "../shared/config.js";

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

export function isCodexAirmcpConfigured(): boolean {
  try {
    runCodex(["mcp", "get", "airmcp"]);
    return true;
  } catch {
    return false;
  }
}

export function configureCodexAirmcp(): "already-configured" | "configured" {
  if (isCodexAirmcpConfigured()) return "already-configured";
  runCodex(["mcp", "add", "airmcp", "--", "npx", "-y", NPM_PACKAGE_NAME]);
  return "configured";
}
