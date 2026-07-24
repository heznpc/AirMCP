import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "airmcp-shutdown-"));
const previousAuditDir = process.env.AIRMCP_VECTOR_STORE_DIR;
const previousAuditKey = process.env.AIRMCP_AUDIT_HMAC_KEY;
const previousAuditEnabled = process.env.AIRMCP_AUDIT_LOG;
const previousUsageTracking = process.env.AIRMCP_USAGE_TRACKING;
process.env.AIRMCP_VECTOR_STORE_DIR = scratch;
process.env.AIRMCP_AUDIT_HMAC_KEY = "shutdown-test-key";
process.env.AIRMCP_AUDIT_LOG = "true";
process.env.AIRMCP_USAGE_TRACKING = "false";

const {
  _resetShutdownHooksForTests,
  registerShutdownFinalizer,
  registerShutdownHook,
  runShutdownHooks,
  unregisterShutdownHook,
} = await import("../dist/server/shutdown.js");
const { _testReset, auditLog, flushAuditLog } = await import("../dist/shared/audit.js");
const { createToolRegistry } = await import("../dist/shared/tool-registry.js");
const {
  _getGovernedActivityStateForTests,
  _resetGovernedActivityForTests,
  drainGovernedActivityForShutdown,
  runGovernedActivity,
} = await import("../dist/shared/governed-activity.js");

function createGovernedMockServer() {
  const tools = new Map();
  const resources = new Map();
  return {
    registerTool: jest.fn((name, options, handler) => tools.set(name, { options, handler })),
    tool: jest.fn(),
    registerResource: jest.fn((name, uriOrTemplate, config, handler) =>
      resources.set(name, { uriOrTemplate, config, handler }),
    ),
    registerPrompt: jest.fn(),
    prompt: jest.fn(),
    _tools: tools,
    _resources: resources,
  };
}

beforeEach(() => {
  _resetShutdownHooksForTests();
  _resetGovernedActivityForTests();
  _testReset();
  rmSync(scratch, { recursive: true, force: true });
});

afterAll(() => {
  _resetShutdownHooksForTests();
  _resetGovernedActivityForTests();
  _testReset();
  rmSync(scratch, { recursive: true, force: true });
  if (previousAuditDir === undefined) delete process.env.AIRMCP_VECTOR_STORE_DIR;
  else process.env.AIRMCP_VECTOR_STORE_DIR = previousAuditDir;
  if (previousAuditKey === undefined) delete process.env.AIRMCP_AUDIT_HMAC_KEY;
  else process.env.AIRMCP_AUDIT_HMAC_KEY = previousAuditKey;
  if (previousAuditEnabled === undefined) delete process.env.AIRMCP_AUDIT_LOG;
  else process.env.AIRMCP_AUDIT_LOG = previousAuditEnabled;
  if (previousUsageTracking === undefined) delete process.env.AIRMCP_USAGE_TRACKING;
  else process.env.AIRMCP_USAGE_TRACKING = previousUsageTracking;
});

