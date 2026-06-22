import { codexManualSetupCommand, stdioProxyEntry } from "./codex-mcp.js";
import { configureMcpClients, type ClientConfigResult } from "./client-config.js";
import { BOLD, DIM, GREEN, RED, RESET, SYM, WHITE, YELLOW } from "./style.js";

interface ConnectClientsOptions {
  dryRun: boolean;
  json: boolean;
}

function usage(): string {
  return [
    "Usage: npx airmcp connect-clients [--dry-run] [--json]",
    "",
    "Configure installed MCP clients to use the token-gated AirMCP.app runtime.",
    "This repairs stale direct stdio configs without rerunning the interactive setup wizard.",
  ].join("\n");
}

function parseArgs(args: string[]): ConnectClientsOptions {
  const options: ConnectClientsOptions = { dryRun: false, json: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown connect-clients option: ${arg}`);
  }
  return options;
}

function iconFor(status: ClientConfigResult["status"]): string {
  if (status === "failed") return `${RED}✗${RESET}`;
  if (status === "skipped") return `${DIM}·${RESET}`;
  if (status === "would-configure") return `${YELLOW}◆${RESET}`;
  return SYM.ok;
}

function labelFor(status: ClientConfigResult["status"]): string {
  if (status === "would-configure") return "would configure";
  if (status === "already-configured") return "already configured";
  return status;
}

export function runConnectClients(args = process.argv.slice(3)): void {
  try {
    const options = parseArgs(args);
    const results = configureMcpClients({ dryRun: options.dryRun, includeSkipped: false });

    if (options.json) {
      console.log(JSON.stringify({ dryRun: options.dryRun, results }, null, 2));
    } else {
      console.log("");
      console.log(`  ${BOLD}${WHITE}AirMCP Client Connection Repair${RESET}`);
      console.log(
        `  ${DIM}${options.dryRun ? "Previewing" : "Configuring"} clients for the token-gated AirMCP.app runtime.${RESET}`,
      );
      console.log("");

      for (const result of results) {
        console.log(
          `  ${iconFor(result.status)} ${result.name.padEnd(16)} ${labelFor(result.status)} ${DIM}${result.detail}${RESET}`,
        );
      }

      if (results.length === 0) {
        console.log(`  ${YELLOW}⚠${RESET} No installed MCP client configs found.`);
        console.log("");
        console.log(`  ${DIM}Manual JSON entry:${RESET}`);
        console.log(
          `  ${DIM}${JSON.stringify({ mcpServers: { airmcp: stdioProxyEntry("<token>") } }, null, 2)}${RESET}`,
        );
        console.log("");
        console.log(`  ${DIM}Codex CLI:${RESET}`);
        console.log(`  ${DIM}${codexManualSetupCommand()}${RESET}`);
      } else if (options.dryRun) {
        console.log("");
        console.log(`  ${DIM}Run ${BOLD}npx airmcp connect-clients${RESET}${DIM} to apply these changes.${RESET}`);
      } else {
        console.log("");
        console.log(`  ${GREEN}✓${RESET} Start AirMCP.app, then restart configured MCP clients.`);
      }
      console.log("");
    }

    if (results.some((result) => result.status === "failed")) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[AirMCP] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
