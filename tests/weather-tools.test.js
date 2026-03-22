import { describe, test, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../dist/weather/api.js', () => ({
  fetchCurrentWeather: jest.fn(),
  fetchDailyForecast: jest.fn(),
  fetchHourlyForecast: jest.fn(),
}));

const { registerWeatherTools } = await import('../dist/weather/tools.js');

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

describe('Weather tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerWeatherTools(server, {});
  });

  test('registers all 3 weather tools', () => {
    expect(server.tools.size).toBe(3);
    const expected = [
      'get_current_weather',
      'get_daily_forecast',
      'get_hourly_forecast',
    ];
    for (const name of expected) {
      expect(server.tools.has(name)).toBe(true);
    }
  });

  test('all tools have titles and descriptions', () => {
    for (const [, { config }] of server.tools) {
      expect(typeof config.title).toBe('string');
      expect(config.title.length).toBeGreaterThan(0);
      expect(typeof config.description).toBe('string');
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  test('all tools have annotations', () => {
    for (const [, { config }] of server.tools) {
      expect(config.annotations).toBeDefined();
      expect(typeof config.annotations.readOnlyHint).toBe('boolean');
      expect(typeof config.annotations.destructiveHint).toBe('boolean');
    }
  });
});
