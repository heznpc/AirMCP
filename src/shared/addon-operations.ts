import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CORE_MODULE_PACK_NAME,
  MODULE_PACK_MANIFEST,
  type ModulePackName,
  type ModulePackStatus,
} from "./module-packs.js";
import { getAddonInstallPackageJsonPath, getAddonInstallPrefix, getAddonPackageInstallPath } from "./addon-packages.js";

export type AddonPackageAction = "install" | "uninstall";
export type AddonInstallStatus = "required" | "not-installed" | "installed" | "version-mismatch";

export interface AddonOperation {
  action: AddonPackageAction;
  prefix: string;
  packages: string[];
  command: string[];
  skipped: boolean;
}

export interface AddonPackageDiskInfo {
  installed: boolean;
  installedVersion: string | null;
  installedSizeBytes: number | null;
}

export interface AddonPackageInstallStatus extends AddonPackageDiskInfo {
  expectedVersion: string;
  installStatus: AddonInstallStatus;
  updateAvailable: boolean;
}

export interface ModulePackAddonStatus extends ModulePackStatus, AddonPackageInstallStatus {
  installSpec: string;
  installCommand: string | null;
  updateCommand: string | null;
  repairCommand: string | null;
  uninstallCommand: string | null;
}

export function addonPackageSpecs(packs: ReadonlySet<ModulePackName>, version: string): string[] {
  return MODULE_PACK_MANIFEST.filter((pack) => pack.name !== CORE_MODULE_PACK_NAME && packs.has(pack.name)).map(
    (pack) => `${pack.packageName}@${version}`,
  );
}

export function addonPackageNames(packs: ReadonlySet<ModulePackName>): string[] {
  return MODULE_PACK_MANIFEST.filter((pack) => pack.name !== CORE_MODULE_PACK_NAME && packs.has(pack.name)).map(
    (pack) => pack.packageName,
  );
}

export function ensureAddonInstallProject(prefix: string): void {
  mkdirSync(prefix, { recursive: true });
  const packageJsonPath = getAddonInstallPackageJsonPath(prefix);
  if (!existsSync(packageJsonPath)) {
    writeFileSync(packageJsonPath, JSON.stringify({ private: true, name: "airmcp-addons" }, null, 2) + "\n");
  }
}

export function directorySizeBytes(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += directorySizeBytes(join(path, entry));
  }
  return total;
}

export function readInstalledAddonPackage(prefix: string, packageName: string): AddonPackageDiskInfo {
  const installPath = getAddonPackageInstallPath(prefix, packageName);
  const packageJsonPath = join(installPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { installed: false, installedVersion: null, installedSizeBytes: null };
  }
  const installedVersion = (() => {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
      return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
      return null;
    }
  })();
  const installedSizeBytes = (() => {
    try {
      return directorySizeBytes(installPath);
    } catch {
      return null;
    }
  })();
  return { installed: true, installedVersion, installedSizeBytes };
}

export function getAddonInstallStatus(
  pack: Pick<ModulePackStatus, "name" | "packageName" | "required">,
  version: string,
  prefix = getAddonInstallPrefix(),
): AddonPackageInstallStatus {
  if (pack.name === CORE_MODULE_PACK_NAME || pack.required) {
    return {
      installed: true,
      installedVersion: version,
      expectedVersion: version,
      installedSizeBytes: null,
      installStatus: "required",
      updateAvailable: false,
    };
  }

  const disk = readInstalledAddonPackage(prefix, pack.packageName);
  const versionMatches = disk.installedVersion === version;
  const installStatus: AddonInstallStatus = !disk.installed
    ? "not-installed"
    : versionMatches
      ? "installed"
      : "version-mismatch";

  return {
    ...disk,
    expectedVersion: version,
    installStatus,
    updateAvailable: disk.installed && !versionMatches,
  };
}

export function withAddonInstallStatus(
  pack: ModulePackStatus,
  version: string,
  prefix = getAddonInstallPrefix(),
): ModulePackAddonStatus {
  const installStatus = getAddonInstallStatus(pack, version, prefix);
  const installSpec = pack.name === CORE_MODULE_PACK_NAME ? `airmcp@${version}` : `${pack.packageName}@${version}`;
  const installCommand =
    pack.name === CORE_MODULE_PACK_NAME ? null : `npx airmcp modules enable ${pack.name} --install`;
  const updateCommand = pack.name === CORE_MODULE_PACK_NAME ? null : installCommand;
  const repairCommand = pack.name === CORE_MODULE_PACK_NAME ? null : installCommand;
  const uninstallCommand = pack.name === CORE_MODULE_PACK_NAME ? null : `npx airmcp modules uninstall ${pack.name}`;
  return {
    ...pack,
    ...installStatus,
    installSpec,
    installCommand,
    updateCommand,
    repairCommand,
    uninstallCommand,
  };
}

export function createAddonPackageOperation(
  action: AddonPackageAction,
  packs: ReadonlySet<ModulePackName>,
  version: string,
  options: { prefix?: string; dryRun?: boolean } = {},
): AddonOperation {
  const prefix = getAddonInstallPrefix(options.prefix);
  const packages = action === "install" ? addonPackageSpecs(packs, version) : addonPackageNames(packs);
  const npmArgs =
    action === "install"
      ? ["install", "--prefix", prefix, "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", ...packages]
      : ["uninstall", "--prefix", prefix, "--no-audit", "--no-fund", "--ignore-scripts", ...packages];
  return {
    action,
    prefix,
    packages,
    command: ["npm", ...npmArgs],
    skipped: packages.length === 0 || options.dryRun === true,
  };
}

export function executeAddonPackageOperation(
  operation: AddonOperation,
  options: { inheritStdio?: boolean } = {},
): void {
  if (operation.skipped) return;
  ensureAddonInstallProject(operation.prefix);
  execFileSync("npm", operation.command.slice(1), { stdio: options.inheritStdio ? "inherit" : "pipe" });
}

export function formatShellCommand(command: string[]): string {
  return command.map((part) => (/^[a-zA-Z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part))).join(" ");
}

export function writeModulePackConfig(
  config: Record<string, unknown>,
  packs: readonly ModulePackName[],
  configPath: string,
): void {
  mkdirSync(dirname(configPath), { recursive: true });
  config.modulePacks = packs;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
