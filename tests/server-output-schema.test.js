/** Runtime contracts for the server-owned tools omitted by module-only tests. */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const scratch = mkdtempSync(join(tmpdir(), 'airmcp-server-schema-'));
const ORIGINAL_RUNTIME_ENV = {
  configPath: process.env.AIRMCP_CONFIG_PATH,
  emergencyStopPath: process.env.AIRMCP_EMERGENCY_STOP_PATH,
  auditLog: process.env.AIRMCP_AUDIT_LOG,
  usageTracking: process.env.AIRMCP_USAGE_TRACKING,
};
process.env.AIRMCP_CONFIG_PATH = join(scratch, 'config.json');
process.env.AIRMCP_EMERGENCY_STOP_PATH = join(scratch, 'emergency-stop');
process.env.AIRMCP_AUDIT_LOG = 'false';
process.env.AIRMCP_USAGE_TRACKING = 'false';

const { createToolRegistry } = await import('../dist/shared/tool-registry.js');
const { registerFrontDoorTools } = await import('../dist/server/front-door-tools.js');
const { registerToolSessionTools } = await import('../dist/server/tool-session-tools.js');
const { toolSessions } = await import('../dist/shared/tool-sessions.js');

describe('server-owned outputSchema runtime contracts', () => {
  let server;
  let startedSessionId;

  beforeAll(() => {
    server = createMockServer();
    const registry = createToolRegistry();
    registry.installOn(server);
    server.registerTool(
      'schema_probe_tool',
      {
        title: 'Schema Probe',
        description: 'Session-local probe target',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () => ({ content: [{ type: 'text', text: 'probe-ok' }] }),
    );

    const config = createMockConfig({
      requireToolSession: false,
      features: { usageTracking: true, proactiveContext: true },
    });
    const harness = {
      name: 'compatible',
      requireSessionForHiddenTools: false,
      maxSessionTools: 64,
      defaultSessionTtlSeconds: 900,
      maxSessionTtlSeconds: 3600,
      discoveryDescriptionMode: 'summary',
    };

    registerFrontDoorTools(server, {
      toolRegistry: registry,
      config,
      harness,
      version: '2.16.0-test',
      enabledModules: ['notes'],
      disabledModules: [],
      modulePacksAvailable: ['core'],
      modulePackInstallStatuses: [],
      modulePackInstallIssues: [],
      modulesMissingPacks: [],
      missingAddonPackageModules: [],
      missingPackInstallHints: [],
      buildWorkflowReadiness: () => [],
    });
    registerToolSessionTools(server, { config, harness, toolRegistry: registry });
  });

  afterAll(() => {
    toolSessions.resetForTests();
    rmSync(scratch, { recursive: true, force: true });
    for (const [key, value] of [
      ['AIRMCP_CONFIG_PATH', ORIGINAL_RUNTIME_ENV.configPath],
      ['AIRMCP_EMERGENCY_STOP_PATH', ORIGINAL_RUNTIME_ENV.emergencyStopPath],
      ['AIRMCP_AUDIT_LOG', ORIGINAL_RUNTIME_ENV.auditLog],
      ['AIRMCP_USAGE_TRACKING', ORIGINAL_RUNTIME_ENV.usageTracking],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function expectContract(name, args = {}) {
    const result = await server.callTool(name, args);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const outputSchema = server._tools.get(name).opts.outputSchema;
    const schema = z.object(outputSchema).strict();
    expect(schema.safeParse(result.structuredContent).success).toBe(true);
    expect(schema.safeParse(JSON.parse(result.content[0].text)).success).toBe(true);
    return result.structuredContent;
  }

  test('front-door tools return their declared structured payloads', async () => {
    await expectContract('list_profiles');
    await expectContract('list_module_packs');
    await expectContract('install_module_pack', {
      pack: 'productivity',
      action: 'install',
      dryRun: true,
    });
    await expectContract('profile_status');
    await expectContract('workflow_readiness');
  });

  test('tool-session discovery and lifecycle tools return their declared structured payloads', async () => {
    const started = await expectContract('start_tool_session', {
      tools: ['schema_probe_tool'],
      ttlSeconds: 300,
      label: 'schema contract',
    });
    startedSessionId = started.sessionId;

    await expectContract('tool_session_status', { sessionId: startedSessionId });
    await expectContract('describe_tool', { name: 'schema_probe_tool', sessionId: startedSessionId });
    await expectContract('discover_tools', { query: 'schema probe', sessionId: startedSessionId });
    await expectContract('suggest_next_tools', { after: 'schema_probe_tool' });
    await expectContract('proactive_context');
    await expectContract('end_tool_session', { sessionId: startedSessionId });
  });

  test('run_tool remains bound to its owning MCP server registry', async () => {
    const config = createMockConfig({
      requireToolSession: false,
      features: { usageTracking: false, proactiveContext: false },
    });
    const harness = {
      name: 'compatible',
      requireSessionForHiddenTools: false,
      maxSessionTools: 64,
      defaultSessionTtlSeconds: 900,
      maxSessionTtlSeconds: 3600,
      discoveryDescriptionMode: 'summary',
    };
    const makeSession = (label) => {
      const sessionServer = createMockServer();
      const registry = createToolRegistry();
      registry.installOn(sessionServer);
      sessionServer.registerTool(
        'shared_name_probe',
        { title: 'Shared Name Probe', description: 'Same public name in every HTTP session', inputSchema: {} },
        async () => ({ content: [{ type: 'text', text: label }] }),
      );
      registerToolSessionTools(sessionServer, { config, harness, toolRegistry: registry });
      return sessionServer;
    };

    const first = makeSession('first-session-handler');
    const second = makeSession('second-session-handler');

    await expect(first.callTool('run_tool', { name: 'shared_name_probe' })).resolves.toMatchObject({
      content: [{ text: 'first-session-handler' }],
    });
    await expect(second.callTool('run_tool', { name: 'shared_name_probe' })).resolves.toMatchObject({
      content: [{ text: 'second-session-handler' }],
    });
  });
});
