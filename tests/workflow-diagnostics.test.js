import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRunJxa = jest.fn();
jest.unstable_mockModule("../dist/shared/jxa.js", () => ({
  runJxa: mockRunJxa,
}));

const { collectTodayOverviewDiagnostic } = await import("../dist/shared/workflow-diagnostics.js");

describe("today overview local diagnostic collector", () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test("reads only today's events and reminders due before now, with bounded sanitized output", async () => {
    const now = new Date(2026, 6, 12, 15, 0, 0, 0);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const inDay = (hours) => new Date(dayStart.getTime() + hours * 60 * 60 * 1000).toISOString();
    const longSummary = "S".repeat(700);

    mockRunJxa
      .mockResolvedValueOnce({
        total: 5,
        events: [
          {
            id: "outside-before",
            summary: "Previous day secret",
            startDate: new Date(dayStart.getTime() - 1).toISOString(),
            endDate: dayStart.toISOString(),
            allDay: false,
            calendar: "Private",
          },
          {
            id: "later",
            summary: "Later event",
            startDate: inDay(10),
            endDate: inDay(11),
            allDay: false,
            calendar: "Work",
          },
          {
            id: "earlier",
            summary: longSummary,
            startDate: inDay(2),
            endDate: inDay(3),
            allDay: false,
            calendar: "Work",
          },
          {
            id: "third",
            summary: "Bounded away",
            startDate: inDay(12),
            endDate: inDay(13),
            allDay: false,
            calendar: "Work",
          },
          {
            id: "outside-after",
            summary: "Next day secret",
            startDate: dayEnd.toISOString(),
            endDate: new Date(dayEnd.getTime() + 3_600_000).toISOString(),
            allDay: false,
            calendar: "Private",
          },
        ],
      })
      .mockResolvedValueOnce({
        totalIncomplete: 99,
        dueToday: [{ name: "Must never leak" }],
        reminders: [
          {
            id: "oldest",
            name: "Oldest overdue",
            completed: false,
            dueDate: new Date(now.getTime() - 7_200_000).toISOString(),
            priority: 1,
            flagged: true,
            list: "Work",
          },
          {
            id: "earlier-today",
            name: "Earlier today is overdue",
            completed: false,
            dueDate: new Date(now.getTime() - 1).toISOString(),
            priority: 0,
            flagged: false,
            list: "Today",
          },
          {
            id: "exactly-now",
            name: "Not overdue at equality",
            completed: false,
            dueDate: now.toISOString(),
          },
          {
            id: "future",
            name: "Future reminder secret",
            completed: false,
            dueDate: new Date(now.getTime() + 1).toISOString(),
          },
          {
            id: "completed",
            name: "Completed reminder secret",
            completed: true,
            dueDate: new Date(now.getTime() - 3_600_000).toISOString(),
          },
          { id: "undated", name: "Undated reminder secret", completed: false, dueDate: null },
        ],
      });

    const result = await collectTodayOverviewDiagnostic({ now, eventLimit: 2, reminderLimit: 2 });

    expect(mockRunJxa).toHaveBeenCalledTimes(2);
    const calendarScript = mockRunJxa.mock.calls[0][0];
    const reminderScript = mockRunJxa.mock.calls[1][0];
    expect(calendarScript).toContain(dayStart.toISOString());
    expect(calendarScript).toContain(new Date(dayEnd.getTime() - 1).toISOString());
    expect(calendarScript).toContain("s + 2");
    expect(reminderScript).toContain(`const cutoff = new Date("${now.toISOString()}")`);
    expect(reminderScript).toContain("dues[i] < cutoff");
    expect(reminderScript).toContain("matches.slice(0, 2)");
    expect(() => new Function(calendarScript)).not.toThrow();
    expect(() => new Function(reminderScript)).not.toThrow();

    expect(result.calendar.returned).toBe(2);
    expect(result.calendar.events.map((event) => event.id)).toEqual(["earlier", "later"]);
    expect(result.calendar.events[0].summary).toHaveLength(500);
    expect(result.reminders).toEqual({
      returned: 2,
      overdue: [
        expect.objectContaining({ id: "oldest", name: "Oldest overdue" }),
        expect.objectContaining({ id: "earlier-today", name: "Earlier today is overdue" }),
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("totalIncomplete");
    expect(serialized).not.toContain("dueToday");
    expect(serialized).not.toContain("Future reminder secret");
    expect(serialized).not.toContain("Completed reminder secret");
    expect(serialized).not.toContain("Undated reminder secret");
    expect(serialized).not.toContain("Previous day secret");
    expect(serialized).not.toContain("Next day secret");
    expect(serialized).not.toContain("Bounded away");
  });
});
