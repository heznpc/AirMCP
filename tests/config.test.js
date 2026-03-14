import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  MODULE_NAMES,
  STARTER_MODULES,
  parseConfig,
  isModuleEnabled,
  needsShareApproval,
} from '../dist/shared/config.js';

/* ------------------------------------------------------------------ */
/*  Helpers to save / restore env vars touched by tests                */
/* ------------------------------------------------------------------ */
const ENV_KEYS = [
  'ICONNECT_FULL',
  'ICONNECT_INCLUDE_SHARED',
  'ICONNECT_ALLOW_SEND_MESSAGES',
  'ICONNECT_ALLOW_SEND_MAIL',
  'ICONNECT_SHARE_APPROVAL',
  'ICONNECT_HITL_LEVEL',
  ...MODULE_NAMES.map((m) => `ICONNECT_DISABLE_${m.toUpperCase()}`),
];

let savedEnv;

function saveEnv() {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]; // undefined if unset
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

function clearConfigEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

/* ================================================================== */

describe('MODULE_NAMES', () => {
  test('contains exactly 18 modules', () => {
    expect(MODULE_NAMES).toHaveLength(18);
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
  test('has exactly 5 core modules', () => {
    expect(STARTER_MODULES.size).toBe(5);
  });

  test('contains notes, reminders, calendar, shortcuts, system', () => {
    const expected = ['notes', 'reminders', 'calendar', 'shortcuts', 'system'];
    for (const mod of expected) {
      expect(STARTER_MODULES.has(mod)).toBe(true);
    }
  });

  test('does not contain non-core modules', () => {
    const nonStarter = ['contacts', 'mail', 'messages', 'music', 'finder',
                        'safari', 'photos', 'intelligence', 'tv', 'ui',
                        'screen', 'maps', 'podcasts'];
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

  /* ------ ICONNECT_FULL=true ----------------------------------------- */

  test('with ICONNECT_FULL=true, all modules are enabled', () => {
    process.env.ICONNECT_FULL = 'true';
    const cfg = parseConfig();

    for (const mod of MODULE_NAMES) {
      expect(cfg.disabledModules.has(mod)).toBe(false);
    }
  });

  /* ------ ICONNECT_DISABLE_NOTES=true -------------------------------- */

  test('with ICONNECT_DISABLE_NOTES=true, notes is disabled', () => {
    process.env.ICONNECT_FULL = 'true';
    process.env.ICONNECT_DISABLE_NOTES = 'true';
    const cfg = parseConfig();

    expect(cfg.disabledModules.has('notes')).toBe(true);
  });

  test('per-module disable env var overrides full mode', () => {
    process.env.ICONNECT_FULL = 'true';
    process.env.ICONNECT_DISABLE_CALENDAR = 'true';
    process.env.ICONNECT_DISABLE_MUSIC = 'true';
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

  test('allowSendMessages defaults to true', () => {
    const cfg = parseConfig();
    expect(cfg.allowSendMessages).toBe(true);
  });

  test('allowSendMail defaults to true', () => {
    const cfg = parseConfig();
    expect(cfg.allowSendMail).toBe(true);
  });

  /* ------ boolean env var overrides ------------------------------ */

  test('ICONNECT_INCLUDE_SHARED=true enables includeShared', () => {
    process.env.ICONNECT_INCLUDE_SHARED = 'true';
    const cfg = parseConfig();
    expect(cfg.includeShared).toBe(true);
  });

  test('ICONNECT_ALLOW_SEND_MESSAGES=false disables allowSendMessages', () => {
    process.env.ICONNECT_ALLOW_SEND_MESSAGES = 'false';
    const cfg = parseConfig();
    expect(cfg.allowSendMessages).toBe(false);
  });

  test('ICONNECT_ALLOW_SEND_MAIL=false disables allowSendMail', () => {
    process.env.ICONNECT_ALLOW_SEND_MAIL = 'false';
    const cfg = parseConfig();
    expect(cfg.allowSendMail).toBe(false);
  });

  /* ------ HITL config defaults ----------------------------------- */

  test('HITL level defaults to "off"', () => {
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('off');
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

  test('ICONNECT_HITL_LEVEL env var overrides default', () => {
    process.env.ICONNECT_HITL_LEVEL = 'all';
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('all');
  });

  test('invalid HITL level falls back to "off"', () => {
    process.env.ICONNECT_HITL_LEVEL = 'invalid-value';
    const cfg = parseConfig();
    expect(cfg.hitl.level).toBe('off');
  });

  /* ------ share approval via env var ----------------------------- */

  test('ICONNECT_SHARE_APPROVAL env var populates shareApprovalModules', () => {
    process.env.ICONNECT_SHARE_APPROVAL = 'notes,calendar';
    const cfg = parseConfig();
    expect(cfg.shareApprovalModules.has('notes')).toBe(true);
    expect(cfg.shareApprovalModules.has('calendar')).toBe(true);
    expect(cfg.shareApprovalModules.size).toBe(2);
  });

  test('ICONNECT_SHARE_APPROVAL ignores invalid module names', () => {
    process.env.ICONNECT_SHARE_APPROVAL = 'notes,bogus,calendar';
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
