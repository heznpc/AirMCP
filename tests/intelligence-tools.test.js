import { describe, test, expect, jest } from '@jest/globals';

// Mock the swift bridge — intelligence tools require macOS 26+ with Apple Silicon
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn();

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
}));

const { registerIntelligenceTools } = await import('../dist/intelligence/tools.js');

// Minimal mock MCP server
function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
    async callTool(name, args = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      return tool.handler(args);
    },
  };
}

describe('Intelligence tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerIntelligenceTools(server, {});
  });

  test('registers all 12 intelligence tools', () => {
    expect(server.tools.size).toBe(12);
    const expectedTools = [
      'summarize_text',
      'rewrite_text',
      'proofread_text',
      'generate_text',
      'generate_structured',
      'tag_content',
      'ai_chat',
      'generate_image',
      'scan_document',
      'generate_plan',
      'ai_status',
      'ai_agent',
    ];
    for (const name of expectedTools) {
      expect(server.tools.has(name)).toBe(true);
    }
  });

  test('all tools have titles and descriptions', () => {
    for (const [name, { config }] of server.tools) {
      expect(config.title).toBeDefined();
      expect(typeof config.title).toBe('string');
      expect(config.title.length).toBeGreaterThan(0);
      expect(config.description).toBeDefined();
      expect(typeof config.description).toBe('string');
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools have annotations', () => {
    for (const [name, { config }] of server.tools) {
      expect(config.annotations).toBeDefined();
      expect(typeof config.annotations.readOnlyHint).toBe('boolean');
      expect(typeof config.annotations.destructiveHint).toBe('boolean');
    }
  });

  test('only file-writing tools are destructive', () => {
    // generate_image writes a PNG/JPEG to a user-supplied path and may
    // overwrite an existing file, so it must be marked destructive so HITL
    // can prompt the user under the destructive-only policy.
    const expectedDestructive = new Set(['generate_image']);
    for (const [name, { config }] of server.tools) {
      expect(config.annotations.destructiveHint).toBe(expectedDestructive.has(name));
    }
  });

  test('read-only analysis tools have correct annotations', () => {
    const readOnlyTools = [
      'summarize_text',
      'rewrite_text',
      'proofread_text',
      'generate_text',
      'generate_structured',
      'tag_content',
      'ai_chat',
      'scan_document',
      'generate_plan',
      'ai_status',
    ];
    for (const name of readOnlyTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
    }
  });

  test('generate_image is not read-only', () => {
    const { config } = server.tools.get('generate_image');
    expect(config.annotations.readOnlyHint).toBe(false);
  });

  test('ai_agent is not read-only (can call tools)', () => {
    const { config } = server.tools.get('ai_agent');
    expect(config.annotations.readOnlyHint).toBe(false);
  });

  test('ai_status is idempotent', () => {
    const { config } = server.tools.get('ai_status');
    expect(config.annotations.idempotentHint).toBe(true);
  });

  test('generation tools are not idempotent', () => {
    const nonIdempotent = [
      'rewrite_text',
      'proofread_text',
      'generate_text',
      'generate_structured',
      'ai_chat',
      'generate_image',
      'generate_plan',
      'ai_agent',
    ];
    for (const name of nonIdempotent) {
      const { config } = server.tools.get(name);
      expect(config.annotations.idempotentHint).toBe(false);
    }
  });
});

describe('Intelligence tool handlers', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerIntelligenceTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('ai_agent checks swift bridge first', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');

    const result = await server.callTool('ai_agent', {
      prompt: 'test prompt',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
    // runSwift should not be called when bridge check fails
    expect(mockRunSwift).not.toHaveBeenCalled();
  });

  test('summarize_text calls swift bridge on success', async () => {
    mockRunSwift.mockResolvedValue({ output: 'Summary of text' });

    const result = await server.callTool('summarize_text', { text: 'Long text here' });
    expect(result.isError).toBeUndefined();
    expect(mockRunSwift).toHaveBeenCalledWith(
      'summarize',
      JSON.stringify({ text: 'Long text here' }),
    );
  });

  test('summarize_text returns error on swift failure', async () => {
    mockRunSwift.mockRejectedValue(new Error('Foundation Models not available'));

    const result = await server.callTool('summarize_text', { text: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Foundation Models not available');
  });
});
