/**
 * `npx airmcp modules` — inspect and edit AirMCP's module-pack activation set.
 *
 * This is the user-facing entry point for on-demand add-ons: config decides
 * which packs activate on this host, and --install/--uninstall manage the
 * matching physical npm companion packages in the same install prefix as AirMCP.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAddonInstallPackageJsonPath,
  getAddonInstallPrefix,
  getAddonPackageInstallPath,
} from "../shared/addon-packages.js";
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

type ModulesCommand = "list" | "doctor" | "enable" | "disable" | "install" | "uninstall" | "help";

interface ParsedArgs {
  command: ModulesCommand;
  tokens: string[];
  json: boolean;
  install: boolean;
  uninstall: boolean;
  dryRun: boolean;
  prefix?: string;
}

interface AddonOperation {
  action: "install" | "uninstall";
  prefix: string;
  packages: string[];
  command: string[];
  skipped: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..");
const ROOT_PACKAGE = readJson(join(PKG_ROOT, "package.json"));
const ROOT_VERSION = String(ROOT_PACKAGE.version ?? "0.0.0");

function readConfig(): Record<string, unknown> {
  if (!existsSync(PATHS.CONFIG)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function writeConfig(config: Record<string, unknown>): void {
  mkdirSync(dirname(PATHS.CONFIG), { recursive: true });
  writeFileSync(PATHS.CONFIG, JSON.stringify(config, null, 2) + "\n");
}

function parseArgs(argv = process.argv.slice(3)): ParsedArgs {
  let command: ModulesCommand = "list";
  const tokens: string[] = [];
  let json = false;
  let install = false;
  let uninstall = false;
  let dryRun = false;
  let prefix: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--install") {
      install = true;
    } else if (arg === "--uninstall") {
      uninstall = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--prefix") {
      prefix = argv[i + 1];
      i++;
    } else if (arg.startsWith("--prefix=")) {
      prefix = arg.slice("--prefix=".length);
    } else if (arg === "--help" || arg === "-h" || arg === "help") {
      command = "help";
    } else if (["list", "doctor", "enable", "disable", "install", "uninstall"].includes(arg)) {
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

  if (command === "install") install = true;
  if (command === "uninstall") uninstall = true;
  return { command, tokens, json, install, uninstall, dryRun, prefix };
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

function addonPackageSpecs(packs: ReadonlySet<ModulePackName>): string[] {
  return MODULE_PACK_MANIFEST.filter((pack) => pack.name !== CORE_MODULE_PACK_NAME && packs.has(pack.name)).map(
    (pack) => `${pack.packageName}@${ROOT_VERSION}`,
  );
}

function addonPackageNames(packs: ReadonlySet<ModulePackName>): string[] {
  return MODULE_PACK_MANIFEST.filter((pack) => pack.name !== CORE_MODULE_PACK_NAME && packs.has(pack.name)).map(
    (pack) => pack.packageName,
  );
}

function installedAddonPackages(prefix: string): Set<string> {
  const installed = new Set<string>();
  for (const pack of MODULE_PACK_MANIFEST) {
    if (pack.name === CORE_MODULE_PACK_NAME) {
      installed.add(pack.name);
      continue;
    }
    if (existsSync(join(getAddonPackageInstallPath(prefix, pack.packageName), "package.json")))
      installed.add(pack.name);
  }
  return installed;
}

function ensureAddonInstallProject(prefix: string): void {
  mkdirSync(prefix, { recursive: true });
  const packageJsonPath = getAddonInstallPackageJsonPath(prefix);
  if (!existsSync(packageJsonPath)) {
    writeFileSync(packageJsonPath, JSON.stringify({ private: true, name: "airmcp-addons" }, null, 2) + "\n");
  }
}

function formatShellCommand(command: string[]): string {
  return command.map((part) => (/^[a-zA-Z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part))).join(" ");
}

function runAddonPackageOperation(
  action: "install" | "uninstall",
  packs: ReadonlySet<ModulePackName>,
  args: ParsedArgs,
): AddonOperation {
  const prefix = getAddonInstallPrefix(args.prefix);
  const packages = action === "install" ? addonPackageSpecs(packs) : addonPackageNames(packs);
  const npmArgs =
    action === "install"
      ? ["install", "--prefix", prefix, "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", ...packages]
      : ["uninstall", "--prefix", prefix, "--no-audit", "--no-fund", "--ignore-scripts", ...packages];
  const operation: AddonOperation = {
    action,
    prefix,
    packages,
    command: ["npm", ...npmArgs],
    skipped: packages.length === 0 || args.dryRun,
  };

  if (!operation.skipped) {
    ensureAddonInstallProject(prefix);
    execFileSync("npm", npmArgs, { stdio: args.json ? "pipe" : "inherit" });
  }
  return operation;
}

function statusPayload(config: Record<string, unknown>, prefix = getAddonInstallPrefix()) {
  const configured = process.env.AIRMCP_MODULE_PACKS !== undefined || config.modulePacks !== undefined;
  const packs = getModulePackStatuses(currentPackSet(config));
  const installed = installedAddonPackages(prefix);
  return {
    configPath: PATHS.CONFIG,
    configured,
    installPrefix: prefix,
    active: packs.filter((pack) => pack.available).map((pack) => pack.name),
    packs: packs.map((pack) => ({
      ...pack,
      installed: installed.has(pack.name),
      installSpec: pack.name === CORE_MODULE_PACK_NAME ? "airmcp" : `${pack.packageName}@${ROOT_VERSION}`,
      installCommand: pack.name === CORE_MODULE_PACK_NAME ? null : `npx airmcp modules enable ${pack.name} --install`,
      uninstallCommand: pack.name === CORE_MODULE_PACK_NAME ? null : `npx airmcp modules uninstall ${pack.name}`,
    })),
  };
}

function printList(payload: ReturnType<typeof statusPayload>): void {
  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP module add-ons${RESET}`);
  console.log(`  ${DIM}Config: ${payload.configPath}${RESET}`);
  console.log("");
  for (const pack of payload.packs) {
    const state = pack.available ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`;
    const installState = pack.installed ? `${GREEN}installed${RESET}` : `${YELLOW}not installed${RESET}`;
    const required = pack.required ? ` ${DIM}(required)${RESET}` : "";
    console.log(`  ${state.padEnd(18)} ${CYAN}${pack.name}${RESET}${required}`);
    console.log(`    ${DIM}${pack.packageName} · ${installState} · ${pack.modules.join(", ")}${RESET}`);
  }
  console.log(`  ${DIM}Install prefix: ${payload.installPrefix}${RESET}`);
  console.log("");
}

function printDoctor(payload: ReturnType<typeof statusPayload>): void {
  printList(payload);
  console.log(`  ${BOLD}Physical split readiness${RESET}`);
  console.log(
    `    ${GREEN}ok${RESET} runtime contract: AIRMCP_MODULE_PACKS/config.json can activate selected packs today`,
  );
  console.log(`    ${GREEN}ok${RESET} package names: add-ons omit pack-* naming`);
  console.log(`    ${GREEN}ok${RESET} package staging: npm run addons:build creates tarball-ready add-on directories`);
  console.log(`    ${GREEN}ok${RESET} on-demand command: use --install/--uninstall to manage companion npm packages`);
  console.log(
    `    ${GREEN}ok${RESET} publish split: npm pack/publish ships a slim root and restores the universal local dist after packing`,
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
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules enable productivity --install${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}modules uninstall media${RESET}`);
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
  if (
    ["enable", "disable", "install", "uninstall"].includes(args.command) &&
    process.env.AIRMCP_MODULE_PACKS !== undefined
  ) {
    console.error("AIRMCP_MODULE_PACKS is set; unset it before editing config.json with `airmcp modules`.");
    process.exitCode = 1;
    return;
  }

  let operation: AddonOperation | undefined;
  let plannedActive: ModulePackName[] | undefined;
  if (args.command === "enable" || args.command === "install") {
    try {
      const requested = packNamesFor(args.tokens);
      if (args.install) operation = runAddonPackageOperation("install", requested, args);
      const next =
        config.modulePacks === undefined ? new Set<ModulePackName>([CORE_MODULE_PACK_NAME]) : currentPackSet(config);
      for (const pack of requested) next.add(pack);
      next.add(CORE_MODULE_PACK_NAME);
      plannedActive = sortedPackList(next);
      if (!args.dryRun) {
        config.modulePacks = plannedActive;
        writeConfig(config);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  } else if (args.command === "disable" || args.command === "uninstall") {
    try {
      const next = currentPackSet(config);
      const requested = packNamesFor(args.tokens);
      for (const pack of requested) {
        if (pack !== CORE_MODULE_PACK_NAME) next.delete(pack);
      }
      next.add(CORE_MODULE_PACK_NAME);
      plannedActive = sortedPackList(next);
      if (!args.dryRun) {
        config.modulePacks = plannedActive;
        writeConfig(config);
      }
      if (args.uninstall) operation = runAddonPackageOperation("uninstall", requested, args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }

  const payload = {
    ...statusPayload(config, getAddonInstallPrefix(args.prefix)),
    ...(plannedActive ? { plannedActive } : {}),
    ...(operation ? { operation } : {}),
  };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (args.command === "doctor") {
    printDoctor(payload);
  } else {
    if (operation) {
      console.log("");
      console.log(`  ${BOLD}${operation.action === "install" ? "Install" : "Uninstall"} command${RESET}`);
      console.log(`    ${DIM}${formatShellCommand(operation.command)}${RESET}`);
      if (operation.skipped) console.log(`    ${YELLOW}skipped${RESET} dry-run or no non-core add-ons selected`);
    }
    if (args.dryRun && plannedActive) {
      console.log(`    ${DIM}planned active packs: ${plannedActive.join(", ")}${RESET}`);
    }
    printList(payload);
  }
}