describe("bounded shutdown finalizers", () => {
  test("an explicitly disposed resource can unregister only its own shutdown hook", async () => {
    const disposed = jest.fn();
    const retained = jest.fn();
    registerShutdownHook(disposed);
    registerShutdownHook(retained);

    unregisterShutdownHook(disposed);
    await runShutdownHooks();

    expect(disposed).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledTimes(1);
  });

  test("runs ordinary cleanup before final persistence work", async () => {
    const order = [];
    registerShutdownHook(async () => {
      order.push("hook");
    });
    registerShutdownFinalizer(async () => {
      order.push("finalizer");
    });

    await runShutdownHooks();

    expect(order).toEqual(["hook", "finalizer"]);
  });

  test("one rejected cleanup does not skip the audit finalizer", async () => {
    const order = [];
    registerShutdownHook(async () => {
      throw new Error("cleanup failed");
    });
    registerShutdownFinalizer(async () => {
      order.push("finalizer");
    });

    await runShutdownHooks();

    expect(order).toEqual(["finalizer"]);
  });

  test("persists a buffered HMAC audit row during shutdown", async () => {
    auditLog({
      timestamp: "2026-07-11T00:00:00.000Z",
      tool: "shutdown_probe",
      status: "ok",
    });
    registerShutdownFinalizer(flushAuditLog);

    await runShutdownHooks();

    const rows = readFileSync(join(scratch, "audit.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    expect(rows).toEqual([
      expect.objectContaining({
        tool: "shutdown_probe",
        kind: "tool",
        seq: 0,
        _prev: "0".repeat(64),
        _hmac: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);
    expect(readFileSync(join(scratch, "audit.checkpoint"), "utf8")).toContain('"seq":0');
  });

  test.each([
    { kind: "tool", auditName: "shutdown_delayed_tool" },
    { kind: "resource", auditName: "resource:shutdown-delayed-resource" },
  ])("waits for a delayed $kind outcome before the audit finalizer", async ({ kind, auditName }) => {
    const registry = createToolRegistry();
    const server = createGovernedMockServer();
    registry.installOn(server);

    let releaseHandler;
    let signalStarted;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    const handlerGate = new Promise((resolve) => {
      releaseHandler = resolve;
    });
    const order = [];

    let call;
    if (kind === "tool") {
      server.registerTool("shutdown_delayed_tool", { annotations: { readOnlyHint: true } }, async () => {
        order.push("handler-started");
        signalStarted();
        await handlerGate;
        order.push("handler-finished");
        return { content: [{ type: "text", text: "done" }] };
      });
      call = server._tools.get("shutdown_delayed_tool").handler({});
    } else {
      server.registerResource(
        "shutdown-delayed-resource",
        "test://shutdown-delayed-resource",
        { description: "shutdown drain probe", mimeType: "text/plain" },
        async (uri) => {
          order.push("handler-started");
          signalStarted();
          await handlerGate;
          order.push("handler-finished");
          return { contents: [{ uri: uri.href, text: "done" }] };
        },
      );
      call = server._resources.get("shutdown-delayed-resource").handler(new URL("test://shutdown-delayed-resource"));
    }

    await started;
    registerShutdownHook(drainGovernedActivityForShutdown);
    registerShutdownFinalizer(async () => {
      order.push("audit-finalizer");
      await flushAuditLog();
    });

    const shutdown = runShutdownHooks();
    await Promise.resolve();
    expect(order).toEqual(["handler-started"]);

    releaseHandler();
    await Promise.all([call, shutdown]);

    expect(order).toEqual(["handler-started", "handler-finished", "audit-finalizer"]);
    const rows = readFileSync(join(scratch, "audit.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    expect(rows).toContainEqual(expect.objectContaining({ tool: auditName, status: "ok" }));
  });

  test("rejects new tool and resource calls after shutdown admission closes", async () => {
    const registry = createToolRegistry();
    const server = createGovernedMockServer();
    registry.installOn(server);
    const toolHandler = jest.fn(async () => ({ content: [{ type: "text", text: "must not run" }] }));
    const resourceHandler = jest.fn(async (uri) => ({ contents: [{ uri: uri.href, text: "must not run" }] }));

    server.registerTool("late_tool", { annotations: { readOnlyHint: true } }, toolHandler);
    server.registerResource(
      "late-resource",
      "test://late-resource",
      { description: "late resource", mimeType: "text/plain" },
      resourceHandler,
    );

    await drainGovernedActivityForShutdown(100);

    await expect(server._tools.get("late_tool").handler({})).rejects.toThrow("shutting down");
    await expect(server._resources.get("late-resource").handler(new URL("test://late-resource"))).rejects.toThrow(
      "shutting down",
    );
    expect(toolHandler).not.toHaveBeenCalled();
    expect(resourceHandler).not.toHaveBeenCalled();
  });

  test("surfaces a bounded drain timeout without inventing a completed outcome", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const active = runGovernedActivity(async () => gate);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(drainGovernedActivityForShutdown(5)).rejects.toThrow("Timed out waiting for 1 governed call");
      expect(_getGovernedActivityStateForTests()).toEqual({ activeCalls: 1, shutdownStarted: true });
    } finally {
      release();
      await active;
      errorSpy.mockRestore();
    }
  });
});
