import type { FSWatcher } from "node:fs";
import type { McpServer } from "../shared/mcp.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllSkills, mergeSkills, watchUserSkills } from "./loader.js";
import { registerSkills } from "./register.js";
import { registerTrigger, resetTriggers, startTriggerListener } from "./triggers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolves to dist/skills/builtins/ — works in repo checkout, npm cache, and git worktrees
// because builtins are copied into dist/ during build (scripts/build.mjs).
const BUILTINS_DIR = join(__dirname, "builtins");

let skillsWatcher: FSWatcher | null = null;

export interface SkillEngineCounts {
  /** Built-in skills loaded from `dist/skills/builtins/*.yaml`. */
  builtinCount: number;
  /** User skills loaded from `~/.airmcp/skills/*.yaml`. */
  userCount: number;
}

export async function registerSkillEngine(server: McpServer): Promise<SkillEngineCounts> {
  const { builtins, user } = loadAllSkills(BUILTINS_DIR);
  const merged = mergeSkills(builtins, user);

  if (merged.length === 0) {
    console.error("[AirMCP] Skills engine: no skills found");
    return { builtinCount: 0, userCount: 0 };
  }

  registerSkills(server, merged);

  // Register event triggers for skills that have them. Reset bindings first
  // because this function is called per createServer (HTTP pre-warm + per-
  // session) and we must not accumulate duplicate bindings.
  resetTriggers();
  for (const skill of merged) {
    registerTrigger(skill);
  }
  startTriggerListener(server);

  // Watch user skills directory for changes — only once per process
  if (!skillsWatcher) {
    skillsWatcher = watchUserSkills(() => {
      console.error("[AirMCP] User skills changed. Restart server to apply changes.");
    });
  }

  return { builtinCount: builtins.length, userCount: user.length };
}

/** Close the file watcher. Called on process exit. */
export function closeSkillsWatcher(): void {
  skillsWatcher?.close();
  skillsWatcher = null;
}
