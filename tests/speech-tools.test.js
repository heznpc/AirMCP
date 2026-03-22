import { describe, test, expect, jest } from '@jest/globals';

// Mock the swift bridge — speech tools require macOS Swift bridge
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn();

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
}));

const { registerSpeechTools } = await import('../dist/speech/tools.js');

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

describe('Speech tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerSpeechTools(server, {});
  });

  test('registers all 3 speech tools', () => {
    expect(server.tools.has('transcribe_audio')).toBe(true);
    expect(server.tools.has('speech_availability')).toBe(true);
    expect(server.tools.has('smart_clipboard')).toBe(true);
    expect(server.tools.size).toBe(3);
  });

  test('all tools are read-only and non-destructive', () => {
    for (const [, { config }] of server.tools) {
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
      expect(config.annotations.idempotentHint).toBe(true);
    }
  });

  test('each tool has a title and description', () => {
    for (const [name, { config }] of server.tools) {
      expect(config.title).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(typeof config.title).toBe('string');
      expect(typeof config.description).toBe('string');
    }
  });
});

describe('transcribe_audio', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerSpeechTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('returns transcription on success', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({
      text: 'Hello world',
      segments: [],
      language: 'en-US',
      onDevice: true,
    });

    const result = await server.callTool('transcribe_audio', { path: '/tmp/test.m4a' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.text).toBe('Hello world');
    expect(parsed.onDevice).toBe(true);
  });

  test('returns error when swift bridge unavailable', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');

    const result = await server.callTool('transcribe_audio', { path: '/tmp/test.m4a' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
  });

  test('returns error when transcription fails', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockRejectedValue(new Error('Audio file not found'));

    const result = await server.callTool('transcribe_audio', { path: '/tmp/missing.m4a' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Audio file not found');
  });
});

describe('speech_availability', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerSpeechTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('returns availability status on success', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({
      available: true,
      supportsOnDevice: true,
    });

    const result = await server.callTool('speech_availability');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.available).toBe(true);
    expect(parsed.supportsOnDevice).toBe(true);
  });

  test('returns error when swift bridge unavailable', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');

    const result = await server.callTool('speech_availability');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
  });
});

describe('smart_clipboard', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerSpeechTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('returns clipboard content on success', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({
      text: 'https://example.com',
      hasImage: false,
      hasURL: true,
      url: 'https://example.com',
      types: ['public.utf8-plain-text', 'public.url'],
      changeCount: 42,
      detectedType: 'url',
    });

    const result = await server.callTool('smart_clipboard');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.text).toBe('https://example.com');
    expect(parsed.detectedType).toBe('url');
    expect(parsed.hasURL).toBe(true);
  });

  test('returns error when swift bridge unavailable', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');

    const result = await server.callTool('smart_clipboard');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
  });
});
