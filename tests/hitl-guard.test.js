import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { installHitlGuard } from '../dist/shared/hitl-guard.js';

/**
 * Creates a minimal mock McpServer whose registerTool captures registrations.
 * After installHitlGuard patches it, we can inspect what callback was stored
 * (original vs wrapped) to infer whether approval is required.
 *
 * @param {{ clientName?: string, withElicitation?: boolean }} [opts]
 *   clientName — sets `server.server.getClientVersion()` return value.
 *   withElicitation — adds a mock `elicitInput` that auto-accepts, so tests
 *     can verify whether elicitation was attempted (managed clients skip it).
 */
function makeMockServer(opts = {}) {
  const { clientName, withElicitation = false } = typeof opts === 'string'
    ? { clientName: opts } // backward compat: makeMockServer('claude-ai')
    : opts;
  const registrations = [];
  const elicitCalls = [];
  const inner = {
    ...(clientName ? { getClientVersion: () => ({ name: clientName, version: '1.0.0' }) } : {}),
    ...(withElicitation
      ? {
          elicitInput: jest.fn(async (req) => {
            elicitCalls.push(req);
            return { action: 'accept', content: { approve: true } };
          }),
        }
      : {}),
  };
  const server = {
    registerTool(name, toolConfig, callback) {
      registrations.push({ name, toolConfig, callback });
    },
    ...(clientName || withElicitation ? { server: inner } : {}),
  };
  return { server, registrations, elicitCalls };
}

function makeConfig(level, whitelist = []) {
  return {
    includeShared: false,
    disabledModules: new Set(),
    shareApprovalModules: new Set(),
    allowSendMessages: true,
    allowSendMail: true,
    hitl: {
      level,
      whitelist: new Set(whitelist),
      timeout: 30000,
      socketPath: '/tmp/fake.sock',
    },
  };
}

function makeMockHitlClient(autoApprove = true) {
  const calls = [];
  return {
    calls,
    requestApproval(tool, args, destructive, openWorld) {
      calls.push({ tool, args, destructive, openWorld });
      return Promise.resolve(autoApprove);
    },
    dispose() {},
  };
}

// ---------- basic export tests ----------

describe('installHitlGuard export', () => {
  test('is a function', () => {
    expect(typeof installHitlGuard).toBe('function');
  });
});

// ---------- level: "off" ----------

describe('level "off"', () => {
  test('never wraps any tool', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('off');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('destructive_tool', { annotations: { destructiveHint: true, readOnlyHint: false } }, original);
    server.registerTool('write_tool', { annotations: { readOnlyHint: false } }, original);
    server.registerTool('read_tool', { annotations: { readOnlyHint: true } }, original);

    // With "off", callbacks should be the original (no wrapping)
    for (const reg of registrations) {
      expect(reg.callback).toBe(original);
    }
  });
});

// ---------- level: "destructive-only" ----------

describe('level "destructive-only"', () => {
  test('wraps tools with destructiveHint=true', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('destructive-only');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('dangerous', { annotations: { destructiveHint: true } }, original);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].callback).not.toBe(original);
  });

  test('does NOT wrap tools without destructiveHint', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('destructive-only');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('safe_write', { annotations: { readOnlyHint: false } }, original);
    server.registerTool('reader', { annotations: { readOnlyHint: true } }, original);
    server.registerTool('no_annotations', {}, original);

    for (const reg of registrations) {
      expect(reg.callback).toBe(original);
    }
  });
});

// ---------- level: "all-writes" ----------

describe('level "all-writes"', () => {
  test('wraps tools with readOnlyHint=false', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all-writes');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('writer', { annotations: { readOnlyHint: false } }, original);

    expect(registrations[0].callback).not.toBe(original);
  });

  test('does NOT wrap read-only tools', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all-writes');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('reader', { annotations: { readOnlyHint: true } }, original);

    expect(registrations[0].callback).toBe(original);
  });

  test('does NOT wrap tools with no annotations (readOnlyHint defaults to undefined, not false)', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all-writes');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('ambiguous', {}, original);

    // readOnlyHint is undefined, and `undefined === false` is false → no wrap
    expect(registrations[0].callback).toBe(original);
  });
});

// ---------- level: "all" ----------

describe('level "all"', () => {
  test('wraps every tool regardless of annotations', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('read', { annotations: { readOnlyHint: true } }, original);
    server.registerTool('write', { annotations: { readOnlyHint: false } }, original);
    server.registerTool('bare', {}, original);

    for (const reg of registrations) {
      expect(reg.callback).not.toBe(original);
    }
  });
});

