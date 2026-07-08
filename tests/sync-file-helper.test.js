import { describe, expect, test } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReplacements, syncFile } from "../scripts/lib/sync-file.mjs";

describe("sync-file helper", () => {
  test("updates numeric capture anchors", () => {
    const result = applyReplacements("295 tools across 30 modules", [
      { pattern: /(\d+) tools across/, value: 296, label: "tool count" },
      { pattern: /across (\d+) modules/, value: 31, label: "module count" },
    ]);

    expect(result.content).toBe("296 tools across 31 modules");
    expect(result.changed).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test("keeps matching current anchors from being reported as missing", () => {
    const result = applyReplacements("295 tools across 31 modules", [
      { pattern: /(\d+) tools across/, value: 295, label: "tool count", required: true },
      { pattern: /across (\d+) modules/, value: 31, label: "module count" },
    ]);

    expect(result.content).toBe("295 tools across 31 modules");
    expect(result.changed).toBe(false);
    expect(result.missing).toEqual([]);
  });

  test("reports deleted numeric anchors even when the file is otherwise unchanged", () => {
    const result = applyReplacements("Approval-gated Apple MCP runtime.", [
      { pattern: /(\d+) tools across/, value: 295, label: "tool count", required: true },
    ]);

    expect(result.changed).toBe(false);
    expect(result.missing).toEqual(["tool count"]);
  });

  test("allows optional legacy anchors to be absent", () => {
    const result = applyReplacements("Current generated surfaces: 232 Shortcuts / Siri AppIntents.", [
      { pattern: /(\d+) tools are auto-registered/g, value: 295, label: "old shortcuts count" },
    ]);

    expect(result.changed).toBe(false);
    expect(result.missing).toEqual([]);
  });

  test("reports deleted literal replacement anchors", () => {
    const result = applyReplacements("No version header here.", [
      { pattern: /AirMCP v[\d.]+/, replacement: "AirMCP v2.15.0", label: "privacy policy version", required: true },
    ]);

    expect(result.changed).toBe(false);
    expect(result.missing).toEqual(["privacy policy version"]);
  });

  test("syncFile treats missing anchors as fatal in check mode", () => {
    const root = mkdtempSync(join(tmpdir(), "airmcp-sync-file-"));
    try {
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "docs", "example.md"), "No count anchor here.\n");

      const messages = [];
      const result = syncFile(
        root,
        "docs/example.md",
        [{ pattern: /(\d+) tools across/, value: 295, label: "tool count", required: true }],
        {
          mode: "check",
          logger: {
            error: (message) => messages.push(message),
            log: (message) => messages.push(message),
            warn: (message) => messages.push(message),
          },
        },
      );

      expect(result).toMatchObject({ dirty: true, fatal: true });
      expect(messages.join("\n")).toContain("MISSING: docs/example.md");
      expect(readFileSync(join(root, "docs", "example.md"), "utf-8")).toBe("No count anchor here.\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
