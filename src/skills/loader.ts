import { readFileSync, readdirSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { SkillDefinitionSchema, type SkillDefinition } from "./types.js";

const USER_SKILLS_DIR = join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".config", "airmcp", "skills");

const MAX_SKILL_FILE_SIZE = 256_000; // 256KB

export function loadSkillFile(path: string): SkillDefinition | null {
  try {
    const raw = readFileSync(path, "utf-8");
    if (raw.length > MAX_SKILL_FILE_SIZE) {
      console.error(`[AirMCP] Skill file too large (${raw.length} bytes, max ${MAX_SKILL_FILE_SIZE}): ${path}`);
      return null;
    }
    const parsed = parse(raw);
    const result = SkillDefinitionSchema.safeParse(parsed);
    if (!result.success) {
      console.error(`[AirMCP] Invalid skill ${path}: ${result.error.issues.map((i) => i.message).join(", ")}`);
      return null;
    }
    return result.data;
  } catch (e) {
    console.error(`[AirMCP] Failed to load skill ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function scanDirectory(dir: string): SkillDefinition[] {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const skills: SkillDefinition[] = [];
    for (const file of files) {
      const skill = loadSkillFile(join(dir, file));
      if (skill) skills.push(skill);
    }
    return skills;
  } catch {
    return []; // directory doesn't exist or unreadable
  }
}

/** Cache for built-in skills — loaded once per process. */
let builtinsCache: SkillDefinition[] | null = null;

export function loadAllSkills(builtinsDir: string): { builtins: SkillDefinition[]; user: SkillDefinition[] } {
  if (!builtinsCache) {
    builtinsCache = scanDirectory(builtinsDir);
  }
  const user = scanDirectory(USER_SKILLS_DIR);
  return { builtins: builtinsCache, user };
}

export function mergeSkills(builtins: SkillDefinition[], user: SkillDefinition[]): SkillDefinition[] {
  // Local protected set — built-in names that user skills cannot override.
  // Kept local rather than module-scoped so per-session createServer calls
  // never see stale entries from a previous merge.
  const protectedNames = new Set<string>();
  const map = new Map<string, SkillDefinition>();
  for (const s of builtins) {
    map.set(s.name, s);
    protectedNames.add(s.name);
  }
  for (const s of user) {
    if (protectedNames.has(s.name)) {
      console.error(`[AirMCP] User skill "${s.name}" conflicts with built-in skill — skipping`);
      continue;
    }
    map.set(s.name, s); // user adds new skills only
  }
  return [...map.values()];
}

/** Ensure the user skills directory exists (called once per process). */
let dirEnsured = false;
function ensureUserDir(): void {
  if (dirEnsured) return;
  mkdirSync(USER_SKILLS_DIR, { recursive: true });
  dirEnsured = true;
}

export function watchUserSkills(callback: () => void): FSWatcher {
  ensureUserDir();

  let timer: ReturnType<typeof setTimeout> | null = null;
  return watch(USER_SKILLS_DIR, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, 500);
  });
}
