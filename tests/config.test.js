import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  MODULE_NAMES,
  STARTER_MODULES,
  parseConfig,
  isModuleEnabled,
  needsShareApproval,
} from '../dist/shared/config.js';
import { PATHS } from '../dist/shared/constants.js';

/* ------------------------------------------------------------------ */
/*  Helpers to save / restore env vars touched by tests                */
/* ------------------------------------------------------------------ */
const ENV_KEYS = [
  'AIRMCP_FULL',
  'AIRMCP_INCLUDE_SHARED',
  'AIRMCP_ALLOW_SEND_MESSAGES',
  'AIRMCP_ALLOW_SEND_MAIL',
  'AIRMCP_SHARE_APPROVAL',
  'AIRMCP_HITL_LEVEL',
  ...MODULE_NAMES.map((m) => `AIRMCP_DISABLE_${m.toUpperCase()}`),
];

let savedEnv;
let savedConfigPath;

function saveEnv() {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]; // undefined if unset
  }
  savedConfigPath = PATHS.CONFIG;
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  PATHS.CONFIG = savedConfigPath;
}

function clearConfigEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  // Point config path to non-existent file so tests aren't affected by
  // the user's local config.json.
  PATHS.CONFIG = '/tmp/__airmcp_test_nonexistent_config__.json';
}

/* ================================================================== */

describe('MODULE_NAMES', () => {
  test('contains exactly 25 modules', () => {
    expect(MODULE_NAMES).toHaveLength(25);
  });

  test('includes the "tv" module', () => {
    expect(MODULE_NAMES).toContain('tv');
  });

  test('includes all expected module names', () => {
    const expected = [
      'notes', 'reminders', 'calendar', 'contacts', 'mail',
      'messages', 'music', 'finder', 'safari', 'system',
      'photos', 'shortcuts', 'intelligence', 'tv', 'ui',
      'screen', 'maps', 'podcasts',
    ];
    for (const name of expected) {
      expect(MODULE_NAMES).toContain(name);
    }
  });
});

/* ================================================================== */

describe('STARTER_MODULES', () => {
  test('has exactly 7 core modules', () => {
    expect(STARTER_MODULES.size).toBe(7);
  });

  test('contains notes, reminders, calendar, shortcuts, system, finder, weather', () => {
    const expected = ['notes', 'reminders', 'calendar', 'shortcuts', 'system', 'finder', 'weather'];
    for (const mod of expected) {
      expect(STARTER_MODULES.has(mod)).toBe(true);
    }
  });

  test('does not contain non-core modules', () => {
    const nonStarter = ['contacts', 'mail', 'messages', 'music',
                        'safari', 'photos', 'intelligence', 'tv', 'ui',
                        'screen', 'maps', 'podcasts', 'pages',
                        'numbers', 'keynote', 'location', 'bluetooth', 'google'];
    for (const mod of nonStarter) {
      expect(STARTER_MODULES.has(mod)).toBe(false);
    }
  });
});

/* ================================================================== */

