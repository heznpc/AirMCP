import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runAutomation } from "../shared/automation.js";
import { runSwift } from "../shared/swift.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okStructured, okUntrustedStructured, okUntrustedLinkedStructured, toolError } from "../shared/result.js";
import {
  listCalendarsScript,
  listEventsScript,
  readEventScript,
  createEventScript,
  updateEventScript,
  deleteEventScript,
  searchEventsScript,
  getUpcomingEventsScript,
  todayEventsScript,
} from "./scripts.js";

interface CalendarItem {
  id: string;
  name: string;
  color: string;
  writable: boolean;
}

interface EventListItem {
  id: string;
  summary: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  calendar: string;
}

interface EventListResult {
  total: number;
  offset: number;
  returned: number;
  events: EventListItem[];
}

interface Attendee {
  name: string;
  email: string;
  status: string;
}

interface EventDetail extends EventListItem {
  description: string;
  location: string;
  recurrence: string;
  url: string;
  attendees: Attendee[];
}

interface MutationResult {
  id: string;
  summary: string;
}

interface DeleteResult {
  deleted: boolean;
  summary: string;
}

interface SearchResult {
  total: number;
  events: EventListItem[];
}

interface UpcomingEventItem extends EventListItem {
  location: string;
}

interface UpcomingEventsResult {
  total: number;
  returned: number;
  events: UpcomingEventItem[];
}

interface TodayEventsResult {
  total: number;
  events: UpcomingEventItem[];
}

interface RecurringEventResult {
  id: string;
  title: string;
  recurring: boolean;
}

