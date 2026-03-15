import type { ModuleRegistration } from "./registry.js";

/**
 * Module manifest — the single source of truth for all AirMCP modules.
 *
 * To add a new module:
 *   1. Create src/<name>/tools.ts  (export registerXxxTools)
 *   2. Optionally create src/<name>/prompts.ts  (export registerXxxPrompts)
 *   3. Add one line to MANIFEST below
 *   That's it. No other imports needed.
 */
const MANIFEST: Array<{
  name: string;
  hasPrompts?: boolean;
  minMacosVersion?: number;
}> = [
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
  { name: "intelligence", minMacosVersion: 26 },
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
];

/**
 * Dynamically load all module registrations.
 * Each module's tools.ts exports a single register function.
 * Only the first exported function is used (convention over configuration).
 */
let cache: ModuleRegistration[] | null = null;

export async function loadModuleRegistry(): Promise<ModuleRegistration[]> {
  if (cache) return cache;
  const registry: ModuleRegistration[] = [];

  const importPromises = MANIFEST.map(async (def) => {
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

      return { name: def.name, tools: toolsFn, prompts: promptsFn, minMacosVersion: def.minMacosVersion } as ModuleRegistration;
    } catch (e) {
      console.error(`[AirMCP] Failed to load module ${def.name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  });

  const results = await Promise.all(importPromises);
  for (const mod of results) {
    if (mod) registry.push(mod);
  }

  cache = registry;

  return registry;
}

/** Find the first exported function whose name starts with "register". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRegisterFn(mod: Record<string, any>): ((...args: any[]) => any) | undefined {
  // Prefer registerXxxTools over registerDynamicXxx (dynamic tools are registered separately)
  let fallback: ((...args: any[]) => any) | undefined;
  for (const [key, val] of Object.entries(mod)) {
    if (typeof val === "function" && key.startsWith("register")) {
      if (key.includes("Dynamic")) { fallback = fallback ?? val; continue; }
      return val;
    }
  }
  return fallback;
  return undefined;
}

// Backward compat: synchronous MODULE_REGISTRY for code that reads it after init
export let MODULE_REGISTRY: ModuleRegistration[] = [];

/** Call once at startup after loadModuleRegistry(). */
export function setModuleRegistry(r: ModuleRegistration[]): void {
  MODULE_REGISTRY = r;
}

/** Get module names from manifest (no import needed). */
export function getModuleNames(): string[] {
  return MANIFEST.map((m) => m.name);
}
