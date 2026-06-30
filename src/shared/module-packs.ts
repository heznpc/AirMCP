/**
 * Module-pack manifest.
 *
 * Packs are AirMCP's DLC-like install/activation boundary. The current npm
 * package still ships every module, but this manifest is the runtime contract
 * that lets operators activate only selected packs and lets staged add-on
 * packages prove their boundaries before bundled fallback can be removed.
 */

export const CORE_MODULE_PACK_NAME = "core";

export const MODULE_PACK_MANIFEST = [
  {
    name: "core",
    packageName: "airmcp",
    title: "Core Workspace",
    description:
      "Base local workspace pack: notes, reminders, calendar, shortcuts, system, Finder, weather, and audit visibility.",
    modules: ["notes", "reminders", "calendar", "shortcuts", "system", "finder", "weather", "audit"],
    required: true,
  },
  {
    name: "communications",
    packageName: "@heznpc/airmcp-communications",
    title: "Communications",
    description:
      "Contacts, Mail, and Messages modules. Send actions still require their existing explicit safety opt-ins.",
    modules: ["contacts", "mail", "messages"],
  },
  {
    name: "productivity",
    packageName: "@heznpc/airmcp-productivity",
    title: "Productivity",
    description: "Apple iWork modules for Pages, Numbers, and Keynote.",
    modules: ["pages", "numbers", "keynote"],
  },
  {
    name: "browser",
    packageName: "@heznpc/airmcp-browser",
    title: "Browser",
    description: "Safari tabs, page capture, bookmarks, and reading-list automation.",
    modules: ["safari"],
  },
  {
    name: "media",
    packageName: "@heznpc/airmcp-media",
    title: "Media",
    description: "Music, TV, Podcasts, and speech automation surfaces.",
    modules: ["music", "tv", "podcasts", "speech"],
  },
  {
    name: "visual",
    packageName: "@heznpc/airmcp-visual",
    title: "Visual",
    description: "Photos, screen capture, and UI automation modules.",
    modules: ["photos", "screen", "ui"],
  },
  {
    name: "location",
    packageName: "@heznpc/airmcp-location",
    title: "Location",
    description: "Maps and current-location modules. Weather stays in core because starter workflows use it.",
    modules: ["maps", "location"],
  },
  {
    name: "device",
    packageName: "@heznpc/airmcp-device",
    title: "Device",
    description: "Bluetooth and HealthKit-oriented device modules.",
    modules: ["bluetooth", "health"],
  },
  {
    name: "intelligence",
    packageName: "@heznpc/airmcp-intelligence",
    title: "Intelligence",
    description:
      "Apple Intelligence and local memory modules. Embedding search remains separately gated by feature flags.",
    modules: ["intelligence", "memory"],
  },
  {
    name: "google-workspace",
    packageName: "@heznpc/airmcp-google",
    title: "Google Workspace",
    description: "Google Workspace integration modules.",
    modules: ["google"],
  },
  {
    name: "spatial",
    packageName: "@heznpc/airmcp-spatial",
    title: "Spatial",
    description: "Experimental spatial asset/context preparation modules.",
    modules: ["spatial_prep"],
  },
] as const;

export type ModulePackName = (typeof MODULE_PACK_MANIFEST)[number]["name"];

export interface ModulePackStatus {
  name: ModulePackName;
  packageName: string;
  title: string;
  description: string;
  modules: string[];
  available: boolean;
  required: boolean;
}

export interface ModulePackSelection {
  configured: boolean;
  packs: Set<ModulePackName>;
  unknown: string[];
}

export const MODULE_PACK_NAMES = MODULE_PACK_MANIFEST.map((pack) => pack.name) as ModulePackName[];

const PACK_BY_MODULE = new Map<string, ModulePackName>();
for (const pack of MODULE_PACK_MANIFEST) {
  for (const moduleName of pack.modules) {
    PACK_BY_MODULE.set(moduleName, pack.name);
  }
}

const PACK_NAME_SET = new Set<string>(MODULE_PACK_NAMES);

const PACK_ALIASES: Record<string, ModulePackName | "all" | "core-only"> = {
  base: "core",
  starter: "core",
  essentials: "core",
  comms: "communications",
  iwork: "productivity",
  office: "productivity",
  safari: "browser",
  photos: "visual",
  screen: "visual",
  maps: "location",
  ai: "intelligence",
  memory: "intelligence",
  google: "google-workspace",
  "google-workspace": "google-workspace",
  google_workspace: "google-workspace",
  spatial_prep: "spatial",
  all: "all",
  "*": "all",
  none: "core-only",
  "core-only": "core-only",
  core_only: "core-only",
};

export function getDefaultModulePacks(): Set<ModulePackName> {
  return new Set(MODULE_PACK_NAMES);
}

export function getModulePackNameForModule(moduleName: string): ModulePackName | null {
  return PACK_BY_MODULE.get(moduleName) ?? null;
}

export function getModulePackPackageName(packName: string): string | null {
  return MODULE_PACK_MANIFEST.find((pack) => pack.name === packName)?.packageName ?? null;
}

export function getModuleAddonImportSpec(moduleName: string, kind: "tools" | "prompts"): string | null {
  const packName = getModulePackNameForModule(moduleName);
  if (!packName || packName === CORE_MODULE_PACK_NAME) return null;
  const packageName = getModulePackPackageName(packName);
  return packageName ? `${packageName}/dist/${moduleName}/${kind}.js` : null;
}

export function getModulePackStatuses(availablePacks: ReadonlySet<string>): ModulePackStatus[] {
  return MODULE_PACK_MANIFEST.map((pack) => ({
    name: pack.name,
    packageName: pack.packageName,
    title: pack.title,
    description: pack.description,
    modules: [...pack.modules],
    available: availablePacks.has(pack.name),
    required: "required" in pack && pack.required === true,
  }));
}

export function isModulePackAvailable(moduleName: string, availablePacks: ReadonlySet<string>): boolean {
  const pack = getModulePackNameForModule(moduleName);
  return pack ? availablePacks.has(pack) : true;
}

export function resolveModulePackSelection(raw: string | string[] | undefined): ModulePackSelection {
  if (raw === undefined) {
    return { configured: false, packs: getDefaultModulePacks(), unknown: [] };
  }

  const tokens = Array.isArray(raw) ? raw : raw.split(",");
  const packs = new Set<ModulePackName>();
  const unknown: string[] = [];
  let sawAll = false;
  let sawCoreOnly = false;
  let sawAnyToken = false;

  for (const token of tokens) {
    const normalized = normalizeModulePackToken(token);
    if (!normalized) continue;
    sawAnyToken = true;
    const resolved =
      PACK_ALIASES[normalized] ?? (PACK_NAME_SET.has(normalized) ? (normalized as ModulePackName) : null);
    if (resolved === "all") {
      sawAll = true;
      continue;
    }
    if (resolved === "core-only") {
      sawCoreOnly = true;
      continue;
    }
    if (resolved) {
      packs.add(resolved);
    } else {
      unknown.push(token);
    }
  }

  if (!sawAnyToken) return { configured: false, packs: getDefaultModulePacks(), unknown };
  if (sawAll) return { configured: true, packs: getDefaultModulePacks(), unknown };

  packs.add(CORE_MODULE_PACK_NAME);
  if (sawCoreOnly) return { configured: true, packs: new Set([CORE_MODULE_PACK_NAME]), unknown };

  return { configured: true, packs, unknown };
}

function normalizeModulePackToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}
