/**
 * Startup banner — animated typewriter effect with color fill.
 * Outputs to stderr so it doesn't interfere with MCP stdio transport.
 */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const WHITE = "\x1b[97m";  // bright white
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

export const LOGO_LINES = [
  `${WHITE}     ___   _      __  __  ___  ___${RESET}`,
  `${WHITE}    / _ | (_)____/  |/  |/ __\\/ _ \\${RESET}`,
  `${WHITE}   / __ |/ / __// /|_/ / /__/ ___/${RESET}`,
  `${WHITE}  /_/ |_/_/_/  /_/  /_/\\___/_/${RESET}`,
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

// ── Animation helpers (exported for reuse in CLI) ────────────────────

export const write = (s: string) => process.stderr.write(s);
export const writeOut = (s: string) => process.stdout.write(s);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Write a line character-by-character with delay. */
export async function typeLine(line: string, charDelay: number, target: "stderr" | "stdout" = "stderr"): Promise<void> {
  const w = target === "stdout" ? writeOut : write;
  // Split into ANSI escape sequences and visible characters
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    if (part.startsWith("\x1b[")) {
      w(part);
    } else {
      for (const ch of part) {
        w(ch);
        if (ch !== " " && charDelay > 0) await sleep(charDelay);
      }
    }
  }
  w("\n");
}

/** Write a stat line with a brief pause. */
async function fillLine(label: string, value: string, delay: number): Promise<void> {
  write(`  ${DIM}├${RESET} ${label}: ${WHITE}${value}${RESET}\n`);
  await sleep(delay);
}

/** Animate modules appearing one by one. */
async function animateModules(modules: string[], perModuleDelay: number): Promise<void> {
  write(`  ${DIM}├${RESET} `);
  for (let i = 0; i < modules.length; i++) {
    if (i > 0) write(`${DIM},${RESET} `);
    write(`${WHITE}${modules[i]}${RESET}`);
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
  write(`  ${DIM}├${RESET} Send Messages: ${info.sendMessages ? `${WHITE}on${RESET}` : `${DIM}off${RESET}`}\n`);
  write(`  ${DIM}├${RESET} Send Mail: ${info.sendMail ? `${WHITE}on${RESET}` : `${DIM}off${RESET}`}\n`);

  write("\n");

  // Transport — final line with a brief pause for dramatic effect
  await sleep(100);
  if (info.transport === "http") {
    await typeLine(`  ${WHITE}▶${RESET} Server running on ${BOLD}http://localhost:${info.port}/mcp${RESET}`, 8);
  } else {
    await typeLine(`  ${WHITE}▶${RESET} Server running on ${BOLD}stdio${RESET}`, 8);
  }

  write("\n");
}
