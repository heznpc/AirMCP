/**
 * Tool Graph — maps tool results to suggested next actions.
 *
 * Each entry maps a source tool name to an array of link definitions.
 * Links use template expressions ({{result.field}}) resolved against the tool's result.
 */

interface ToolLink {
  tool: string;
  description: string;
  args?: Record<string, string>; // template expressions resolved against result
}

const LINK_MAP: Record<string, ToolLink[]> = {
  // Calendar
  today_events: [
    { tool: "read_event", description: "Read event details", args: { eventId: "{{id}}" } },
    { tool: "create_note", description: "Create meeting notes", args: { title: "{{title}} — Notes" } },
    { tool: "create_reminder", description: "Set follow-up reminder" },
    { tool: "semantic_search", description: "Find related items", args: { query: "{{title}}" } },
  ],
  read_event: [
    { tool: "update_event", description: "Modify this event", args: { eventId: "{{id}}" } },
    { tool: "delete_event", description: "Delete this event", args: { eventId: "{{id}}" } },
    { tool: "create_note", description: "Create meeting notes", args: { title: "{{title}} — Notes" } },
    { tool: "create_reminder", description: "Set follow-up", args: { title: "Follow up: {{title}}" } },
  ],

  // Notes
  list_notes: [
    { tool: "read_note", description: "Read a note", args: { noteId: "{{id}}" } },
    { tool: "create_note", description: "Create a new note" },
    { tool: "search_notes", description: "Search notes by content" },
  ],
  read_note: [
    { tool: "update_note", description: "Edit this note", args: { noteId: "{{id}}" } },
    { tool: "delete_note", description: "Delete this note", args: { noteId: "{{id}}" } },
    { tool: "semantic_search", description: "Find related items", args: { query: "{{name}}" } },
  ],
  create_note: [
    { tool: "read_note", description: "Read the created note", args: { noteId: "{{id}}" } },
    { tool: "list_notes", description: "List all notes" },
  ],
  search_notes: [{ tool: "read_note", description: "Read a found note", args: { noteId: "{{id}}" } }],

  // Reminders
  list_reminders: [
    { tool: "create_reminder", description: "Create a new reminder" },
    { tool: "complete_reminder", description: "Mark as done", args: { reminderId: "{{id}}" } },
  ],
  create_reminder: [{ tool: "list_reminders", description: "View all reminders" }],

  // Mail
  list_mail: [
    { tool: "read_mail", description: "Read an email", args: { messageId: "{{id}}" } },
    { tool: "search_mail", description: "Search emails" },
  ],
  read_mail: [
    { tool: "reply_mail", description: "Reply to this email", args: { messageId: "{{id}}" } },
    { tool: "flag_mail", description: "Flag this email", args: { messageId: "{{id}}" } },
    { tool: "create_reminder", description: "Remind about this email", args: { title: "Reply: {{subject}}" } },
    { tool: "create_note", description: "Save email as note", args: { title: "{{subject}}" } },
  ],

  // Contacts
  list_contacts: [
    { tool: "read_contact", description: "View contact details", args: { contactId: "{{id}}" } },
    { tool: "search_contacts", description: "Search contacts" },
    { tool: "create_contact", description: "Create new contact" },
  ],
  read_contact: [
    { tool: "update_contact", description: "Edit contact", args: { contactId: "{{id}}" } },
    { tool: "send_mail", description: "Send email to contact" },
    { tool: "send_message", description: "Send iMessage" },
  ],

  // Music
  now_playing: [
    { tool: "pause_playback", description: "Pause" },
    { tool: "next_track", description: "Next track" },
    { tool: "set_rating", description: "Rate this track" },
    { tool: "add_to_playlist", description: "Add to playlist" },
  ],

  // Finder
  search_files: [
    { tool: "read_file_info", description: "Get file details" },
    { tool: "move_file", description: "Move file" },
    { tool: "set_file_tags", description: "Tag file" },
  ],

  // Semantic
  semantic_search: [
    { tool: "find_related", description: "Find more related items" },
    { tool: "read_note", description: "Read a found note" },
    { tool: "read_event", description: "Read a found event" },
  ],

  // Health
  health_summary: [
    { tool: "health_today_steps", description: "Detailed step count" },
    { tool: "health_heart_rate", description: "Heart rate details" },
    { tool: "health_sleep", description: "Sleep details" },
    { tool: "create_reminder", description: "Set health-related reminder" },
    { tool: "create_note", description: "Log health observations" },
  ],
  health_today_steps: [
    { tool: "health_summary", description: "Full health dashboard" },
    { tool: "health_sleep", description: "Check sleep data" },
  ],
  health_heart_rate: [
    { tool: "health_summary", description: "Full health dashboard" },
    { tool: "create_note", description: "Log heart rate observation" },
  ],
  health_sleep: [
    { tool: "health_summary", description: "Full health dashboard" },
    { tool: "health_heart_rate", description: "Check heart rate" },
    { tool: "create_reminder", description: "Set bedtime reminder" },
  ],

  // Safari
  list_tabs: [
    { tool: "read_tab", description: "Read tab content", args: { tabIndex: "{{index}}" } },
    { tool: "close_tab", description: "Close a tab", args: { tabIndex: "{{index}}" } },
    { tool: "create_note", description: "Save page as note" },
  ],

  // Photos
  list_albums: [
    { tool: "search_photos", description: "Search photos" },
    { tool: "get_photo_info", description: "Get photo details" },
  ],
  search_photos: [
    { tool: "get_photo_info", description: "View photo details" },
    { tool: "create_note", description: "Save photo info as note" },
  ],

  // Messages
  list_chats: [
    { tool: "read_chat", description: "Read chat messages" },
    { tool: "send_message", description: "Send a message" },
    { tool: "search_contacts", description: "Find contact" },
  ],

  // System
  get_system_info: [
    { tool: "list_running_apps", description: "See running apps" },
    { tool: "get_battery_status", description: "Check battery" },
  ],

  // Shortcuts
  list_shortcuts: [
    { tool: "run_shortcut", description: "Run a shortcut" },
    { tool: "search_shortcuts", description: "Search shortcuts" },
  ],
  run_shortcut: [
    { tool: "list_shortcuts", description: "See all shortcuts" },
    { tool: "create_note", description: "Log shortcut output" },
  ],

  // Music (expanded)
  search_music: [
    { tool: "play_track", description: "Play a found track" },
    { tool: "add_to_playlist", description: "Add to playlist" },
  ],
  list_playlists: [
    { tool: "play_playlist", description: "Play a playlist" },
    { tool: "search_music", description: "Search for music" },
  ],

  // Maps
  search_maps: [
    { tool: "get_directions", description: "Get directions" },
    { tool: "create_reminder", description: "Remind when near location" },
  ],

  // Weather
  get_weather: [
    { tool: "create_reminder", description: "Set weather-based reminder" },
    { tool: "create_note", description: "Log weather observation" },
  ],

  // Speech
  transcribe_audio: [
    { tool: "create_note", description: "Save transcription as note" },
    { tool: "create_reminder", description: "Create reminder from transcript" },
    { tool: "semantic_search", description: "Find related items" },
  ],
};

/** Get suggested next actions for a tool result, boosted by usage patterns. */
export function getToolLinks(toolName: string, usageNext?: Array<{ tool: string; count: number }>): ToolLink[] {
  const base = LINK_MAP[toolName] ?? [];
  if (!usageNext || usageNext.length === 0) return base;

  // Merge: usage-based suggestions that aren't already in the static map
  const existing = new Set(base.map((l) => l.tool));
  const extras: ToolLink[] = usageNext
    .filter((u) => !existing.has(u.tool))
    .slice(0, 3)
    .map((u) => ({ tool: u.tool, description: `Frequently used after ${toolName}` }));

  // Put static links first, usage-learned extras after
  return [...base, ...extras];
}

/** Append _links to a data object if links exist for the tool. */
export function withLinks(
  toolName: string,
  data: unknown,
  usageNext?: Array<{ tool: string; count: number }>,
): unknown {
  const links = getToolLinks(toolName, usageNext);
  if (links.length === 0 || data === null || data === undefined) return data;
  if (typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), _links: links };
  }
  if (Array.isArray(data)) {
    return { items: data, _links: links };
  }
  return data;
}
