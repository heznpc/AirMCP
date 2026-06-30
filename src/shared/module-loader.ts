import type { ModuleRegistration } from "./registry.js";
import type { ModuleManifestEntry } from "./modules.js";
import { getModuleAddonImportSpec, getModulePackNameForModule } from "./module-packs.js";
import { log, errToCtx } from "./logger.js";

type AddonPackageMode = "prefer-installed" | "bundled" | "external-only";

function getAddonPackageMode(): AddonPackageMode {
  const raw = (process.env.AIRMCP_ADDON_PACKAGE_MODE ?? "prefer-installed").trim().toLowerCase();
  if (raw === "bundled" || raw === "external-only" || raw === "prefer-installed") return raw;
  return "prefer-installed";
}

function isOptionalPackageMiss(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find package '@heznpc/airmcp-");
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

  if (externalSpec && mode !== "bundled") {
    try {
      return (await import(externalSpec)) as Record<string, unknown>;
    } catch (error) {
      if (mode === "external-only") {
        log.error("required add-on package module failed to load", {
          module: def.name,
          kind,
          spec: externalSpec,
          err: errToCtx(error),
        });
        return null;
      }
      if (!isOptionalPackageMiss(error)) {
        log.warn("installed add-on package failed; falling back to bundled module", {
          module: def.name,
          kind,
          spec: externalSpec,
          err: errToCtx(error),
        });
      }
    }
  }

  return (await import(`../${def.name}/${kind}.js`)) as Record<string, unknown>;
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
