import { listEventsScript } from "../calendar/scripts.js";
import { runJxa } from "./jxa.js";

const DEFAULT_EVENT_LIMIT = 5;
const DEFAULT_REMINDER_LIMIT = 5;
const MAX_DIAGNOSTIC_ITEMS = 20;

interface RawEvent {
  id?: unknown;
  summary?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  allDay?: unknown;
  calendar?: unknown;
}

interface RawReminder {
  id?: unknown;
  name?: unknown;
  completed?: unknown;
  dueDate?: unknown;
  priority?: unknown;
  flagged?: unknown;
  list?: unknown;
}

export interface TodayOverviewDiagnostic {
  timestamp: string;
  workflowId: "today-overview";
  calendar: {
    returned: number;
    events: Array<{
      id: string;
      summary: string;
      startDate: string;
      endDate: string;
      allDay: boolean;
      calendar: string;
    }>;
  };
  reminders: {
    returned: number;
    overdue: Array<{
      id: string;
      name: string;
      completed: false;
      dueDate: string;
      priority: number;
      flagged: boolean;
      list: string;
    }>;
  };
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_DIAGNOSTIC_ITEMS, Math.floor(value)));
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/**
 * Fetch only incomplete reminders whose due date is before the supplied instant.
 * Titles and other user content are read only after the due-date filter has run.
 */
export function overdueRemindersBeforeScript(cutoffIso: string, limit: number): string {
  const safeLimit = boundedLimit(limit, DEFAULT_REMINDER_LIMIT);
  return `
    const Reminders = Application('Reminders');
    const cutoff = new Date(${JSON.stringify(cutoffIso)});
    const lists = Reminders.lists();
    const matches = [];
    for (const list of lists) {
      const src = list.reminders.whose({completed: false});
      const count = src.length;
      if (count === 0) continue;
      const dues = src.dueDate();
      for (let i = 0; i < count; i++) {
        if (dues[i] && dues[i] < cutoff) {
          matches.push({ reminder: src[i], dueDate: dues[i], list: list.name() });
        }
      }
    }
    matches.sort((a, b) => a.dueDate - b.dueDate);
    const overdue = matches.slice(0, ${safeLimit}).map(item => {
      const reminder = item.reminder;
      return {
        id: reminder.id(), name: reminder.name(), completed: false,
        dueDate: item.dueDate.toISOString(), priority: reminder.priority(),
        flagged: reminder.flagged(), list: item.list
      };
    });
    JSON.stringify({reminders: overdue});
  `;
}

/**
 * Direct-local diagnostic collector for `today-overview --preview`.
 * This deliberately is not an MCP call and must be labelled as bypassing
 * AirMCP governance and audit at the CLI boundary.
 */
export async function collectTodayOverviewDiagnostic(
  options: {
    now?: Date;
    eventLimit?: number;
    reminderLimit?: number;
  } = {},
): Promise<TodayOverviewDiagnostic> {
  const now = options.now ?? new Date();
  const eventLimit = boundedLimit(options.eventLimit, DEFAULT_EVENT_LIMIT);
  const reminderLimit = boundedLimit(options.reminderLimit, DEFAULT_REMINDER_LIMIT);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const [calendarResult, reminderResult] = await Promise.all([
    runJxa<{ events?: RawEvent[] }>(
      listEventsScript(start.toISOString(), new Date(end.getTime() - 1).toISOString(), eventLimit, 0),
    ),
    runJxa<{ reminders?: RawReminder[] }>(overdueRemindersBeforeScript(now.toISOString(), reminderLimit)),
  ]);

  const events = (Array.isArray(calendarResult.events) ? calendarResult.events : [])
    .filter((event) => {
      const timestamp = typeof event.startDate === "string" ? new Date(event.startDate).getTime() : Number.NaN;
      return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
    })
    .sort((a, b) => new Date(String(a.startDate)).getTime() - new Date(String(b.startDate)).getTime())
    .slice(0, eventLimit)
    .map((event) => ({
      id: boundedString(event.id, 256),
      summary: boundedString(event.summary, 500),
      startDate: boundedString(event.startDate, 64),
      endDate: boundedString(event.endDate, 64),
      allDay: event.allDay === true,
      calendar: boundedString(event.calendar, 200),
    }));

  const overdue = (Array.isArray(reminderResult.reminders) ? reminderResult.reminders : [])
    .filter((reminder) => {
      const timestamp = typeof reminder.dueDate === "string" ? new Date(reminder.dueDate).getTime() : Number.NaN;
      return reminder.completed !== true && Number.isFinite(timestamp) && timestamp < now.getTime();
    })
    .sort((a, b) => new Date(String(a.dueDate)).getTime() - new Date(String(b.dueDate)).getTime())
    .slice(0, reminderLimit)
    .map((reminder) => ({
      id: boundedString(reminder.id, 256),
      name: boundedString(reminder.name, 500),
      completed: false as const,
      dueDate: boundedString(reminder.dueDate, 64),
      priority: typeof reminder.priority === "number" && Number.isFinite(reminder.priority) ? reminder.priority : 0,
      flagged: reminder.flagged === true,
      list: boundedString(reminder.list, 200),
    }));

  return {
    timestamp: now.toISOString(),
    workflowId: "today-overview",
    calendar: { returned: events.length, events },
    reminders: { returned: overdue.length, overdue },
  };
}
