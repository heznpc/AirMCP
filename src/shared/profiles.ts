/**
 * Runtime profile manifest.
 *
 * Profiles decide which modules load. Tool exposure decides which registered
 * tools are advertised in MCP `tools/list`.
 */

export const MODULE_NAMES = [
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "mail",
  "messages",
  "music",
  "finder",
  "safari",
  "system",
  "photos",
  "shortcuts",
  "intelligence",
  "tv",
  "ui",
  "screen",
  "maps",
  "podcasts",
  "weather",
  "pages",
  "numbers",
  "keynote",
  "location",
  "bluetooth",
  "google",
  "speech",
  "health",
  "memory",
  "audit",
] as const;

export const OPT_IN_MODULE_NAMES = ["spatial_prep"] as const;
export const KNOWN_MODULE_NAMES = [...MODULE_NAMES, ...OPT_IN_MODULE_NAMES] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];
export type KnownModuleName = (typeof KNOWN_MODULE_NAMES)[number];

export const STARTER_MODULE_NAMES = [
  "notes",
  "reminders",
  "calendar",
  "shortcuts",
  "system",
  "finder",
  "weather",
] as const satisfies readonly ModuleName[];

/** Core modules enabled by default when no config.json exists. */
export const STARTER_MODULES: ReadonlySet<string> = new Set(STARTER_MODULE_NAMES);

export const PROFILE_NAMES = ["starter", "communications-safe", "productivity", "full"] as const;
export type AirMcpProfileName = (typeof PROFILE_NAMES)[number];
export type ActiveProfileName = AirMcpProfileName | "custom";

export const TOOL_EXPOSURE_MODES = ["progressive", "profile", "full"] as const;
export type ToolExposureMode = (typeof TOOL_EXPOSURE_MODES)[number];

const COMMUNICATIONS_SAFE_MODULES = [
  ...STARTER_MODULE_NAMES,
  "contacts",
  "mail",
  "messages",
] as const satisfies readonly ModuleName[];

const PRODUCTIVITY_MODULES = [
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "mail",
  "messages",
  "finder",
  "pages",
  "numbers",
  "keynote",
  "shortcuts",
] as const satisfies readonly ModuleName[];

export const PROFILE_MODULES: Record<AirMcpProfileName, readonly ModuleName[]> = {
  starter: STARTER_MODULE_NAMES,
  "communications-safe": COMMUNICATIONS_SAFE_MODULES,
  productivity: PRODUCTIVITY_MODULES,
  full: MODULE_NAMES,
};

export const PROFILE_DESCRIPTIONS: Record<AirMcpProfileName, string> = {
  starter: "Core local workspace tools: notes, reminders, calendar, shortcuts, system, finder, weather.",
  "communications-safe":
    "Starter plus contacts, mail, and messages. Read/manage tools load, but send actions remain disabled unless explicitly opted in.",
  productivity: "Productivity workspace: starter, communications, Finder, and iWork modules.",
  full: "All standard modules. Experimental opt-in modules remain disabled unless explicitly enabled.",
};

export const DEFAULT_TOOL_EXPOSURE_BY_PROFILE: Record<AirMcpProfileName, ToolExposureMode> = {
  starter: "progressive",
  "communications-safe": "progressive",
  productivity: "profile",
  full: "full",
};

export const FRONT_DOOR_TOOLS = [
  "profile_status",
  "list_profiles",
  "start_tool_session",
  "tool_session_status",
  "end_tool_session",
  "discover_tools",
  "run_tool",
  "get_workflow",
] as const;

export const PROGRESSIVE_EXPOSED_TOOLS = [
  ...FRONT_DOOR_TOOLS,
  "suggest_next_tools",
  "proactive_context",
  "list_notes",
  "search_notes",
  "read_note",
  "list_reminders",
  "list_events",
  "today_events",
  "list_directory",
  "get_clipboard",
  "set_clipboard",
  "list_shortcuts",
  "run_shortcut",
  "get_current_weather",
  "get_daily_forecast",
] as const;

export function isProfileName(raw: string | undefined): raw is AirMcpProfileName {
  return raw !== undefined && (PROFILE_NAMES as readonly string[]).includes(raw);
}

export function normalizeProfileName(raw: string | undefined): AirMcpProfileName | null {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return isProfileName(normalized) ? normalized : null;
}

export function isToolExposureMode(raw: string | undefined): raw is ToolExposureMode {
  return raw !== undefined && (TOOL_EXPOSURE_MODES as readonly string[]).includes(raw);
}

export function normalizeToolExposureMode(raw: string | undefined): ToolExposureMode | null {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return isToolExposureMode(normalized) ? normalized : null;
}

export function getProfileModules(profile: AirMcpProfileName): readonly ModuleName[] {
  return PROFILE_MODULES[profile];
}

export function getProfileDisabledModules(profile: AirMcpProfileName): Set<string> {
  const enabled = new Set<string>(PROFILE_MODULES[profile]);
  return new Set(MODULE_NAMES.filter((mod) => !enabled.has(mod)));
}

export function getProgressiveToolAllowlist(): Set<string> {
  return new Set(PROGRESSIVE_EXPOSED_TOOLS);
}
