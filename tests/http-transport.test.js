import { describe, test, expect, jest } from '@jest/globals';

// Mock all heavy dependencies that would fail in test environment
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn(),
}));
jest.unstable_mockModule('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/config.js', () => ({
  NPM_PACKAGE_NAME: 'airmcp',
  parseConfig: jest.fn(() => ({
    hitl: { level: 'off' },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  })),
  getOsVersion: jest.fn(() => 26),
  isModuleEnabled: jest.fn(() => false),
}));
jest.unstable_mockModule('../dist/shared/constants.js', () => ({
  LIMITS: { HTTP_SESSIONS: 10 },
  TIMEOUT: { SESSION_IDLE: 300000, SESSION_CLEANUP: 60000, KILL_GRACE: 5000 },
}));
jest.unstable_mockModule('../dist/shared/banner.js', () => ({
  printBanner: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/audit.js', () => ({
  auditLog: jest.fn(),
}));
jest.unstable_mockModule('../dist/server/mcp-setup.js', () => ({
  createServer: jest.fn(async () => ({
    server: { connect: jest.fn(), close: jest.fn(), sendResourceListChanged: jest.fn() },
    bannerInfo: { transport: 'http', version: '2.6.0' },
  })),
}));

describe('HTTP transport module', () => {
  test('module exports startHttpServer function', async () => {
    const mod = await import('../dist/server/http-transport.js');
    expect(typeof mod.startHttpServer).toBe('function');
  });

  test('startHttpServer is an async function', async () => {
    const mod = await import('../dist/server/http-transport.js');
    // AsyncFunction constructor name check
    expect(mod.startHttpServer.constructor.name).toBe('AsyncFunction');
  });
});
