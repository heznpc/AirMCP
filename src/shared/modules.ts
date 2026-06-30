import type { ModuleRegistration } from "./registry.js";
import type { ModuleCompatibility } from "./compatibility.js";
import type { AirMcpConfig } from "./config.js";
import { isModuleEnabled } from "./config.js";
import { log, errToCtx } from "./logger.js";

/**
 * Module manifest — the single source of truth for all AirMCP modules.
 *
 * To add a new module:
 *   1. Create src/<name>/tools.ts  (export registerXxxTools)
 *   2. Optionally create src/<name>/prompts.ts  (export registerXxxPrompts)
 *   3. Add one line to MANIFEST below
 *   That's it. No other imports needed.
 *
 * Compatibility metadata (RFC 0004):
 *   - `minMacosVersion` is kept top-level for the existing runtime gate.
 *   - `compatibility` is a richer manifest (status, deprecation, hardware
 *     requirements, permission list). It is threaded through to the
 *     ModuleRegistration but currently only used by the doctor / reports.
 *     Existing registration logic is unchanged.
 */
/** Static manifest entry — the compile-time definition of a module. */
export interface ModuleManifestEntry {
  name: string;
  hasPrompts?: boolean;
  minMacosVersion?: number;
  compatibility?: ModuleCompatibility;
}

/**
 * Module manifest (read-only). Exported so tools like `airmcp doctor`, the
 * `print-compat-report` script, and tests can inspect compatibility metadata
 * without calling `loadModuleRegistry()` (which eagerly imports every module).
 */
export const MODULE_MANIFEST: ReadonlyArray<ModuleManifestEntry> = [
  { name: "notes", hasPrompts: true },
  { name: "reminders", hasPrompts: true },
  { name: "calendar", hasPrompts: true },
  { name: "contacts" },
  { name: "mail" },
  { name: "music" },
  { name: "finder" },
  {
    name: "safari",
    compatibility: {
      // Safari module is STABLE on every host. Only the single `add_bookmark`
      // TOOL broke on macOS 26 (Apple removed the `make new bookmark` JXA
      // verb) — and that tool gates ITSELF off at the tool level
      // (src/safari/tools.ts: registered only on macOS <26, returns
      // errDeprecated and steers to add_to_reading_list). A module-level
      // `brokenOn:[26]` here would skip the ENTIRE module on macOS 26,
      // dropping all 11 working Safari tools (tabs / reading-list / page
      // content / …), so it is deliberately NOT set — the breakage is
      // tool-scoped, not module-scoped.
      status: "stable",
    },
  },
  { name: "system" },
  { name: "photos" },
  { name: "shortcuts", hasPrompts: true },
  { name: "messages" },
  {
    name: "intelligence",
    minMacosVersion: 26,
    compatibility: {
      minMacosVersion: 26,
      status: "beta",
      requiresHardware: ["apple-silicon"],
    },
  },
  { name: "tv" },
  { name: "ui" },
  { name: "screen" },
  { name: "maps" },
  {
    name: "podcasts",
    compatibility: {
      // Apple removed the entire Podcasts JXA scripting dictionary in
      // macOS 26. All 6 tools fail at runtime; the module is still
      // registered for ≤25 hosts. RFC 0004 doctor surfaces this so a
      // user on 26 isn't left guessing why podcasts_* always errors.
      status: "deprecated",
      brokenOn: [26],
      deprecation: {
        since: "2.11.0",
        removeAt: "3.0.0",
        reason:
          "Apple removed the Podcasts JXA scripting dictionary entirely in macOS 26. Investigating Shortcuts bridge or Media framework alternatives.",
      },
    },
  },
  { name: "weather" },
  { name: "pages" },
  { name: "numbers" },
  { name: "keynote" },
  { name: "location" },
  { name: "bluetooth" },
  { name: "google" },
  { name: "speech" },
  {
    name: "health",
    compatibility: {
      status: "stable",
      requiresHardware: ["apple-silicon", "healthkit"],
      requiresPermissions: ["healthkit"],
    },
  },
  { name: "memory" },
  { name: "audit" },
  { name: "spatial_prep" },
];

/**
 * Dynamically load all module registrations.
 * Each module's tools.ts exports a single register function.
 * Only the first exported function is used (convention over configuration).
 *
 * Debug mode (env vars):
 *   AIRMCP_DEBUG_MODULES=notes,calendar   — load only these modules (whitelist)
 *   AIRMCP_DEBUG_SEQUENTIAL=true          — load modules one-by-one instead of Promise.all()
 *
 * Combine both for memory-safe debugging:
 *   AIRMCP_DEBUG_MODULES=notes AIRMCP_DEBUG_SEQUENTIAL=true
 */