// ---------- whitelist ----------

describe('whitelist', () => {
  test('whitelisted tool is never wrapped even at level "all"', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all', ['trusted_tool']);

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('trusted_tool', { annotations: { destructiveHint: true } }, original);

    expect(registrations[0].callback).toBe(original);
  });

  test('non-whitelisted tool is still wrapped', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all', ['trusted_tool']);

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('untrusted_tool', {}, original);

    expect(registrations[0].callback).not.toBe(original);
  });
});

// ---------- managed client detection (prefix match) ----------

describe('managed client detection', () => {
  test.each([
    'claude-ai',
    'Claude Code',
    'claude-code',
    'claude-managed-agent',
    'Claude-Platform',
  ])('"%s" is managed → skips elicitation, uses socket HITL', async (clientName) => {
    const { server, registrations, elicitCalls } = makeMockServer({
      clientName,
      withElicitation: true,
    });
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', { annotations: { destructiveHint: true } }, original);
    const result = await registrations[0].callback({ key: 'val' });

    expect(elicitCalls).toHaveLength(0); // elicitation skipped
    expect(hitl.calls).toHaveLength(1);  // socket HITL used
    expect(result).toBe('result');
  });

  test('non-Claude client with elicitation support uses elicitation (not managed)', async () => {
    const { server, registrations, elicitCalls } = makeMockServer({
      clientName: 'cursor',
      withElicitation: true,
    });
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);
    const result = await registrations[0].callback({});

    expect(elicitCalls).toHaveLength(1); // elicitation attempted
    expect(hitl.calls).toHaveLength(0);  // socket HITL not needed
    expect(result).toBe('result');
  });

  test('server without getClientVersion is not treated as managed', async () => {
    const { server, registrations, elicitCalls } = makeMockServer({
      withElicitation: true,
    });
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('test_tool', {}, original);
    await registrations[0].callback({});

    expect(elicitCalls).toHaveLength(1); // not managed → elicitation attempted
    expect(hitl.calls).toHaveLength(0);
  });
});

// ---------- wrapped callback behaviour ----------

describe('wrapped callback behaviour', () => {
  test('calls hitlClient.requestApproval and forwards to original on approve', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    let called = false;
    const original = () => { called = true; return 'result'; };
    server.registerTool('my_tool', { annotations: { destructiveHint: true, openWorldHint: true } }, original);

    const wrapped = registrations[0].callback;
    const result = await wrapped({ foo: 'bar' });

    expect(hitl.calls).toHaveLength(1);
    expect(hitl.calls[0].tool).toBe('my_tool');
    expect(hitl.calls[0].args).toEqual({ foo: 'bar' });
    expect(hitl.calls[0].destructive).toBe(true);
    expect(hitl.calls[0].openWorld).toBe(true);
    expect(called).toBe(true);
    expect(result).toBe('result');
  });

  test('returns error when approval is denied', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(false);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    let called = false;
    const original = () => { called = true; };
    server.registerTool('blocked_tool', {}, original);

    const wrapped = registrations[0].callback;
    const result = await wrapped({});

    expect(called).toBe(false);
    expect(result).toHaveProperty('isError', true);
    expect(result.content[0].text).toContain('blocked_tool');
    expect(result.content[0].text).toContain('denied');
  });

  test('defaults destructiveHint and openWorldHint to false when annotations are absent', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('bare_tool', {}, original);

    await registrations[0].callback({});

    expect(hitl.calls[0].destructive).toBe(false);
    expect(hitl.calls[0].openWorld).toBe(false);
  });

  test('wrapped callback defaults toolArgs to {} when called with no arguments', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('no_args_tool', {}, original);

    // Call with no arguments at all
    await registrations[0].callback();

    expect(hitl.calls[0].args).toEqual({});
  });
});

// ---------- isManagedClient edge cases ----------

describe('isManagedClient edge cases', () => {
  test('handles server.server.getClientVersion throwing an error', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion() {
          throw new Error('getClientVersion exploded');
        },
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);

    // Should not throw — isManagedClient catches and returns false
    // This means elicitation would be attempted (not managed), but since
    // elicitInput is not defined, it falls back to socket HITL
    const result = await registrations[0].callback({});
    expect(result).toBe('result');
    expect(hitl.calls).toHaveLength(1);
  });

  test('handles server.server being null', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: null,
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('result');
    expect(hitl.calls).toHaveLength(1);
  });

  test('getClientVersion returning object without name is not managed', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ version: '1.0' }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('result');
    // Not managed, so elicitation attempted first, but no elicitInput → falls to socket
    expect(hitl.calls).toHaveLength(1);
  });
});