export function registerCalendarTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_calendars",
    {
      title: "List Calendars",
      description: "List all calendars with name, color, and writable status.",
      inputSchema: {},
      outputSchema: {
        calendars: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            color: z.string().nullable(),
            writable: z.boolean(),
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
        const result = await runAutomation<CalendarItem[]>({
          swift: { command: "list-calendars" },
          jxa: () => listCalendarsScript(),
        });
        return okStructured({ calendars: result });
      } catch (e) {
        return toolError("list calendars", e);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "List Events",
      description:
        "List events within a date range. Requires startDate and endDate (ISO 8601). Optionally filter by calendar name. Supports limit/offset pagination.",
      inputSchema: {
        startDate: z.string().max(64).describe("Start of range (ISO 8601, e.g. '2026-03-01T00:00:00Z')"),
        endDate: z.string().max(64).describe("End of range (ISO 8601, e.g. '2026-03-31T23:59:59Z')"),
        calendar: z.string().max(500).optional().describe("Filter by calendar name"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(100)
          .describe("Max events to return (default: 100)"),
        offset: z.number().int().min(0).optional().default(0).describe("Number of events to skip (default: 0)"),
      },
      outputSchema: {
        total: z.number(),
        offset: z.number(),
        returned: z.number(),
        events: z.array(
          z.object({
            id: z.string(),
            summary: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            allDay: z.boolean(),
            calendar: z.string(),
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
    async ({ startDate, endDate, calendar, limit, offset }) => {
      try {
        const result = await runAutomation<EventListResult>({
          swift: {
            command: "list-events",
            input: { startDate, endDate, calendar, limit, offset },
          },
          jxa: () => listEventsScript(startDate, endDate, limit, offset, calendar),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("list events", e);
      }
    },
  );

  server.registerTool(
    "read_event",
    {
      title: "Read Event",
      description:
        "Read full details of a calendar event by ID. Includes attendees (read-only), location, description, and recurrence info.",
      inputSchema: {
        id: z.string().max(500).describe("Event UID"),
      },
      outputSchema: {
        id: z.string(),
        summary: z.string(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        startDate: z.string(),
        endDate: z.string(),
        allDay: z.boolean(),
        recurrence: z.string().nullable(),
        url: z.string().nullable(),
        calendar: z.string(),
        attendees: z.array(
          z.object({
            name: z.string().nullable(),
            email: z.string().nullable(),
            status: z.string().nullable(),
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
    async ({ id }) => {
      try {
        const result = await runAutomation<EventDetail>({
          swift: { command: "read-event", input: { id } },
          jxa: () => readEventScript(id),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("read event", e);
      }
    },
  );

  server.registerTool(
    "create_event",
    {
      title: "Create Event",
      description:
        "Create a new calendar event. Recurring events cannot be created via automation. Attendees cannot be added programmatically.",
      inputSchema: {
        summary: z.string().min(1).max(500).describe("Event title"),
        startDate: z.string().max(64).describe("Start date/time (ISO 8601, e.g. '2026-03-15T09:00:00Z')"),
        endDate: z.string().max(64).describe("End date/time (ISO 8601, e.g. '2026-03-15T10:00:00Z')"),
        location: z.string().max(5000).optional().describe("Event location"),
        description: z.string().max(5000).optional().describe("Event notes/description"),
        calendar: z.string().max(500).optional().describe("Target calendar name. Defaults to first writable calendar."),
        allDay: z.boolean().optional().describe("Set as all-day event"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ summary, startDate, endDate, location, description, calendar, allDay }) => {
      try {
        const result = await runAutomation<MutationResult>({
          swift: {
            command: "create-event",
            input: { title: summary, startDate, endDate, location, notes: description, calendar, allDay },
          },
          jxa: () => createEventScript(summary, startDate, endDate, { location, description, calendar, allDay }),
        });
        return ok(result);
      } catch (e) {
        return toolError("create event", e);
      }
    },
  );

  server.registerTool(
    "update_event",
    {
      title: "Update Event",
      description:
        "Update event properties. Only specified fields are changed. Attendees and recurrence rules cannot be modified via automation.",
      inputSchema: {
        id: z.string().max(500).describe("Event UID"),
        summary: z.string().max(500).optional().describe("New title"),
        startDate: z
          .string()
          .max(64)
          .optional()
          .describe("New start date/time (ISO 8601, e.g. '2026-03-15T09:00:00Z')"),
        endDate: z.string().max(64).optional().describe("New end date/time (ISO 8601, e.g. '2026-03-15T10:00:00Z')"),
        location: z.string().max(5000).optional().describe("New location"),
        description: z.string().max(5000).optional().describe("New notes/description"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, summary, startDate, endDate, location, description }) => {
      try {
        const result = await runAutomation<MutationResult>({
          swift: {
            command: "update-event",
            input: { id, title: summary, startDate, endDate, location, notes: description },
          },
          jxa: () => updateEventScript(id, { summary, startDate, endDate, location, description }),
        });
        return ok(result);
      } catch (e) {
        return toolError("update event", e);
      }
    },
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete Event",
      description: "Delete a calendar event by ID. This action is permanent.",
      inputSchema: {
        id: z.string().max(500).describe("Event UID"),
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
          swift: { command: "delete-event", input: { id } },
          jxa: () => deleteEventScript(id),
        });
        return ok(result);
      } catch (e) {
        return toolError("delete event", e);
      }
    },
  );

  server.registerTool(
    "search_events",
    {
      title: "Search Events",
      description: "Search events by keyword in title or description within a date range.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        startDate: z.string().max(64).describe("Start of range (ISO 8601, e.g. '2026-03-01T00:00:00Z')"),
        endDate: z.string().max(64).describe("End of range (ISO 8601, e.g. '2026-03-31T23:59:59Z')"),
        limit: z.number().int().min(1).max(500).optional().default(50).describe("Max results (default: 50)"),
      },
      outputSchema: {
        total: z.number(),
        events: z.array(
          z.object({
            id: z.string(),
            summary: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            allDay: z.boolean(),
            calendar: z.string(),
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
    async ({ query, startDate, endDate, limit }) => {
      try {
        const result = await runAutomation<SearchResult>({
          swift: {
            command: "search-events",
            input: { query, startDate, endDate, limit },
          },
          jxa: () => searchEventsScript(query, startDate, endDate, limit),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("search events", e);
      }
    },
  );

  server.registerTool(
    "get_upcoming_events",
    {
      title: "Get Upcoming Events",
      description:
        "Get the next N upcoming events from now (searches up to 30 days ahead). A convenience wrapper that doesn't require date range parameters.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(10).describe("Max events to return (default: 10)"),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        events: z.array(
          z.object({
            id: z.string(),
            summary: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            allDay: z.boolean(),
            calendar: z.string(),
            location: z.string(),
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
    async ({ limit }) => {
      try {
        const result = await runAutomation<UpcomingEventsResult>({
          swift: { command: "get-upcoming-events", input: { limit } },
          jxa: () => getUpcomingEventsScript(limit),
        });
        return okUntrustedStructured(result);
      } catch (e) {
        return toolError("get upcoming events", e);
      }
    },
  );

  server.registerTool(
    "today_events",
    {
      title: "Today's Events",
      description: "Get all calendar events for today.",
      inputSchema: {},
      outputSchema: {
        total: z.number(),
        events: z.array(
          z.object({
            id: z.string(),
            summary: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            allDay: z.boolean(),
            calendar: z.string(),
            location: z.string(),
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
        const result = await runAutomation<TodayEventsResult>({
          swift: { command: "today-events" },
          jxa: () => todayEventsScript(),
        });
        return okUntrustedLinkedStructured("today_events", result);
      } catch (e) {
        return toolError("get today's events", e);
      }
    },
  );

  server.registerTool(
    "create_recurring_event",
    {
      title: "Create Recurring Event",
      description:
        "Create a recurring calendar event via EventKit. Supports daily, weekly, monthly, and yearly recurrence with configurable intervals. Requires macOS 26+ Swift bridge.",
      inputSchema: {
        summary: z.string().min(1).max(500).describe("Event title"),
        startDate: z.string().max(64).describe("Start date/time (ISO 8601, e.g. '2026-03-15T09:00:00Z')"),
        endDate: z.string().max(64).describe("End date/time (ISO 8601, e.g. '2026-03-15T10:00:00Z')"),
        location: z.string().max(5000).optional().describe("Event location"),
        description: z.string().max(5000).optional().describe("Event notes/description"),
        calendar: z.string().max(500).optional().describe("Target calendar name. Defaults to the default calendar."),
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
    async ({ summary, startDate, endDate, location, description, calendar, recurrence }) => {
      try {
        const result = await runSwift<RecurringEventResult>(
          "create-recurring-event",
          JSON.stringify({
            title: summary,
            startDate,
            endDate,
            location,
            notes: description,
            calendar,
            recurrence,
          }),
        );
        return ok(result);
      } catch (e) {
        return toolError("create recurring event", e);
      }
    },
  );
}
