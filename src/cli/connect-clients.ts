import {
  codexDirectManualSetupCommand,
  codexManualSetupCommand,
  directStdioEntry,
  stdioProxyEntry,
} from "./codex-mcp.js";
import { configureMcpClients, type ClientConfigResult, type ClientRuntimeMode } from "./client-config.js";
import { BOLD, DIM, GREEN, RED, RESET, SYM, WHITE, YELLOW } from "./style.js";

interface ConnectClientsOptions {
  dryRun: boolean;
  json: boolean;
  runtimeMode: ClientRuntimeMode;
}

function usage(): string {
  return [
    "Usage: npx airmcp connect-clients [--dry-run] [--json] [--client-runtime app|direct]",
    "",
    "Configure installed MCP clients to use the selected AirMCP runtime.",
    "Default: token-gated AirMCP.app runtime. Use --client-runtime direct for direct stdio entries.",
  ].join("\n");
}

function normalizeClientRuntimeMode(raw: string | undefined): ClientRuntimeMode | null {
  const value = raw?.trim().toLowerCase();
  if (value === "app" || value === "app-owned" || value === "airmcp-app") return "app";
  if (value === "direct" || value === "stdio" || value === "direct-stdio") return "direct";
  return null;
}

function parseArgs(args: string[]): ConnectClientsOptions {
  const options: ConnectClientsOptions = { dryRun: false, json: false, runtimeMode: "app" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
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
    if (arg === "--client-runtime") {
      const runtimeMode = normalizeClientRuntimeMode(args[i + 1]);
      if (!runtimeMode) throw new Error(`Invalid --client-runtime value: ${args[i + 1] ?? ""}`);
      options.runtimeMode = runtimeMode;
      i++;
      continue;
    }
    if (arg.startsWith("--client-runtime=")) {
      const runtimeMode = normalizeClientRuntimeMode(arg.slice("--client-runtime=".length));
      if (!runtimeMode) throw new Error(`Invalid --client-runtime value: ${arg.slice("--client-runtime=".length)}`);
      options.runtimeMode = runtimeMode;
      continue;
    }
    if (arg === "--direct-stdio") {
      options.runtimeMode = "direct";
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
    const results = configureMcpClients({
      dryRun: options.dryRun,
      includeSkipped: false,
      runtimeMode: options.runtimeMode,
    });

    if (options.json) {
      console.log(JSON.stringify({ dryRun: options.dryRun, clientRuntime: options.runtimeMode, results }, null, 2));
    } else {
      const runtimeLabel = options.runtimeMode === "direct" ? "direct stdio runtime" : "token-gated AirMCP.app runtime";
      console.log("");
      console.log(`  ${BOLD}${WHITE}AirMCP Client Connection Repair${RESET}`);
      console.log(`  ${DIM}${options.dryRun ? "Previewing" : "Configuring"} clients for the ${runtimeLabel}.${RESET}`);
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
          `  ${DIM}${JSON.stringify(
            {
              mcpServers: {
                airmcp: options.runtimeMode === "direct" ? directStdioEntry() : stdioProxyEntry("<token>"),
              },
            },
            null,
            2,
          )}${RESET}`,
        );
        console.log("");
        console.log(`  ${DIM}Codex CLI:${RESET}`);
        console.log(
          `  ${DIM}${options.runtimeMode === "direct" ? codexDirectManualSetupCommand() : codexManualSetupCommand()}${RESET}`,
        );
      } else if (options.dryRun) {
        console.log("");
        console.log(
          `  ${DIM}Run ${BOLD}npx airmcp connect-clients${
            options.runtimeMode === "direct" ? " --client-runtime direct" : ""
          }${RESET}${DIM} to apply these changes.${RESET}`,
        );
      } else {
        console.log("");
        if (options.runtimeMode === "direct") {
          console.log(`  ${GREEN}✓${RESET} Restart configured MCP clients.`);
        } else {
          console.log(`  ${GREEN}✓${RESET} Start AirMCP.app, then restart configured MCP clients.`);
        }
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
