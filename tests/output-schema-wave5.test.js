/**
 * outputSchema Wave 5 — drift guard for photos read tools.
 *
 * Wave 4 covered mail / finder / safari / notes (7 tools). Wave 5
 * extends to photos: `list_photos`, `search_photos`, `get_photo_info`,
 * `list_favorites`. `list_albums` is intentionally deferred — it
 * returns a bare `AlbumItem[]` and outputSchema requires top-level
 * `type: object`; wrapping would be a breaking change for clients
 * already JSON.parse-ing the text content as an array.
 *
 * Each case seeds `runAutomation` (the Photos module's transport
 * dispatch) and asserts `structuredContent` parses through the tool's
 * own `outputSchema` under strict Zod.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const { mockRunAutomation } = setupPlatformMocks();
const { registerPhotosTools } = await import('../dist/photos/tools.js');

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

function resetAll() {
  mockRunAutomation.mockReset();
}

// ── photos.list_photos ────────────────────────────────────────────────

describe('Wave 5 — photos.list_photos', () => {
  beforeEach(resetAll);

  test('structuredContent matches outputSchema with full row', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({
      total: 2,
      offset: 0,
      returned: 2,
      photos: [
        {
          id: 'abc-1',
          filename: 'IMG_0001.HEIC',
          name: null,
          date: '2026-04-30T09:00:00Z',
          width: 4032,
          height: 3024,
          favorite: false,
        },
        {
          id: 'abc-2',
          filename: null,
          name: null,
          date: null,
          width: 1920,
          height: 1080,
          favorite: true,
        },
      ],
    });
    const result = await server.callTool('list_photos', { album: 'Recents', limit: 50, offset: 0 });
    assertConforms(server, 'list_photos', result.structuredContent);
  });

  test('structuredContent handles empty album', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({ total: 0, offset: 0, returned: 0, photos: [] });
    const result = await server.callTool('list_photos', { album: 'Empty', limit: 50, offset: 0 });
    assertConforms(server, 'list_photos', result.structuredContent);
  });
});

// ── photos.search_photos ──────────────────────────────────────────────

describe('Wave 5 — photos.search_photos', () => {
  beforeEach(resetAll);

  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({
      total: 1,
      photos: [
        {
          id: 'xyz-1',
          filename: 'beach.jpg',
          name: 'Sunset',
          date: '2026-04-30T18:00:00Z',
          favorite: true,
          description: 'Warm light over the water',
        },
      ],
    });
    const result = await server.callTool('search_photos', { query: 'beach', limit: 30 });
    assertConforms(server, 'search_photos', result.structuredContent);
  });
});

// ── photos.get_photo_info ─────────────────────────────────────────────

describe('Wave 5 — photos.get_photo_info', () => {
  beforeEach(resetAll);

  test('structuredContent matches outputSchema (with GPS + keywords)', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({
      id: 'abc-1',
      filename: 'IMG.HEIC',
      name: 'Sunset',
      description: 'Beach',
      date: '2026-04-30T18:00:00Z',
      width: 4032,
      height: 3024,
      altitude: 12.5,
      location: [37.7749, -122.4194],
      favorite: true,
      keywords: ['sunset', 'beach'],
    });
    const result = await server.callTool('get_photo_info', { id: 'abc-1' });
    assertConforms(server, 'get_photo_info', result.structuredContent);
  });

  test('structuredContent tolerates all-null EXIF metadata', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({
      id: 'abc-2',
      filename: null,
      name: null,
      description: null,
      date: null,
      width: 0,
      height: 0,
      altitude: null,
      location: null,
      favorite: false,
      keywords: null,
    });
    const result = await server.callTool('get_photo_info', { id: 'abc-2' });
    assertConforms(server, 'get_photo_info', result.structuredContent);
  });
});

// ── photos.list_favorites ─────────────────────────────────────────────

describe('Wave 5 — photos.list_favorites', () => {
  beforeEach(resetAll);

  test('structuredContent matches outputSchema', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({
      total: 1,
      returned: 1,
      photos: [
        {
          id: 'fav-1',
          filename: 'IMG.HEIC',
          name: 'Family',
          date: '2026-04-29T15:00:00Z',
          width: 4032,
          height: 3024,
          favorite: true,
        },
      ],
    });
    const result = await server.callTool('list_favorites', { limit: 50 });
    assertConforms(server, 'list_favorites', result.structuredContent);
  });

  test('structuredContent handles empty list', async () => {
    const server = createMockServer();
    registerPhotosTools(server, createMockConfig());
    mockRunAutomation.mockResolvedValue({ total: 0, returned: 0, photos: [] });
    const result = await server.callTool('list_favorites', { limit: 50 });
    assertConforms(server, 'list_favorites', result.structuredContent);
  });
});
