import type { ModuleRegistration } from "./registry.js";
import type { ModuleManifestEntry } from "./modules.js";
import { pathToFileURL } from "node:url";
import { resolveAddonPackageImport } from "./addon-packages.js";
import { getModuleAddonImportSpec, getModulePackNameForModule, getModulePackPackageName } from "./module-packs.js";
import { log, errToCtx } from "./logger.js";

type AddonPackageMode = "prefer-installed" | "bundled" | "external-only";

const missingAddonPackageModules = new Set<string>();

function getAddonPackageMode(): AddonPackageMode {
  const raw = (process.env.AIRMCP_ADDON_PACKAGE_MODE ?? "bundled").trim().toLowerCase();
  if (raw === "bundled" || raw === "external-only" || raw === "prefer-installed") return raw;
  return "bundled";
}

export function isOptionalAddonPackageMiss(error: unknown, expectedPackageName: string | null): boolean {
  if (!expectedPackageName) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== undefined && code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  const message = error instanceof Error ? error.message : String(error);
  const missingPackage = /Cannot find package ['"]([^'"]+)['"]/.exec(message)?.[1];
  if (missingPackage) return missingPackage === expectedPackageName;
  const missingModule = /Cannot find module ['"]([^'"]+)['"]/.exec(message)?.[1];
  return missingModule === expectedPackageName || missingModule?.startsWith(`${expectedPackageName}/`) === true;
}

export function clearMissingAddonPackageModules(): void {
  missingAddonPackageModules.clear();
}

export function getMissingAddonPackageModules(): string[] {
  return [...missingAddonPackageModules].sort();
}

function rememberMissingAddonPackageModule(moduleName: string): void {
  missingAddonPackageModules.add(moduleName);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRegisterFn(mod: Record<string, any>): ((...args: any[]) => any) | undefined {
  // Prefer registerXxxTools over registerDynamicXxx (dynamic tools are registered separately).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fallback: ((...args: any[]) => any) | undefined;
  for (const [key, val] of Object.entries(mod)) {
    if (typeof val === "function" && key.startsWith("register")) {
      if (key.includes("Dynamic")) {
        fallback = fallback ?? val;
        continue;
      }
      return val;
    }
  }
  return fallback;
}

async function importModuleFile(
  def: ModuleManifestEntry,
  kind: "tools" | "prompts",
  mode: AddonPackageMode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  const externalSpec = getModuleAddonImportSpec(def.name, kind);
  const packName = getModulePackNameForModule(def.name);
  const externalPackageName = packName ? getModulePackPackageName(packName) : null;
  let externalPackageMissing = false;

  if (externalSpec && mode !== "bundled") {
    try {
      return (await import(externalSpec)) as Record<string, unknown>;
    } catch (error) {
      const resolvedFromPrefix = resolveAddonPackageImport(externalSpec);
      if (resolvedFromPrefix) {
        try {
          return (await import(pathToFileURL(resolvedFromPrefix).href)) as Record<string, unknown>;
        } catch (prefixError) {
          if (mode === "external-only") {
            log.error("required add-on package module failed to load", {
              module: def.name,
              kind,
              spec: externalSpec,
              resolved: resolvedFromPrefix,
              err: errToCtx(prefixError),
            });
            return null;
          }
          log.warn("installed add-on package failed from configured prefix; falling back to bundled module", {
            module: def.name,
            kind,
            spec: externalSpec,
            resolved: resolvedFromPrefix,
            err: errToCtx(prefixError),
          });
        }
      }
      if (mode === "external-only") {
        if (isOptionalAddonPackageMiss(error, externalPackageName)) rememberMissingAddonPackageModule(def.name);
        log.error("required add-on package module failed to load", {
          module: def.name,
          kind,
          spec: externalSpec,
          err: errToCtx(error),
        });
        return null;
      }
      if (!isOptionalAddonPackageMiss(error, externalPackageName)) {
        log.warn("installed add-on package failed; falling back to bundled module", {
          module: def.name,
          kind,
          spec: externalSpec,
          err: errToCtx(error),
        });
      } else {
        externalPackageMissing = true;
      }
    }
  }

  try {
    return (await import(`../${def.name}/${kind}.js`)) as Record<string, unknown>;
  } catch (error) {
    if (externalSpec && externalPackageMissing) rememberMissingAddonPackageModule(def.name);
    throw error;
  }
}

/** Import a single module definition, returning null on failure. */
export async function importModuleRegistration(def: ModuleManifestEntry): Promise<ModuleRegistration | null> {
  const mode = getAddonPackageMode();
  try {
    const toolsMod = await importModuleFile(def, "tools", mode);
    if (!toolsMod) return null;
    const toolsFn = findRegisterFn(toolsMod);
    if (!toolsFn) {
      log.warn("no register function found in tools.ts", { module: def.name });
      return null;
    }

    let promptsFn: ModuleRegistration["prompts"] | undefined;
    if (def.hasPrompts) {
      const promptsMod = await importModuleFile(def, "prompts", mode);
      promptsFn = promptsMod ? findRegisterFn(promptsMod) : undefined;
    }

    return {
      name: def.name,
      tools: toolsFn,
      prompts: promptsFn,
      minMacosVersion: def.minMacosVersion,
      compatibility: def.compatibility,
      pack: getModulePackNameForModule(def.name) ?? undefined,
    } as ModuleRegistration;
  } catch (error) {
    log.error("failed to load module", { module: def.name, err: errToCtx(error) });
    return null;
  }
}
