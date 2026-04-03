import { describe, test, expect, jest } from '@jest/globals';

// Mock the swift bridge — health tools require macOS HealthKit
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn();

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
}));

const { registerHealthTools } = await import('../dist/health/tools.js');

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

describe('Health tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerHealthTools(server, {});
  });

  test('registers all 5 health tools', () => {
    expect(server.tools.has('health_summary')).toBe(true);
    expect(server.tools.has('health_today_steps')).toBe(true);
    expect(server.tools.has('health_heart_rate')).toBe(true);
    expect(server.tools.has('health_sleep')).toBe(true);
    expect(server.tools.has('health_authorize')).toBe(true);
    expect(server.tools.size).toBe(5);
  });

  test('data tools are read-only, authorize is not', () => {
    const dataTools = ['health_summary', 'health_today_steps', 'health_heart_rate', 'health_sleep'];
    for (const name of dataTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
    const { config: authConfig } = server.tools.get('health_authorize');
    expect(authConfig.annotations.readOnlyHint).toBe(false);
  });
});

describe('health_summary', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerHealthTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('returns health dashboard on success', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({
      stepsToday: 8432,
      heartRateAvg7d: 68.5,
      sleepHoursLastNight: 7.25,
      activeEnergyToday: 345.2,
      exerciseMinutesToday: 32,
    });

    const result = await server.callTool('health_summary');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.stepsToday).toBe(8432);
    expect(parsed.heartRateAvg7d).toBe(68.5);
    expect(parsed.sleepHoursLastNight).toBe(7.25);
    // _links are in a separate content block as proper JSON
    const linksBlock = result.content.find(c => c.text.includes('_links'));
    expect(linksBlock).toBeDefined();
    const { _links } = JSON.parse(linksBlock.text);
    expect(_links.length).toBeGreaterThan(0);
  });

  test('returns error when swift bridge unavailable', async () => {
    mockCheckSwiftBridge.mockResolvedValue('Swift bridge not found');

    const result = await server.callTool('health_summary');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Swift bridge required');
  });

  test('returns error when HealthKit throws', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockRejectedValue(new Error('HealthKit not available'));

    const result = await server.callTool('health_summary');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HealthKit not available');
  });
});

describe('health_sleep', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerHealthTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('passes date argument to swift bridge', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({ sleepHours: 7.5 });

    await server.callTool('health_sleep', { date: '2026-03-21' });

    expect(mockRunSwift).toHaveBeenCalledWith('health-sleep', JSON.stringify({ date: '2026-03-21' }));
  });

  test('sends empty input when no date provided', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({ sleepHours: 6.8 });

    await server.callTool('health_sleep', {});

    expect(mockRunSwift).toHaveBeenCalledWith('health-sleep', '{}');
  });
});

describe('health_today_steps', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    registerHealthTools(server, {});
    mockRunSwift.mockReset();
    mockCheckSwiftBridge.mockReset();
  });

  test('returns step count with _links', async () => {
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockRunSwift.mockResolvedValue({ stepsToday: 12000 });

    const result = await server.callTool('health_today_steps');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.stepsToday).toBe(12000);
    expect(parsed._links).toBeDefined();
  });
});
