// JXA scripts for Apple Reminders automation.
// Each function returns a JXA script string to be executed via osascript.

import { esc } from "../shared/esc.js";

// The interfaces below pin the shape of each script's final
// `JSON.stringify(...)`, and the `*_EXAMPLE` constants carry a concrete instance
// of it. `tests/script-shape-contract.test.js` parses every example through the
// matching tool's real `outputSchema`, so changing what a script emits without
// updating the example (and the outputSchema) fails a test rather than passing
// the tautological mock-in-mock-out runtime check. Examples and scripts must be
// kept in lockstep by hand.
//
// Reminder tools run through `runAutomation`, so these shapes are a contract for
// BOTH backends: the EventKit Swift bridge (`AirMCPKit/Types.swift`
// `ReminderListInfo` / `ReminderListItem` / `ReminderListOutput` /
// `ReminderDetail` / `SearchRemindersOutput`) and the JXA fallback below must
// agree field for field.

// ── Return shapes ───────────────────────────────────────────────────────
export interface RemindersListInfo {
  id: string;
  name: string;
  reminderCount: number;
}

/** `list_reminder_lists` wraps the script's bare array as `{ lists }`. */
export interface RemindersListListsOutput {
  lists: RemindersListInfo[];
}

export interface RemindersListItem {
  id: string;
  name: string;
  completed: boolean;
  /** Null for reminders with no due date. */
  dueDate: string | null;
  priority: number;
  flagged: boolean;
  list: string;
}

export interface RemindersListOutput {
  total: number;
  offset: number;
  returned: number;
  reminders: RemindersListItem[];
}

export interface RemindersReadOutput extends RemindersListItem {
  body: string;
  /** Null until the reminder is completed. */
  completionDate: string | null;
  creationDate: string;
  modificationDate: string;
}

/** `search_reminders` reports only `returned` — it has no total to offer,
 *  because the scan stops as soon as the limit is reached. */
export interface RemindersSearchOutput {
  returned: number;
  reminders: RemindersListItem[];
}

// ── Example fixtures (hand-maintained; see tests/script-shape-contract) ──
const REMINDER_ROW: RemindersListItem = {
  id: "REM-1",
  name: "Buy milk",
  completed: false,
  dueDate: "2026-03-16T09:00:00.000Z",
  priority: 0,
  flagged: false,
  list: "Reminders",
};

export const LIST_REMINDER_LISTS_EXAMPLE: RemindersListListsOutput = {
  lists: [
    { id: "LIST-1", name: "Reminders", reminderCount: 12 },
    { id: "LIST-2", name: "Groceries", reminderCount: 0 },
  ],
};

export const LIST_REMINDERS_EXAMPLE: RemindersListOutput = {
  total: 3,
  offset: 0,
  returned: 2,
  reminders: [
    REMINDER_ROW,
    // No due date, and the search path falls back to '' for a missing name.
    { ...REMINDER_ROW, id: "REM-2", name: "", dueDate: null, completed: true, flagged: true, priority: 9 },
  ],
};

export const READ_REMINDER_EXAMPLE: RemindersReadOutput = {
  ...REMINDER_ROW,
  body: "Whole milk",
  completionDate: null,
  creationDate: "2026-03-01T08:00:00.000Z",
  modificationDate: "2026-03-15T09:00:00.000Z",
};

/** Same tool, completed case: `completionDate` is populated. */
export const READ_REMINDER_EXAMPLE_COMPLETED: RemindersReadOutput = {
  ...REMINDER_ROW,
  id: "REM-2",
  completed: true,
  body: "",
  completionDate: "2026-03-16T10:00:00.000Z",
  creationDate: "2026-03-01T08:00:00.000Z",
  modificationDate: "2026-03-16T10:00:00.000Z",
};

export const SEARCH_REMINDERS_EXAMPLE: RemindersSearchOutput = {
  returned: 1,
  reminders: [REMINDER_ROW],
};