/** Parse AIRMCP_DEBUG_MODULES into a whitelist Set, or null if unset. */
function getDebugWhitelist(): Set<string> | null {
  const raw = process.env.AIRMCP_DEBUG_MODULES;
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return null;
  const valid = new Set(MODULE_MANIFEST.map((m) => m.name));
  const whitelist = new Set<string>();
  for (const n of names) {
    if (valid.has(n)) {
      whitelist.add(n);
    } else {
      log.warn("Debug: unknown module — skipping", { module: n, available: [...valid] });
    }
  }
  return whitelist.size > 0 ? whitelist : null;
}

/** Import a single module definition, returning null on failure. */
async function importModule(def: ModuleManifestEntry): Promise<ModuleRegistration | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolsMod: Record<string, any> = await import(`../${def.name}/tools.js`);
    const toolsFn = findRegisterFn(toolsMod);
    if (!toolsFn) {
      log.warn("no register function found in tools.ts", { module: def.name });
      return null;
    }

    let promptsFn: ModuleRegistration["prompts"] | undefined;
    if (def.hasPrompts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promptsMod: Record<string, any> = await import(`../${def.name}/prompts.js`);
      promptsFn = findRegisterFn(promptsMod);
    }

    return {
      name: def.name,
      tools: toolsFn,
      prompts: promptsFn,
      minMacosVersion: def.minMacosVersion,
      compatibility: def.compatibility,
    } as ModuleRegistration;
  } catch (e) {
    log.error("failed to load module", { module: def.name, err: errToCtx(e) });
    return null;
  }
}

const cacheByKey = new Map<string, ModuleRegistration[]>();

export async function loadModuleRegistry(config?: AirMcpConfig): Promise<ModuleRegistration[]> {
  const whitelist = getDebugWhitelist();
  const targets = getTargetManifestEntries(config, whitelist);
  const cacheKey = targets.map((m) => m.name).join(",");
  if (cacheByKey.has(cacheKey)) return cacheByKey.get(cacheKey)!;

  const sequential = process.env.AIRMCP_DEBUG_SEQUENTIAL === "true";

  if (whitelist) {
    log.info("Debug mode: loading whitelist subset (sequential loading optional)", {
      count: targets.length,
      modules: targets.map((m) => m.name),
    });
  }
  if (sequential) {
    log.info("Debug mode: sequential loading enabled");
  }

  const registry: ModuleRegistration[] = [];
  const failed: string[] = [];

  if (sequential) {
    // Sequential: load one module at a time to minimize memory usage
    for (const def of targets) {
      const result = await importModule(def);
      if (result) {
        registry.push(result);
      } else {
        failed.push(def.name);
      }
    }
  } else {
    // Parallel: original Promise.all() behavior
    const results = await Promise.all(targets.map(importModule));
    for (let i = 0; i < results.length; i++) {
      if (results[i]) {
        registry.push(results[i]!);
      } else {
        failed.push(targets[i]!.name);
      }
    }
  }

  if (failed.length > 0) {
    log.error("failed to load modules", { count: failed.length, modules: failed });
  }

  cacheByKey.set(cacheKey, registry);

  return registry;
}

function getTargetManifestEntries(
  config: AirMcpConfig | undefined,
  whitelist: Set<string> | null,
): ReadonlyArray<ModuleManifestEntry> {
  return MODULE_MANIFEST.filter((m) => {
    if (whitelist && !whitelist.has(m.name)) return false;
    if (config && !isModuleEnabled(config, m.name)) return false;
    return true;
  });
}

/** Find the first exported function whose name starts with "register". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRegisterFn(mod: Record<string, any>): ((...args: any[]) => any) | undefined {
  // Prefer registerXxxTools over registerDynamicXxx (dynamic tools are registered separately)
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

// Backward compat: synchronous MODULE_REGISTRY for code that reads it after init
export let MODULE_REGISTRY: ModuleRegistration[] = [];

/** Call once at startup after loadModuleRegistry(). */
export function setModuleRegistry(r: ModuleRegistration[]): void {
  MODULE_REGISTRY = r;
}

/** Get module names from manifest (no import needed). */
export function getModuleNames(): string[] {
  return MODULE_MANIFEST.map((m) => m.name);
}
