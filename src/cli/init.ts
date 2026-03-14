/**
 * `npx iconnect-mcp init` — interactive setup wizard.
 *
 * 1. Choose modules (toggle-style)
 * 2. Write ~/.config/iconnect/config.json
 * 3. Auto-detect and patch MCP client configs (Claude Desktop, Cursor, Windsurf, etc.)
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const ICONNECT_CONFIG_DIR = join(HOME, ".config", "iconnect");
const ICONNECT_CONFIG_PATH = join(ICONNECT_CONFIG_DIR, "config.json");

const MODULE_LABELS: Record<string, string> = {
  notes: "Notes",
  reminders: "Reminders",
  calendar: "Calendar",
  contacts: "Contacts",
  mail: "Mail",
  messages: "Messages",
  music: "Music",
  finder: "Finder",
  safari: "Safari",
  system: "System",
  photos: "Photos",
  shortcuts: "Shortcuts",
  intelligence: "Intelligence",
  tv: "TV",
  ui: "UI Automation",
  screen: "Screen Capture",
  maps: "Maps",
};

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function printModules(enabled: Set<string>): void {
  const cols = 3;
  const mods = [...MODULE_NAMES];
  const rows = Math.ceil(mods.length / cols);

  console.log("");
  for (let r = 0; r < rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r + c * rows;
      if (idx >= mods.length) break;
      const mod = mods[idx];
      const num = String(idx + 1).padStart(2, " ");
      const check = enabled.has(mod) ? "\x1b[32m✓\x1b[0m" : " ";
      const label = MODULE_LABELS[mod] ?? mod;
      parts.push(`  [${num}] ${check} ${label.padEnd(14)}`);
    }
    console.log(parts.join(""));
  }
  console.log("");
}

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("\x1b[1m\x1b[36m  iConnect Setup Wizard\x1b[0m");
  console.log("\x1b[2m  Connect your Mac to any AI via MCP\x1b[0m");
  console.log("");

  // --- Step 1: Module selection ---
  const enabled = new Set<string>(STARTER_MODULES);

  console.log("  Which modules would you like to enable?");
  console.log("  \x1b[2mToggle: type a number (e.g. \"6\")\x1b[0m");
  console.log("  \x1b[2mPresets: \"all\" = enable all, \"starter\" = core 5\x1b[0m");
  console.log("  \x1b[2mDone: press Enter with empty input\x1b[0m");

  printModules(enabled);

  for (;;) {
    const input = (await ask(rl, "  > ")).trim().toLowerCase();

    if (input === "") break;

    if (input === "all") {
      for (const m of MODULE_NAMES) enabled.add(m);
      printModules(enabled);
      continue;
    }
    if (input === "starter") {
      enabled.clear();
      for (const m of STARTER_MODULES) enabled.add(m);
      printModules(enabled);
      continue;
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= MODULE_NAMES.length) {
      const mod = MODULE_NAMES[num - 1];
      if (enabled.has(mod)) {
        enabled.delete(mod);
      } else {
        enabled.add(mod);
      }
      printModules(enabled);
      continue;
    }

    console.log(`  \x1b[33mType a number (1-${MODULE_NAMES.length}), "all", "starter", or Enter to continue.\x1b[0m`);
  }

  // --- Step 2: Write config.json ---
  const disabledModules = MODULE_NAMES.filter((m) => !enabled.has(m));

  console.log("");
  process.stdout.write("  Writing config...");

  mkdirSync(ICONNECT_CONFIG_DIR, { recursive: true });
  const configPayload = {
    disabledModules,
    includeShared: false,
    allowSendMessages: true,
    allowSendMail: true,
  };
  writeFileSync(ICONNECT_CONFIG_PATH, JSON.stringify(configPayload, null, 2) + "\n");
  console.log(` \x1b[32m✓\x1b[0m ${ICONNECT_CONFIG_PATH}`);

  // --- Step 3: Auto-detect and patch MCP client configs ---
  const iconnectEntry = {
    command: "npx",
    args: ["-y", NPM_PACKAGE_NAME],
  };

  let patchedClients = 0;
  const detectedClients: string[] = [];

  for (const client of MCP_CLIENTS) {
    const configExists = existsSync(client.configPath);
    const parentExists = existsSync(join(client.configPath, ".."));

    // Only patch if the config file or its parent directory already exists (client is installed)
    if (!configExists && !parentExists) continue;

    detectedClients.push(client.name);
    process.stdout.write(`  Configuring ${client.name}...`);

    try {
      let existing: Record<string, unknown> = {};
      if (configExists) {
        existing = JSON.parse(readFileSync(client.configPath, "utf-8"));
      }

      const servers = (existing[client.serversKey] as Record<string, unknown>) ?? {};
      servers.iconnect = iconnectEntry;
      existing[client.serversKey] = servers;

      mkdirSync(join(client.configPath, ".."), { recursive: true });
      writeFileSync(client.configPath, JSON.stringify(existing, null, 2) + "\n");
      console.log(" \x1b[32m✓\x1b[0m");
      patchedClients++;
    } catch (e) {
      console.log(` \x1b[33m⚠\x1b[0m ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (detectedClients.length === 0) {
    console.log("  \x1b[33m⚠\x1b[0m No MCP clients detected.");
    console.log("");
    console.log("  Add this to your MCP client config manually:");
    console.log(`  \x1b[2m${JSON.stringify({ mcpServers: { iconnect: iconnectEntry } }, null, 2)}\x1b[0m`);
  }

  // --- Done ---
  console.log("");
  console.log(`  \x1b[32m✓\x1b[0m Setup complete! ${enabled.size} modules enabled, ${patchedClients} client(s) configured.`);
  if (detectedClients.length > 0) {
    console.log(`  \x1b[2mRestart ${detectedClients.join(", ")} to connect iConnect.\x1b[0m`);
  }
  console.log("");

  rl.close();
}
