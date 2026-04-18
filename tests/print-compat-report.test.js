/**
 * Smoke test for scripts/print-compat-report.mjs.
 *
 * Keeps the script honest — covers the text layout, --json shape, and
 * --help exit code. We don't mock the env: the script reads
 * getCompatibilityEnv() from the current process, so assertions only touch
 * fields that hold on both darwin and linux sandboxes (every module in
 * MODULE_MANIFEST must appear somewhere in the output, --json must
 * round-trip, etc.).
 */
import { describe, test, expect } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MODULE_MANIFEST } from '../dist/shared/modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'scripts', 'print-compat-report.mjs');

function run(args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('print-compat-report', () => {
  test('--help exits 0 and prints usage', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('RFC 0004');
    expect(r.stdout).toContain('--json');
  });

  test('default text output mentions env + totals', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^AirMCP compatibility report/);
    expect(r.stdout).toContain('Total ');
    expect(r.stdout).toContain('register ');
  });

  test('--json emits a valid object with expected keys', () => {
    const r = run(['--json']);
    expect(r.status).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj).toHaveProperty('env');
    expect(obj).toHaveProperty('summary');
    expect(obj).toHaveProperty('decisions');
    expect(Array.isArray(obj.decisions)).toBe(true);
    // Must cover every module in the manifest — drifting below this count
    // means a module silently disappeared from the report.
    expect(obj.decisions.length).toBe(MODULE_MANIFEST.length);
    // Every manifest entry must have a corresponding decision entry.
    const decidedNames = new Set(obj.decisions.map((d) => d.name));
    for (const m of MODULE_MANIFEST) {
      expect(decidedNames.has(m.name)).toBe(true);
    }
    for (const d of obj.decisions) {
      expect(typeof d.name).toBe('string');
      expect(['register', 'register-with-deprecation', 'skip-unsupported', 'skip-broken']).toContain(
        d.decision,
      );
    }
  });

  test('--json totals reconcile across summary groups', () => {
    const r = run(['--json']);
    const { summary, decisions } = JSON.parse(r.stdout);
    const groupSum =
      summary.register.length +
      // deprecated modules also end up in `register` (they still register); avoid double-count.
      summary.unsupported.length +
      summary.broken.length;
    expect(groupSum).toBe(decisions.length);
  });
});
