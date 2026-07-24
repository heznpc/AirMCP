/**
 * ToolRegistry.previewCall — the pre-hoc twin of callTool.
 *
 * The flagship property is STRUCTURAL zero-execution: previewCall validates
 * args and returns the exact audit args a call would record, but never invokes
 * the handler. These tests register a handler spy and assert it stays untouched
 * across a preview, plus that annotations (incl. the newly-persisted
 * sensitiveHint), arg validation, and unknown-tool handling are accurate.
 */
import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { z } from "zod";

jest.unstable_mockModule("../dist/shared/usage-tracker.js", () => ({
  usageTracker: { record: jest.fn() },
}));
jest.unstable_mockModule("../dist/shared/audit.js", () => ({
  auditLog: jest.fn(),
  readAuditEntries: jest.fn(),
  // Real previewCall scrubs args; a marker-wrapping passthrough lets the test
  // prove auditArgs came from sanitizeArgs without importing the real scrubber.
  sanitizeArgs: jest.fn((a) => ({ ...a, _scrubbed: true })),
}));
jest.unstable_mockModule("../dist/shared/tool-filter.js", () => ({
  compactDescription: jest.fn((d) => (d ? d.substring(0, 80) : d)),
}));

const { createToolRegistry } = await import("../dist/shared/tool-registry.js");

function createMockServer() {
  const tools = new Map();
  return {
    registerTool: jest.fn((name, opts, handler) => tools.set(name, { opts, handler })),
    tool: jest.fn((name, ...rest) => tools.set(name, { rest })),
    registerPrompt: jest.fn(),
    prompt: jest.fn(),
    _tools: tools,
  };
}

describe("ToolRegistry.previewCall", () => {
  let registry;
  let server;
  let handlerSpy;

  beforeEach(() => {
    registry = createToolRegistry();
    server = createMockServer();
    registry.installOn(server);
    handlerSpy = jest.fn(async () => ({ content: [] }));
  });

  test("destructive tool: accurate annotations + valid args + audit preview, handler NEVER invoked", () => {
    server.registerTool(
      "delete_thing",
      {
        title: "Delete Thing",
        description: "Deletes a thing",
        inputSchema: { id: z.string() },
        annotations: { destructiveHint: true, readOnlyHint: false },
      },
      handlerSpy,
    );

    const preview = registry.previewCall("delete_thing", { id: "abc" });

    expect(preview.exists).toBe(true);
    expect(preview.annotations).toEqual({ destructive: true, readOnly: false, sensitive: false });
    expect(preview.argsValid).toBe(true);
    expect(preview.auditArgs).toEqual({ id: "abc", _scrubbed: true });
    // The load-bearing guarantee: the handler was never called.
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  test("sensitive read-only tool: sensitiveHint is persisted and surfaced", () => {
    server.registerTool(
      "read_secret",
      {
        title: "Read Secret",
        description: "Reads sensitive state",
        inputSchema: {},
        annotations: { readOnlyHint: true, sensitiveHint: true, destructiveHint: false },
      },
      handlerSpy,
    );

    const preview = registry.previewCall("read_secret", {});
    expect(preview.annotations).toEqual({ destructive: false, readOnly: true, sensitive: true });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  test("invalid args: argsValid false + validationError, still no execution", () => {
    server.registerTool(
      "needs_id",
      { title: "Needs Id", description: "x", inputSchema: { id: z.string() }, annotations: {} },
      handlerSpy,
    );

    const preview = registry.previewCall("needs_id", { id: 123 });
    expect(preview.exists).toBe(true);
    expect(preview.argsValid).toBe(false);
    expect(typeof preview.validationError).toBe("string");
    expect(preview.auditArgs).toBeDefined();
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  test("unknown tool: exists false, nothing else", () => {
    const preview = registry.previewCall("no_such_tool", {});
    expect(preview).toEqual({ exists: false });
  });

  test("hidden (non-exposed) tools are still previewable — the whole point of pre-hoc preview", () => {
    // Progressive exposure hides most tools from the SDK, but the registry
    // still records them; a cautious client must be able to preview before
    // widening access.
    registry.configureExposure({ mode: "progressive", exposedToolNames: [] });
    server.registerTool(
      "hidden_delete",
      { title: "Hidden", description: "x", inputSchema: {}, annotations: { destructiveHint: true } },
      handlerSpy,
    );
    const preview = registry.previewCall("hidden_delete", {});
    expect(preview.exists).toBe(true);
    expect(preview.exposed).toBe(false);
    expect(preview.annotations.destructive).toBe(true);
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
