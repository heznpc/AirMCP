/**
 * Regression test for RFC 0007 A.3 destructive-tool dialog accuracy.
 *
 * Pre-fix every destructive AppIntent shipped the same generic line
 * ("This action is destructive and cannot be undone") in its
 * IntentDialog. That message was WRONG for soft-delete tools whose
 * description explicitly documents a recovery window (`delete_note` →
 * 30-day Recently Deleted) and OVER-DRAMATIC for non-deletion
 * destructives like `bulk_move_notes` (rearranges, doesn't destroy
 * data). The fix builds the dialog body from the tool's own
 * `description` field so Shortcuts / Siri shows the actual consequence
 * before the user confirms.
 *
 * Two layers of coverage:
 *
 *  1. Direct unit tests of `buildConfirmDialogBody` — exercises the
 *     sanitization, truncation, fallback, and title composition rules
 *     without needing the full manifest. Cheap, fast, deterministic.
 *
 *  2. Integration through the live codegen with
 *     AIRMCP_APPINTENTS_DESTRUCTIVE=true — proves the helper actually
 *     gets wired into the emitted Swift for representative destructive
 *     tools we ship (delete_note, delete_event, trash_file,
 *     bulk_move_notes). If a future refactor disconnects the helper
 *     from generateIntent's confirmBlock, the strings won't match and
 *     this test fires.
 */
import { describe, test, expect, beforeAll } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GEN_SCRIPT = join(ROOT, "scripts", "gen-swift-intents.mjs");

// Import from the lib (not from gen-swift-intents.mjs) so importing
// doesn't trigger the codegen's top-level write. This decoupling is
// the reason the helper lives in scripts/lib/codegen-helpers.mjs.
const { buildConfirmDialogBody } = await import("../scripts/lib/codegen-helpers.mjs");

