/**
 * `npx airmcp modules` — inspect and edit AirMCP's module-pack activation set.
 *
 * This is the user-facing seam before physical add-on packages exist: the
 * universal runtime still ships all built-ins, while config decides which
 * packs activate on this host.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "../shared/constants.js";
import {
  CORE_MODULE_PACK_NAME,
  MODULE_PACK_MANIFEST,
  getModulePackStatuses,
  resolveModulePackSelection,
  type ModulePackName,
} from "../shared/module-packs.js";
import { isPlainObject } from "../shared/validate.js";
import { BOLD, CYAN, DIM, GREEN, RESET, WHITE, YELLOW } from "./style.js";

type ModulesCommand = "list" | "doctor" | "enable" | "disable" | "help";

interface ParsedArgs {
  command: ModulesCommand;
  tokens: string[];
  json: boolean;
}

function readConfig(): Record<string, unknown> {
  if (!existsSync(PATHS.CONFIG)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  mkdirSync(dirname(PATHS.CONFIG), { recursive: true });
  writeFileSync(PATHS.CONFIG, JSON.stringify(config, null, 2) + "\n");
}

function parseArgs(argv = process.argv.slice(3)): ParsedArgs {
  let command: ModulesCommand = "list";
  const tokens: string[] = [];
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h" || arg === "help") {
      command = "help";
    } else if (["list", "doctor", "enable", "disable"].includes(arg)) {
      command = arg as ModulesCommand;
    } else {
      tokens.push(
        ...arg
          .split(",")
          .map((token) => token.trim())
          .filter(Boolean),
      );
    }
  }

  return { command, tokens, json };
}

function currentPackSet(config: Record<string, unknown>): Set<ModulePackName> {
  const raw = process.env.AIRMCP_MODULE_PACKS ?? (config.modulePacks as string | string[] | undefined);
  return resolveModulePackSelection(raw).packs;
}

function packNamesFor(tokens: string[]): Set<ModulePackName> {
  const raw = tokens.length ? tokens : ["all"];
  const selection = resolveModulePackSelection(raw);
  if (selection.unknown.length) {
    throw new Error(`Unknown module add-ons: ${selection.unknown.join(", ")}`);
  }
  return selection.packs;
}

function statusPayload(config: Record<string, unknown>) {
  const configured = process.env.AIRMCP_MODULE_PACKS !== undefined || config.modulePacks !== undefined;
  const packs = getModulePackStatuses(currentPackSet(config));
  return {
    configPath: PATHS.CONFIG,
    configured,
    active: packs.filter((pack) => pack.available).map((pack) => pack.name),
    packs,
  };
}

function printList(payload: ReturnType<typeof statusPayload>): void {
  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP module add-ons${RESET}`);
  console.log(`  ${DIM}Config: ${payload.configPath}${RESET}`);
  console.log("");
  for (const pack of payload.packs) {
    const state = pack.available ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`;
    const required = pack.required ? ` ${DIM}(required)${RESET}` : "";
    console.log(`  ${state.padEnd(18)} ${CYAN}${pack.name}${RESET}${required}`);
    console.log(`    ${DIM}${pack.packageName} · ${pack.modules.join(", ")}${RESET}`);
  }
  console.log("");
}

function printDoctor(payload: ReturnType<typeof statusPayload>): void {
  printList(payload);
  console.log(`  ${BOLD}Physical split readiness${RESET}`);
  console.log(
    `    ${GREEN}ok${RESET} runtime contract: AIRMCP_MODULE_PACKS/config.json can activate selected packs today`,
  );
  console.log(`    ${GREEN}ok${RESET} package names: future add-ons omit pack-* naming`);
  console.log(
    `    ${YELLOW}wait${RESET} package split: current npm package still ships every built-in module until signed app/bridge distribution is ready`,
  );
  console.log("");
}

function printHelp(): void {
  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP modules${RESET} ${DIM}Inspect or edit module add-on activation${RESET}`);
  console.log("");
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules list --json${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules enable productivity,communications${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules disable media${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules doctor${RESET}`);
  console.log("");
}

function sortedPackList(packs: ReadonlySet<ModulePackName>): ModulePackName[] {
  return MODULE_PACK_MANIFEST.map((pack) => pack.name).filter((name) => packs.has(name));
}

export async function runModules(): Promise<void> {
  const args = parseArgs();
  if (args.command === "help") {
    printHelp();
    return;
  }

  const config = readConfig();
  if ((args.command === "enable" || args.command === "disable") && process.env.AIRMCP_MODULE_PACKS !== undefined) {
    console.error("AIRMCP_MODULE_PACKS is set; unset it before editing config.json with `airmcp modules`.");
    process.exitCode = 1;
    return;
  }

  if (args.command === "enable") {
    try {
      const next =
        config.modulePacks === undefined ? new Set<ModulePackName>([CORE_MODULE_PACK_NAME]) : currentPackSet(config);
      for (const pack of packNamesFor(args.tokens)) next.add(pack);
      next.add(CORE_MODULE_PACK_NAME);
      config.modulePacks = sortedPackList(next);
      writeConfig(config);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  } else if (args.command === "disable") {
    try {
      const next = currentPackSet(config);
      for (const pack of packNamesFor(args.tokens)) {
        if (pack !== CORE_MODULE_PACK_NAME) next.delete(pack);
      }
      next.add(CORE_MODULE_PACK_NAME);
      config.modulePacks = sortedPackList(next);
      writeConfig(config);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }

  const payload = statusPayload(config);
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (args.command === "doctor") {
    printDoctor(payload);
  } else {
    printList(payload);
  }
}
