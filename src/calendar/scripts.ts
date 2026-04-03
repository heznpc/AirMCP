// JXA scripts for Apple Calendar automation.
// Each function returns a JXA script string to be executed via osascript.

import { esc } from "../shared/esc.js";

export function listCalendarsScript(): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    const result = [];
    for (let i = 0; i < cals.length; i++) {
      try {
        const cal = cals[i];
        let color = null;
        let writable = false;
        try { color = cal.color(); } catch(e) {}
        try { writable = cal.writable(); } catch(e) {}
        result.push({ id: cal.id(), name: cal.name(), color: color, writable: writable });
      } catch(e) {}
    }
    JSON.stringify(result);
  `;
}

export function listEventsScript(
  startDate: string,
  endDate: string,
  limit: number,
  offset: number,
  calendar?: string,
): string {
  if (calendar) {
    return `
      const Calendar = Application('Calendar');
      const cals = Calendar.calendars.whose({name: '${esc(calendar)}'})();
      if (cals.length === 0) throw new Error('Calendar not found: ${esc(calendar)}');
      const cal = cals[0];
      const start = new Date('${esc(startDate)}');
      const end = new Date('${esc(endDate)}');
      const events = cal.events.whose({
        _and: [{startDate: {_greaterThanEquals: start}}, {startDate: {_lessThanEquals: end}}]
      })();
      const total = events.length;
      const s = Math.min(${offset}, total);
      const e = Math.min(s + ${limit}, total);
      const result = [];
      for (let i = s; i < e; i++) {
        const ev = events[i];
        result.push({
          id: ev.uid(),
          summary: ev.summary(),
          startDate: ev.startDate().toISOString(),
          endDate: ev.endDate().toISOString(),
          allDay: ev.alldayEvent(),
          calendar: '${esc(calendar)}'
        });
      }
      JSON.stringify({total: total, offset: s, returned: result.length, events: result});
    `;
  }
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    const start = new Date('${esc(startDate)}');
    const end = new Date('${esc(endDate)}');
    const all = [];
    for (const cal of cals) {
      const filtered = cal.events.whose({
        _and: [{startDate: {_greaterThanEquals: start}}, {startDate: {_lessThanEquals: end}}]
      });
      const count = filtered.length;
      if (count === 0) continue;
      const eUids = filtered.uid();
      const eSummaries = filtered.summary();
      const eStarts = filtered.startDate();
      const eEnds = filtered.endDate();
      const eAllDay = filtered.alldayEvent();
      const calName = cal.name();
      const safe = Math.min(count, eUids.length, eSummaries.length, eStarts.length, eEnds.length, eAllDay.length);
      for (let i = 0; i < safe; i++) {
        if (eUids[i] == null || eStarts[i] == null || eEnds[i] == null) continue;
        all.push({
          id: eUids[i], summary: eSummaries[i] || '',
          startDate: eStarts[i].toISOString(), endDate: eEnds[i].toISOString(),
          allDay: eAllDay[i] ?? false, calendar: calName
        });
      }
    }
    all.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    const total = all.length;
    const s = Math.min(${offset}, total);
    const e = Math.min(s + ${limit}, total);
    JSON.stringify({total: total, offset: s, returned: e - s, events: all.slice(s, e)});
  `;
}

export function readEventScript(id: string): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    let found = null;
    for (const cal of cals) {
      const events = cal.events.whose({uid: '${esc(id)}'})();
      if (events.length > 0) {
        const ev = events[0];
        const attendeeList = [];
        try {
          const attendees = ev.attendees();
          for (const a of attendees) {
            attendeeList.push({
              name: a.displayName(),
              email: a.email(),
              status: a.participationStatus()
            });
          }
        } catch(e) {}
        found = {
          id: ev.uid(),
          summary: ev.summary(),
          description: ev.description(),
          location: ev.location(),
          startDate: ev.startDate().toISOString(),
          endDate: ev.endDate().toISOString(),
          allDay: ev.alldayEvent(),
          recurrence: ev.recurrence(),
          url: ev.url(),
          calendar: cal.name(),
          attendees: attendeeList
        };
        break;
      }
    }
    if (!found) throw new Error('Event not found: ${esc(id)}');
    JSON.stringify(found);
  `;
}

export function createEventScript(
  summary: string,
  startDate: string,
  endDate: string,
  opts: { location?: string; description?: string; calendar?: string; allDay?: boolean },
): string {
  const props = [
    `summary: '${esc(summary)}'`,
    `startDate: new Date('${esc(startDate)}')`,
    `endDate: new Date('${esc(endDate)}')`,
  ];
  if (opts.location) props.push(`location: '${esc(opts.location)}'`);
  if (opts.description) props.push(`description: '${esc(opts.description)}'`);
  if (opts.allDay !== undefined) props.push(`alldayEvent: ${opts.allDay}`);

  if (opts.calendar) {
    return `
      const Calendar = Application('Calendar');
      const cals = Calendar.calendars.whose({name: '${esc(opts.calendar)}'})();
      if (cals.length === 0) throw new Error('Calendar not found: ${esc(opts.calendar)}');
      const ev = Calendar.Event({${props.join(", ")}});
      cals[0].events.push(ev);
      JSON.stringify({id: ev.uid(), summary: ev.summary()});
    `;
  }
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars.whose({writable: true})();
    if (cals.length === 0) throw new Error('No writable calendar found');
    const ev = Calendar.Event({${props.join(", ")}});
    cals[0].events.push(ev);
    JSON.stringify({id: ev.uid(), summary: ev.summary()});
  `;
}

