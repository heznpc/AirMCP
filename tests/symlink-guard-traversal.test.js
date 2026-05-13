/**
 * Regression test for the symlink-traversal HIGH fix.
 *
 * Three tools previously accepted any `zFilePath`-validated path without
 * realpath-checking it:
 *   • messages.send_file
 *   • intelligence.generate_image
 *   • shortcuts.export_shortcut / import_shortcut
 *
 * `zFilePath` only rejects literal `..` segments. A symlink inside HOME
 * pointing OUTSIDE HOME would slip past and let a caller exfiltrate /etc,
 * /private/var, /tmp/foo via iMessage attachment, write a generated PNG
 * onto a system file, or read an arbitrary path as a shortcut. The fix
 * was to call `resolveAndGuard()` in each tool, which realpath()s the
 * input and rejects anything resolving outside HOME.
 *
 * This test creates a real symlink inside HOME pointing at /etc (which is
 * always outside HOME on macOS/Linux), then drives each tool and asserts
 * the underlying JXA/Swift mock is NEVER called — the guard short-circuits
 * before the bridge runs.
 *
 * If a future refactor drops `resolveAndGuard()` from any of these tools,
 * this test fires before the regression ships.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { mkdtemp, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const mockRunJxa = jest.fn();
const mockRunAppleScript = jest.fn();
const mockRunSwift = jest.fn();
const mockCheckSwiftBridge = jest.fn(async () => null);

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
  runAppleScript: mockRunAppleScript,
}));
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: mockRunSwift,
  checkSwiftBridge: mockCheckSwiftBridge,
  hasSwiftCommand: async () => true,
  closeSwiftBridge: () => {},
}));

// Force send_file's allow-gate open so the test can reach resolveAndGuard.
// Without this the tool short-circuits on permission before the symlink
// check runs, and we'd be testing the wrong thing.
process.env.AIRMCP_ALLOW_SEND_MESSAGES = 'true';

const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerIntelligenceTools } = await import('../dist/intelligence/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');

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

// A symlink lives in HOME, but points at /etc which is OUTSIDE HOME. This
// is the exact attack `resolveAndGuard` defends against.
let symlinkInsideHome;
let cleanupDir;

beforeAll(async () => {
  const home = homedir();
  // Use a uuid-flavored dir name so concurrent runs / leftover dirs don't
  // collide. tmpdir() on macOS is /var/folders which lives OUTSIDE HOME,
  // so we can't anchor the symlink under tmpdir — it needs to be inside
  // HOME for the guard's "starts inside HOME but resolves outside" attack
  // shape to apply.
  const dirName = `.airmcp-symlink-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  cleanupDir = join(home, dirName);
  await mkdir(cleanupDir, { recursive: true });
  symlinkInsideHome = join(cleanupDir, 'escape.link');
  // Target /etc — a system directory that is always outside HOME.
  // Even root cannot legitimately call any of these tools on /etc/shadow.
  await symlink('/etc', symlinkInsideHome);
});

afterAll(async () => {
  if (cleanupDir) {
    await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('symlink-traversal guard: send_file (messages)', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerMessagesTools(server, {});
  });

  test('rejects a HOME-rooted symlink pointing outside HOME', async () => {
    mockRunAppleScript.mockReset();
    const result = await server.callTool('send_file', {
      target: '+15555550100',
      filePath: symlinkInsideHome,
    });
    // The guard's error wraps as a tool error envelope. Either isError:true
    // or content[0].text starting with "Error" is acceptable — we just need
    // to verify the JXA bridge was NEVER reached.
    expect(mockRunAppleScript).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

describe('symlink-traversal guard: generate_image (intelligence)', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerIntelligenceTools(server, {});
  });

  test('rejects outputPath that resolves outside HOME', async () => {
    mockRunSwift.mockReset();
    const result = await server.callTool('generate_image', {
      prompt: 'a friendly otter',
      outputPath: join(symlinkInsideHome, 'pwn.png'),
    });
    expect(mockRunSwift).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test('allows missing outputPath (defaults to /tmp via Swift)', async () => {
    mockRunSwift.mockReset();
    mockRunSwift.mockResolvedValue({ path: '/tmp/out.png', latencyMs: 1 });
    const result = await server.callTool('generate_image', { prompt: 'a friendly otter' });
    // When outputPath is omitted, the guard skips and the bridge is called
    // exactly once. Catches a regression where the guard would over-fire
    // on undefined paths.
    expect(mockRunSwift).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });
});

describe('symlink-traversal guard: shortcuts export + import', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerShortcutsTools(server, {});
  });

  test('export_shortcut rejects an outputPath resolving outside HOME', async () => {
    mockRunJxa.mockReset();
    const result = await server.callTool('export_shortcut', {
      name: 'TestShortcut',
      outputPath: join(symlinkInsideHome, 'pwn.shortcut'),
    });
    expect(mockRunJxa).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test('import_shortcut rejects a filePath resolving outside HOME', async () => {
    mockRunJxa.mockReset();
    const result = await server.callTool('import_shortcut', {
      filePath: join(symlinkInsideHome, 'evil.shortcut'),
    });
    expect(mockRunJxa).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
