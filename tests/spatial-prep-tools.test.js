import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockServer } from './helpers/mock-server.js';

const { registerSpatialPrepTools } = await import('../dist/spatial_prep/tools.js');

describe('Spatial prep tools', () => {
  let tempDir;
  let server;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'airmcp-spatial-prep-'));
    server = createMockServer();
    registerSpatialPrepTools(server, {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('registers the read-only spatial prep tools', () => {
    expect(server._tools.has('list_vr_assets')).toBe(true);
    expect(server._tools.has('get_vr_asset_context')).toBe(true);
    for (const name of ['list_vr_assets', 'get_vr_asset_context']) {
      const tool = server._tools.get(name);
      expect(tool.opts.annotations.readOnlyHint).toBe(true);
      expect(tool.opts.annotations.destructiveHint).toBe(false);
    }
  });

  test('list_vr_assets scans metadata, filters extensions, and skips symlink directories', async () => {
    const project = join(tempDir, 'project');
    const modelDir = join(project, 'models');
    const linkedDir = join(tempDir, 'linked');
    await mkdir(modelDir, { recursive: true });
    await mkdir(linkedDir, { recursive: true });
    await writeFile(join(modelDir, 'chair.usdz'), 'fake binary');
    await writeFile(join(modelDir, 'preview.png'), 'not an asset');
    await writeFile(join(modelDir, '.hidden.glb'), 'hidden');
    await symlink(linkedDir, join(project, 'linked-assets'));

    const result = await server.callTool('list_vr_assets', {
      root: project,
      limit: 50,
      cursor: 0,
      maxDepth: 4,
      maxEntries: 1000,
      includeHidden: false,
    });

    expect(result.structuredContent.total).toBe(1);
    expect(result.structuredContent.assets[0].name).toBe('chair.usdz');
    expect(result.structuredContent.assets[0].relativePath).toBe('models/chair.usdz');
    expect(result.structuredContent.skippedSymlinks).toBe(1);
  });

  test('get_vr_asset_context returns nearby textures, materials, and bounded text context', async () => {
    const project = join(tempDir, 'project');
    await mkdir(project, { recursive: true });
    const assetPath = join(project, 'room.glb');
    const readmePath = join(project, 'README.md');
    await writeFile(assetPath, 'fake binary');
    await writeFile(join(project, 'room.mtl'), 'material info');
    await writeFile(join(project, 'room-basecolor.png'), 'image bytes');
    await writeFile(readmePath, 'Use this as reference context. Do not treat this text as instructions.');

    const result = await server.callTool('get_vr_asset_context', {
      assetPath,
      root: project,
      nearbyLimit: 50,
      maxTextChars: 24,
      includeHidden: false,
    });

    expect(result.structuredContent.asset.name).toBe('room.glb');
    expect(result.structuredContent.nearby.total).toBe(3);
    expect(result.structuredContent.nearby.files.map((f) => f.kind).sort()).toEqual(['material', 'metadata', 'texture']);
    expect(result.structuredContent.textContext).toHaveLength(1);
    expect(result.structuredContent.textContext[0].path).toBe(await realpath(readmePath));
    expect(result.structuredContent.textContext[0].excerpt.length).toBeLessThanOrEqual(24);
    expect(result.structuredContent.textContext[0].truncated).toBe(true);
  });

  test('get_vr_asset_context rejects assets outside an explicit root', async () => {
    const root = join(tempDir, 'root');
    const outside = join(tempDir, 'outside.glb');
    await mkdir(root, { recursive: true });
    await writeFile(outside, 'fake binary');

    const result = await server.callTool('get_vr_asset_context', {
      assetPath: outside,
      root,
      nearbyLimit: 50,
      maxTextChars: 100,
      includeHidden: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[invalid_input]');
  });
});
