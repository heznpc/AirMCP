/**
 * audit_log / audit_summary end-to-end tests.
 *
 * Writes a handful of auditLog() entries, flushes to a tmp audit.jsonl,
 * then calls the registered tools and checks the filter / aggregation
 * behaviour. The fs is real — the handler reads the JSONL back through
 * the same path as production — so anything that would break on a
 * live machine (e.g. malformed line tolerance, since-filter math) is
 * exercised here.
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Redirect PATHS.VECTOR_STORE (= audit dir) to a scratch dir BEFORE the
// audit module is imported, so AUDIT_PATH lands in our tmp dir.
const SCRATCH = mkdtempSync(join(tmpdir(), 'airmcp-audit-'));
jest.unstable_mockModule('../dist/shared/constants.js', () => ({
  PATHS: { VECTOR_STORE: SCRATCH, TEMP_DIR: tmpdir() },
  AUDIT: {
    FLUSH_INTERVAL: 30000,
    MAX_ENTRY_SIZE: 8192,
    MAX_FILE_SIZE: 10 * 1024 * 1024,
    MAX_ARG_LENGTH: 500,
    MAX_FLUSH_FAILURES: 3,
  },
  LIMITS: {},
  TIMEOUT: {},
  API: {},
}));

const { registerAuditTools } = await import('../dist/audit/tools.js');
const { createMockServer } = await import('./helpers/mock-server.js');
const { createMockConfig } = await import('./helpers/mock-config.js');

function writeJsonl(file, entries) {
  const path = join(SCRATCH, file);
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

afterEach(() => {
  // Wipe the tmp dir between tests so state from one case doesn't leak.
  try {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
  } catch {
    // best-effort cleanup
  }
});

describe('audit_log tool', () => {
  test('returns entries filtered by time window', async () => {
    const now = Date.now();
    writeJsonl('audit.jsonl', [
      { timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), tool: 'old_tool', status: 'ok' },
      { timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString(), tool: 'new_tool', status: 'ok' },
    ]);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_log', { limit: 10 });
    expect(result.structuredContent.returned).toBe(1);
    expect(result.structuredContent.entries[0].tool).toBe('new_tool');
  });

  test('filters by tool name', async () => {
    const now = Date.now();
    writeJsonl('audit.jsonl', [
      { timestamp: new Date(now).toISOString(), tool: 'a', status: 'ok' },
      { timestamp: new Date(now).toISOString(), tool: 'b', status: 'ok' },
      { timestamp: new Date(now).toISOString(), tool: 'a', status: 'error' },
    ]);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_log', { tool: 'a', limit: 10 });
    expect(result.structuredContent.returned).toBe(2);
    expect(result.structuredContent.entries.every((e) => e.tool === 'a')).toBe(true);
  });

  test('filters by status', async () => {
    const now = Date.now();
    writeJsonl('audit.jsonl', [
      { timestamp: new Date(now).toISOString(), tool: 'x', status: 'ok' },
      { timestamp: new Date(now).toISOString(), tool: 'x', status: 'error' },
    ]);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_log', { status: 'error', limit: 10 });
    expect(result.structuredContent.returned).toBe(1);
    expect(result.structuredContent.entries[0].status).toBe('error');
  });

  test('tolerates malformed lines', async () => {
    const now = new Date().toISOString();
    const validLine = JSON.stringify({ timestamp: now, tool: 't', status: 'ok' });
    writeFileSync(join(SCRATCH, 'audit.jsonl'), `${validLine}\n{not json}\n${validLine}\n`);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_log', { limit: 10 });
    expect(result.structuredContent.returned).toBe(2);
  });

  test('walks rotated files', async () => {
    const now = Date.now();
    writeJsonl('audit.jsonl', [
      { timestamp: new Date(now).toISOString(), tool: 'current', status: 'ok' },
    ]);
    writeJsonl('audit.1700000000000.jsonl', [
      { timestamp: new Date(now - 60_000).toISOString(), tool: 'rotated', status: 'ok' },
    ]);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_log', { limit: 10 });
    expect(result.structuredContent.returned).toBe(2);
    expect(result.structuredContent.scannedFiles).toBeGreaterThanOrEqual(2);
    const tools = result.structuredContent.entries.map((e) => e.tool).sort();
    expect(tools).toEqual(['current', 'rotated']);
  });
});

describe('audit_summary tool', () => {
  test('computes count / errorRate / topTools', async () => {
    const now = new Date().toISOString();
    writeJsonl('audit.jsonl', [
      { timestamp: now, tool: 'alpha', status: 'ok' },
      { timestamp: now, tool: 'alpha', status: 'ok' },
      { timestamp: now, tool: 'alpha', status: 'error' },
      { timestamp: now, tool: 'beta', status: 'ok' },
    ]);
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_summary', { topN: 5 });
    const sc = result.structuredContent;
    expect(sc.total).toBe(4);
    expect(sc.errors).toBe(1);
    expect(sc.errorRate).toBeCloseTo(0.25, 4);
    expect(sc.topTools[0]).toEqual({ tool: 'alpha', count: 3, errors: 1 });
    expect(sc.topTools[1]).toEqual({ tool: 'beta', count: 1, errors: 0 });
  });

  test('empty audit returns zeros without dividing by zero', async () => {
    const server = createMockServer();
    registerAuditTools(server, createMockConfig());
    const result = await server.callTool('audit_summary', {});
    expect(result.structuredContent.total).toBe(0);
    expect(result.structuredContent.errors).toBe(0);
    expect(result.structuredContent.errorRate).toBe(0);
    expect(result.structuredContent.topTools).toEqual([]);
  });
});