describe('parseConfig()', () => {
  beforeEach(() => {
    saveEnv();
    clearConfigEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  /* ------ starter preset (no env vars, no config file) ------------ */

  test('with no env vars and no config file, uses starter preset', () => {
    const cfg = parseConfig();

    // Starter modules should be enabled
    for (const mod of STARTER_MODULES) {
      expect(cfg.disabledModules.has(mod)).toBe(false);
    }

    // Non-starter modules should be disabled
    for (const mod of MODULE_NAMES) {
      if (!STARTER_MODULES.has(mod)) {
        expect(cfg.disabledModules.has(mod)).toBe(true);
      }
    }
  });

  /* ------ AIRMCP_FULL=true ----------------------------------------- */

  test('with AIRMCP_FULL=true, all modules are enabled', () => {
    process.env.AIRMCP_FULL = 'true';
    const cfg = parseConfig();

    for (const mod of MODULE_NAMES) {
      expect(cfg.disabledModules.has(mod)).toBe(false);
    }
  });

  /* ------ AIRMCP_DISABLE_NOTES=true -------------------------------- */

  test('with AIRMCP_DISABLE_NOTES=true, notes is disabled', () => {
    process.env.AIRMCP_FULL = 'true';
    process.env.AIRMCP_DISABLE_NOTES = 'true';
    const cfg = parseConfig();

    expect(cfg.disabledModules.has('notes')).toBe(true);
  });

  test('per-module disable env var overrides full mode', () => {
    process.env.AIRMCP_FULL = 'true';
    process.env.AIRMCP_DISABLE_CALENDAR = 'true';
    process.env.AIRMCP_DISABLE_MUSIC = 'true';
    const cfg = parseConfig();

    expect(cfg.disabledModules.has('calendar')).toBe(true);
    expect(cfg.disabledModules.has('music')).toBe(true);
    // Other modules still enabled
    expect(cfg.disabledModules.has('notes')).toBe(false);
  });

  /* ------ default boolean values --------------------------------- */

  test('includeShared defaults to false', () => {
    const cfg = parseConfig();
    expect(cfg.includeShared).toBe(false);
  });

  test('allowSendMessages defaults to false', () => {
    const cfg = parseConfig();
    expect(cfg.allowSendMessages).toBe(false);
  });

  test('allowSendMail defaults to false', () => {
    const cfg = parseConfig();
    expect(cfg.allowSendMail).toBe(false);
  });

  /* ------ boolean env var overrides ------------------------------ */

  test('AIRMCP_INCLUDE_SHARED=true enables includeShared', () => {
    process.env.AIRMCP_INCLUDE_SHARED = 'true';
    const cfg = parseConfig();
    expect(cfg.includeShared).toBe(true);
  });

  test('AIRMCP_ALLOW_SEND_MESSAGES=false disables allowSendMessages', () => {
    process.env.AIRMCP_ALLOW_SEND_MESSAGES = 'false';
    const cfg = parseConfig();
    expect(cfg.allowSendMessages).toBe(false);
  });

  test('AIRMCP_ALLOW_SEND_MAIL=false disables allowSendMail', () => {
    process.env.AIRMCP_ALLOW_SEND_MAIL = 'false';
    const cfg = parseConfig();
    expect(cfg.allowSendMail).toBe(false);
  });

  /* ------ HITL config defaults ----------------------------------- */

  test('HITL level defaults to "destructive-only"', () => {
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('destructive-only');
  });

  test('HITL timeout defaults to 30', () => {
    const cfg = parseConfig();
    expect(cfg.hitl.timeout).toBe(30);
  });

  test('HITL whitelist defaults to empty set', () => {
    const cfg = parseConfig();
    expect(cfg.hitl.whitelist.size).toBe(0);
  });

  test('HITL socketPath is set', () => {
    const cfg = parseConfig();
    expect(cfg.hitl.socketPath).toContain('hitl.sock');
  });

  test('AIRMCP_HITL_LEVEL env var overrides default', () => {
    process.env.AIRMCP_HITL_LEVEL = 'all';
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('all');
  });

  test('invalid HITL level falls back to "destructive-only"', () => {
    process.env.AIRMCP_HITL_LEVEL = 'invalid-value';
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('destructive-only');
  });

  /* ------ share approval via env var ----------------------------- */

  test('AIRMCP_SHARE_APPROVAL env var populates shareApprovalModules', () => {
    process.env.AIRMCP_SHARE_APPROVAL = 'notes,calendar';
    const cfg = parseConfig();
    expect(cfg.shareApprovalModules.has('notes')).toBe(true);
    expect(cfg.shareApprovalModules.has('calendar')).toBe(true);
    expect(cfg.shareApprovalModules.size).toBe(2);
  });

  test('AIRMCP_SHARE_APPROVAL ignores invalid module names', () => {
    process.env.AIRMCP_SHARE_APPROVAL = 'notes,bogus,calendar';
    const cfg = parseConfig();
    expect(cfg.shareApprovalModules.has('notes')).toBe(true);
    expect(cfg.shareApprovalModules.has('calendar')).toBe(true);
    expect(cfg.shareApprovalModules.has('bogus')).toBe(false);
    expect(cfg.shareApprovalModules.size).toBe(2);
  });
});

/* ================================================================== */

describe('isModuleEnabled()', () => {
  test('returns true for enabled module', () => {
    const cfg = {
      disabledModules: new Set(['mail']),
      shareApprovalModules: new Set(),
    };
    expect(isModuleEnabled(cfg, 'notes')).toBe(true);
  });

  test('returns false for disabled module', () => {
    const cfg = {
      disabledModules: new Set(['mail']),
      shareApprovalModules: new Set(),
    };
    expect(isModuleEnabled(cfg, 'mail')).toBe(false);
  });
});

/* ================================================================== */

describe('needsShareApproval()', () => {
  test('returns true when module is in shareApprovalModules', () => {
    const cfg = {
      disabledModules: new Set(),
      shareApprovalModules: new Set(['notes']),
    };
    expect(needsShareApproval(cfg, 'notes')).toBe(true);
  });

  test('returns false when module is not in shareApprovalModules', () => {
    const cfg = {
      disabledModules: new Set(),
      shareApprovalModules: new Set(['notes']),
    };
    expect(needsShareApproval(cfg, 'calendar')).toBe(false);
  });
});
