import type { FSWatcher } from "node:fs";
import type { McpServer } from "../shared/mcp.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllSkills, mergeSkills, watchUserSkills } from "./loader.js";
import { registerSkills } from "./register.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTINS_DIR = join(__dirname, "builtins");

let skillsWatcher: FSWatcher | null = null;

export async function registerSkillEngine(server: McpServer): Promise<void> {
  const { builtins, user } = loadAllSkills(BUILTINS_DIR);
  const merged = mergeSkills(builtins, user);

  if (merged.length === 0) {
    console.error("[AirMCP] Skills engine: no skills found");
    return;
  }

  registerSkills(server, merged);

  // Watch user skills directory for changes — only once per process
  if (!skillsWatcher) {
    skillsWatcher = watchUserSkills(() => {
      console.error("[AirMCP] User skills changed. Restart server to apply changes.");
    });
  }
}

/** Close the file watcher. Called on process exit. */
export function closeSkillsWatcher(): void {
  skillsWatcher?.close();
  skillsWatcher = null;
}
