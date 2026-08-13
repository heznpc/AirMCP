/**
 * setup_permissions — permission guidance surface.
 *
 * The scenario that motivated this: capture_screenshot failed because Screen
 * Recording was never granted, and the tool result gave the user no way to
 * find the right System Settings pane. Screen Recording, Accessibility, and
 * Full Disk Access can never show a macOS consent popup, so setup_permissions
 * now (a) reports their live status and (b) can deep-link straight into the
 * pane via open_settings.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const spawnCalls = [];
jest.unstable_mockModule('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    default: actual,
    spawn: jest.fn((cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      return { on: jest.fn(), unref: jest.fn() };
    }),
  };
});

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: jest.fn(async () => '{"accessible":true}'),
}));

let bridgeHasCommand = true;
let bridgeStatus = { screenRecording: false, accessibility: true };
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  hasSwiftCommand: jest.fn(async () => bridgeHasCommand),
  runSwift: jest.fn(async () => bridgeStatus),
  checkSwiftBridge: jest.fn(async () => null),
  closeSwiftBridge: jest.fn(),
}));

const { registerSetupTools, probeFullDiskAccess } = await import('../dist/shared/setup.js');

function captureTool() {
  const captured = {};
  const fakeServer = {
    registerTool(name, config, cb) {
      captured.name = name;
      captured.config = config;
      captured.cb = cb;
    },
  };
  registerSetupTools(fakeServer);
  return captured;
}

beforeEach(() => {
  spawnCalls.length = 0;
  bridgeHasCommand = true;
  bridgeStatus = { screenRecording: false, accessibility: true };
});

describe('setup_permissions — non-promptable permission status', () => {
  test('declares the open_settings parameter in its input schema', () => {
    const tool = captureTool();
    expect(tool.name).toBe('setup_permissions');
    expect(tool.config.inputSchema).toHaveProperty('open_settings');
    expect(tool.config.description).toContain('open_settings');
  });

  test('reports bridge-probed Screen Recording / Accessibility status with settings deep links', async () => {
    const tool = captureTool();
    const result = await tool.cb({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.system_permissions.screen_recording).toMatchObject({
      status: 'denied',
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    });
    expect(parsed.system_permissions.screen_recording.settings_path).toContain('Privacy & Security');
    expect(parsed.system_permissions.accessibility).toMatchObject({
      status: 'granted',
      settings_url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    });
    // Full Disk is probed against the real TCC database on this machine —
    // the value is environment-dependent, the contract is the shape.
    expect(['granted', 'denied', 'unknown']).toContain(parsed.system_permissions.full_disk.status);
    expect(parsed.system_permissions.full_disk.settings_url).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
  });

  test('degrades to "unknown" when the compiled bridge lacks the permission-status command', async () => {
    bridgeHasCommand = false;
    const tool = captureTool();
    const result = await tool.cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.system_permissions.screen_recording.status).toBe('unknown');
    expect(parsed.system_permissions.accessibility.status).toBe('unknown');
  });

  test('open_settings launches the deep link for the requested pane', async () => {
    const tool = captureTool();
    const result = await tool.cb({ open_settings: 'screen_recording' });
    const parsed = JSON.parse(result.content[0].text);

    if (process.platform === 'darwin') {
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].cmd).toBe('/usr/bin/open');
      expect(spawnCalls[0].args).toEqual([
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      ]);
      expect(parsed.opened_settings).toBe(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    } else {
      expect(spawnCalls).toHaveLength(0);
      expect(parsed.opened_settings).toBeUndefined();
    }
  });

  test('without open_settings nothing is launched', async () => {
    const tool = captureTool();
    await tool.cb({});
    expect(spawnCalls).toHaveLength(0);
  });

  test('legacy per-app probe results are preserved', async () => {
    const tool = captureTool();
    const result = await tool.cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBeGreaterThan(0);
    expect(parsed.granted).toBe(parsed.total);
    expect(parsed.results.every((r) => r.status === 'granted')).toBe(true);
  });
});

describe('probeFullDiskAccess', () => {
  test('an openable probe path counts as granted', async () => {
    const status = await probeFullDiskAccess(new URL(import.meta.url).pathname);
    expect(status).toBe(process.platform === 'darwin' ? 'granted' : 'unknown');
  });

  test('ENOENT with the TCC vault marker present counts as denied (vault hides the file)', async () => {
    const marker = new URL(import.meta.url).pathname; // any existing path
    const status = await probeFullDiskAccess('/nonexistent/airmcp-fda-probe', marker);
    expect(status).toBe(process.platform === 'darwin' ? 'denied' : 'unknown');
  });

  test('ENOENT with the TCC layout itself missing is inconclusive, not denied', async () => {
    const status = await probeFullDiskAccess('/nonexistent/airmcp-fda-probe', '/nonexistent/airmcp-tcc-marker');
    expect(status).toBe('unknown');
  });
});
