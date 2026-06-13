// Wire-description contract for compact mode (src/shared/tool-filter.ts).
//
// Compact mode is ON by default (AIRMCP_COMPACT_TOOLS unset in the test env),
// and what these tests pin is the shape of what every MCP client actually
// receives in tools/list: complete sentences within the budget, never a
// mid-word cut. The old implementation (first sentence hard-capped at 80
// chars, sliced to 77+"...") shipped broken prose for every tool whose first
// sentence ran past 80 — registry quality scoring flagged it catalog-wide.

import { describe, test, expect } from "@jest/globals";
import { compactDescription } from "../dist/shared/tool-filter.js";

const BUDGET = 160;

describe("compactDescription (compact mode on)", () => {
  test("short description passes through, gaining terminal punctuation", () => {
    expect(compactDescription("Create a new folder")).toBe("Create a new folder.");
    expect(compactDescription("Get all calendar events for today.")).toBe(
      "Get all calendar events for today.",
    );
  });

  test("keeps as many whole sentences as fit the budget", () => {
    const s1 = "First sentence about the tool purpose.";
    const s2 = "Second sentence with extra details for discovery.";
    const s3 = "x".repeat(120) + ".";
    const out = compactDescription(`${s1} ${s2} ${s3}`);
    expect(out).toBe(`${s1} ${s2}`);
    expect(out.length).toBeLessThanOrEqual(BUDGET);
  });

  test("over-budget tail is dropped at a sentence boundary, not mid-word", () => {
    const s1 = "A complete leading sentence that fits the budget on its own.";
    const s2 = "This trailing sentence is long enough that including it would push the total well past the one-sixty character budget for the wire description.";
    const out = compactDescription(`${s1} ${s2}`);
    expect(out).toBe(s1);
  });

  test("never cuts mid-word and never emits '...'", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = compactDescription(words);
    expect(out.length).toBeLessThanOrEqual(BUDGET);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\.\.\./);
    const lastWord = out.slice(0, -1).trim().split(" ").pop();
    expect(words.split(" ")).toContain(lastWord);
  });

  test("abbreviation-style punctuation does not split a sentence", () => {
    // "etc.)" — the '.' is followed by ')', not whitespace → not a boundary.
    const s1 =
      "[Skill] Snapshot today's events and open reminders whenever macOS Focus mode changes (Do Not Disturb, Personal, etc.) — read-only, nothing is written.";
    const s2 =
      "Gives the AI fresh context right after a mode switch; showcases the focus_mode_changed event trigger plus parallel data gathering.";
    const out = compactDescription(`${s1} ${s2}`);
    expect(out).toBe(s1);
    expect(out.endsWith("…")).toBe(false);
  });

  test("real fixture: find_related first sentence survives whole", () => {
    const desc =
      "Find items semantically related to a note, event, reminder, or email ID across indexed Apple apps — read-only; requires semantic_index to be built first. " +
      "Discovers cross-app connections (e.g., a calendar event related to notes and reminders about the same topic).";
    const out = compactDescription(desc);
    expect(out).toBe(
      "Find items semantically related to a note, event, reminder, or email ID across indexed Apple apps — read-only; requires semantic_index to be built first.",
    );
  });
});
