/**
 * `npx iconnect-mcp doctor` — diagnose iConnect installation.
 *
 * Checks: Node version, config files, MCP client configs,
 * module status, and optionally probes macOS permissions.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { MODULE_NAMES, STARTER_MODULES, NPM_PACKAGE_NAME } from "../shared/config.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

interface McpClient {
  name: string;
  configPath: string;
  serversKey: string;
}

const MCP_CLIENTS: McpClient[] = [
  {
    name: "Claude Desktop",
    configPath: join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    serversKey: "mcpServers",
  },
  {
    name: "Cursor",
    configPath: join(HOME, ".cursor", "mcp.json"),
    serversKey: "mcpServers",
  },
  {
    name: "Windsurf",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    serversKey: "mcpServers",
  },
];
const ICONNECT_CONFIG_PATH = join(HOME, ".config", "iconnect", "config.json");

const OK = "\x1b[32m✓\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

interface FileConfig {
  disabledModules?: string[];
  includeShared?: boolean;
  allowSendMessages?: boolean;
  allowSendMail?: boolean;
}

function check(label: string, status: string, detail: string): void {
  console.log(`  ${status} ${label.padEnd(22)} ${detail}`);
}

export async function runDoctor(): Promise<void> {
  console.log("");
  console.log("\x1b[1m\x1b[36m  iConnect Doctor\x1b[0m");
  console.log("");

  // 1. Node version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1), 10);
  check("Node.js", major >= 18 ? OK : FAIL, `${nodeVer} ${major >= 18 ? "(>= 18 required)" : "— upgrade required (>= 18)"}`);

  // 2. macOS check
  const platform = process.platform;
  check("Platform", platform === "darwin" ? OK : FAIL, platform === "darwin" ? "macOS" : `${platform} — iConnect requires macOS`);

  // 3. Config file
  let fileConfig: FileConfig | null = null;
  if (existsSync(ICONNECT_CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(readFileSync(ICONNECT_CONFIG_PATH, "utf-8")) as FileConfig;
      check("Config file", OK, ICONNECT_CONFIG_PATH);
    } catch {
      check("Config file", WARN, `${ICONNECT_CONFIG_PATH} (parse error)`);
    }
  } else {
    check("Config file", WARN, "Not found — using starter preset (5 modules)");
  }

  // 4. MCP client configs
  let anyClientFound = false;
  for (const client of MCP_CLIENTS) {
    if (existsSync(client.configPath)) {
      anyClientFound = true;
      try {
        const raw = JSON.parse(readFileSync(client.configPath, "utf-8"));
        const servers = raw?.[client.serversKey] ?? {};
        if (servers.iconnect) {
          check(client.name, OK, "iconnect entry found");
        } else {
          check(client.name, WARN, `Config exists but no 'iconnect' entry — run: npx ${NPM_PACKAGE_NAME} init`);
        }
      } catch {
        check(client.name, WARN, `Config parse error: ${client.configPath}`);
      }
    }
  }
  if (!anyClientFound) {
    check("MCP Clients", WARN, `No client configs found — run: npx ${NPM_PACKAGE_NAME} init`);
  }

  // 5. Enabled modules
  const disabledSet = new Set(fileConfig?.disabledModules ?? []);
  const enabledMods = new Set<string>();
  const disabledMods = new Set<string>();

  for (const mod of MODULE_NAMES) {
    if (fileConfig) {
      // Explicit config
      if (disabledSet.has(mod)) {
        disabledMods.add(mod);
      } else {
        enabledMods.add(mod);
      }
    } else {
      // Starter preset
      if (STARTER_MODULES.has(mod)) {
        enabledMods.add(mod);
      } else {
        disabledMods.add(mod);
      }
    }
  }

  console.log("");
  console.log(`  \x1b[1mModules\x1b[0m (${enabledMods.size} enabled, ${disabledMods.size} disabled)`);
  for (const mod of MODULE_NAMES) {
    const on = enabledMods.has(mod);
    console.log(`    ${on ? OK : "\x1b[2m-\x1b[0m"} ${mod}${on ? "" : " \x1b[2m(disabled)\x1b[0m"}`);
  }

  // 6. Permission probe (macOS only, skip if not darwin)
  if (platform === "darwin") {
    console.log("");
    console.log("  \x1b[1mPermissions\x1b[0m");

    const APP_MAP: Record<string, string> = {
      notes: "Notes",
      reminders: "Reminders",
      calendar: "Calendar",
      contacts: "Contacts",
      mail: "Mail",
      messages: "Messages",
      music: "Music",
      finder: "Finder",
      safari: "Safari",
      system: "System Events",
      photos: "Photos",
      tv: "TV",
    };

    for (const mod of enabledMods) {
      const appName = APP_MAP[mod];
      if (!appName) continue;

      try {
        execSync(
          `osascript -l JavaScript -e "Application('${appName}'); JSON.stringify({ok:true})"`,
          { timeout: 5000, stdio: "pipe" },
        );
        check(`  ${appName}`, OK, "Accessible");
      } catch {
        check(`  ${appName}`, WARN, "Not accessible — grant permission in System Settings > Privacy");
      }
    }
  }

  // 7. Swift bridge
  const swiftBridgePath = join(process.cwd(), "swift", ".build", "release", "iconnect-bridge");
  if (existsSync(swiftBridgePath)) {
    check("Swift bridge", OK, "Built");
  } else {
    check("Swift bridge", WARN, "Not built — run: npm run swift-build (optional, for EventKit/PhotoKit/Intelligence)");
  }

  console.log("");
}
