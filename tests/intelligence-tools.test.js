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

  test('registers all 13 intelligence tools', () => {
    expect(server.tools.size).toBe(13);
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
      'ai_plan_metrics',
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

  test('ai_agent is read-only (write tools intentionally not exposed to FoundationModels session)', () => {
    // Updated for the FoundationModelsBridge.allTools() restriction:
    // CreateReminderTool / CreateNoteTool removed because the agentic
    // tool-calling loop bypasses the Node toolRegistry pre-handler
    // (no HITL / rate-limit / audit). Only read tools remain
    // (TodayEvents / DueReminders / SearchContacts), so the surface
    // is honestly read-only. See CHANGELOG security entry + ROADMAP
    // P1 "Swift→Node loop-back transport" for the path back to
    // exposing writes safely.
    const { config } = server.tools.get('ai_agent');
    expect(config.annotations.readOnlyHint).toBe(true);
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

  test('ai_plan_metrics bails when the swift bridge is unavailable', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');
    const result = await server.callTool('ai_plan_metrics', { limit: 2, seed: 42 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
    expect(mockRunSwift).not.toHaveBeenCalled();
  });

  test('ai_plan_metrics aggregates parseable scores from the model', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    // Mock returns a 1-step plan for every case. Whether mustInclude
    // matches depends on the sampled case, but parse-rate should be 1.0.
    mockRunSwift.mockResolvedValue({
      output: JSON.stringify([{ step: 1, tool: 'today_events', args: {}, purpose: 'glance at today' }]),
    });

    const result = await server.callTool('ai_plan_metrics', { limit: 3, seed: 1 });
    expect(result.isError).toBeUndefined();
    const sc = JSON.parse(result.content[0].text);
    expect(sc.sampled).toBe(3);
    expect(sc.parseRate).toBe(1);
    expect(sc.averageScore).toBeGreaterThan(0);
    expect(sc.perCase).toHaveLength(3);
    expect(mockRunSwift).toHaveBeenCalledTimes(3);
  });

  test('ai_plan_metrics tolerates per-case failures without sinking the batch', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift
      .mockRejectedValueOnce(new Error('model timeout'))
      .mockResolvedValueOnce({ output: 'not json at all' })
      .mockResolvedValueOnce({
        output: JSON.stringify([{ step: 1, tool: 'today_events', args: {}, purpose: 'x' }]),
      });

    const result = await server.callTool('ai_plan_metrics', { limit: 3, seed: 1 });
    expect(result.isError).toBeUndefined();
    const sc = JSON.parse(result.content[0].text);
    expect(sc.sampled).toBe(3);
    // 1/3 produced a parseable plan
    expect(sc.parseRate).toBeCloseTo(1 / 3, 4);
    expect(mockRunSwift).toHaveBeenCalledTimes(3);
  });

  test('ai_plan_metrics with a fixed seed is reproducible', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({ output: '[]' });

    const a = await server.callTool('ai_plan_metrics', { limit: 4, seed: 7 });
    const aNames = JSON.parse(a.content[0].text).perCase.map((c) => c.name);

    mockRunSwift.mockResolvedValue({ output: '[]' });
    const b = await server.callTool('ai_plan_metrics', { limit: 4, seed: 7 });
    const bNames = JSON.parse(b.content[0].text).perCase.map((c) => c.name);

    expect(bNames).toEqual(aNames);
  });
});
