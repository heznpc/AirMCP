import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { getModuleNames, setModuleRegistry, MODULE_REGISTRY } from '../dist/shared/modules.js';

/* ================================================================== */
/*  Static exports (no mocking needed)                                */
/* ================================================================== */

describe('getModuleNames()', () => {
  test('returns all module names from the manifest', () => {
    const names = getModuleNames();
    expect(names.length).toBeGreaterThanOrEqual(25);
    expect(names).toContain('notes');
    expect(names).toContain('reminders');
    expect(names).toContain('calendar');
    expect(names).toContain('contacts');
    expect(names).toContain('mail');
    expect(names).toContain('music');
    expect(names).toContain('finder');
    expect(names).toContain('safari');
    expect(names).toContain('system');
    expect(names).toContain('photos');
    expect(names).toContain('shortcuts');
    expect(names).toContain('messages');
    expect(names).toContain('intelligence');
    expect(names).toContain('tv');
    expect(names).toContain('ui');
    expect(names).toContain('screen');
    expect(names).toContain('maps');
    expect(names).toContain('podcasts');
    expect(names).toContain('weather');
    expect(names).toContain('pages');
    expect(names).toContain('numbers');
    expect(names).toContain('keynote');
    expect(names).toContain('location');
    expect(names).toContain('bluetooth');
    expect(names).toContain('google');
  });

  test('returns consistent results on repeated calls', () => {
    const first = getModuleNames();
    const second = getModuleNames();
    expect(first).toEqual(second);
  });
});

describe('setModuleRegistry()', () => {
  afterEach(() => {
    setModuleRegistry([]);
  });

  test('updates MODULE_REGISTRY', () => {
    const mockRegistry = [
      { name: 'test', tools: () => {} },
    ];
    setModuleRegistry(mockRegistry);
    expect(MODULE_REGISTRY).toEqual(mockRegistry);
  });

  test('MODULE_REGISTRY is initially empty after reset', () => {
    setModuleRegistry([]);
    expect(MODULE_REGISTRY).toEqual([]);
  });
});

/* ================================================================== */
/*  loadModuleRegistry() — needs dynamic import mocking               */
/* ================================================================== */

describe('loadModuleRegistry() — debug filtering', () => {
  let savedDebugModules;
  let savedDebugSequential;

  beforeEach(() => {
    savedDebugModules = process.env.AIRMCP_DEBUG_MODULES;
    savedDebugSequential = process.env.AIRMCP_DEBUG_SEQUENTIAL;
  });

  afterEach(() => {
    if (savedDebugModules === undefined) delete process.env.AIRMCP_DEBUG_MODULES;
    else process.env.AIRMCP_DEBUG_MODULES = savedDebugModules;
    if (savedDebugSequential === undefined) delete process.env.AIRMCP_DEBUG_SEQUENTIAL;
    else process.env.AIRMCP_DEBUG_SEQUENTIAL = savedDebugSequential;
  });

  test('AIRMCP_DEBUG_MODULES filters to only specified modules', async () => {
    // We need a fresh module import for each loadModuleRegistry call
    // because the cache is module-level state.
    process.env.AIRMCP_DEBUG_MODULES = 'notes,calendar';
    delete process.env.AIRMCP_DEBUG_SEQUENTIAL;

    const { loadModuleRegistry } = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    // Capture console.error to inspect debug messages and suppress noise
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      const registry = await loadModuleRegistry();

      // Should have attempted to load only notes and calendar.
      // They may fail (dynamic imports to actual module files), but the
      // debug message should confirm filtering.
      const debugMsg = errors.find((e) => e.includes('Debug mode: loading'));
      expect(debugMsg).toBeDefined();
      expect(debugMsg).toContain('notes');
      expect(debugMsg).toContain('calendar');
      // Should not mention unfiltered modules in the loading message
      expect(debugMsg).not.toContain('music');
      expect(debugMsg).not.toContain('photos');
    } finally {
      console.error = origError;
    }
  });

  test('unknown module names in AIRMCP_DEBUG_MODULES are rejected with warning', async () => {
    process.env.AIRMCP_DEBUG_MODULES = 'notes,fakemodulethatdoesnotexist';
    delete process.env.AIRMCP_DEBUG_SEQUENTIAL;

    const { loadModuleRegistry } = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      await loadModuleRegistry();

      // Should have a warning about the unknown module
      const warning = errors.find((e) => e.includes('unknown module'));
      expect(warning).toBeDefined();
      expect(warning).toContain('fakemodulethatdoesnotexist');
    } finally {
      console.error = origError;
    }
  });

  test('AIRMCP_DEBUG_SEQUENTIAL=true logs sequential loading message', async () => {
    process.env.AIRMCP_DEBUG_MODULES = 'notes';
    process.env.AIRMCP_DEBUG_SEQUENTIAL = 'true';

    const { loadModuleRegistry } = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      await loadModuleRegistry();

      const seqMsg = errors.find((e) => e.includes('sequential loading'));
      expect(seqMsg).toBeDefined();
    } finally {
      console.error = origError;
    }
  });

  test('loadModuleRegistry returns cached results on second call', async () => {
    process.env.AIRMCP_DEBUG_MODULES = 'notes';
    delete process.env.AIRMCP_DEBUG_SEQUENTIAL;

    const mod = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    const origError = console.error;
    console.error = () => {}; // suppress noise

    try {
      const first = await mod.loadModuleRegistry();
      const second = await mod.loadModuleRegistry();

      // Same reference — returned from cache
      expect(first).toBe(second);
    } finally {
      console.error = origError;
    }
  });

  test('AIRMCP_DEBUG_SEQUENTIAL loads modules one by one (not Promise.all)', async () => {
    // With sequential mode and debug modules, we can verify sequential behavior
    // by checking that the sequential log message is emitted and that the
    // function completes successfully.
    process.env.AIRMCP_DEBUG_MODULES = 'notes,calendar';
    process.env.AIRMCP_DEBUG_SEQUENTIAL = 'true';

    const { loadModuleRegistry } = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      const registry = await loadModuleRegistry();

      // Should have both the debug filter message and sequential message
      const debugMsg = errors.find((e) => e.includes('Debug mode: loading'));
      const seqMsg = errors.find((e) => e.includes('sequential loading'));
      expect(debugMsg).toBeDefined();
      expect(seqMsg).toBeDefined();

      // Registry should be an array (may be empty if module files aren't available)
      expect(Array.isArray(registry)).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  test('empty AIRMCP_DEBUG_MODULES is treated as unset (loads all)', async () => {
    process.env.AIRMCP_DEBUG_MODULES = '';
    delete process.env.AIRMCP_DEBUG_SEQUENTIAL;

    const { loadModuleRegistry } = await import(
      `../dist/shared/modules.js?t=${Date.now()}${Math.random()}`
    );

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    try {
      await loadModuleRegistry();

      // Should NOT have the debug filtering message (empty = unset)
      const debugMsg = errors.find((e) => e.includes('Debug mode: loading'));
      expect(debugMsg).toBeUndefined();
    } finally {
      console.error = origError;
    }
  });

  test('getModuleNames returns names independently of debug env vars', () => {
    // getModuleNames always returns all manifest names, unaffected by debug env
    process.env.AIRMCP_DEBUG_MODULES = 'notes';
    const names = getModuleNames();
    expect(names.length).toBeGreaterThanOrEqual(25);
    expect(names).toContain('music');
    expect(names).toContain('photos');
  });
});
