import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { z } from 'zod';

// ─── Mock dependencies that tool-registry.js imports at the module level ────
jest.unstable_mockModule('../dist/shared/usage-tracker.js', () => ({
  usageTracker: { record: jest.fn() },
}));
jest.unstable_mockModule('../dist/shared/audit.js', () => ({
  auditLog: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/tool-filter.js', () => ({
  compactDescription: jest.fn((d) => d ? d.substring(0, 80) : d),
}));

const { toolRegistry } = await import('../dist/shared/tool-registry.js');
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

// ─── Helper: mock server for unit-level tests ──────────────────────────────
function createMockServer() {
  const tools = new Map();
  const prompts = new Map();
  return {
    registerTool: jest.fn((name, opts, handler) => {
      tools.set(name, { opts, handler });
    }),
    tool: jest.fn((name, ...rest) => {
      tools.set(name, { rest });
    }),
    registerPrompt: jest.fn((name, opts, callback) => {
      prompts.set(name, { opts, callback });
    }),
    prompt: jest.fn((name, ...rest) => {
      prompts.set(name, { rest });
    }),
    _tools: tools,
    _prompts: prompts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit tests (mock server) — preserved from the original test suite
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolRegistry (mock server)', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    toolRegistry.installOn(server);
  });

  test('starts with zero tools and prompts', () => {
    expect(toolRegistry.getToolCount()).toBe(0);
    expect(toolRegistry.getPromptCount()).toBe(0);
    expect(toolRegistry.getToolNames()).toEqual([]);
    expect(toolRegistry.getPromptNames()).toEqual([]);
  });

  test('tracks tool registrations via registerTool', () => {
    server.registerTool('test_tool', {
      title: 'Test Tool',
      description: 'A test tool for testing',
    }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(['test_tool']);
  });

  test('tracks multiple tool registrations', () => {
    server.registerTool('tool_a', { title: 'Tool A', description: 'First' }, async () => ({}));
    server.registerTool('tool_b', { title: 'Tool B', description: 'Second' }, async () => ({}));
    server.registerTool('tool_c', { title: 'Tool C', description: 'Third' }, async () => ({}));

    expect(toolRegistry.getToolCount()).toBe(3);
    expect(toolRegistry.getToolNames()).toContain('tool_a');
    expect(toolRegistry.getToolNames()).toContain('tool_b');
    expect(toolRegistry.getToolNames()).toContain('tool_c');
  });

  test('getToolInfo returns correct info', () => {
    server.registerTool('my_tool', {
      title: 'My Tool',
      description: 'Does something useful',
    }, async () => ({}));

    const info = toolRegistry.getToolInfo('my_tool');
    expect(info).toBeDefined();
    expect(info.name).toBe('my_tool');
    expect(info.title).toBe('My Tool');
    expect(info.description).toBe('Does something useful');
  });

  test('getToolInfo returns undefined for unknown tool', () => {
    expect(toolRegistry.getToolInfo('nonexistent')).toBeUndefined();
  });

  test('searchTools finds tools by name', () => {
    server.registerTool('search_notes', { title: 'Search Notes', description: 'Search' }, async () => ({}));
    server.registerTool('list_notes', { title: 'List Notes', description: 'List' }, async () => ({}));
    server.registerTool('read_mail', { title: 'Read Mail', description: 'Read' }, async () => ({}));

    const results = toolRegistry.searchTools('notes');
    expect(results.length).toBe(2);
    expect(results.map(r => r.name)).toContain('search_notes');
    expect(results.map(r => r.name)).toContain('list_notes');
  });

  test('searchTools scores name matches higher than description', () => {
    server.registerTool('calendar_event', { title: 'Cal', description: 'Create event' }, async () => ({}));
    server.registerTool('other_tool', { title: 'Other', description: 'Manages calendar items' }, async () => ({}));

    const results = toolRegistry.searchTools('calendar');
    expect(results[0].name).toBe('calendar_event');
  });

  test('searchTools respects limit', () => {
    for (let i = 0; i < 30; i++) {
      server.registerTool(`tool_${i}`, { title: `Tool ${i}`, description: 'test tool' }, async () => ({}));
    }

    const results = toolRegistry.searchTools('tool', 5);
    expect(results.length).toBe(5);
  });

  test('searchTools returns empty for no matches', () => {
    server.registerTool('my_tool', { title: 'My Tool', description: 'Something' }, async () => ({}));
    expect(toolRegistry.searchTools('zzzznonexistent')).toEqual([]);
  });

  test('callTool invokes registered handler', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    });
    server.registerTool('callable', { title: 'Callable' }, handler);

    const result = await toolRegistry.callTool('callable', { key: 'value' });
    expect(result.content[0].text).toBe('result');
  });

  test('callTool throws for unknown tool', async () => {
    await expect(toolRegistry.callTool('nonexistent', {}))
      .rejects.toThrow('Tool "nonexistent" not found');
  });

  test('tracks prompt registrations via registerPrompt', () => {
    server.registerPrompt('my_prompt', {}, async () => ({}));

    expect(toolRegistry.getPromptCount()).toBe(1);
    expect(toolRegistry.getPromptNames()).toEqual(['my_prompt']);
  });

  test('getPromptCallback returns callback', () => {
    const cb = async () => ({});
    server.registerPrompt('test_prompt', {}, cb);

    const retrieved = toolRegistry.getPromptCallback('test_prompt');
    expect(retrieved).toBeDefined();
  });

  test('getPromptCallback returns undefined for unknown prompt', () => {
    expect(toolRegistry.getPromptCallback('nonexistent')).toBeUndefined();
  });

  test('installOn clears previous registrations', () => {
    server.registerTool('old_tool', { title: 'Old' }, async () => ({}));
    expect(toolRegistry.getToolCount()).toBe(1);

    // Re-install on a new server
    const server2 = createMockServer();
    toolRegistry.installOn(server2);
    expect(toolRegistry.getToolCount()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests — real McpServer from @modelcontextprotocol/sdk v1.29.0
//
// These verify that the monkey-patching in tool-registry.ts is compatible
// with the actual SDK. The critical assumption is that the callback is
// always the last argument to registerTool(name, config, cb).
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolRegistry monkey-patch on real McpServer (SDK integration)', () => {
  let server;

  beforeEach(() => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    toolRegistry.installOn(server);
  });

  // ── Basic registration and tracking ───────────────────────────────

  test('registerTool on real McpServer is tracked in the registry', () => {
    server.registerTool('real_tool', {
      title: 'Real Tool',
      description: 'Registered on the real SDK McpServer',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async () => ({
      content: [{ type: 'text', text: 'hello' }],
    }));

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(['real_tool']);
  });

  test('getToolInfo returns correct metadata for a real-SDK tool', () => {
    server.registerTool('info_tool', {
      title: 'Info Tool',
      description: 'Returns tool info correctly',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => ({
      content: [{ type: 'text', text: 'info' }],
    }));

    const info = toolRegistry.getToolInfo('info_tool');
    expect(info).toBeDefined();
    expect(info.name).toBe('info_tool');
    expect(info.title).toBe('Info Tool');
    expect(info.description).toBe('Returns tool info correctly');
  });

  // ── Handler wrapping — callTool returns expected result ───────────

  test('callTool invokes the wrapped handler and returns expected result', async () => {
    server.registerTool('echo_tool', {
      title: 'Echo',
      description: 'Echoes back the input',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async (args) => ({
      content: [{ type: 'text', text: `echo: ${JSON.stringify(args)}` }],
    }));

    const result = await toolRegistry.callTool('echo_tool', { msg: 'ping' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('echo: {"msg":"ping"}');
  });

  test('callTool propagates errors from the handler', async () => {
    server.registerTool('fail_tool', {
      title: 'Fail Tool',
      description: 'Always throws',
      inputSchema: {},
    }, async () => {
      throw new Error('intentional failure');
    });

    await expect(toolRegistry.callTool('fail_tool', {}))
      .rejects.toThrow('intentional failure');
  });

  // ── Multiple tools — callback position assumption holds ───────────

  test('registering two tools tracks both and both handlers work', async () => {
    server.registerTool('tool_alpha', {
      title: 'Alpha',
      description: 'First tool',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async () => ({
      content: [{ type: 'text', text: 'alpha-result' }],
    }));

    server.registerTool('tool_beta', {
      title: 'Beta',
      description: 'Second tool',
      inputSchema: {
        value: z.string().describe('A string value'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async (args) => ({
      content: [{ type: 'text', text: `beta-${args.value}` }],
    }));

    expect(toolRegistry.getToolCount()).toBe(2);
    expect(toolRegistry.getToolNames()).toContain('tool_alpha');
    expect(toolRegistry.getToolNames()).toContain('tool_beta');

    const alphaResult = await toolRegistry.callTool('tool_alpha', {});
    expect(alphaResult.content[0].text).toBe('alpha-result');

    const betaResult = await toolRegistry.callTool('tool_beta', { value: 'test' });
    expect(betaResult.content[0].text).toBe('beta-test');
  });

  // ── Signature compatibility: exact patterns from codebase modules ─

  test('registerTool with empty inputSchema and full annotations (reminders pattern)', async () => {
    // Mirrors: src/reminders/tools.ts — list_reminder_lists
    server.registerTool(
      'list_reminder_lists',
      {
        title: 'List Reminder Lists',
        description: 'List all reminder lists with reminder counts.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({
        content: [{ type: 'text', text: JSON.stringify([{ name: 'Default', count: 3 }]) }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(['list_reminder_lists']);
    const result = await toolRegistry.callTool('list_reminder_lists', {});
    expect(result.content[0].text).toContain('Default');
  });

  test('registerTool with Zod inputSchema fields (reminders list_reminders pattern)', async () => {
    // Mirrors: src/reminders/tools.ts — list_reminders (Zod fields in inputSchema)
    server.registerTool(
      'list_reminders',
      {
        title: 'List Reminders',
        description: 'List reminders. Supports filtering and pagination.',
        inputSchema: {
          list: z.string().max(500).optional().describe('Filter by list name'),
          completed: z.boolean().optional().describe('Filter by completed status'),
          limit: z.number().int().min(1).max(1000).optional().default(200)
            .describe('Max number to return'),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => ({
        content: [{
          type: 'text',
          text: JSON.stringify({ list: args.list || 'all', count: 0 }),
        }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    const info = toolRegistry.getToolInfo('list_reminders');
    expect(info.title).toBe('List Reminders');
    const result = await toolRegistry.callTool('list_reminders', { list: 'Work' });
    expect(JSON.parse(result.content[0].text).list).toBe('Work');
  });

  test('registerTool with minimal config (no inputSchema, no annotations)', async () => {
    // Edge case: bare-minimum config object
    server.registerTool(
      'bare_tool',
      {
        title: 'Bare Tool',
        description: 'Minimal registration',
      },
      async () => ({
        content: [{ type: 'text', text: 'bare' }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    expect(toolRegistry.getToolNames()).toEqual(['bare_tool']);
    const result = await toolRegistry.callTool('bare_tool', {});
    expect(result.content[0].text).toBe('bare');
  });

  test('registerTool with write annotations (pages pattern)', async () => {
    // Mirrors: src/pages/tools.ts — pages_open_document (readOnlyHint: false)
    server.registerTool(
      'pages_open_document',
      {
        title: 'Open Pages Document',
        description: 'Open a Pages document from a file path.',
        inputSchema: {
          path: z.string().describe('Absolute file path to the .pages document'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => ({
        content: [{ type: 'text', text: `opened: ${args.path}` }],
      }),
    );

    expect(toolRegistry.getToolCount()).toBe(1);
    const result = await toolRegistry.callTool('pages_open_document', {
      path: '/tmp/test.pages',
    });
    expect(result.content[0].text).toBe('opened: /tmp/test.pages');
  });

  // ── Verify SDK actually received the tool (not silently dropped) ──

  test('real McpServer internally registers the tool (not silently swallowed)', () => {
    server.registerTool('internal_check', {
      title: 'Internal Check',
      description: 'Verifies the SDK stored the tool internally',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }));

    // The SDK stores tools in _registeredTools (a plain object, not a Map).
    // Access it to confirm the monkey-patch forwarded the call correctly.
    // This is intentionally accessing a private field for test verification.
    const sdkInternalTools = server._registeredTools;
    expect(sdkInternalTools).toBeDefined();
    expect('internal_check' in sdkInternalTools).toBe(true);
    expect(typeof sdkInternalTools['internal_check'].handler).toBe('function');
  });

  // ── registerTool signature: callback is always the last argument ──

  test('callback is the last argument to registerTool (SDK v1.29.0 contract)', () => {
    // The monkey-patch assumes: rest[rest.length - 1] is the callback.
    // Verify this by checking the SDK's registerTool.length or by confirming
    // that the tool works. If the SDK ever changes the argument order, this
    // test will break, alerting us to update the monkey-patch.
    const originalRegisterTool = McpServer.prototype.registerTool;
    // SDK registerTool should accept (name, config, cb) — 3 parameters
    // Note: Function.length may not reflect all params due to defaults/rest,
    // so we rely on a functional test instead.
    let callbackReceived = false;
    const testServer = new McpServer({ name: 'sig-test', version: '0.0.1' });

    // Register without the monkey-patch to observe raw SDK behavior
    testServer.registerTool('sig_test', {
      title: 'Sig Test',
      description: 'Signature verification',
      inputSchema: {},
    }, async () => {
      callbackReceived = true;
      return { content: [{ type: 'text', text: 'sig-ok' }] };
    });

    // Verify the SDK stored it — the handler should be in the tool's entry
    const entry = testServer._registeredTools['sig_test'];
    expect(entry).toBeDefined();
    // The SDK stores the callback as .handler. If callback was not the last arg,
    // the SDK would have thrown or stored undefined.
    expect(typeof entry.handler).toBe('function');
  });

  // ── Bulk registration — stress test for multiple tools ────────────

  test('registering many tools in sequence all tracked correctly', async () => {
    const count = 20;
    for (let i = 0; i < count; i++) {
      server.registerTool(`bulk_tool_${i}`, {
        title: `Bulk Tool ${i}`,
        description: `Bulk test tool number ${i}`,
        inputSchema: {},
        annotations: { readOnlyHint: true },
      }, async () => ({
        content: [{ type: 'text', text: `result-${i}` }],
      }));
    }

    expect(toolRegistry.getToolCount()).toBe(count);
    for (let i = 0; i < count; i++) {
      expect(toolRegistry.getToolNames()).toContain(`bulk_tool_${i}`);
    }

    // Spot-check a few handlers
    const r0 = await toolRegistry.callTool('bulk_tool_0', {});
    expect(r0.content[0].text).toBe('result-0');

    const r19 = await toolRegistry.callTool('bulk_tool_19', {});
    expect(r19.content[0].text).toBe('result-19');
  });
});
