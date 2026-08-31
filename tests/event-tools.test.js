import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createMockServer } from './helpers/mock-server.js';

let observerRunning = false;
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn();
const mockIsSwiftObserverRunning = jest.fn();
const mockStartPollers = jest.fn();

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
  isSwiftObserverRunning: mockIsSwiftObserverRunning,
}));
jest.unstable_mockModule('../dist/shared/pollers.js', () => ({ startPollers: mockStartPollers }));

const { eventBus } = await import('../dist/shared/event-bus.js');
const { registerEventTools } = await import('../dist/server/event-tools.js');

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

describe('event observer lifecycle', () => {
  let server;
  let dispose;

  beforeEach(() => {
    eventBus.stop();
    observerRunning = false;
    jest.clearAllMocks();
    mockCheckSwiftBridge.mockResolvedValue(null);
    mockIsSwiftObserverRunning.mockImplementation(() => observerRunning);
    mockRunSwift.mockImplementation(async command => {
      if (command === 'start-observer') observerRunning = true;
      return { status: 'observer_started' };
    });

    server = createMockServer();
    dispose = registerEventTools(server, {
      notifyResourceListChanged: jest.fn(),
      toolRegistry: {
        getPromptCallback: jest.fn(),
        getPromptNames: jest.fn(() => []),
      },
    });
  });

  afterEach(() => {
    dispose?.();
    eventBus.stop();
  });

  test('reports a native crash and restarts the observer without discarding event listeners', async () => {
    const triggerListener = jest.fn();
    eventBus.on('calendar_changed', triggerListener);

    const started = parseResult(await server.callTool('event_subscribe'));
    expect(started.status).toBe('started');
    expect(eventBus.isRunning).toBe(true);
    expect(mockRunSwift).toHaveBeenCalledTimes(1);

    const duplicate = parseResult(await server.callTool('event_subscribe'));
    expect(duplicate.status).toBe('already_running');
    expect(mockRunSwift).toHaveBeenCalledTimes(1);

    observerRunning = false;
    const crashedStatus = parseResult(await server.callTool('event_status'));
    expect(crashedStatus).toEqual({ running: false });
    expect(eventBus.isRunning).toBe(true);
    expect(eventBus.listeners('calendar_changed')).toContain(triggerListener);

    const restarted = parseResult(await server.callTool('event_subscribe'));
    expect(restarted.status).toBe('started');
    expect(mockRunSwift).toHaveBeenCalledTimes(2);
    expect(mockStartPollers).toHaveBeenCalledTimes(2);
    expect(eventBus.listeners('calendar_changed')).toContain(triggerListener);

    const recoveredStatus = parseResult(await server.callTool('event_status'));
    expect(recoveredStatus).toEqual({ running: true });
  });
});
