/**
 * Integration tests for `src/server/mcp-setup.ts createServer()`.
 *
 * createServer is the 441-LOC crossroads that does:
 *   - SDK McpServer construction
 *   - toolRegistry.installOn (innermost wrap)
 *   - optional HITL guard installation (outermost wrap)
 *   - dynamic module loading (loadModuleRegistry)
 *   - per-module compatibility resolution → enabled / disabled / osBlocked / broken / deprecated buckets
 *   - cross / semantic / resources / setup / skills / apps registration
 *   - discover_tools, suggest_next_tools, etc.
 *   - cleanupEventListeners closure
 *
 * Until now the only tests touching this file mocked `createServer` itself
 * (http-transport.test.js, hitl-client.test.js) — the function's own
 * branching (module isolation on failure, compatibility categorization,
 * tool-registry-before-modules invariant) was untested. This file fills
 * those gaps with three focused scenarios.
 *
 * WWDC 6/8 context: createServer is the most likely entry point for any
 * post-keynote reposition code (new module registration, new transport
 * adapter, new compat gate). Guarding its loop invariants *before* that
 * window means the reposition coder can rely on the existing categorization
 * surviving their change.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Heavy-dep mocks. createServer pulls ~25 modules; we stub everything that
// either touches the filesystem, spawns child processes, or carries module-
// level state that would leak between tests.
// ---------------------------------------------------------------------------

// SDK McpServer — replaced with a recording fake that captures registerTool
// calls without doing any of the real Zod / schema work.
const sdkRegisterToolCalls = [];
const sdkRegisterPromptCalls = [];
const sdkRegisterResourceCalls = [];
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class FakeMcpServer {
    constructor(meta) {
      this.meta = meta;
    }
    registerTool(name, _config, cb) {
      sdkRegisterToolCalls.push({ name, cb });
      return {};
    }
    registerPrompt(name, _config, cb) {
      sdkRegisterPromptCalls.push({ name, cb });
      return {};
    }
    registerResource(name, _uri, _config, cb) {
      sdkRegisterResourceCalls.push({ name, cb });
      return {};
    }
    tool(name, ..._rest) {
      sdkRegisterToolCalls.push({ name, cb: null });
    }
    prompt(name, ..._rest) {
      sdkRegisterPromptCalls.push({ name, cb: null });
    }
    resource(name, ..._rest) {
      sdkRegisterResourceCalls.push({ name, cb: null });
    }
    connect() {}
    close() {}
    sendResourceListChanged() {}
    get server() {
      return { _registeredResources: {}, _registeredTools: {} };
    }
  },
}));

// loadModuleRegistry → fixture set per-test via this Jest mock.
let fakeModuleRegistry = [];
let fakeModulePackPlan = {
  packs: [
    {
      name: 'core',
      packageName: 'airmcp',
      title: 'Core Workspace',
      description: 'Core',
      modules: ['notes'],
      available: true,
      required: true,
    },
  ],
  modulesMissingPacks: [],
};
let fakeMissingAddonPackageModules = [];
jest.unstable_mockModule('../dist/shared/modules.js', () => ({
  loadModuleRegistry: jest.fn(async () => fakeModuleRegistry),
  getModulePackPlan: jest.fn(() => fakeModulePackPlan),
  setModuleRegistry: jest.fn(),
  MODULE_REGISTRY: [],
  getModuleNames: jest.fn(() => fakeModuleRegistry.map((m) => m.name)),
}));
jest.unstable_mockModule('../dist/shared/module-loader.js', () => ({
  getMissingAddonPackageModules: jest.fn(() => fakeMissingAddonPackageModules),
}));

// Compatibility resolver — drives the enabled / osBlocked / broken / deprecated
// buckets. Per-test we set the function body to whatever the scenario needs.
let resolveCompatImpl = (_name, _compat, _env) => ({ decision: 'register-clean', reason: '' });
jest.unstable_mockModule('../dist/shared/compatibility.js', () => ({
  resolveModuleCompatibility: (...args) => resolveCompatImpl(...args),
}));

// All the things createServer registers AFTER the module loop. Stub them so
// the test doesn't depend on cross/semantic/skills internals.
jest.unstable_mockModule('../dist/cross/prompts.js', () => ({ registerCrossPrompts: jest.fn() }));
jest.unstable_mockModule('../dist/cross/tools.js', () => ({ registerCrossTools: jest.fn() }));
jest.unstable_mockModule('../dist/semantic/tools.js', () => ({ registerSemanticTools: jest.fn() }));
jest.unstable_mockModule('../dist/shared/resources.js', () => ({ registerResources: jest.fn() }));
jest.unstable_mockModule('../dist/shared/setup.js', () => ({ registerSetupTools: jest.fn() }));
jest.unstable_mockModule('../dist/skills/index.js', () => ({
  registerSkillEngine: jest.fn(async () => ({ builtinCount: 0, userCount: 0 })),
  closeSkillsWatcher: jest.fn(),
}));
jest.unstable_mockModule('../dist/skills/triggers.js', () => ({
  getRegisteredTriggers: jest.fn(() => []),
}));
jest.unstable_mockModule('../dist/apps/tools.js', () => ({ registerApps: jest.fn() }));
jest.unstable_mockModule('../dist/shortcuts/tools.js', () => ({
  registerDynamicShortcutTools: jest.fn(async () => 0),
}));

// hitl guard — installation is observed via this flag.
const hitlInstallCalls = [];
jest.unstable_mockModule('../dist/shared/hitl-guard.js', () => ({
  installHitlGuard: jest.fn((server, _client, _config) => {
    hitlInstallCalls.push({ at: Date.now(), serverPresent: !!server });
  }),
}));
jest.unstable_mockModule('../dist/shared/hitl.js', () => ({
  HitlClient: jest.fn(),
}));

// tool-registry — instrumented to record installation order vs module calls.
const toolRegistryEvents = [];
let toolRegistryInstalled = false;
jest.unstable_mockModule('../dist/shared/tool-registry.js', () => ({
  ToolInputValidationError: class ToolInputValidationError extends Error {},
  toolRegistry: {
    installOn: jest.fn((_server) => {
      toolRegistryInstalled = true;
      toolRegistryEvents.push({ kind: 'install', t: Date.now() });
    }),
    configureExposure: jest.fn(),
    pruneStaleRegistrations: jest.fn(),
    getToolCount: () => 0,
    getExposedToolCount: () => 0,
    getExposedToolNames: () => [],
    getPromptCount: () => 0,
    getToolNames: () => [],
    searchTools: () => [],
    callTool: jest.fn(),
    reset: jest.fn(),
  },
}));

// tool-search — discover_tools handler hits this.
jest.unstable_mockModule('../dist/shared/tool-search.js', () => ({
  semanticToolSearch: jest.fn(async () => []),
  isToolSearchIndexed: jest.fn(() => false),
  indexToolDescriptions: jest.fn(),
}));

// tool-filter — isCompactMode is the only function used in createServer.
jest.unstable_mockModule('../dist/shared/tool-filter.js', () => ({
  isCompactMode: jest.fn(() => false),
}));

// usage-tracker, proactive, event-bus, pollers, cache, swift, share-guard —
// pure stubs.
jest.unstable_mockModule('../dist/shared/usage-tracker.js', () => ({
  usageTracker: { stop: jest.fn(), flushSync: jest.fn(), recordCall: jest.fn() },
}));
jest.unstable_mockModule('../dist/shared/proactive.js', () => ({
  generateProactiveContext: jest.fn(async () => ({ context: '' })),
}));
jest.unstable_mockModule('../dist/shared/event-bus.js', () => ({
  eventBus: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));
jest.unstable_mockModule('../dist/shared/pollers.js', () => ({
  startPollers: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/cache.js', () => ({
  resourceCache: { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() },
}));
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  checkSwiftBridge: jest.fn(async () => null),
  runSwift: jest.fn(async () => ({})),
  closeSwiftBridge: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/share-guard.js', () => ({
  setShareGuardHitlClient: jest.fn(),
}));

// config — return a benign default config (every module enabled).
jest.unstable_mockModule('../dist/shared/config.js', () => ({
  NPM_PACKAGE_NAME: 'airmcp',
  FRONT_DOOR_TOOLS: [
    'profile_status',
    'list_profiles',
    'list_module_packs',
    'install_module_pack',
    'workflow_readiness',
    'discover_tools',
    'run_tool',
    'get_workflow',
  ],
  PROFILE_NAMES: ['starter', 'communications-safe', 'productivity', 'full'],
  PROFILE_DESCRIPTIONS: {
    starter: 'Starter',
    'communications-safe': 'Communications Safe',
    productivity: 'Productivity',
    full: 'Full',
  },
  PROFILE_MODULES: {
    starter: ['notes'],
    'communications-safe': ['notes', 'mail', 'messages'],
    productivity: ['notes', 'pages', 'numbers', 'keynote'],
    full: ['notes', 'calendar', 'finder'],
  },
  parseConfig: jest.fn(() => ({
    profile: 'starter',
    toolExposure: 'profile',
    progressiveTools: new Set([
      'profile_status',
      'list_profiles',
      'list_module_packs',
      'install_module_pack',
      'workflow_readiness',
      'discover_tools',
      'run_tool',
    ]),
    modulePacks: new Set(['core']),
    modulePacksConfigured: false,
    hitl: { level: 'off' },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  })),
  getOsVersion: jest.fn(() => 26),
  getCompatibilityEnv: jest.fn(() => ({ osVersion: 26, hardware: [], permissions: [] })),
  isModuleEnabled: jest.fn(() => true),
}));

// icons module — pure data, no I/O, but stub to keep tests independent
jest.unstable_mockModule('../dist/shared/icons.js', () => ({
  SERVER_ICON: { src: 'data:image/png;base64,', sizes: '512x512', mimeType: 'image/png' },
  WEBSITE_URL: 'https://example.test',
}));

const { createServer } = await import('../dist/server/mcp-setup.js');

// ---------------------------------------------------------------------------
// Shared test fixtures.
// ---------------------------------------------------------------------------

function mkPkg() {
  return { version: '2.12.0', description: 'test', license: 'MIT', homepage: 'https://example.test' };
}
function mkConfig() {
  return {
    profile: 'starter',
    toolExposure: 'profile',
    progressiveTools: new Set([
      'profile_status',
      'list_profiles',
      'list_module_packs',
      'install_module_pack',
      'workflow_readiness',
      'discover_tools',
      'run_tool',
    ]),
    modulePacks: new Set(['core']),
    modulePacksConfigured: false,
    hitl: { level: 'off' },
    allowSendMail: false,
    allowSendMessages: false,
    disabledModules: [],
    features: {},
  };
}
function mkOptions(overrides = {}) {
  return {
    config: mkConfig(),
    hitlClient: null,
    osVersion: 26,
    pkg: mkPkg(),
    ...overrides,
  };
}

beforeEach(() => {
  sdkRegisterToolCalls.length = 0;
  sdkRegisterPromptCalls.length = 0;
  sdkRegisterResourceCalls.length = 0;
  toolRegistryEvents.length = 0;
  hitlInstallCalls.length = 0;
  toolRegistryInstalled = false;
  fakeModuleRegistry = [];
  fakeModulePackPlan = {
    packs: [
      {
        name: 'core',
        packageName: 'airmcp',
        title: 'Core Workspace',
        description: 'Core',
        modules: ['notes'],
        available: true,
        required: true,
      },
    ],
    modulesMissingPacks: [],
  };
  fakeMissingAddonPackageModules = [];
  resolveCompatImpl = () => ({ decision: 'register-clean', reason: '' });
});

// ---------------------------------------------------------------------------
// Scenario 1 — Module isolation on failure.
//
// Invariant: a single module's `mod.tools()` throwing must NOT take down the
// server. The failing module lands in modulesDisabled with the others
// continuing into modulesEnabled. This is the cheapest robustness guarantee
// the loop offers; it's currently asserted nowhere.
// ---------------------------------------------------------------------------

describe('createServer — module isolation on failure', () => {
  test('one failing module does not prevent other modules from registering', async () => {
    const callOrder = [];
    fakeModuleRegistry = [
      {
        name: 'working_one',
        tools: (_server) => {
          callOrder.push('working_one');
        },
      },
      {
        name: 'broken_middle',
        tools: () => {
          throw new Error('synthetic failure for test');
        },
      },
      {
        name: 'working_two',
        tools: (_server) => {
          callOrder.push('working_two');
        },
      },
    ];

    // Suppress the loop's expected console.error during the failure.
    const origError = console.error;
    const stderr = [];
    console.error = (...args) => stderr.push(args.join(' '));

    let result;
    try {
      result = await createServer(mkOptions());
    } finally {
      console.error = origError;
    }

    // Loop ran past the failure.
    expect(callOrder).toEqual(['working_one', 'working_two']);

    // bannerInfo categorization is correct.
    expect(result.bannerInfo.modulesEnabled).toEqual(['working_one', 'working_two']);
    expect(result.bannerInfo.modulesDisabled).toEqual(['broken_middle']);

    // The failure was surfaced to stderr (not silently swallowed).
    const failureLog = stderr.find((m) => m.includes('broken_middle') && m.includes('synthetic failure'));
    expect(failureLog).toBeDefined();
  });

  test('all modules failing yields empty modulesEnabled and full modulesDisabled', async () => {
    fakeModuleRegistry = [
      { name: 'one', tools: () => { throw new Error('boom 1'); } },
      { name: 'two', tools: () => { throw new Error('boom 2'); } },
    ];
    const origError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await createServer(mkOptions());
    } finally {
      console.error = origError;
    }
    expect(result.bannerInfo.modulesEnabled).toEqual([]);
    expect(result.bannerInfo.modulesDisabled.sort()).toEqual(['one', 'two']);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Compatibility categorization buckets.
//
// resolveModuleCompatibility returns one of:
//   register-clean | register-with-deprecation | skip-unsupported | skip-broken
//
// Each must land in the matching bannerInfo bucket. The loop's branching is
// dense (lines 87-122 of mcp-setup.ts) and a regression here would silently
// surface "tool exists but always fails" to agents.
// ---------------------------------------------------------------------------

describe('createServer — compatibility bucket categorization', () => {
  test('each decision routes a module to its banner bucket', async () => {
    fakeModuleRegistry = [
      { name: 'mod_clean', tools: jest.fn() },
      { name: 'mod_deprecated', tools: jest.fn() },
      { name: 'mod_unsupported', tools: jest.fn() },
      { name: 'mod_broken', tools: jest.fn() },
    ];

    resolveCompatImpl = (name) => {
      switch (name) {
        case 'mod_clean':
          return { decision: 'register-clean', reason: '' };
        case 'mod_deprecated':
          return { decision: 'register-with-deprecation', reason: 'mod_deprecated — going away in 3.0.0' };
        case 'mod_unsupported':
          return { decision: 'skip-unsupported', reason: 'mod_unsupported requires macOS 27+ (detected 26)' };
        case 'mod_broken':
          return { decision: 'skip-broken', reason: 'mod_broken is known-broken on macOS 26' };
        default:
          return { decision: 'register-clean', reason: '' };
      }
    };

    const origError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await createServer(mkOptions());
    } finally {
      console.error = origError;
    }

    // mod_clean registers cleanly.
    expect(result.bannerInfo.modulesEnabled).toContain('mod_clean');

    // mod_deprecated registers AND lands in modulesDeprecated.
    expect(result.bannerInfo.modulesEnabled).toContain('mod_deprecated');
    expect(result.bannerInfo.modulesDeprecated).toEqual(['mod_deprecated']);

    // mod_unsupported lands in modulesOsBlocked (with reason), never registered.
    expect(result.bannerInfo.modulesEnabled).not.toContain('mod_unsupported');
    expect(result.bannerInfo.modulesOsBlocked.some((s) => s.startsWith('mod_unsupported'))).toBe(true);

    // mod_broken lands in modulesBroken (with reason), never registered.
    expect(result.bannerInfo.modulesEnabled).not.toContain('mod_broken');
    expect(result.bannerInfo.modulesBroken.some((s) => s.startsWith('mod_broken'))).toBe(true);

    // Bucket totals are mutually exclusive — every fixture module is in
    // exactly one bucket (modulo deprecated which is in both enabled +
    // deprecated, the documented overlap).
    const bucketed = new Set([
      ...result.bannerInfo.modulesEnabled,
      ...result.bannerInfo.modulesDisabled,
      ...result.bannerInfo.modulesOsBlocked.map((s) => s.split(' ')[0]),
      ...result.bannerInfo.modulesBroken.map((s) => s.split(' ')[0]),
    ]);
    expect(bucketed.has('mod_clean')).toBe(true);
    expect(bucketed.has('mod_deprecated')).toBe(true);
    expect(bucketed.has('mod_unsupported')).toBe(true);
    expect(bucketed.has('mod_broken')).toBe(true);

    // tools() should be called only for non-skipped modules.
    expect(fakeModuleRegistry[0].tools).toHaveBeenCalled(); // clean
    expect(fakeModuleRegistry[1].tools).toHaveBeenCalled(); // deprecated still registers
    expect(fakeModuleRegistry[2].tools).not.toHaveBeenCalled(); // unsupported skipped
    expect(fakeModuleRegistry[3].tools).not.toHaveBeenCalled(); // broken skipped
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Installation order invariant.
//
// createServer's wrapping contract requires: toolRegistry.installOn must
// have run before ANY module's mod.tools() can call registerTool. Otherwise
// the audit/usage tracking wrapper isn't in place and tool calls don't get
// logged. This is also the precondition for the documented `audit(HITL(cb))`
// nesting in the source comment.
// ---------------------------------------------------------------------------

describe('createServer — installation order invariant', () => {
  test('toolRegistry.installOn runs before any module is loaded', async () => {
    let toolRegistryInstalledWhenModuleRan = null;
    fakeModuleRegistry = [
      {
        name: 'observer',
        tools: (_server) => {
          toolRegistryInstalledWhenModuleRan = toolRegistryInstalled;
        },
      },
    ];

    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(mkOptions());
    } finally {
      console.error = origError;
    }

    expect(toolRegistryInstalledWhenModuleRan).toBe(true);
  });

  test('HITL guard is NOT installed when level is "off"', async () => {
    fakeModuleRegistry = [{ name: 'noop', tools: () => {} }];
    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(mkOptions({ hitlClient: null, config: { ...mkConfig(), hitl: { level: 'off' } } }));
    } finally {
      console.error = origError;
    }
    expect(hitlInstallCalls).toEqual([]);
  });

  test('HITL guard IS installed when hitlClient present and level != off', async () => {
    fakeModuleRegistry = [{ name: 'noop', tools: () => {} }];
    const fakeHitlClient = {}; // any truthy value
    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(
        mkOptions({
          hitlClient: fakeHitlClient,
          config: { ...mkConfig(), hitl: { level: 'destructive-only' } },
        }),
      );
    } finally {
      console.error = origError;
    }
    expect(hitlInstallCalls).toHaveLength(1);
    expect(hitlInstallCalls[0].serverPresent).toBe(true);
  });
});

describe('createServer — module add-on install hints', () => {
  test('workflow_readiness explains workflow blockers from the active runtime', async () => {
    fakeModuleRegistry = [{ name: 'notes', tools: () => {} }];

    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(mkOptions({ pkg: { ...mkPkg(), version: '2.15.0' } }));
    } finally {
      console.error = origError;
    }

    const readinessTool = sdkRegisterToolCalls.find((call) => call.name === 'workflow_readiness');
    const statusTool = sdkRegisterToolCalls.find((call) => call.name === 'profile_status');
    const readiness = await readinessTool.cb({ id: 'daily-briefing' });
    const status = await statusTool.cb();

    expect(readiness.structuredContent).toMatchObject({
      activeProfile: 'starter',
      toolExposure: 'profile',
      summary: { total: 1, ready: 0, partial: 0, blocked: 1 },
    });
    expect(readiness.structuredContent.workflows[0]).toMatchObject({
      id: 'daily-briefing',
      status: 'blocked',
    });
    expect(readiness.structuredContent.workflows[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'module_disabled', module: 'calendar' }),
        expect.objectContaining({ code: 'tool_not_registered', tool: 'today_events' }),
      ]),
    );
    expect(status.structuredContent.workflowReadiness).toMatchObject({ total: 6, blocked: 6 });
  });

  test('profile_status and list_module_packs expose on-demand install commands for missing packs', async () => {
    fakeModuleRegistry = [{ name: 'notes', tools: () => {} }];
    fakeModulePackPlan = {
      packs: [
        {
          name: 'core',
          packageName: 'airmcp',
          title: 'Core Workspace',
          description: 'Core',
          modules: ['notes'],
          available: true,
          required: true,
        },
        {
          name: 'productivity',
          packageName: '@heznpc/airmcp-productivity',
          title: 'Productivity',
          description: 'iWork',
          modules: ['pages', 'numbers', 'keynote'],
          available: false,
          required: false,
        },
      ],
      modulesMissingPacks: ['pages', 'numbers'],
    };

    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(mkOptions({ pkg: { ...mkPkg(), version: '2.15.0' } }));
    } finally {
      console.error = origError;
    }

    const statusTool = sdkRegisterToolCalls.find((call) => call.name === 'profile_status');
    const packsTool = sdkRegisterToolCalls.find((call) => call.name === 'list_module_packs');
    const status = await statusTool.cb();
    const packs = await packsTool.cb();

    expect(status.structuredContent.missingPackInstallHints).toEqual([
      {
        pack: 'productivity',
        packageName: '@heznpc/airmcp-productivity',
        installSpec: '@heznpc/airmcp-productivity@2.15.0',
        modules: ['pages', 'numbers'],
        command: 'npx airmcp modules enable productivity --install',
        message:
          'Install and activate the productivity add-on to use pages, numbers: npx airmcp modules enable productivity --install. Restart AirMCP after installation.',
      },
    ]);
    expect(status.structuredContent.modulesMissingAddonPackages).toEqual([]);
    expect(packs.structuredContent.packs.find((pack) => pack.name === 'productivity')).toMatchObject({
      installSpec: '@heznpc/airmcp-productivity@2.15.0',
      installCommand: 'npx airmcp modules enable productivity --install',
      uninstallCommand: 'npx airmcp modules uninstall productivity',
    });
  });

  test('profile_status folds physically missing add-on packages into install hints', async () => {
    fakeModuleRegistry = [{ name: 'notes', tools: () => {} }];
    fakeModulePackPlan = {
      packs: [
        {
          name: 'core',
          packageName: 'airmcp',
          title: 'Core Workspace',
          description: 'Core',
          modules: ['notes'],
          available: true,
          required: true,
        },
        {
          name: 'productivity',
          packageName: '@heznpc/airmcp-productivity',
          title: 'Productivity',
          description: 'iWork',
          modules: ['pages', 'numbers', 'keynote'],
          available: true,
          required: false,
        },
      ],
      modulesMissingPacks: [],
    };
    fakeMissingAddonPackageModules = ['pages'];

    const origError = console.error;
    console.error = () => {};
    try {
      await createServer(mkOptions({ pkg: { ...mkPkg(), version: '2.15.0' } }));
    } finally {
      console.error = origError;
    }

    const statusTool = sdkRegisterToolCalls.find((call) => call.name === 'profile_status');
    const status = await statusTool.cb();

    expect(status.structuredContent.modulesMissingPacks).toEqual([]);
    expect(status.structuredContent.modulesMissingAddonPackages).toEqual(['pages']);
    expect(status.structuredContent.missingPackInstallHints).toEqual([
      {
        pack: 'productivity',
        packageName: '@heznpc/airmcp-productivity',
        installSpec: '@heznpc/airmcp-productivity@2.15.0',
        modules: ['pages'],
        command: 'npx airmcp modules enable productivity --install',
        message:
          'Install and activate the productivity add-on to use pages: npx airmcp modules enable productivity --install. Restart AirMCP after installation.',
      },
    ]);
  });

  test('install_module_pack requires confirmation for real npm operations and supports dry-run previews', async () => {
    fakeModuleRegistry = [{ name: 'notes', tools: () => {} }];
    fakeModulePackPlan = {
      packs: [
        {
          name: 'core',
          packageName: 'airmcp',
          title: 'Core Workspace',
          description: 'Core',
          modules: ['notes'],
          available: true,
          required: true,
        },
        {
          name: 'productivity',
          packageName: '@heznpc/airmcp-productivity',
          title: 'Productivity',
          description: 'iWork',
          modules: ['pages', 'numbers', 'keynote'],
          available: false,
          required: false,
        },
      ],
      modulesMissingPacks: [],
    };

    await createServer(mkOptions({ pkg: { ...mkPkg(), version: '2.15.0' } }));

    const installTool = sdkRegisterToolCalls.find((call) => call.name === 'install_module_pack');
    const refused = await installTool.cb({ pack: 'productivity' });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error.message).toContain('confirm:true');

    const dryRun = await installTool.cb({ pack: 'productivity', dryRun: true });
    expect(dryRun.structuredContent).toMatchObject({
      pack: 'productivity',
      action: 'install',
      packageName: '@heznpc/airmcp-productivity',
      installSpec: '@heznpc/airmcp-productivity@2.15.0',
      dryRun: true,
      skipped: true,
      restartRequired: false,
    });
    expect(dryRun.structuredContent.command).toContain('npm install');
    expect(dryRun.structuredContent.activePacks).toEqual(expect.arrayContaining(['core', 'productivity']));
  });
});
