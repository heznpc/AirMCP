import type { McpServer } from "./mcp.js";
import { runJxa } from "./jxa.js";
import { ok } from "./result.js";
import { AirMcpConfig, isModuleEnabled } from "./config.js";

/** Map: module name → macOS app name + permission-probe script */
const MODULE_APP_MAP: Array<{ module: string; name: string; script: string }> = [
  { module: "notes", name: "Notes", script: "const Notes = Application('Notes'); JSON.stringify({app: 'Notes', accessible: true});" },
  { module: "reminders", name: "Reminders", script: "const Reminders = Application('Reminders'); JSON.stringify({app: 'Reminders', accessible: true});" },
  { module: "calendar", name: "Calendar", script: "const Calendar = Application('Calendar'); JSON.stringify({app: 'Calendar', accessible: true});" },
  { module: "contacts", name: "Contacts", script: "const Contacts = Application('Contacts'); JSON.stringify({app: 'Contacts', accessible: true});" },
  { module: "mail", name: "Mail", script: "const Mail = Application('Mail'); JSON.stringify({app: 'Mail', accessible: true});" },
  { module: "music", name: "Music", script: "const Music = Application('Music'); JSON.stringify({app: 'Music', accessible: true});" },
  { module: "finder", name: "Finder", script: "const Finder = Application('Finder'); JSON.stringify({app: 'Finder', accessible: true});" },
  { module: "safari", name: "Safari", script: "const Safari = Application('Safari'); JSON.stringify({app: 'Safari', accessible: true});" },
  { module: "system", name: "System Events", script: "const SE = Application('System Events'); JSON.stringify({app: 'System Events', accessible: true});" },
  { module: "photos", name: "Photos", script: "const Photos = Application('Photos'); JSON.stringify({app: 'Photos', accessible: true});" },
  { module: "messages", name: "Messages", script: "const Messages = Application('Messages'); JSON.stringify({app: 'Messages', accessible: true});" },
  { module: "tv", name: "TV", script: "const TV = Application('TV'); JSON.stringify({app: 'TV', accessible: true});" },
];

export function registerSetupTools(server: McpServer, config?: AirMcpConfig): void {
  server.registerTool(
    "setup_permissions",
    {
      title: "Setup Permissions",
      description:
        "Trigger macOS permission prompts for all Apple apps used by AirMCP. Run this once after installation to grant all permissions at once. Each app will show a one-time macOS permission dialog.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      // Only probe apps for enabled modules
      const apps = config
        ? MODULE_APP_MAP.filter((a) => isModuleEnabled(config, a.module))
        : MODULE_APP_MAP;
      const results: Array<{ app: string; status: string }> = [];
      for (const app of apps) {
        try {
          await runJxa(app.script);
          results.push({ app: app.name, status: "granted" });
        } catch (e) {
          results.push({
            app: app.name,
            status: `failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      const granted = results.filter((r) => r.status === "granted").length;
      const skipped = MODULE_APP_MAP.length - apps.length;
      return ok({ total: apps.length, granted, skipped, results });
    },
  );
}
