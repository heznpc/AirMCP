import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import { runSwift } from "../shared/swift.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, err } from "../shared/result.js";
import {
  listReminderListsScript,
  listRemindersScript,
  readReminderScript,
  createReminderScript,
  updateReminderScript,
  completeReminderScript,
  deleteReminderScript,
  searchRemindersScript,
  createReminderListScript,
  deleteReminderListScript,
} from "./scripts.js";

interface ReminderListItem {
  id: string;
  name: string;
  reminderCount: number;
}

interface ReminderItem {
  id: string;
  name: string;
  completed: boolean;
  dueDate: string | null;
  priority: number;
  flagged: boolean;
  list: string;
}

interface ReminderDetail extends ReminderItem {
  body: string;
  completionDate: string | null;
  creationDate: string;
  modificationDate: string;
}

interface MutationResult {
  id: string;
  name: string;
}

interface CompleteResult extends MutationResult {
  completed: boolean;
}

interface DeleteResult {
  deleted: boolean;
  name: string;
}

interface SearchRemindersResult {
  returned: number;
  reminders: ReminderItem[];
}

interface ListMutationResult {
  id: string;
  name: string;
}

interface RecurringReminderResult {
  id: string;
  title: string;
  recurring: boolean;
}

export function registerReminderTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_reminder_lists",
    {
      title: "List Reminder Lists",
      description: "List all reminder lists with reminder counts.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await runJxa<ReminderListItem[]>(listReminderListsScript());
        return ok(result);
      } catch (e) {
        return err(`Failed to list reminder lists: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "list_reminders",
    {
      title: "List Reminders",
      description:
        "List reminders. Optionally filter by list name and/or completion status. Supports pagination via limit/offset.",
      inputSchema: {
        list: z.string().optional().describe("Filter by list name"),
        completed: z.boolean().optional().describe("Filter by completed status (true/false). Omit to list all."),
        limit: z.number().int().min(1).max(1000).optional().default(200).describe("Max number of reminders to return (default: 200)"),
        offset: z.number().int().min(0).optional().default(0).describe("Number of reminders to skip for pagination (default: 0)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ list, completed, limit, offset }) => {
      try {
        const result = await runJxa<{ total: number; offset: number; returned: number; reminders: ReminderItem[] }>(listRemindersScript(limit, offset, list, completed));
        return ok(result);
      } catch (e) {
        return err(`Failed to list reminders: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "read_reminder",
    {
      title: "Read Reminder",
      description: "Read the full details of a specific reminder by ID.",
      inputSchema: {
        id: z.string().describe("Reminder ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const result = await runJxa<ReminderDetail>(readReminderScript(id));
        return ok(result);
      } catch (e) {
        return err(`Failed to read reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Create Reminder",
      description:
        "Create a new reminder. Optionally set notes, due date, priority (0=none, 1-4=high, 5=medium, 6-9=low), and target list. Recurrence rules cannot be set via automation.",
      inputSchema: {
        title: z.string().describe("Reminder title"),
        body: z.string().optional().describe("Notes/body text"),
        dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15T10:00:00Z')"),
        priority: z.number().int().min(0).max(9).optional().describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
        list: z.string().optional().describe("Target list name. Defaults to the default list."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, body, dueDate, priority, list }) => {
      try {
        const result = await runJxa<MutationResult>(
          createReminderScript(title, { body, dueDate, priority, list }),
        );
        return ok(result);
      } catch (e) {
        return err(`Failed to create reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "update_reminder",
    {
      title: "Update Reminder",
      description:
        "Update reminder properties. Only specified fields are changed. Set dueDate to null to clear it. Recurrence rules cannot be modified via automation.",
      inputSchema: {
        id: z.string().describe("Reminder ID"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New notes/body text"),
        dueDate: z.string().nullable().optional().describe("New due date (ISO 8601, e.g. '2026-03-15T10:00:00Z') or null to clear"),
        priority: z.number().int().min(0).max(9).optional().describe("New priority (0-9)"),
        flagged: z.boolean().optional().describe("Set flagged status"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, title, body, dueDate, priority, flagged }) => {
      try {
        const result = await runJxa<MutationResult>(
          updateReminderScript(id, { name: title, body, dueDate, priority, flagged }),
        );
        return ok(result);
      } catch (e) {
        return err(`Failed to update reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Complete Reminder",
      description: "Mark a reminder as completed or un-complete it.",
      inputSchema: {
        id: z.string().describe("Reminder ID"),
        completed: z.boolean().optional().default(true).describe("Set to true to complete, false to un-complete (default: true)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, completed }) => {
      try {
        const result = await runJxa<CompleteResult>(completeReminderScript(id, completed));
        return ok(result);
      } catch (e) {
        return err(`Failed to complete reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "delete_reminder",
    {
      title: "Delete Reminder",
      description: "Delete a reminder by ID. This action is permanent.",
      inputSchema: {
        id: z.string().describe("Reminder ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const result = await runJxa<DeleteResult>(deleteReminderScript(id));
        return ok(result);
      } catch (e) {
        return err(`Failed to delete reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "search_reminders",
    {
      title: "Search Reminders",
      description:
        "Search reminders by keyword in name or body across all lists (case-insensitive).",
      inputSchema: {
        query: z.string().describe("Search keyword"),
        limit: z.number().int().min(1).max(500).optional().default(30).describe("Max results (default: 30)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit }) => {
      try {
        const result = await runJxa<SearchRemindersResult>(searchRemindersScript(query, limit));
        return ok(result);
      } catch (e) {
        return err(`Failed to search reminders: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "create_reminder_list",
    {
      title: "Create Reminder List",
      description: "Create a new reminder list.",
      inputSchema: {
        name: z.string().describe("Name for the new list"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      try {
        const result = await runJxa<ListMutationResult>(createReminderListScript(name));
        return ok(result);
      } catch (e) {
        return err(`Failed to create reminder list: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "delete_reminder_list",
    {
      title: "Delete Reminder List",
      description: "Delete a reminder list by name. This action is permanent and removes all reminders in the list.",
      inputSchema: {
        name: z.string().describe("Name of the list to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      try {
        const result = await runJxa<DeleteResult>(deleteReminderListScript(name));
        return ok(result);
      } catch (e) {
        return err(`Failed to delete reminder list: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "create_recurring_reminder",
    {
      title: "Create Recurring Reminder",
      description:
        "Create a recurring reminder via EventKit. Supports daily, weekly, monthly, and yearly recurrence with configurable intervals. Requires macOS 26+ Swift bridge.",
      inputSchema: {
        title: z.string().describe("Reminder title"),
        list: z.string().optional().describe("Target reminder list name. Defaults to the default list."),
        notes: z.string().optional().describe("Reminder notes/body text"),
        dueDate: z.string().optional().describe("Due date (ISO 8601, e.g. '2026-03-15T10:00:00Z')"),
        priority: z.number().int().min(0).max(9).optional().describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
        recurrence: z.object({
          frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).describe("Recurrence frequency"),
          interval: z.number().int().min(1).describe("Repeat every N frequency units (e.g. 2 = every 2 weeks)"),
          endDate: z.string().optional().describe("Recurrence end date (ISO 8601, e.g. '2026-12-31T23:59:59Z')"),
          count: z.number().int().min(1).optional().describe("Number of occurrences (alternative to endDate)"),
          daysOfWeek: z.array(z.number().int().min(1).max(7)).optional().describe("Days of week for weekly recurrence (1=Sun, 2=Mon, ..., 7=Sat)"),
        }).describe("Recurrence rule"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, list, notes, dueDate, priority, recurrence }) => {
      try {
        const result = await runSwift<RecurringReminderResult>(
          "create-recurring-reminder",
          JSON.stringify({
            title,
            list,
            notes,
            dueDate,
            priority,
            recurrence,
          }),
        );
        return ok(result);
      } catch (e) {
        return err(`Failed to create recurring reminder: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
