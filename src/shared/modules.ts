import type { ModuleRegistration } from "./registry.js";
import type { ModuleCompatibility } from "./compatibility.js";

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
  { name: "safari" },
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
  { name: "podcasts" },
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
let cache: ModuleRegistration[] | null = null;

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
      console.error(`[AirMCP] Debug: unknown module "${n}" — skipping (available: ${[...valid].join(", ")})`);
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
      console.error(`[AirMCP] Warning: no register function found in ${def.name}/tools.ts`);
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
    console.error(`[AirMCP] Failed to load module ${def.name}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function loadModuleRegistry(): Promise<ModuleRegistration[]> {
  if (cache) return cache;

  const whitelist = getDebugWhitelist();
  const sequential = process.env.AIRMCP_DEBUG_SEQUENTIAL === "true";
  const targets: ReadonlyArray<ModuleManifestEntry> = whitelist
    ? MODULE_MANIFEST.filter((m) => whitelist.has(m.name))
    : MODULE_MANIFEST;

  if (whitelist) {
    console.error(
      `[AirMCP] Debug mode: loading ${targets.length} module(s) — ${targets.map((m) => m.name).join(", ")}`,
    );
  }
  if (sequential) {
    console.error(`[AirMCP] Debug mode: sequential loading enabled`);
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
    console.error(`[AirMCP] Failed to load ${failed.length} module(s): ${failed.join(", ")}`);
  }

  cache = registry;

  return registry;
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
