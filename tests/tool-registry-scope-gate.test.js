/**
 * Integration test for the tool-registry OAuth scope gate (RFC 0005 §3.4,
 * Step 2). End-to-end path:
 *   1. Register tools with realistic annotations (readOnlyHint + destructiveHint).
 *   2. Enter AsyncLocalStorage request context with a token's scopes.
 *   3. Invoke the wrapped handler — gate should allow/deny before the
 *      rate-limit bucket and before the handler body.
 *
 * This does NOT go through Express — it validates the boundary between
 * oauth-verifier (decides) and tool-registry (enforces). Also verifies
 * that absent context (stdio / loopback) remains a no-op so existing
 * tests and deployments aren't regressed.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

const auditLogMock = jest.fn();

jest.unstable_mockModule('../dist/shared/usage-tracker.js', () => ({
  usageTracker: { record: jest.fn() },
}));
jest.unstable_mockModule('../dist/shared/audit.js', () => ({
  auditLog: auditLogMock,
}));
jest.unstable_mockModule('../dist/shared/tool-filter.js', () => ({
  compactDescription: (d) => (d ? d.substring(0, 80) : d),
}));

const { toolRegistry } = await import('../dist/shared/tool-registry.js');
const { runWithRequestContext } = await import('../dist/shared/request-context.js');

function createMockServer() {
  const tools = new Map();
  return {
    registerTool: jest.fn((name, opts, handler) => {
      tools.set(name, { opts, handler });
    }),
    tool: jest.fn((name, ...rest) => {
      tools.set(name, { rest });
    }),
    registerPrompt: jest.fn(),
    prompt: jest.fn(),
    _tools: tools,
  };
}

async function callToolThroughGate(server, name, args = {}) {
  const entry = server._tools.get(name);
  if (!entry) throw new Error(`tool ${name} not registered`);
  return entry.handler(args, {});
}

describe('tool-registry OAuth scope gate', () => {
  let server;

  beforeEach(() => {
    toolRegistry.reset();
    auditLogMock.mockReset();
    server = createMockServer();
    toolRegistry.installOn(server);

    // Register a read-only tool, a write tool, a destructive tool,
    // and an admin tool. Each with the annotations the gate reads.
    server.registerTool(
      'list_notes',
      {
        title: 'List notes',
        description: 'd',
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
    server.registerTool(
      'create_reminder',
      {
        title: 'Create reminder',
        description: 'd',
        annotations: { readOnlyHint: false, destructiveHint: false, sensitiveHint: true },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
    server.registerTool(
      'delete_note',
      {
        title: 'Delete note',
        description: 'd',
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
    server.registerTool(
      'audit_log',
      {
        title: 'Audit log',
        description: 'd',
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
  });

  test('no OAuth context → gate is a no-op (legacy paths unaffected)', async () => {
    // stdio / loopback-only / legacy Bearer never enter runWithRequestContext.
    // The gate MUST stay out of the way in that case — otherwise the
    // entire existing test suite would break.
    const result = await callToolThroughGate(server, 'delete_note');
    expect(result.content[0].text).toBe('ok');
  });

  test('mcp:read token allows list_notes', async () => {
    const result = await runWithRequestContext(
      { oauth: { subject: 'u', scopes: ['mcp:read'], raw: {} } },
      () => callToolThroughGate(server, 'list_notes'),
    );
    expect(result.content[0].text).toBe('ok');
  });

  test('mcp:read token denies create_reminder with [forbidden]', async () => {
    await expect(
      runWithRequestContext({ oauth: { subject: 'u', scopes: ['mcp:read'], raw: {} } }, () =>
        callToolThroughGate(server, 'create_reminder'),
      ),
    ).rejects.toThrow(/\[forbidden\] scope mcp:write required/);
  });

  test('mcp:write token allows sensitive non-destructive create_reminder', async () => {
    const result = await runWithRequestContext(
      { oauth: { subject: 'u', scopes: ['mcp:write'], raw: {} } },
      () => callToolThroughGate(server, 'create_reminder'),
    );
    expect(result.content[0].text).toBe('ok');
  });

  test('mcp:write token denies delete_note', async () => {
    await expect(
      runWithRequestContext({ oauth: { subject: 'u', scopes: ['mcp:write'], raw: {} } }, () =>
        callToolThroughGate(server, 'delete_note'),
      ),
    ).rejects.toThrow(/\[forbidden\] scope mcp:destructive required/);
  });

  test('mcp:destructive token allows delete_note', async () => {
    const result = await runWithRequestContext(
      { oauth: { subject: 'u', scopes: ['mcp:destructive'], raw: {} } },
      () => callToolThroughGate(server, 'delete_note'),
    );
    expect(result.content[0].text).toBe('ok');
  });

  test('mcp:destructive does NOT imply mcp:admin — audit_log denied', async () => {
    await expect(
      runWithRequestContext({ oauth: { subject: 'u', scopes: ['mcp:destructive'], raw: {} } }, () =>
        callToolThroughGate(server, 'audit_log'),
      ),
    ).rejects.toThrow(/\[forbidden\] scope mcp:admin required/);
  });

  test('mcp:admin token allows all four tools', async () => {
    const ctx = { oauth: { subject: 'u', scopes: ['mcp:admin'], raw: {} } };
    for (const tool of ['list_notes', 'create_reminder', 'delete_note', 'audit_log']) {
      const result = await runWithRequestContext(ctx, () => callToolThroughGate(server, tool));
      expect(result.content[0].text).toBe('ok');
    }
  });

  test('empty scope set denies every tool', async () => {
    const ctx = { oauth: { subject: 'u', scopes: [], raw: {} } };
    for (const tool of ['list_notes', 'create_reminder', 'delete_note', 'audit_log']) {
      await expect(
        runWithRequestContext(ctx, () => callToolThroughGate(server, tool)),
      ).rejects.toThrow(/\[forbidden\]/);
    }
  });

  test('denial is audited with status=error before the handler runs', async () => {
    await expect(
      runWithRequestContext({ oauth: { subject: 'u', scopes: ['mcp:read'], raw: {} } }, () =>
        callToolThroughGate(server, 'delete_note'),
      ),
    ).rejects.toThrow();
    // First audit call is the denial. The error path does NOT call the
    // handler so no second audit is emitted.
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'delete_note', status: 'error' }),
    );
  });
});
