import { describe, test, expect, beforeEach } from '@jest/globals';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

// Set up mocks before importing module under test
const { mockRunJxa, mockRunAutomation } = setupPlatformMocks();
const { registerSystemTools } = await import('../dist/system/tools.js');

// ── Helpers ──────────────────────────────────────────────────────────

function setup(configOverrides = {}) {
  const server = createMockServer();
  const config = createMockConfig(configOverrides);
  registerSystemTools(server, config);
  return { server, config };
}

// ── Registration ─────────────────────────────────────────────────────

describe('registerSystemTools', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
    mockRunAutomation.mockReset();
  });

  test('registers all expected system tools', () => {
    const { server } = setup();
    const names = [...server._tools.keys()];

    const expected = [
      'get_clipboard', 'set_clipboard',
      'get_volume', 'set_volume',
      'toggle_dark_mode',
      'get_frontmost_app', 'list_running_apps',
      'get_screen_info', 'show_notification', 'capture_screenshot',
      'get_wifi_status', 'toggle_wifi', 'list_bluetooth_devices',
      'get_battery_status', 'get_brightness', 'set_brightness',
      'toggle_focus_mode',
      'system_sleep', 'prevent_sleep', 'system_power',
      'launch_app', 'quit_app', 'is_app_running',
      'list_all_windows', 'move_window', 'resize_window', 'minimize_window',
    ];

    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  test('read-only system tools have correct annotations', () => {
    const { server } = setup();
    const readOnlyTools = [
      'get_clipboard', 'get_volume', 'get_frontmost_app',
      'list_running_apps', 'get_screen_info', 'get_wifi_status',
      'list_bluetooth_devices', 'get_battery_status', 'get_brightness',
      'is_app_running', 'list_all_windows',
    ];

    for (const name of readOnlyTools) {
      const tool = server._tools.get(name);
      expect(tool.opts.annotations.readOnlyHint).toBe(true);
      expect(tool.opts.annotations.destructiveHint).toBe(false);
    }
  });

  test('destructive system tools have correct annotations', () => {
    const { server } = setup();
    const destructiveTools = ['toggle_wifi', 'system_sleep', 'system_power', 'quit_app'];

    for (const name of destructiveTools) {
      const tool = server._tools.get(name);
      expect(tool.opts.annotations.destructiveHint).toBe(true);
    }
  });
});

// ── get_clipboard (runAutomation pattern) ────────────────────────────

describe('get_clipboard', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
    mockRunAutomation.mockReset();
  });

  test('returns clipboard content via runAutomation', async () => {
    const { server } = setup();
    mockRunAutomation.mockResolvedValue({ content: 'Hello World', length: 11, truncated: false });

    const result = await server.callTool('get_clipboard', {});

    expect(result.isError).toBeUndefined();
    // get_clipboard uses okUntrusted
    expect(result.content[0].text).toContain('UNTRUSTED');
    expect(result.content[0].text).toContain('Hello World');
    expect(mockRunAutomation).toHaveBeenCalledTimes(1);

    // Verify runAutomation was called with swift and jxa options
    const callArg = mockRunAutomation.mock.calls[0][0];
    expect(callArg.swift.command).toBe('get-clipboard');
    expect(typeof callArg.jxa).toBe('function');
  });

  test('returns error on runAutomation failure', async () => {
    const { server } = setup();
    mockRunAutomation.mockRejectedValue(new Error('clipboard unavailable'));

    const result = await server.callTool('get_clipboard', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get clipboard');
  });
});

// ── set_clipboard (JXA-only) ─────────────────────────────────────────

describe('set_clipboard', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
    mockRunAutomation.mockReset();
  });

  test('sets clipboard content via runJxa', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ set: true, length: 5 });

    const result = await server.callTool('set_clipboard', { text: 'hello' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.set).toBe(true);
    expect(parsed.length).toBe(5);
    expect(mockRunJxa).toHaveBeenCalledTimes(1);
  });

  test('returns error on JXA failure', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('access denied'));

    const result = await server.callTool('set_clipboard', { text: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to set clipboard');
  });
});

// ── get_volume / set_volume ──────────────────────────────────────────

describe('get_volume', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns volume levels', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ outputVolume: 50, inputVolume: 75, outputMuted: false });

    const result = await server.callTool('get_volume', {});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.outputVolume).toBe(50);
    expect(parsed.outputMuted).toBe(false);
  });
});

describe('set_volume', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('sets volume and returns new state', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ outputVolume: 80, outputMuted: false });

    const result = await server.callTool('set_volume', { volume: 80 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.outputVolume).toBe(80);
  });
});

