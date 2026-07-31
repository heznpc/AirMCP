/**
 * Doctor ↔ runtime consistency contract (GitHub #358 class).
 *
 * Issue #358's failure shape: `npx airmcp doctor` reported one state while
 * the actually-booted MCP server ran another (custom profile silently
 * reverting to starter). Nothing guarded the two surfaces against drift —
 * doctor could reimplement config resolution and diverge without any test
 * noticing.
 *
 * This contract pins three views of the SAME config file to each other:
 *
 *   1. the shared resolver (`parseConfig` + `isModuleEnabled`) — the source
 *      of truth the server boots with,
 *   2. the `doctor` CLI's printed "Runtime profile" claim,
 *   3. a real stdio boot of dist/index.js answering `profile_status`.
 *
 * If doctor's reporting path or the server's boot path ever stops deriving
 * from the shared resolver, the three views disagree and this test fails —
 * before a user files the next #358.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'dist', 'index.js');

const SCRATCH = mkdtempSync(join(tmpdir(), 'airmcp-doctor-'));
const CONFIG_PATH = join(SCRATCH, 'config.json');
const FILE_CONFIG = {
  profile: 'full',
  disabledModules: ['music', 'photos'],
};
writeFileSync(CONFIG_PATH, JSON.stringify(FILE_CONFIG, null, 2));

// The child processes and the in-process resolver must see the same world.
const CHILD_ENV = {
  ...process.env,
  AIRMCP_CONFIG_PATH: CONFIG_PATH,
  AIRMCP_RATE_LIMIT: 'false',
  AIRMCP_AUDIT_LOG: 'false',
  AIRMCP_USAGE_TRACKING: 'false',
  AIRMCP_USAGE_PROFILE_PATH: join(SCRATCH, 'usage.json'),
  AIRMCP_HITL_SOCKET_PATH: join(SCRATCH, 'hitl.sock'),
  // Doctor probes the npm registry for a version check; keep the test hermetic.
  npm_config_registry: 'http://127.0.0.1:1',
};
process.env.AIRMCP_CONFIG_PATH = CONFIG_PATH;

const { parseConfig, isModuleEnabled, MODULE_NAMES, getCompatibilityEnv } = await import(
  '../dist/shared/config.js'
);
const { MODULE_MANIFEST } = await import('../dist/shared/modules.js');
const { resolveModuleCompatibility } = await import('../dist/shared/compatibility.js');
const { startMcp, parseStructuredResult } = await import('../scripts/lib/mcp-stdio-client.mjs');

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('doctor ↔ runtime consistency (#358 contract)', () => {
  let resolved;

  beforeAll(() => {
    const config = parseConfig();
    const compatEnv = getCompatibilityEnv();
    // What the server actually boots: config-enabled modules minus the ones
    // the shared compatibility resolver skips on this host (e.g. podcasts is
    // brokenOn macOS 26). Both filters come from shared code — the test never
    // reimplements either decision.
    const bootedModules = MODULE_NAMES.filter((m) => {
      if (!isModuleEnabled(config, m)) return false;
      const entry = MODULE_MANIFEST.find((d) => d.name === m);
      const decision = resolveModuleCompatibility(m, entry?.compatibility, compatEnv);
      return !decision.decision.startsWith('skip');
    }).sort();
    resolved = {
      profile: config.profile,
      toolExposure: config.toolExposure,
      enabledModules: MODULE_NAMES.filter((m) => isModuleEnabled(config, m)).sort(),
      bootedModules,
      totalModules: MODULE_NAMES.length,
    };
  });

  test('shared resolver honors the file config (test precondition)', () => {
    expect(resolved.profile).toBe('full');
    expect(resolved.enabledModules).not.toContain('music');
    expect(resolved.enabledModules).not.toContain('photos');
    expect(resolved.enabledModules.length).toBeGreaterThan(10);
  });

  test(
    'doctor reports exactly the shared resolver state',
    async () => {
      const { stdout } = await execFileAsync('node', [ENTRY, 'doctor'], {
        env: CHILD_ENV,
        timeout: 90_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = stripAnsi(stdout);
      // The label names the standard-module denominator AND the opt-in modules
      // excluded from it, because reporting only "11/29" read as a
      // contradiction of the documented 32-module catalogue.
      const match = text.match(
        /Runtime profile\s+(\S+) \((\S+) exposure, (\d+)\/(\d+) standard modules enabled, (\d+) opt-in excluded of (\d+) total\)/,
      );
      expect(match).not.toBeNull();
      const [, profile, exposure, enabled, total, optIn, catalogue] = match;
      expect(profile).toBe(resolved.profile);
      expect(exposure).toBe(resolved.toolExposure);
      expect(Number(enabled)).toBe(resolved.enabledModules.length);
      expect(Number(total)).toBe(resolved.totalModules);
      // The two denominators have to add up, or the label just moves the
      // confusion instead of resolving it.
      expect(Number(total) + Number(optIn)).toBe(Number(catalogue));
      // The #358 regression path: a requested profile that is not effective
      // must be flagged. With a valid requested profile there is no mismatch
      // warning — doctor may not claim one exists.
      expect(text).not.toMatch(/Config profile\s+requested/);
    },
    120_000,
  );

  test(
    'a real stdio boot reports the same profile and module set (profile_status)',
    async () => {
      const mcp = startMcp({ entry: ENTRY, cwd: ROOT, env: CHILD_ENV, timeoutMs: 30_000 });
      try {
        const init = await mcp.request(
          'initialize',
          {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'doctor-consistency-test', version: '0.0.0' },
          },
          1,
        );
        expect(init.result).toBeDefined();
        mcp.notify('notifications/initialized');

        const callResp = await mcp.request(
          'tools/call',
          { name: 'profile_status', arguments: {} },
          2,
        );
        expect(callResp.result).toBeDefined();
        const status = parseStructuredResult(callResp);
        expect(status.profile).toBe(resolved.profile);
        expect(status.toolExposure).toBe(resolved.toolExposure);
        expect([...status.modulesEnabled].sort()).toEqual(resolved.bootedModules);
        expect(status.modulesDisabled).toEqual(expect.arrayContaining(['music', 'photos']));
      } finally {
        await mcp.stop();
      }
    },
    120_000,
  );
});

afterAll(() => {
  delete process.env.AIRMCP_CONFIG_PATH;
});
