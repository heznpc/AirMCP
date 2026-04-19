import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runAutomation } from "../shared/automation.js";
import { runSwift } from "../shared/swift.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okLinked, okLinkedStructured, okStructured, okUntrustedStructured, toolError } from "../shared/result.js";
import type { MutationResult, DeleteResult } from "../shared/types.js";
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

interface CompleteResult extends MutationResult {
  completed: boolean;
}

interface SearchRemindersResult {
  returned: number;
  reminders: ReminderItem[];
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
      outputSchema: {
        lists: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            reminderCount: z.number(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await runAutomation<ReminderListItem[]>({
          swift: { command: "list-reminder-lists" },
          jxa: () => listReminderListsScript(),
        });
        return okStructured({ lists: result });
      } catch (e) {
        return toolError("list reminder lists", e);
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
        list: z.string().max(500).optional().describe("Filter by list name"),
        completed: z.boolean().optional().describe("Filter by completed status (true/false). Omit to list all."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(200)
          .describe("Max number of reminders to return (default: 200)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Number of reminders to skip for pagination (default: 0)"),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        returned: z.number(),
        reminders: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            completed: z.boolean(),
            dueDate: z.string().nullable(),
            priority: z.number(),
            flagged: z.boolean(),
            list: z.string(),
          }),
        ),
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
        const result = await runAutomation<{
          total: number;
          offset: number;
          returned: number;
          reminders: ReminderItem[];
        }>({
          swift: {
            command: "list-reminders",
            input: { list, completed, limit, offset },
          },
          jxa: () => listRemindersScript(limit, offset, list, completed),
        });
        return okLinkedStructured("list_reminders", result);
      } catch (e) {
        return toolError("list reminders", e);
      }
    },
  );

  server.registerTool(
    "read_reminder",
    {
      title: "Read Reminder",
      description: "Read the full details of a specific reminder by ID.",
      inputSchema: {
        id: z.string().max(500).describe("Reminder ID"),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        body: z.string(),
        completed: z.boolean(),
        completionDate: z.string().nullable(),
        creationDate: z.string(),
        modificationDate: z.string(),
        dueDate: z.string().nullable(),
        priority: z.number(),
        flagged: z.boolean(),
        list: z.string(),
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
        const result = await runAutomation<ReminderDetail>({
          swift: { command: "read-reminder", input: { id } },
          jxa: () => readReminderScript(id),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("read reminder", e);
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
        title: z.string().max(500).describe("Reminder title"),
        body: z.string().max(5000).optional().describe("Notes/body text"),
        dueDate: z.string().max(64).optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15T10:00:00Z')"),
        priority: z.number().int().min(0).max(9).optional().describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
        list: z.string().max(500).optional().describe("Target list name. Defaults to the default list."),
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
        const result = await runAutomation<MutationResult>({
          swift: {
            command: "create-reminder",
            input: { title, body, dueDate, priority, list },
          },
          jxa: () => createReminderScript(title, { body, dueDate, priority, list }),
        });
        return okLinked("create_reminder", result);
      } catch (e) {
        return toolError("create reminder", e);
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
        id: z.string().max(500).describe("Reminder ID"),
        title: z.string().max(500).optional().describe("New title"),
        body: z.string().max(5000).optional().describe("New notes/body text"),
        dueDate: z
          .string()
          .nullable()
          .optional()
          .describe("New due date (ISO 8601, e.g. '2026-03-15T10:00:00Z') or null to clear"),
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
        const result = await runAutomation<MutationResult>({
          swift: {
            command: "update-reminder",
            input: {
              id,
              title,
              body,
              dueDate: dueDate === null ? undefined : dueDate,
              clearDueDate: dueDate === null ? true : undefined,
              priority,
              flagged,
            },
          },
          jxa: () => updateReminderScript(id, { name: title, body, dueDate, priority, flagged }),
        });
        return ok(result);
      } catch (e) {
        return toolError("update reminder", e);
      }
    },
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Complete Reminder",
      description: "Mark a reminder as completed or un-complete it.",
      inputSchema: {
        id: z.string().max(500).describe("Reminder ID"),
        completed: z
          .boolean()
          .optional()
          .default(true)
          .describe("Set to true to complete, false to un-complete (default: true)"),
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
        const result = await runAutomation<CompleteResult>({
          swift: {
            command: "complete-reminder",
            input: { id, completed },
          },
          jxa: () => completeReminderScript(id, completed),
        });
        return ok(result);
      } catch (e) {
        return toolError("complete reminder", e);
      }
    },
  );

  server.registerTool(
    "delete_reminder",
    {
      title: "Delete Reminder",
      description: "Delete a reminder by ID. This action is permanent.",
      inputSchema: {
        id: z.string().max(500).describe("Reminder ID"),
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
        const result = await runAutomation<DeleteResult>({
          swift: { command: "delete-reminder", input: { id } },
          jxa: () => deleteReminderScript(id),
        });
        return ok(result);
      } catch (e) {
        return toolError("delete reminder", e);
      }
    },
  );

  server.registerTool(
    "search_reminders",
    {
      title: "Search Reminders",
      description: "Search reminders by keyword in name or body across all lists (case-insensitive).",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(500).optional().default(30).describe("Max results (default: 30)"),
      },
      outputSchema: {
        returned: z.number(),
        reminders: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            completed: z.boolean(),
            dueDate: z.string().nullable(),
            priority: z.number(),
            flagged: z.boolean(),
            list: z.string(),
          }),
        ),
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
        const result = await runAutomation<SearchRemindersResult>({
          swift: {
            command: "search-reminders",
            input: { query, limit },
          },
          jxa: () => searchRemindersScript(query, limit),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("search reminders", e);
      }
    },
  );

  server.registerTool(
    "create_reminder_list",
    {
      title: "Create Reminder List",
      description: "Create a new reminder list.",
      inputSchema: {
        name: z.string().max(500).describe("Name for the new list"),
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
        const result = await runAutomation<MutationResult>({
          swift: {
            command: "create-reminder-list",
            input: { name },
          },
          jxa: () => createReminderListScript(name),
        });
        return ok(result);
      } catch (e) {
        return toolError("create reminder list", e);
      }
    },
  );

  server.registerTool(
    "delete_reminder_list",
    {
      title: "Delete Reminder List",
      description: "Delete a reminder list by name. This action is permanent and removes all reminders in the list.",
      inputSchema: {
        name: z.string().max(500).describe("Name of the list to delete"),
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
        const result = await runAutomation<DeleteResult>({
          swift: {
            command: "delete-reminder-list",
            input: { name },
          },
          jxa: () => deleteReminderListScript(name),
        });
        return ok(result);
      } catch (e) {
        return toolError("delete reminder list", e);
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
        title: z.string().max(500).describe("Reminder title"),
        list: z.string().max(500).optional().describe("Target reminder list name. Defaults to the default list."),
        notes: z.string().max(5000).optional().describe("Reminder notes/body text"),
        dueDate: z.string().max(64).optional().describe("Due date (ISO 8601, e.g. '2026-03-15T10:00:00Z')"),
        priority: z.number().int().min(0).max(9).optional().describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
        recurrence: z
          .object({
            frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).describe("Recurrence frequency"),
            interval: z.number().int().min(1).describe("Repeat every N frequency units (e.g. 2 = every 2 weeks)"),
            endDate: z
              .string()
              .max(64)
              .optional()
              .describe("Recurrence end date (ISO 8601, e.g. '2026-12-31T23:59:59Z')"),
            count: z.number().int().min(1).optional().describe("Number of occurrences (alternative to endDate)"),
            daysOfWeek: z
              .array(z.number().int().min(1).max(7))
              .optional()
              .describe("Days of week for weekly recurrence (1=Sun, 2=Mon, ..., 7=Sat)"),
          })
          .describe("Recurrence rule"),
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
        return toolError("create recurring reminder", e);
      }
    },
  );
}