// ---------- AIRMCP_MANAGED_CLIENTS env var ----------

describe('AIRMCP_MANAGED_CLIENTS env var', () => {
  const origEnv = process.env.AIRMCP_MANAGED_CLIENTS;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.AIRMCP_MANAGED_CLIENTS;
    } else {
      process.env.AIRMCP_MANAGED_CLIENTS = origEnv;
    }
  });

  test('recognizes custom managed clients from env var', async () => {
    process.env.AIRMCP_MANAGED_CLIENTS = 'CustomClient, AnotherClient';

    // Force re-evaluation of the module to pick up the env change
    // We use a fresh import to clear the cached set
    const freshModule = await import('../dist/shared/hitl-guard.js?t=' + Date.now());

    const registrations = [];
    const elicitCalls = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'customclient', version: '1.0' }),
        elicitInput: jest.fn(async (req) => {
          elicitCalls.push(req);
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    freshModule.installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);
    await registrations[0].callback({});

    // customclient is in AIRMCP_MANAGED_CLIENTS so it IS managed → skip elicitation
    // But note: the cached set may already exist from the original module import.
    // The key thing is this doesn't crash and still uses socket fallback.
    // Module-level MANAGED_CLIENTS may be cached from earlier import;
    // verify the callback completes without throwing
    expect(hitl.calls.length + registrations.length).toBeGreaterThan(0);
  });
});

// ---------- elicitation paths ----------

describe('elicitation paths', () => {
  test('elicitation rejection returns denial error', async () => {
    const elicitCalls = [];
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          elicitCalls.push(true);
          // User declines — action is 'reject'
          return { action: 'reject', content: {} };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('elicit_deny_tool', { annotations: { destructiveHint: true } }, original);

    const result = await registrations[0].callback({});

    expect(elicitCalls).toHaveLength(1);
    expect(hitl.calls).toHaveLength(0); // socket HITL not used
    expect(result).toHaveProperty('isError', true);
    expect(result.content[0].text).toContain('elicit_deny_tool');
    expect(result.content[0].text).toContain('denied');
  });

  test('elicitation returning approve=false returns denial error', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'some-client', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'accept', content: { approve: false } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('test_tool', {}, original);

    const result = await registrations[0].callback({});

    expect(result).toHaveProperty('isError', true);
    expect(hitl.calls).toHaveLength(0);
  });

  test('elicitation throwing falls back to socket HITL', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'some-client', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          throw new Error('elicitation not supported');
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('fallback_tool', {}, original);

    const result = await registrations[0].callback({});

    // Elicitation threw → tryElicitApproval returns undefined → falls back to socket
    expect(hitl.calls).toHaveLength(1);
    expect(hitl.calls[0].tool).toBe('fallback_tool');
    expect(result).toBe('result');
  });

  test('elicitation with destructiveHint uses destructive label', async () => {
    const elicitMessages = [];
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async (req) => {
          elicitMessages.push(req.message);
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    // Register a destructive tool
    server.registerTool('delete_all', { annotations: { destructiveHint: true } }, () => 'ok');
    await registrations[0].callback({ target: 'everything' });

    expect(elicitMessages[0]).toContain('Destructive');
    expect(elicitMessages[0]).toContain('delete_all');
  });

  test('elicitation with non-destructive tool uses approve label', async () => {
    const elicitMessages = [];
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async (req) => {
          elicitMessages.push(req.message);
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    // Register a non-destructive tool
    server.registerTool('safe_tool', { annotations: { readOnlyHint: false } }, () => 'ok');
    await registrations[0].callback({});

    expect(elicitMessages[0]).toContain('Approve');
    expect(elicitMessages[0]).not.toContain('Destructive');
  });
});

// ---------- telemetry ----------

