import { describe, test, expect, jest } from '@jest/globals';

// Mock the JXA bridge — music tools require macOS
const mockRunJxa = jest.fn();

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
}));

const { registerMusicTools } = await import('../dist/music/tools.js');

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

describe('Music tools registration', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    registerMusicTools(server, {});
  });

  test('registers all 17 music tools', () => {
    expect(server.tools.size).toBe(17);
    const expectedTools = [
      'list_playlists',
      'list_tracks',
      'now_playing',
      'playback_control',
      'search_tracks',
      'play_track',
      'play_playlist',
      'get_track_info',
      'set_shuffle',
      'create_playlist',
      'add_to_playlist',
      'remove_from_playlist',
      'delete_playlist',
      'get_rating',
      'set_rating',
      'set_favorited',
      'set_disliked',
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

  test('read-only tools have correct annotations', () => {
    const readOnlyTools = [
      'list_playlists',
      'list_tracks',
      'now_playing',
      'search_tracks',
      'get_track_info',
      'get_rating',
    ];
    for (const name of readOnlyTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(true);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });

  test('playback and mutation tools are not read-only', () => {
    const mutatingTools = [
      'playback_control',
      'play_track',
      'play_playlist',
      'set_shuffle',
      'create_playlist',
      'add_to_playlist',
      'remove_from_playlist',
      'delete_playlist',
      'set_rating',
      'set_favorited',
      'set_disliked',
    ];
    for (const name of mutatingTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.readOnlyHint).toBe(false);
    }
  });

  test('destructive tools are correctly marked', () => {
    const destructiveTools = ['remove_from_playlist', 'delete_playlist'];
    for (const name of destructiveTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(true);
    }
  });

  test('non-destructive mutation tools are not marked destructive', () => {
    const safeWriteTools = [
      'playback_control',
      'play_track',
      'play_playlist',
      'create_playlist',
      'add_to_playlist',
      'set_rating',
      'set_favorited',
      'set_disliked',
    ];
    for (const name of safeWriteTools) {
      const { config } = server.tools.get(name);
      expect(config.annotations.destructiveHint).toBe(false);
    }
  });
});