export function listReminderListsScript(): string {
  return `
    const Reminders = Application('Reminders');
    const lists = Reminders.lists();
    const names = Reminders.lists.name();
    const ids = Reminders.lists.id();
    const result = names.map((name, i) => ({
      id: ids[i],
      name: name,
      reminderCount: lists[i].reminders.length
    }));
    JSON.stringify(result);
  `;
}

export function listRemindersScript(limit: number, offset: number, list?: string, completed?: boolean): string {
  const filterParts: string[] = [];
  if (completed === true) filterParts.push("r.completed()");
  if (completed === false) filterParts.push("!r.completed()");

  const filterExpr = filterParts.length > 0 ? `.filter(r => ${filterParts.join(" && ")})` : "";

  if (list) {
    return `
      const Reminders = Application('Reminders');
      const lists = Reminders.lists.whose({name: '${esc(list)}'})();
      if (lists.length === 0) throw new Error('List not found: ${esc(list)}');
      const l = lists[0];
      const reminders = l.reminders();
      const filtered = reminders${filterExpr};
      const all = filtered.map(r => ({
        id: r.id(),
        name: r.name(),
        completed: r.completed(),
        dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
        priority: r.priority(),
        flagged: r.flagged(),
        list: '${esc(list)}'
      }));
      const start = Math.min(${offset}, all.length);
      const end = Math.min(start + ${limit}, all.length);
      const result = all.slice(start, end);
      JSON.stringify({total: all.length, offset: start, returned: result.length, reminders: result});
    `;
  }
  const whoseFilter =
    completed === true ? ".whose({completed: true})" : completed === false ? ".whose({completed: false})" : "";
  return `
    const Reminders = Application('Reminders');
    const lists = Reminders.lists();
    const result = [];
    let totalAll = 0;
    let accumulated = 0;
    for (const l of lists) {
      const src = l.reminders${whoseFilter};
      const count = src.length;
      totalAll += count;
      if (count === 0) continue;
      if (result.length >= ${limit}) continue;
      if (accumulated + count <= ${offset}) { accumulated += count; continue; }
      const rIds = src.id();
      const rNames = src.name();
      const rCompleted = src.completed();
      const rDueDates = src.dueDate();
      const rPriorities = src.priority();
      const rFlagged = src.flagged();
      const listName = l.name();
      const startIdx = Math.max(0, ${offset} - accumulated);
      for (let i = startIdx; i < count && result.length < ${limit}; i++) {
        result.push({
          id: rIds[i], name: rNames[i], completed: rCompleted[i],
          dueDate: rDueDates[i] ? rDueDates[i].toISOString() : null,
          priority: rPriorities[i], flagged: rFlagged[i], list: listName
        });
      }
      accumulated += count;
    }
    JSON.stringify({total: totalAll, offset: Math.min(${offset}, totalAll), returned: result.length, reminders: result});
  `;
}

export function readReminderScript(id: string): string {
  return `
    const Reminders = Application('Reminders');
    const r = Reminders.reminders.byId('${esc(id)}');
    JSON.stringify({
      id: r.id(),
      name: r.name(),
      body: r.body(),
      completed: r.completed(),
      completionDate: r.completionDate() ? r.completionDate().toISOString() : null,
      creationDate: r.creationDate().toISOString(),
      modificationDate: r.modificationDate().toISOString(),
      dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
      priority: r.priority(),
      flagged: r.flagged(),
      list: r.container().name()
    });
  `;
}

