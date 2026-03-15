/**
 * `npx airmcp init` — interactive setup wizard.
 *
 * 1. Choose modules (toggle-style with presets + recommendations)
 * 2. Write ~/.config/airmcp/config.json
 * 3. Auto-detect and patch MCP client configs (Claude Desktop, Cursor, Windsurf, etc.)
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MODULE_NAMES, STARTER_MODULES, NPM_PACKAGE_NAME } from "../shared/config.js";
import { LOGO_LINES, typeLine, sleep, writeOut } from "../shared/banner.js";

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
    name: "Claude Code",
    configPath: join(HOME, ".claude", "mcp.json"),
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

const AIRMCP_CONFIG_DIR = join(HOME, ".config", "airmcp");
const AIRMCP_CONFIG_PATH = join(AIRMCP_CONFIG_DIR, "config.json");

// ── Module metadata ──────────────────────────────────────────────────

interface ModuleMeta {
  label: string;
  desc: string;
  category: "productivity" | "media" | "system" | "advanced" | "cloud";
}

const MODULE_META: Record<string, ModuleMeta> = {
  notes:        { label: "Notes",            desc: "Apple Notes CRUD",            category: "productivity" },
  reminders:    { label: "Reminders",        desc: "Tasks, due dates, lists",     category: "productivity" },
  calendar:     { label: "Calendar",         desc: "Events, schedules",           category: "productivity" },
  contacts:     { label: "Contacts",         desc: "People, email, phone",        category: "productivity" },
  mail:         { label: "Mail",             desc: "Read, send, manage email",    category: "productivity" },
  messages:     { label: "Messages",         desc: "iMessage/SMS",                category: "productivity" },
  music:        { label: "Music",            desc: "Playback, playlists",         category: "media" },
  finder:       { label: "Finder",           desc: "Files, search, organize",     category: "system" },
  safari:       { label: "Safari",           desc: "Tabs, bookmarks, pages",      category: "system" },
  system:       { label: "System",           desc: "Volume, brightness, apps",    category: "system" },
  photos:       { label: "Photos",           desc: "Albums, search, import",      category: "media" },
  shortcuts:    { label: "Shortcuts",        desc: "Run Siri Shortcuts",          category: "system" },
  intelligence: { label: "Intelligence",     desc: "Apple AI (macOS 26+)",        category: "advanced" },
  tv:           { label: "TV",               desc: "Apple TV playback",           category: "media" },
  ui:           { label: "UI Automation",    desc: "Accessibility, click, type",  category: "advanced" },
  screen:       { label: "Screen Capture",   desc: "Screenshot, recording",       category: "system" },
  maps:         { label: "Maps",             desc: "Location, directions",        category: "system" },
  podcasts:     { label: "Podcasts",         desc: "Shows, playback",             category: "media" },
  weather:      { label: "Weather",          desc: "Forecast, conditions",        category: "system" },
  pages:        { label: "Pages",            desc: "Documents",                   category: "productivity" },
  numbers:      { label: "Numbers",          desc: "Spreadsheets",                category: "productivity" },
  keynote:      { label: "Keynote",          desc: "Presentations",               category: "productivity" },
  location:     { label: "Location",         desc: "GPS coordinates",             category: "system" },
  bluetooth:    { label: "Bluetooth",        desc: "BLE scan, connect",           category: "advanced" },
  google:       { label: "Google Workspace", desc: "Gmail, Drive, Sheets, Cal",   category: "cloud" },
};

const PRESETS: Record<string, { desc: string; modules: string[] }> = {
  starter: {
    desc: "Core essentials (7 modules) — Notes, Calendar, Reminders, System, Shortcuts, Finder, Weather",
    modules: [...STARTER_MODULES],
  },
  productivity: {
    desc: "All productivity apps (10 modules)",
    modules: ["notes", "reminders", "calendar", "contacts", "mail", "messages", "pages", "numbers", "keynote", "shortcuts"],
  },
  all: {
    desc: "Everything (25 modules)",
    modules: [...MODULE_NAMES],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const WHITE = "\x1b[97m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

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
      const check = enabled.has(mod) ? `${GREEN}✓${RESET}` : " ";
      const meta = MODULE_META[mod];
      const label = meta?.label ?? mod;
      const star = STARTER_MODULES.has(mod) ? `${DIM}★${RESET}` : " ";
      parts.push(`  [${num}] ${check}${star}${label.padEnd(17)}`);
    }
    console.log(parts.join(""));
  }
  console.log("");
}

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Animated logo
  writeOut("\n");
  for (const line of LOGO_LINES) {
    await typeLine(line, 3, "stdout");
  }
  writeOut("\n");
  await typeLine(`  ${BOLD}${WHITE}AirMCP Setup Wizard${RESET}`, 10, "stdout");
  await typeLine(`  ${DIM}Connect your Mac to any AI via MCP${RESET}`, 5, "stdout");
  writeOut("\n");
  await sleep(200);

  // --- Step 1: Module selection ---
  const enabled = new Set<string>(STARTER_MODULES);

  console.log(`  ${BOLD}Which modules would you like to enable?${RESET}`);
  console.log("");
  console.log(`  ${DIM}Commands:${RESET}`);
  console.log(`    ${BOLD}number${RESET}  ${DIM}Toggle a module (e.g. "6" to toggle Messages)${RESET}`);
  console.log(`    ${BOLD}all${RESET}     ${DIM}Enable all 25 modules${RESET}`);
  console.log(`    ${BOLD}starter${RESET} ${DIM}Reset to recommended 7 modules ★${RESET}`);
  console.log(`    ${BOLD}prod${RESET}    ${DIM}Enable all productivity modules${RESET}`);
  console.log(`    ${BOLD}Enter${RESET}   ${DIM}Done — save and continue${RESET}`);
  console.log("");
  console.log(`  ${DIM}★ = recommended for new users${RESET}`);

  printModules(enabled);

  for (;;) {
    const input = (await ask(rl, `  ${WHITE}>${RESET} ${DIM}(number / all / starter / prod / Enter to save)${RESET} `)).trim().toLowerCase();

    if (input === "") break;

    if (input === "all") {
      for (const m of MODULE_NAMES) enabled.add(m);
      console.log(`  ${GREEN}✓${RESET} All modules enabled`);
      printModules(enabled);
      continue;
    }
    if (input === "starter") {
      enabled.clear();
      for (const m of STARTER_MODULES) enabled.add(m);
      console.log(`  ${GREEN}✓${RESET} Reset to starter preset (7 modules)`);
      printModules(enabled);
      continue;
    }
    if (input === "prod" || input === "productivity") {
      for (const m of PRESETS.productivity.modules) enabled.add(m);
      console.log(`  ${GREEN}✓${RESET} Productivity modules enabled`);
      printModules(enabled);
      continue;
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= MODULE_NAMES.length) {
      const mod = MODULE_NAMES[num - 1];
      const meta = MODULE_META[mod];
      if (enabled.has(mod)) {
        enabled.delete(mod);
        console.log(`  ${YELLOW}−${RESET} ${meta?.label ?? mod} disabled`);
      } else {
        enabled.add(mod);
        console.log(`  ${GREEN}+${RESET} ${meta?.label ?? mod} enabled ${DIM}(${meta?.desc})${RESET}`);
      }
      printModules(enabled);
      continue;
    }

    console.log(`  ${YELLOW}?${RESET} Type a number (1-${MODULE_NAMES.length}), "all", "starter", "prod", or ${BOLD}Enter${RESET} to continue.`);
  }

  // --- Step 2: Write config.json ---
  const disabledModules = MODULE_NAMES.filter((m) => !enabled.has(m));

  console.log("");
  process.stdout.write("  Writing config...");

  mkdirSync(AIRMCP_CONFIG_DIR, { recursive: true });
  const configPayload = {
    disabledModules,
    includeShared: false,
    allowSendMessages: true,
    allowSendMail: true,
  };
  writeFileSync(AIRMCP_CONFIG_PATH, JSON.stringify(configPayload, null, 2) + "\n");
  console.log(` ${GREEN}✓${RESET} ${AIRMCP_CONFIG_PATH}`);

  // --- Step 3: Auto-detect and patch MCP client configs ---
  const airmcpEntry = {
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
      servers.airmcp = airmcpEntry;
      existing[client.serversKey] = servers;

      mkdirSync(join(client.configPath, ".."), { recursive: true });
      writeFileSync(client.configPath, JSON.stringify(existing, null, 2) + "\n");
      console.log(` ${GREEN}✓${RESET}`);
      patchedClients++;
    } catch (e) {
      console.log(` ${YELLOW}⚠${RESET} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (detectedClients.length === 0) {
    console.log(`  ${YELLOW}⚠${RESET} No MCP clients detected.`);
    console.log("");
    console.log("  Add this to your MCP client config manually:");
    console.log(`  ${DIM}${JSON.stringify({ mcpServers: { airmcp: airmcpEntry } }, null, 2)}${RESET}`);
  }

  // --- Done ---
  console.log("");
  console.log(`  ${GREEN}✓${RESET} Setup complete! ${BOLD}${enabled.size} modules${RESET} enabled, ${patchedClients} client(s) configured.`);
  if (detectedClients.length > 0) {
    console.log(`  ${DIM}Restart ${detectedClients.join(", ")} to connect AirMCP.${RESET}`);
  }
  console.log("");
  console.log(`  ${DIM}Next steps:${RESET}`);
  console.log(`    ${DIM}•${RESET} Run ${BOLD}npx airmcp doctor${RESET} to check everything is working`);
  console.log(`    ${DIM}•${RESET} Re-run ${BOLD}npx airmcp init${RESET} anytime to change modules`);
  console.log(`    ${DIM}•${RESET} Use ${BOLD}npx airmcp --full${RESET} to enable all modules temporarily`);
  console.log("");

  rl.close();
}