// ── get_frontmost_app ────────────────────────────────────────────────

describe('get_frontmost_app', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns frontmost app info', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ name: 'Safari', bundleIdentifier: 'com.apple.Safari', pid: 1234 });

    const result = await server.callTool('get_frontmost_app', {});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe('Safari');
    expect(parsed.bundleIdentifier).toBe('com.apple.Safari');
    expect(parsed.pid).toBe(1234);
  });
});

// ── show_notification ────────────────────────────────────────────────

describe('show_notification', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('shows notification with all options', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ sent: true });

    const result = await server.callTool('show_notification', {
      message: 'Hello',
      title: 'AirMCP',
      subtitle: 'Test',
      sound: 'Glass',
    });

    expect(result.isError).toBeUndefined();
    expect(mockRunJxa).toHaveBeenCalledTimes(1);
  });
});

// ── launch_app / quit_app / is_app_running ───────────────────────────

describe('launch_app', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('launches an app by name', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ launched: true, name: 'Safari' });

    const result = await server.callTool('launch_app', { name: 'Safari' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.launched).toBe(true);
  });

  test('returns error when app not found', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('App not found: FakeApp'));

    const result = await server.callTool('launch_app', { name: 'FakeApp' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to launch app');
  });
});

describe('quit_app', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('quits a running app', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ quit: true, name: 'TextEdit' });

    const result = await server.callTool('quit_app', { name: 'TextEdit' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.quit).toBe(true);
  });
});

describe('is_app_running', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns running status', async () => {
    const { server } = setup();
    // Wave 7: is_app_running now has outputSchema → structuredContent is the
    // source of truth. Mock matches the actual script return shape including
    // the running:true variant fields (bundleIdentifier, visible).
    mockRunJxa.mockResolvedValue({
      running: true,
      name: 'Safari',
      bundleIdentifier: 'com.apple.Safari',
      pid: 1234,
      visible: true,
    });

    const result = await server.callTool('is_app_running', { name: 'Safari' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.running).toBe(true);
    expect(result.structuredContent.pid).toBe(1234);
  });
});

// ── Window management ────────────────────────────────────────────────

describe('list_all_windows', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('returns window list', async () => {
    const { server } = setup();
    // Wave 6: list_all_windows now declares outputSchema so structuredContent
    // is the source of truth. Mock matches the actual script return shape
    // (was previously a bare array; the script always returned {total, windows}).
    mockRunJxa.mockResolvedValue({
      total: 2,
      windows: [
        { app: 'Safari', pid: 100, title: 'Google', position: [0, 0], size: [1200, 800], minimized: false },
        { app: 'Finder', pid: 200, title: 'Documents', position: [100, 100], size: [600, 400], minimized: false },
      ],
    });

    const result = await server.callTool('list_all_windows', {});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.total).toBe(2);
    expect(result.structuredContent.windows).toHaveLength(2);
    expect(result.structuredContent.windows[0].app).toBe('Safari');
  });
});

describe('move_window', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('moves a window to specified coordinates', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ moved: true, app: 'Safari', x: 200, y: 100 });

    const result = await server.callTool('move_window', { appName: 'Safari', x: 200, y: 100 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.moved).toBe(true);
    expect(parsed.x).toBe(200);
  });
});

describe('resize_window', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
  });

  test('resizes a window', async () => {
    const { server } = setup();
    mockRunJxa.mockResolvedValue({ resized: true, width: 800, height: 600 });

    const result = await server.callTool('resize_window', { appName: 'Safari', width: 800, height: 600 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.resized).toBe(true);
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe('error handling', () => {
  beforeEach(() => {
    mockRunJxa.mockReset();
    mockRunAutomation.mockReset();
  });

  test('tools using runAutomation wrap errors with toolError', async () => {
    const { server } = setup();
    mockRunAutomation.mockRejectedValue(new Error('bridge crash'));

    const result = await server.callTool('get_clipboard', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get clipboard');
    expect(result.content[0].text).toContain('bridge crash');
  });

  test('tools using runJxa wrap errors with toolError', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue(new Error('osascript crash'));

    const result = await server.callTool('get_volume', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get volume');
    expect(result.content[0].text).toContain('osascript crash');
  });

  test('handles non-Error thrown values', async () => {
    const { server } = setup();
    mockRunJxa.mockRejectedValue('string error');

    const result = await server.callTool('toggle_dark_mode', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('string error');
  });
});