describe("buildConfirmDialogBody (unit)", () => {
  test("combines title + description into the dialog body", () => {
    const tool = {
      name: "delete_thing",
      title: "Delete Thing",
      description: "Delete a thing by id.",
      annotations: { destructiveHint: true },
    };
    expect(buildConfirmDialogBody(tool)).toBe("Delete Thing with AirMCP? Delete a thing by id.");
  });

  test("falls back to generic body when description is missing", () => {
    const tool = {
      name: "x",
      title: "X",
      description: "",
      annotations: { destructiveHint: true },
    };
    // No description → the generic "cannot be undone" line is the
    // safer default. Future tools that forget a description still get
    // a sensible (if blunt) dialog.
    expect(buildConfirmDialogBody(tool)).toBe(
      "X with AirMCP? This action is destructive and cannot be undone.",
    );
  });

  test("falls back to a generic action label when title is missing too", () => {
    const tool = { name: "y", title: "", description: "", annotations: { destructiveHint: true } };
    expect(buildConfirmDialogBody(tool)).toBe(
      "Run this AirMCP action? This action is destructive and cannot be undone.",
    );
  });

  test('sanitizes characters that would break the Swift string literal', () => {
    const tool = {
      name: "weird",
      title: 'Strange "Tool"',
      // Include the four characters the Swift literal cannot tolerate:
      // double-quote, backslash, CR, LF — each in its own paragraph so
      // a regression that drops one of them is easy to spot.
      description: 'Line one with "quote".\nLine two with \\ backslash.\rTrailing return.',
      annotations: { destructiveHint: true },
    };
    const body = buildConfirmDialogBody(tool);
    expect(body).not.toMatch(/["\\\r\n]/);
    // Internal whitespace collapses to single spaces so the dialog
    // doesn't render with awkward double-spaces.
    expect(body).not.toMatch(/  +/);
  });

  test("truncates very long bodies at 220 chars with ellipsis", () => {
    const longDesc = "x".repeat(500);
    const body = buildConfirmDialogBody({
      name: "long",
      title: "Long",
      description: longDesc,
      annotations: { destructiveHint: true },
    });
    expect(body.length).toBeLessThanOrEqual(220);
    expect(body.endsWith("…")).toBe(true);
  });

  test("does NOT truncate bodies at or under the cap", () => {
    const body = buildConfirmDialogBody({
      name: "tight",
      title: "Tight",
      // Title prefix is "Tight with AirMCP? " (19 chars) plus this
      // payload — total = 220 exactly, edge-of-cap, no ellipsis.
      description: "y".repeat(201),
      annotations: { destructiveHint: true },
    });
    expect(body.length).toBe(220);
    expect(body.endsWith("…")).toBe(false);
  });
});

describe("generated Swift dialogs (integration with AIRMCP_APPINTENTS_DESTRUCTIVE=true)", () => {
  let generated;
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "airmcp-codegen-dest-"));
    const outPath = join(tmpDir, "MCPIntents.swift");
    // Run the actual production codegen so the test exercises the
    // same path a developer or CI would invoke. Output goes to a
    // tmpdir so the test never mutates the checked-in Swift file.
    execFileSync("node", [GEN_SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        AIRMCP_APPINTENTS_DESTRUCTIVE: "true",
        AIRMCP_INTENTS_OUT: outPath,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    generated = readFileSync(outPath, "utf8");
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // The four tools below cover the failure modes the pre-fix dialog
  // got wrong: soft delete with recovery window, permanent delete,
  // file system move-to-trash, and bulk rearrange-not-delete. If any
  // of these dialogs reverts to the historic generic body, this test
  // fires.
  const cases = [
    {
      tool: "delete_note",
      // Substring chosen from the tool's actual description so a
      // wording tweak in description doesn't false-fire — but the
      // recovery window is the load-bearing part of the message.
      mustContain: "Recently Deleted",
      mustNotContain: "cannot be undone",
    },
    {
      tool: "delete_event",
      // delete_event's own description does say "permanent" — the
      // dialog now echoes that truthfully.
      mustContain: "Delete a calendar event by ID. This action is permanent.",
      mustNotContain: null,
    },
    {
      tool: "trash_file",
      mustContain: "Move a file or folder to the Trash",
      // trash_file is recoverable from .Trash so the historic
      // "cannot be undone" claim was wrong here too.
      mustNotContain: "cannot be undone",
    },
    {
      tool: "bulk_move_notes",
      mustContain: "Move multiple notes",
      // bulk_move_notes rearranges; nothing is destroyed.
      mustNotContain: "cannot be undone",
    },
  ];

  for (const { tool, mustContain, mustNotContain } of cases) {
    test(`dialog for ${tool} uses the tool's description`, () => {
      // Find the perform() block for this tool. Each generated
      // destructive intent is preceded by `// Tool: <name>` per the
      // codegen template.
      const marker = `// Tool: ${tool}`;
      const idx = generated.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      // Look inside the next ~2000 chars (enough for one full Intent
      // struct including the requestConfirmation block).
      const slice = generated.slice(idx, idx + 2000);
      expect(slice).toMatch(/requestConfirmation\(/);
      expect(slice).toContain(mustContain);
      if (mustNotContain) {
        expect(slice).not.toContain(mustNotContain);
      }
    });
  }

  test("non-destructive write tools have NO requestConfirmation block", () => {
    // `create_event` is a write tool with destructiveHint: false —
    // per RFC 0007 §6 it lands in Phase A.3 same as destructives but
    // skips the confirmation. Pin that the confirmBlock truly only
    // fires for destructiveHint: true.
    const marker = "// Tool: create_event";
    const idx = generated.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const slice = generated.slice(idx, idx + 1500);
    expect(slice).not.toMatch(/requestConfirmation\(/);
  });

  test("FoundationModels AppShortcut is behind the explicit preview compile flag", () => {
    expect(generated).toContain(
      "#if AIRMCP_ENABLE_FOUNDATION_MODELS && canImport(FoundationModels) && compiler(>=6.3)",
    );
    expect(generated).toContain("public struct AirMCPAskShortcut: AppShortcutsProvider");
    expect(generated).not.toContain("if #available(macOS 26, iOS 26, *) {\n            AppShortcut(");
  });

  test("generated AppIntent perform methods run on the main actor for SwiftUI snippets", () => {
    const marker = "// Tool: today_events";
    const idx = generated.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const slice = generated.slice(idx, idx + 1600);
    expect(slice).toContain("@MainActor\n    public func perform() async throws");
    expect(slice).toContain("view: MCPTodayEventsSnippetView(data: decoded)");
  });

  test("optional scalar snippet fields render with nil fallbacks", () => {
    const marker = "public struct MCPMemoryStatsSnippetView: View";
    const idx = generated.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const slice = generated.slice(idx, idx + 1800);
    expect(slice).toContain('Text((data.oldest ?? "—"))');
    expect(slice).toContain('Text((data.newest ?? "—"))');
  });
});