export function createReminderScript(
  title: string,
  opts: { body?: string; dueDate?: string; priority?: number; list?: string },
): string {
  const props = [`name: '${esc(title)}'`];
  if (opts.body) props.push(`body: '${esc(opts.body)}'`);
  if (opts.priority !== undefined) props.push(`priority: ${opts.priority}`);

  const dateSetup = opts.dueDate ? `r.dueDate = new Date('${esc(opts.dueDate)}');` : "";

  if (opts.list) {
    return `
      const Reminders = Application('Reminders');
      const lists = Reminders.lists.whose({name: '${esc(opts.list)}'})();
      if (lists.length === 0) throw new Error('List not found: ${esc(opts.list)}');
      const r = Reminders.Reminder({${props.join(", ")}});
      lists[0].reminders.push(r);
      ${dateSetup}
      JSON.stringify({id: r.id(), name: r.name()});
    `;
  }
  return `
    const Reminders = Application('Reminders');
    const r = Reminders.Reminder({${props.join(", ")}});
    Reminders.defaultList().reminders.push(r);
    ${dateSetup}
    JSON.stringify({id: r.id(), name: r.name()});
  `;
}

export function updateReminderScript(
  id: string,
  updates: { name?: string; body?: string; dueDate?: string | null; priority?: number; flagged?: boolean },
): string {
  const lines: string[] = [];
  if (updates.name !== undefined) lines.push(`r.name = '${esc(updates.name)}';`);
  if (updates.body !== undefined) lines.push(`r.body = '${esc(updates.body)}';`);
  if (updates.dueDate === null) lines.push("r.dueDate = null;");
  else if (updates.dueDate !== undefined) lines.push(`r.dueDate = new Date('${esc(updates.dueDate)}');`);
  if (updates.priority !== undefined) lines.push(`r.priority = ${updates.priority};`);
  if (updates.flagged !== undefined) lines.push(`r.flagged = ${updates.flagged};`);

  return `
    const Reminders = Application('Reminders');
    const r = Reminders.reminders.byId('${esc(id)}');
    ${lines.join("\n    ")}
    JSON.stringify({id: r.id(), name: r.name()});
  `;
}

export function completeReminderScript(id: string, completed: boolean): string {
  return `
    const Reminders = Application('Reminders');
    const r = Reminders.reminders.byId('${esc(id)}');
    r.completed = ${completed};
    JSON.stringify({id: r.id(), name: r.name(), completed: r.completed()});
  `;
}

export function deleteReminderScript(id: string): string {
  return `
    const Reminders = Application('Reminders');
    const r = Reminders.reminders.byId('${esc(id)}');
    const name = r.name();
    Reminders.delete(r);
    JSON.stringify({deleted: true, name: name});
  `;
}

export function searchRemindersScript(query: string, limit: number): string {
  return `
    const Reminders = Application('Reminders');
    const lists = Reminders.lists();
    const q = '${esc(query)}';
    const result = [];
    for (const l of lists) {
      if (result.length >= ${limit}) break;
      const matches = l.reminders.whose({_or: [
        {name: {_contains: q}},
        {body: {_contains: q}}
      ]});
      const count = matches.length;
      if (count === 0) continue;
      const rIds = matches.id();
      const rNames = matches.name();
      const rCompleted = matches.completed();
      const rDueDates = matches.dueDate();
      const rPriorities = matches.priority();
      const rFlagged = matches.flagged();
      const listName = l.name();
      for (let i = 0; i < count && result.length < ${limit}; i++) {
        result.push({
          id: rIds[i], name: rNames[i] || '', completed: rCompleted[i],
          dueDate: rDueDates[i] ? rDueDates[i].toISOString() : null,
          priority: rPriorities[i], flagged: rFlagged[i], list: listName
        });
      }
    }
    JSON.stringify({returned: result.length, reminders: result});
  `;
}

export function createReminderListScript(name: string): string {
  return `
    const Reminders = Application('Reminders');
    const l = Reminders.List({name: '${esc(name)}'});
    Reminders.lists.push(l);
    JSON.stringify({id: l.id(), name: l.name()});
  `;
}

export function deleteReminderListScript(name: string): string {
  return `
    const Reminders = Application('Reminders');
    const lists = Reminders.lists.whose({name: '${esc(name)}'})();
    if (lists.length === 0) throw new Error('List not found: ${esc(name)}');
    Reminders.delete(lists[0]);
    JSON.stringify({deleted: true, name: '${esc(name)}'});
  `;
}