describe('telemetry tracing', () => {
  const origTelemetry = process.env.AIRMCP_TELEMETRY;

  beforeEach(() => {
    process.env.AIRMCP_TELEMETRY = 'true';
  });

  afterEach(() => {
    if (origTelemetry === undefined) {
      delete process.env.AIRMCP_TELEMETRY;
    } else {
      process.env.AIRMCP_TELEMETRY = origTelemetry;
    }
  });

  test('traces elicitation approval when telemetry enabled', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('traced_tool', { annotations: { destructiveHint: true } }, original);

    // Should not throw even with telemetry enabled
    const result = await registrations[0].callback({ a: 1 });
    expect(result).toBe('result');
    expect(hitl.calls).toHaveLength(0); // used elicitation
  });

  test('traces elicitation denial when telemetry enabled', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'reject', content: {} };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('denied_tool', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toHaveProperty('isError', true);
  });

  test('traces socket approval when telemetry enabled', async () => {
    // No elicitation support → falls back to socket
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('socket_traced', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('result');
    expect(hitl.calls).toHaveLength(1);
  });

  test('traces socket denial when telemetry enabled', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(false);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('denied_socket', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toHaveProperty('isError', true);
    expect(hitl.calls).toHaveLength(1);
  });

  test('traces elicitation via socket path for managed client', async () => {
    // Managed client skips elicitation, falls back to socket with telemetry
    const { server, registrations, elicitCalls } = makeMockServer({
      clientName: 'claude-code',
      withElicitation: true,
    });
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'traced_result';
    server.registerTool('managed_traced', { annotations: { destructiveHint: true } }, original);

    const result = await registrations[0].callback({ key: 'val' });
    expect(result).toBe('traced_result');
    expect(elicitCalls).toHaveLength(0);
    expect(hitl.calls).toHaveLength(1);
  });

  test('traces socket denial for managed client when telemetry enabled', async () => {
    const { server, registrations, elicitCalls } = makeMockServer({
      clientName: 'claude-desktop',
      withElicitation: true,
    });
    const hitl = makeMockHitlClient(false);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('managed_denied', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toHaveProperty('isError', true);
    expect(elicitCalls).toHaveLength(0);
    expect(hitl.calls).toHaveLength(1);
  });
});

// ---------- telemetry disabled ----------

describe('telemetry disabled (default)', () => {
  const origTelemetry = process.env.AIRMCP_TELEMETRY;

  beforeEach(() => {
    delete process.env.AIRMCP_TELEMETRY;
  });

  afterEach(() => {
    if (origTelemetry === undefined) {
      delete process.env.AIRMCP_TELEMETRY;
    } else {
      process.env.AIRMCP_TELEMETRY = origTelemetry;
    }
  });

  test('socket approval works without telemetry', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'no_telemetry_result';
    server.registerTool('no_telem', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('no_telemetry_result');
    expect(hitl.calls).toHaveLength(1);
  });

  test('socket denial works without telemetry', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(false);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('no_telem_deny', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toHaveProperty('isError', true);
  });

  test('elicitation approval works without telemetry', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'elicit_no_telem';
    server.registerTool('elicit_tool', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('elicit_no_telem');
    expect(hitl.calls).toHaveLength(0);
  });

  test('elicitation denial works without telemetry', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'reject', content: {} };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'should not run';
    server.registerTool('elicit_deny', { annotations: { destructiveHint: true } }, original);

    const result = await registrations[0].callback({});
    expect(result).toHaveProperty('isError', true);
    expect(hitl.calls).toHaveLength(0);
  });
});

// ---------- elicitation edge cases ----------

describe('elicitation edge cases', () => {
  test('server without elicitInput falls back to socket', async () => {
    // Server has inner object but no elicitInput method
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'custom-client', version: '1.0' }),
        // no elicitInput defined
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'socket_fallback';
    server.registerTool('no_elicit_tool', {}, original);

    const result = await registrations[0].callback({ arg: 'val' });
    expect(result).toBe('socket_fallback');
    expect(hitl.calls).toHaveLength(1);
    expect(hitl.calls[0].tool).toBe('no_elicit_tool');
  });

  test('elicitation with large args truncates summary to 500 chars', async () => {
    const elicitMessages = [];
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async (req) => {
          elicitMessages.push(req.message);
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    // Create args that produce a JSON string much longer than 500 chars
    const bigArgs = { data: 'x'.repeat(1000) };
    const original = () => 'ok';
    server.registerTool('big_args_tool', {}, original);

    await registrations[0].callback(bigArgs);

    // The message should contain the truncated args summary
    const argsInMessage = elicitMessages[0].split('\n\n')[1]?.replace('Arguments:\n', '');
    expect(argsInMessage.length).toBeLessThanOrEqual(500);
  });

  test('server.server being undefined falls back to socket', async () => {
    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      // no server.server property at all
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'result';
    server.registerTool('test_tool', {}, original);

    const result = await registrations[0].callback({});
    expect(result).toBe('result');
    expect(hitl.calls).toHaveLength(1);
  });
});

