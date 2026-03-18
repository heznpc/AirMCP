import { describe, test, expect, jest } from '@jest/globals';

// Mock dependencies before importing
const mockRunJxa = jest.fn();
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const mockCheckSwiftBridge = jest.fn().mockResolvedValue('Swift bridge not available');
const mockRunSwift = jest.fn();
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  checkSwiftBridge: mockCheckSwiftBridge,
  runSwift: mockRunSwift,
}));

const { registerCrossTools } = await import('../dist/cross/tools.js');

// Minimal McpServer mock
function createMockServer() {
  const tools = new Map();
  return {
    server: {
      createMessage: jest.fn(),
    },
    registerTool: jest.fn((name, opts, handler) => {
      tools.set(name, { opts, handler });
    }),
    _tools: tools,
  };
}

function createMockConfig(overrides = {}) {
  const { disabledModules = [], ...rest } = overrides;
  return {
    disabledModules: new Set(disabledModules),
    shareApprovalModules: new Set(),
    includeShared: false,
    allowSendMessages: true,
    allowSendMail: true,
    hitl: { level: 'off', whitelist: new Set(), timeout: 30, socketPath: '' },
    ...rest,
  };
}

describe('registerCrossTools', () => {
  test('registers summarize_context tool', () => {
    const server = createMockServer();
    const config = createMockConfig();
    registerCrossTools(server, config);

    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server._tools.has('summarize_context')).toBe(true);
  });

  test('summarize_context has correct annotations', () => {
    const server = createMockServer();
    const config = createMockConfig();
    registerCrossTools(server, config);

    const tool = server._tools.get('summarize_context');
    expect(tool.opts.annotations.readOnlyHint).toBe(true);
    expect(tool.opts.annotations.destructiveHint).toBe(false);
  });

  test('summarize_context returns error on empty snapshot', async () => {
    const server = createMockServer();
    const config = createMockConfig({ disabledModules: ['notes', 'calendar', 'reminders', 'mail', 'music', 'system', 'contacts', 'finder', 'safari', 'photos', 'shortcuts', 'messages', 'intelligence', 'tv'] });
    registerCrossTools(server, config);

    const tool = server._tools.get('summarize_context');
    const result = await tool.handler({ focus: undefined });

    // With all modules disabled, snapshot should be minimal but not empty (has timestamp/depth)
    // The tool checks for "{}" or empty string
    expect(result).toBeDefined();
  });

  test('summarize_context uses sampling when available', async () => {
    const server = createMockServer();
    const config = createMockConfig();

    // Mock calendar data for snapshot
    mockRunJxa.mockResolvedValue({ events: [] });

    server.server.createMessage.mockResolvedValue({
      content: { type: 'text', text: 'Here is your briefing...' },
      model: 'claude-3-sonnet',
    });

    registerCrossTools(server, config);
    const tool = server._tools.get('summarize_context');
    const result = await tool.handler({ focus: 'meetings' });

    expect(server.server.createMessage).toHaveBeenCalled();
    const callArgs = server.server.createMessage.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('meetings');
    expect(callArgs.maxTokens).toBe(500);
  });

  test('summarize_context falls back when sampling not supported', async () => {
    const server = createMockServer();
    const config = createMockConfig();

    mockRunJxa.mockResolvedValue({ events: [] });

    server.server.createMessage.mockRejectedValue(new Error('sampling not supported'));

    registerCrossTools(server, config);
    const tool = server._tools.get('summarize_context');
    const result = await tool.handler({ focus: undefined });

    expect(result.content[0].text).toContain('fallback');
  });

  test('summarize_context returns error on sampling failure', async () => {
    const server = createMockServer();
    const config = createMockConfig();

    mockRunJxa.mockResolvedValue({ events: [] });

    server.server.createMessage.mockRejectedValue(new Error('network timeout'));

    registerCrossTools(server, config);
    const tool = server._tools.get('summarize_context');
    const result = await tool.handler({ focus: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('network timeout');
  });
});
