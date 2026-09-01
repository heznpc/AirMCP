/**
 * outputSchema Wave 6 — drift guard for system + music read tools.
 *
 * Wave 5 covered photos. Wave 6 closes the device-state + music-context
 * gap: 7 system reads (list_running_apps, get_screen_info, get_wifi_status,
 * list_bluetooth_devices, get_battery_status, get_brightness,
 * list_all_windows) + 3 music reads (search_tracks, get_track_info,
 * get_rating).
 *
 * Each case seeds runJxa (the underlying transport for both modules) with
 * realistic JSON and asserts `structuredContent` parses through the tool's
 * own outputSchema under strict Zod.
 *
 * Schemas use `z.tuple([z.number(), z.number()])` for window position/size
 * because JXA's `window.position()` and `window.size()` always return a
 * fixed-length 2-tuple via NSArray; tolerating a longer/shorter array
 * would silently mask shape regressions in the AppleScript dictionary.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const { mockRunJxa } = setupPlatformMocks();
const { registerSystemTools } = await import('../dist/system/tools.js');
const { registerMusicTools } = await import('../dist/music/tools.js');

function schemaFor(server, toolName) {
  const tool = server._tools.get(toolName);
  expect(tool).toBeDefined();
  expect(tool.opts.outputSchema).toBeDefined();
  return z.object(tool.opts.outputSchema).strict();
}

function assertConforms(server, toolName, structured) {
  const schema = schemaFor(server, toolName);
  const parsed = schema.safeParse(structured);
  if (!parsed.success) {
    throw new Error(`${toolName} drift: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
}

function setupSystemServer() {
  const server = createMockServer();
  registerSystemTools(server, createMockConfig());
  return server;
}

function setupMusicServer() {
  const server = createMockServer();
  registerMusicTools(server, createMockConfig());
  return server;
}

beforeEach(() => {
  mockRunJxa.mockReset();
});

// ── system.list_running_apps ──────────────────────────────────────────

describe('Wave 6 — system.list_running_apps', () => {
  test('full row with several apps', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      total: 3,
      apps: [
        { name: 'Finder', bundleIdentifier: 'com.apple.finder', pid: 1, visible: true },
        { name: 'Terminal', bundleIdentifier: 'com.apple.Terminal', pid: 2345, visible: true },
        { name: 'Helper', bundleIdentifier: 'com.example.helper', pid: 9999, visible: false },
      ],
    });
    const result = await server.callTool('list_running_apps', {});
    assertConforms(server, 'list_running_apps', result.structuredContent);
  });

  test('empty list', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({ total: 0, apps: [] });
    const result = await server.callTool('list_running_apps', {});
    assertConforms(server, 'list_running_apps', result.structuredContent);
  });
});

// ── system.get_screen_info ────────────────────────────────────────────

describe('Wave 6 — system.get_screen_info', () => {
  test('multi-display Retina + non-Retina', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      displays: [
        { name: 'Built-in Retina', resolution: '3024 x 1964', pixelWidth: 3024, pixelHeight: 1964, retina: true },
        { name: 'External', resolution: '2560 x 1440', pixelWidth: 2560, pixelHeight: 1440, retina: false },
      ],
    });
    const result = await server.callTool('get_screen_info', {});
    assertConforms(server, 'get_screen_info', result.structuredContent);
  });

  test('null pixel dimensions tolerated', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      displays: [{ name: 'Display', resolution: null, pixelWidth: null, pixelHeight: null, retina: false }],
    });
    const result = await server.callTool('get_screen_info', {});
    assertConforms(server, 'get_screen_info', result.structuredContent);
  });
});

// ── system.get_wifi_status ────────────────────────────────────────────

describe('Wave 6 — system.get_wifi_status', () => {
  test('connected with full info', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      ssid: 'HomeNet',
      bssid: '00:11:22:33:44:55',
      signalStrength: -52,
      noiseLevel: -91,
      channel: '36',
      connected: true,
      raw: 'agrCtlRSSI: -52\nSSID: HomeNet\n',
    });
    const result = await server.callTool('get_wifi_status', {});
    assertConforms(server, 'get_wifi_status', result.structuredContent);
  });

  test('disconnected (all nullable fields null)', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      ssid: null,
      bssid: null,
      signalStrength: null,
      noiseLevel: null,
      channel: null,
      connected: false,
      raw: 'WiFi off',
    });
    const result = await server.callTool('get_wifi_status', {});
    assertConforms(server, 'get_wifi_status', result.structuredContent);
  });
});

// ── system.list_bluetooth_devices ─────────────────────────────────────

describe('Wave 6 — system.list_bluetooth_devices', () => {
  test('mixed paired + connected devices', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      total: 2,
      devices: [
        { name: 'AirPods Pro', connected: true, address: 'aa:bb:cc:dd:ee:ff', type: 'Headphones' },
        { name: 'Magic Mouse', connected: false, address: null, type: 'Mouse' },
      ],
    });
    const result = await server.callTool('list_bluetooth_devices', {});
    assertConforms(server, 'list_bluetooth_devices', result.structuredContent);
  });

  test('empty paired list', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({ total: 0, devices: [] });
    const result = await server.callTool('list_bluetooth_devices', {});
    assertConforms(server, 'list_bluetooth_devices', result.structuredContent);
  });
});

// ── system.get_battery_status ─────────────────────────────────────────

describe('Wave 6 — system.get_battery_status', () => {
  test('charging on AC', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      percentage: 85,
      charging: true,
      source: 'AC Power',
      timeRemaining: '0:45',
      raw: 'AC Power; 85%; charging; 0:45 remaining',
    });
    const result = await server.callTool('get_battery_status', {});
    assertConforms(server, 'get_battery_status', result.structuredContent);
  });

  test('Mac mini (no battery — all percentage/time null)', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      percentage: null,
      charging: false,
      source: null,
      timeRemaining: null,
      raw: 'No batteries',
    });
    const result = await server.callTool('get_battery_status', {});
    assertConforms(server, 'get_battery_status', result.structuredContent);
  });
});

// ── system.get_brightness ─────────────────────────────────────────────

describe('Wave 6 — system.get_brightness', () => {
  test('typical reading', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({ brightness: 0.75, raw: '"brightness" = 768' });
    const result = await server.callTool('get_brightness', {});
    assertConforms(server, 'get_brightness', result.structuredContent);
  });

  test('external display (no brightness reported — null tolerated)', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({ brightness: null, raw: '' });
    const result = await server.callTool('get_brightness', {});
    assertConforms(server, 'get_brightness', result.structuredContent);
  });
});

// ── system.list_all_windows ───────────────────────────────────────────

describe('Wave 6 — system.list_all_windows', () => {
  test('windows across multiple apps', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      total: 2,
      windows: [
        { app: 'Safari', pid: 100, title: 'AirMCP — heznpc/AirMCP', position: [0, 25], size: [1440, 900], minimized: false },
        { app: 'Notes', pid: 200, title: 'My Note', position: [200, 100], size: [800, 600], minimized: true },
      ],
    });
    const result = await server.callTool('list_all_windows', {});
    assertConforms(server, 'list_all_windows', result.structuredContent);
  });

  test('window with null position/size (accessibility lookup failed)', async () => {
    const server = setupSystemServer();
    mockRunJxa.mockResolvedValue({
      total: 1,
      windows: [{ app: 'Background Process', pid: 999, title: '', position: null, size: null, minimized: false }],
    });
    const result = await server.callTool('list_all_windows', {});
    assertConforms(server, 'list_all_windows', result.structuredContent);
  });
});

// ── music.search_tracks ───────────────────────────────────────────────

describe('Wave 6 — music.search_tracks', () => {
  test('returns several tracks', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({
      total: 1500,
      returned: 2,
      tracks: [
        { id: 101, name: 'Take Five', artist: 'Dave Brubeck', album: 'Time Out', duration: 324 },
        { id: 102, name: 'Blue in Green', artist: 'Miles Davis', album: 'Kind of Blue', duration: 337 },
      ],
    });
    const result = await server.callTool('search_tracks', { query: 'jazz', limit: 30 });
    assertConforms(server, 'search_tracks', result.structuredContent);
  });

  test('empty result set', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({ total: 0, returned: 0, tracks: [] });
    const result = await server.callTool('search_tracks', { query: 'no-match', limit: 30 });
    assertConforms(server, 'search_tracks', result.structuredContent);
  });
});

// ── music.get_track_info ──────────────────────────────────────────────

describe('Wave 6 — music.get_track_info', () => {
  test('full metadata', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({
      id: 42,
      name: 'Take Five',
      artist: 'Dave Brubeck',
      album: 'Time Out',
      albumArtist: 'Dave Brubeck Quartet',
      genre: 'Jazz',
      year: 1959,
      trackNumber: 3,
      discNumber: 1,
      duration: 324.5,
      playedCount: 17,
      rating: 80,
      favorited: true,
      disliked: false,
      dateAdded: '2024-03-15T08:30:00Z',
      sampleRate: 44100,
      bitRate: 256,
      size: 13107200,
    });
    const result = await server.callTool('get_track_info', { trackName: 'Take Five' });
    assertConforms(server, 'get_track_info', result.structuredContent);
  });

  test('missing dateAdded tolerated', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({
      id: 0,
      name: 'Untitled',
      artist: '',
      album: '',
      albumArtist: '',
      genre: '',
      year: 0,
      trackNumber: 0,
      discNumber: 0,
      duration: 0,
      playedCount: 0,
      rating: 0,
      favorited: false,
      disliked: false,
      dateAdded: null,
      sampleRate: 0,
      bitRate: 0,
      size: 0,
    });
    const result = await server.callTool('get_track_info', { trackName: 'Untitled' });
    assertConforms(server, 'get_track_info', result.structuredContent);
  });
});

// ── music.get_rating ──────────────────────────────────────────────────

describe('Wave 6 — music.get_rating', () => {
  test('rated + favorited track', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({
      name: 'Take Five',
      artist: 'Dave Brubeck',
      rating: 100,
      favorited: true,
      disliked: false,
    });
    const result = await server.callTool('get_rating', { trackName: 'Take Five' });
    assertConforms(server, 'get_rating', result.structuredContent);
  });

  test('unrated track', async () => {
    const server = setupMusicServer();
    mockRunJxa.mockResolvedValue({
      name: 'New Track',
      artist: '',
      rating: 0,
      favorited: false,
      disliked: false,
    });
    const result = await server.callTool('get_rating', { trackName: 'New Track' });
    assertConforms(server, 'get_rating', result.structuredContent);
  });
});
