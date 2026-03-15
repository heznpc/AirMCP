/**
 * Startup banner — animated typewriter effect with color fill.
 * Outputs to stderr so it doesn't interfere with MCP stdio transport.
 */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";

const LOGO_LINES = [
  `${CYAN}     ___   _      ${MAGENTA}__  __  ___  ___${RESET}`,
  `${CYAN}    / _ | (_)____${MAGENTA}/  |/  |/ __\\/ _ \\${RESET}`,
  `${CYAN}   / __ |/ / __/${MAGENTA}/ /|_/ / /__/ ___/${RESET}`,
  `${CYAN}  /_/ |_/_/_/  ${MAGENTA}/_/  /_/\\___/_/${RESET}`,
];

export interface BannerInfo {
  version: string;
  transport: "stdio" | "http";
  port?: number;
  modulesEnabled: string[];
  modulesDisabled: string[];
  modulesOsBlocked: string[];
  toolCount: number;
  promptCount?: number;
  dynamicShortcuts: number;
  skillsBuiltin: number;
  skillsUser: number;
  hitlLevel: string;
  macosVersion: number;
  nodeVersion: string;
  sendMessages: boolean;
  sendMail: boolean;
}

// ── Animation helpers ────────────────────────────────────────────────

const write = (s: string) => process.stderr.write(s);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Write a line character-by-character with delay. */
async function typeLine(line: string, charDelay: number): Promise<void> {
  // Split into ANSI escape sequences and visible characters
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    if (part.startsWith("\x1b[")) {
      // ANSI escape — write immediately (no delay)
      write(part);
    } else {
      // Visible characters — type one by one
      for (const ch of part) {
        write(ch);
        if (ch !== " " && charDelay > 0) await sleep(charDelay);
      }
    }
  }
  write("\n");
}

/** Write a line that "fills in" from dim to bright. */
async function fillLine(label: string, value: string, delay: number): Promise<void> {
  write(`  ${DIM}├${RESET} ${label}: `);
  // Flash: dim → bold
  write(`${DIM}${value}${RESET}`);
  await sleep(delay);
  write(`\r  ${DIM}├${RESET} ${label}: ${BOLD}${value}${RESET}  \n`);
}

/** Animate modules appearing one by one. */
async function animateModules(modules: string[], perModuleDelay: number): Promise<void> {
  write(`  ${DIM}├${RESET} `);
  for (let i = 0; i < modules.length; i++) {
    if (i > 0) write(`${DIM}, ${RESET}`);
    write(`${GREEN}${modules[i]}${RESET}`);
    if (perModuleDelay > 0) await sleep(perModuleDelay);
  }
  write("\n");
}

// ── Main banner ──────────────────────────────────────────────────────

export async function printBanner(info: BannerInfo): Promise<void> {
  write("\n");

  // Logo — each line types in fast
  for (const line of LOGO_LINES) {
    await typeLine(line, 4);
  }

  write("\n");

  // Version line — types in
  await typeLine(`  ${DIM}:: AirMCP v${info.version} ::${RESET}                ${DIM}macOS ${info.macosVersion} / Node ${info.nodeVersion}${RESET}`, 6);

  write("\n");

  // Modules — appear one by one
  write(`  ${BOLD}Modules${RESET}  ${DIM}(${info.modulesEnabled.length} active)${RESET}\n`);
  await animateModules(info.modulesEnabled, 30);
  if (info.modulesDisabled.length > 0) {
    write(`  ${DIM}├ disabled: ${info.modulesDisabled.join(", ")}${RESET}\n`);
  }
  if (info.modulesOsBlocked.length > 0) {
    write(`  ${DIM}├ ${YELLOW}unavailable:${RESET} ${DIM}${info.modulesOsBlocked.join(", ")}${RESET}\n`);
  }

  write("\n");

  // Stats — fill in one by one
  write(`  ${BOLD}Stats${RESET}\n`);
  await fillLine("Tools", `${info.toolCount}${info.dynamicShortcuts > 0 ? ` (+${info.dynamicShortcuts} shortcuts)` : ""}`, 80);
  if (info.promptCount) {
    await fillLine("Prompts", String(info.promptCount), 60);
  }
  await fillLine("Skills", `${info.skillsBuiltin} built-in${info.skillsUser > 0 ? `, ${info.skillsUser} user` : ""}`, 60);
  const hitlVal = info.hitlLevel === "off" ? `${DIM}off${RESET}` : `${YELLOW}${info.hitlLevel}${RESET}`;
  write(`  ${DIM}├${RESET} HITL: ${hitlVal}\n`);

  write("\n");

  // Security
  write(`  ${BOLD}Security${RESET}\n`);
  write(`  ${DIM}├${RESET} Send Messages: ${info.sendMessages ? `${GREEN}on${RESET}` : `${DIM}off${RESET}`}\n`);
  write(`  ${DIM}├${RESET} Send Mail: ${info.sendMail ? `${GREEN}on${RESET}` : `${DIM}off${RESET}`}\n`);

  write("\n");

  // Transport — final line with a brief pause for dramatic effect
  await sleep(100);
  if (info.transport === "http") {
    await typeLine(`  ${GREEN}▶${RESET} Server running on ${BOLD}http://localhost:${info.port}/mcp${RESET}`, 8);
  } else {
    await typeLine(`  ${GREEN}▶${RESET} Server running on ${BOLD}stdio${RESET}`, 8);
  }

  write("\n");
}