export function updateEventScript(
  id: string,
  updates: { summary?: string; startDate?: string; endDate?: string; location?: string; description?: string },
): string {
  const lines: string[] = [];
  if (updates.summary !== undefined) lines.push(`ev.summary = '${esc(updates.summary)}';`);
  if (updates.startDate !== undefined) lines.push(`ev.startDate = new Date('${esc(updates.startDate)}');`);
  if (updates.endDate !== undefined) lines.push(`ev.endDate = new Date('${esc(updates.endDate)}');`);
  if (updates.location !== undefined) lines.push(`ev.location = '${esc(updates.location)}';`);
  if (updates.description !== undefined) lines.push(`ev.description = '${esc(updates.description)}';`);

  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    let ev = null;
    for (const cal of cals) {
      const events = cal.events.whose({uid: '${esc(id)}'})();
      if (events.length > 0) { ev = events[0]; break; }
    }
    if (!ev) throw new Error('Event not found: ${esc(id)}');
    ${lines.join("\n    ")}
    JSON.stringify({id: ev.uid(), summary: ev.summary()});
  `;
}

export function deleteEventScript(id: string): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    let result = null;
    for (const cal of cals) {
      const events = cal.events.whose({uid: '${esc(id)}'})();
      if (events.length > 0) {
        const summary = events[0].summary();
        Calendar.delete(events[0]);
        result = {deleted: true, summary: summary};
        break;
      }
    }
    if (!result) throw new Error('Event not found: ${esc(id)}');
    JSON.stringify(result);
  `;
}

export function searchEventsScript(query: string, startDate: string, endDate: string, limit: number): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    const start = new Date('${esc(startDate)}');
    const end = new Date('${esc(endDate)}');
    const q = '${esc(query)}'.toLowerCase();
    const all = [];
    for (const cal of cals) {
      const filtered = cal.events.whose({
        _and: [{startDate: {_greaterThanEquals: start}}, {startDate: {_lessThanEquals: end}}]
      });
      const count = filtered.length;
      if (count === 0) continue;
      const eSummaries = filtered.summary();
      const eDescs = filtered.description();
      const eUids = filtered.uid();
      const eStarts = filtered.startDate();
      const eEnds = filtered.endDate();
      const eAllDay = filtered.alldayEvent();
      const calName = cal.name();
      const safe = Math.min(count, eUids.length, eSummaries.length, eDescs.length, eStarts.length, eEnds.length, eAllDay.length);
      for (let i = 0; i < safe; i++) {
        if (eUids[i] == null || eStarts[i] == null || eEnds[i] == null) continue;
        const summary = eSummaries[i] || '';
        const desc = eDescs[i] || '';
        if (summary.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
          all.push({
            id: eUids[i], summary: summary,
            startDate: eStarts[i].toISOString(), endDate: eEnds[i].toISOString(),
            allDay: eAllDay[i] ?? false, calendar: calName
          });
        }
      }
    }
    all.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    const result = all.slice(0, ${limit});
    JSON.stringify({total: all.length, returned: result.length, events: result});
  `;
}

export function getUpcomingEventsScript(limit: number): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const all = [];
    for (const cal of cals) {
      const filtered = cal.events.whose({
        _and: [{startDate: {_greaterThanEquals: now}}, {startDate: {_lessThanEquals: end}}]
      });
      const count = filtered.length;
      if (count === 0) continue;
      const eUids = filtered.uid();
      const eSummaries = filtered.summary();
      const eStarts = filtered.startDate();
      const eEnds = filtered.endDate();
      const eAllDay = filtered.alldayEvent();
      const eLocs = filtered.location();
      const calName = cal.name();
      const safe = Math.min(count, eUids.length, eSummaries.length, eStarts.length, eEnds.length, eAllDay.length, eLocs.length);
      for (let i = 0; i < safe; i++) {
        if (eUids[i] == null || eStarts[i] == null || eEnds[i] == null) continue;
        all.push({
          id: eUids[i], summary: eSummaries[i] || '',
          startDate: eStarts[i].toISOString(), endDate: eEnds[i].toISOString(),
          allDay: eAllDay[i] ?? false, location: eLocs[i] || null, calendar: calName
        });
      }
    }
    all.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    const result = all.slice(0, ${limit});
    JSON.stringify({total: all.length, returned: result.length, events: result});
  `;
}

export function todayEventsScript(): string {
  return `
    const Calendar = Application('Calendar');
    const cals = Calendar.calendars();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const all = [];
    for (const cal of cals) {
      const filtered = cal.events.whose({
        _and: [{startDate: {_greaterThanEquals: start}}, {startDate: {_lessThanEquals: end}}]
      });
      const count = filtered.length;
      if (count === 0) continue;
      const eUids = filtered.uid();
      const eSummaries = filtered.summary();
      const eStarts = filtered.startDate();
      const eEnds = filtered.endDate();
      const eAllDay = filtered.alldayEvent();
      const eLocs = filtered.location();
      const calName = cal.name();
      const safe = Math.min(count, eUids.length, eSummaries.length, eStarts.length, eEnds.length, eAllDay.length, eLocs.length);
      for (let i = 0; i < safe; i++) {
        if (eUids[i] == null || eStarts[i] == null || eEnds[i] == null) continue;
        all.push({
          id: eUids[i], summary: eSummaries[i] || '',
          startDate: eStarts[i].toISOString(), endDate: eEnds[i].toISOString(),
          allDay: eAllDay[i] ?? false, location: eLocs[i] || null, calendar: calName
        });
      }
    }
    all.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    JSON.stringify({total: all.length, returned: all.length, events: all});
  `;
}
