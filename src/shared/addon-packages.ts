import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ADDON_INSTALL_PREFIX_ENV = "AIRMCP_ADDON_INSTALL_PREFIX";

export function getDefaultAddonInstallPrefix(): string {
  return join(homedir(), ".airmcp", "addons");
}

export function getAddonInstallPrefix(explicitPrefix?: string): string {
  return resolve(explicitPrefix ?? process.env[ADDON_INSTALL_PREFIX_ENV] ?? getDefaultAddonInstallPrefix());
}

export function getAddonInstallPackageJsonPath(prefix = getAddonInstallPrefix()): string {
  return join(prefix, "package.json");
}

export function getAddonPackageInstallPath(prefix: string, packageName: string): string {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    return join(prefix, "node_modules", scope!, name!);
  }
  return join(prefix, "node_modules", packageName);
}

export function resolveAddonPackageImport(spec: string): string | null {
  const prefix = getAddonInstallPrefix();
  try {
    return createRequire(getAddonInstallPackageJsonPath(prefix)).resolve(spec);
  } catch {
    return null;
  }
}