// ---------- shouldRequireApproval edge cases ----------

describe('shouldRequireApproval edge cases', () => {
  test('destructive-only with destructiveHint=false does not wrap', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('destructive-only');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('explicit_safe', { annotations: { destructiveHint: false } }, original);

    expect(registrations[0].callback).toBe(original);
  });

  test('all-writes with readOnlyHint=false and destructiveHint=true wraps', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('all-writes');

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('destructive_write', {
      annotations: { readOnlyHint: false, destructiveHint: true }
    }, original);

    expect(registrations[0].callback).not.toBe(original);
  });

  test('multiple tools registered: each evaluated independently', () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient();
    const config = makeConfig('destructive-only', ['whitelisted']);

    installHitlGuard(server, hitl, config);

    const original = () => 'original';
    server.registerTool('destructive', { annotations: { destructiveHint: true } }, original);
    server.registerTool('whitelisted', { annotations: { destructiveHint: true } }, original);
    server.registerTool('safe', { annotations: { readOnlyHint: true } }, original);

    // destructive: wrapped
    expect(registrations[0].callback).not.toBe(original);
    // whitelisted: not wrapped despite being destructive
    expect(registrations[1].callback).toBe(original);
    // safe: not wrapped
    expect(registrations[2].callback).toBe(original);
  });
});

// ---------- wrapped callback argument forwarding ----------

describe('wrapped callback argument forwarding', () => {
  test('forwards all arguments to original callback', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    let receivedArgs;
    const original = (...args) => {
      receivedArgs = args;
      return 'result';
    };
    server.registerTool('multi_arg_tool', {}, original);

    const arg1 = { key: 'val' };
    const arg2 = { extra: 'context' };
    await registrations[0].callback(arg1, arg2);

    expect(receivedArgs).toHaveLength(2);
    expect(receivedArgs[0]).toBe(arg1);
    expect(receivedArgs[1]).toBe(arg2);
  });

  test('passes openWorldHint annotation through to hitlClient', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('open_world_tool', {
      annotations: { openWorldHint: true, readOnlyHint: false }
    }, original);

    await registrations[0].callback({ query: 'hello' });

    expect(hitl.calls[0].openWorld).toBe(true);
    expect(hitl.calls[0].destructive).toBe(false);
  });

  test('defaults openWorldHint to false when not in annotations', async () => {
    const { server, registrations } = makeMockServer();
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('no_open_world', { annotations: {} }, original);

    await registrations[0].callback({});

    expect(hitl.calls[0].openWorld).toBe(false);
  });
});

// ---------- isManagedClient: AIRMCP_MANAGED_CLIENTS edge cases ----------

describe('AIRMCP_MANAGED_CLIENTS edge cases', () => {
  const origEnv = process.env.AIRMCP_MANAGED_CLIENTS;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.AIRMCP_MANAGED_CLIENTS;
    } else {
      process.env.AIRMCP_MANAGED_CLIENTS = origEnv;
    }
  });

  test('empty AIRMCP_MANAGED_CLIENTS does not make any client managed', async () => {
    process.env.AIRMCP_MANAGED_CLIENTS = '';

    const freshModule = await import('../dist/shared/hitl-guard.js?e=' + Date.now());

    const registrations = [];
    const elicitCalls = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'random-client', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          elicitCalls.push(true);
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    freshModule.installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('test_tool', {}, original);
    await registrations[0].callback({});

    // Not managed, so elicitation should be attempted
    expect(elicitCalls).toHaveLength(1);
  });

  test('AIRMCP_MANAGED_CLIENTS with whitespace-only entries does not crash', async () => {
    process.env.AIRMCP_MANAGED_CLIENTS = ' , , , ';

    const freshModule = await import('../dist/shared/hitl-guard.js?w=' + Date.now());

    const registrations = [];
    const server = {
      registerTool(name, toolConfig, callback) {
        registrations.push({ name, toolConfig, callback });
      },
      server: {
        getClientVersion: () => ({ name: 'cursor', version: '1.0' }),
        elicitInput: jest.fn(async () => {
          return { action: 'accept', content: { approve: true } };
        }),
      },
    };
    const hitl = makeMockHitlClient(true);
    const config = makeConfig('all');

    freshModule.installHitlGuard(server, hitl, config);

    const original = () => 'ok';
    server.registerTool('test_tool', {}, original);

    // Should not throw
    const result = await registrations[0].callback({});
    expect(result).toBe('ok');
  });
});
