/**
 * Safety Annotations consistency test.
 *
 * Boots every module and verifies that tool annotations follow naming
 * conventions and that every tool has the core annotation fields defined.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

// ── Platform mocks (must precede all dynamic imports) ────────────────
// We mock directly instead of using setupPlatformMocks because we need
// additional exports (runAppleScript) not provided by the shared helper.

jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: jest.fn(),
  runAppleScript: jest.fn(),
  osascriptSemaphore: { acquire: jest.fn().mockResolvedValue(undefined), release: jest.fn() },
}));

jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: jest.fn(),
  checkSwiftBridge: jest.fn().mockResolvedValue('Swift bridge not available'),
  hasSwiftCommand: jest.fn().mockResolvedValue(false),
  closeSwiftBridge: jest.fn(),
}));

jest.unstable_mockModule('../dist/shared/automation.js', () => ({
  runAutomation: jest.fn(),
}));

jest.unstable_mockModule('../dist/weather/api.js', () => ({
  fetchCurrentWeather: jest.fn(),
  fetchDailyForecast: jest.fn(),
  fetchHourlyForecast: jest.fn(),
}));

jest.unstable_mockModule('../dist/google/gws.js', () => ({
  runGws: jest.fn(),
  checkGws: jest.fn(),
}));

jest.unstable_mockModule('../dist/semantic/service.js', () => ({
  SemanticSearchService: class {
    constructor() {}
    index() {}
    search() {}
    findRelated() {}
    status() {}
    clear() {}
  },
}));

jest.unstable_mockModule('../dist/shared/local-llm.js', () => ({
  checkOllama: jest.fn(),
  ollamaGenerate: jest.fn(),
  ollamaModels: jest.fn(),
  DEFAULT_MODEL: 'llama3',
}));

// ── Dynamic imports (after mocks) ───────────────────────────────────

const { registerNoteTools } = await import('../dist/notes/tools.js');
const { registerReminderTools } = await import('../dist/reminders/tools.js');
const { registerCalendarTools } = await import('../dist/calendar/tools.js');
const { registerContactTools } = await import('../dist/contacts/tools.js');
const { registerSystemTools } = await import('../dist/system/tools.js');
const { registerMailTools } = await import('../dist/mail/tools.js');
const { registerSafariTools } = await import('../dist/safari/tools.js');
const { registerFinderTools } = await import('../dist/finder/tools.js');
const { registerMusicTools } = await import('../dist/music/tools.js');
const { registerHealthTools } = await import('../dist/health/tools.js');
const { registerWeatherTools } = await import('../dist/weather/tools.js');
const { registerPhotosTools } = await import('../dist/photos/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');
const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerIntelligenceTools } = await import('../dist/intelligence/tools.js');
const { registerTvTools } = await import('../dist/tv/tools.js');
const { registerUiTools } = await import('../dist/ui/tools.js');
const { registerScreenTools } = await import('../dist/screen/tools.js');
const { registerMapsTools } = await import('../dist/maps/tools.js');
const { registerPodcastsTools } = await import('../dist/podcasts/tools.js');
const { registerPagesTools } = await import('../dist/pages/tools.js');
const { registerNumbersTools } = await import('../dist/numbers/tools.js');
const { registerKeynoteTools } = await import('../dist/keynote/tools.js');
const { registerLocationTools } = await import('../dist/location/tools.js');
const { registerBluetoothTools } = await import('../dist/bluetooth/tools.js');
const { registerGoogleTools } = await import('../dist/google/tools.js');
const { registerSpeechTools } = await import('../dist/speech/tools.js');
const { registerCrossTools } = await import('../dist/cross/tools.js');
const { registerSemanticTools } = await import('../dist/semantic/tools.js');
const { registerMemoryTools } = await import('../dist/memory/tools.js');
const { PRIVACY_READOUT_TOOLS, PRIVACY_READOUT_NAME_PATTERNS, PRIVACY_PATTERN_EXEMPT } = await import(
  '../dist/shared/privacy-sensitive-tools.js'
);

// ── Test suite ──────────────────────────────────────────────────────

describe('Safety Annotations consistency', () => {
  let server;

  beforeAll(() => {
    server = createMockServer();
    // Enable all gated features so every tool is registered
    const config = createMockConfig({
      allowSendMessages: true,
      allowSendMail: true,
      allowRunJavascript: true,
    });

    // Register all 27 manifest modules
    registerNoteTools(server, config);
    registerReminderTools(server, config);
    registerCalendarTools(server, config);
    registerContactTools(server, config);
    registerSystemTools(server, config);
    registerMailTools(server, config);
    registerSafariTools(server, config);
    registerFinderTools(server, config);
    registerMusicTools(server, config);
    registerHealthTools(server, config);
    registerWeatherTools(server, config);
    registerPhotosTools(server, config);
    registerShortcutsTools(server, config);
    registerMessagesTools(server, config);
    registerIntelligenceTools(server, config);
    registerTvTools(server, config);
    registerUiTools(server, config);
    registerScreenTools(server, config);
    registerMapsTools(server, config);
    registerPodcastsTools(server, config);
    registerPagesTools(server, config);
    registerNumbersTools(server, config);
    registerKeynoteTools(server, config);
    registerLocationTools(server, config);
    registerBluetoothTools(server, config);
    registerGoogleTools(server, config);
    registerSpeechTools(server, config);
    registerMemoryTools(server, config);

    // Extra non-manifest modules
    registerCrossTools(server, config);
    registerSemanticTools(server, config);
  });

  // ── Helper: collect all tool names and their annotations ──────────

  function getAllTools() {
    const result = [];
    for (const [name, { opts }] of server._tools) {
      result.push({ name, annotations: opts.annotations });
    }
    return result;
  }

  // ── 1. All tools must have core annotation fields defined ─────────

  test('every tool has core annotation fields defined', () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThan(0);

    const REQUIRED_FIELDS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
    const failures = [];

    for (const { name, annotations } of tools) {
      if (!annotations) {
        failures.push(`${name}: annotations object is missing entirely`);
        continue;
      }
      for (const field of REQUIRED_FIELDS) {
        if (annotations[field] === undefined) {
          failures.push(`${name}: annotations.${field} is undefined`);
        }
      }
      if (annotations.sensitiveHint !== undefined && typeof annotations.sensitiveHint !== 'boolean') {
        failures.push(`${name}: annotations.sensitiveHint is ${typeof annotations.sensitiveHint}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} tool(s) have missing annotation fields:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 2. Destructive-prefix tools must have destructiveHint: true ───

  test('tools with delete_/trash_/remove_/purge_ prefix have destructiveHint: true', () => {
    const DESTRUCTIVE_PREFIXES = ['delete_', 'trash_', 'remove_', 'purge_'];
    const tools = getAllTools();
    const failures = [];

    for (const { name, annotations } of tools) {
      const hasDestructivePrefix = DESTRUCTIVE_PREFIXES.some((p) => name.startsWith(p));
      if (hasDestructivePrefix && annotations?.destructiveHint !== true) {
        failures.push(
          `${name}: has destructive prefix but destructiveHint=${annotations?.destructiveHint}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} destructive-prefix tool(s) lack destructiveHint: true:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 3. send_ tools must have destructiveHint: true ────────────────

  test('tools with send_ prefix have destructiveHint: true', () => {
    const tools = getAllTools();
    const failures = [];

    for (const { name, annotations } of tools) {
      if (name.startsWith('send_') && annotations?.destructiveHint !== true) {
        failures.push(
          `${name}: send_ tool but destructiveHint=${annotations?.destructiveHint}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} send_ tool(s) lack destructiveHint: true:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 4. External egress/action tools must be destructive-gated ─────

  test('known external egress and agentic action tools have destructiveHint: true', () => {
    const EGRESS_OR_ACTION_TOOLS = [
      // Direct user-data egress.
      'send_mail',
      'reply_mail',
      'send_message',
      'send_file',
      'gws_gmail_send',
      // Cloud writes can persist attacker-controlled data outside the Mac.
      'gws_sheets_write',
      'gws_calendar_create',
      'gws_tasks_create',
      'gws_raw',
      // Arbitrary action surfaces can route data through another app/site.
      'open_url',
      'add_to_reading_list',
      'run_javascript',
      'run_shortcut',
      'ui_click',
      'ui_type',
      'ui_press_key',
      'ui_perform_action',
    ];
    const tools = getAllTools();
    const failures = [];

    for (const name of EGRESS_OR_ACTION_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        failures.push(`${name}: not registered`);
        continue;
      }
      if (tool.annotations?.destructiveHint !== true) {
        failures.push(`${name}: destructiveHint=${tool.annotations?.destructiveHint}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `egress/action tool(s) lack destructiveHint: true:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 5. Durable side-effect tools must be sensitive-gated ──────────

  test('known durable create/enrich tools have sensitiveHint: true without destructiveHint', () => {
    const SENSITIVE_SIDE_EFFECT_TOOLS = [
      'add_contact_email',
      'add_contact_phone',
      'add_to_album',
      'add_to_playlist',
      'complete_reminder',
      'create_album',
      'create_contact',
      'create_directory',
      'create_event',
      'create_folder',
      'create_note',
      'create_playlist',
      'create_recurring_event',
      'create_recurring_reminder',
      'create_reminder',
      'create_reminder_list',
      'create_shortcut',
    ];
    const tools = getAllTools();
    const failures = [];

    for (const name of SENSITIVE_SIDE_EFFECT_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        failures.push(`${name}: not registered`);
        continue;
      }
      if (tool.annotations?.destructiveHint !== false) {
        failures.push(`${name}: destructiveHint=${tool.annotations?.destructiveHint}`);
      }
      if (tool.annotations?.sensitiveHint !== true) {
        failures.push(`${name}: sensitiveHint=${tool.annotations?.sensitiveHint}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `sensitive side-effect tool(s) lack the expected annotations:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 6. Read-only-prefix tools must have readOnlyHint: true ────────

  test('tools with list_/get_/search_/read_/today_/upcoming_ prefix have readOnlyHint: true', () => {
    const READ_ONLY_PREFIXES = ['list_', 'get_', 'search_', 'read_', 'today_', 'upcoming_'];
    // Maps tools intentionally have readOnlyHint: false because they open the
    // Maps app and cause UI side effects (openWorldHint: true).
    const READ_ONLY_EXCEPTIONS = new Set([
      'search_location',
      'get_directions',
      'search_nearby',
    ]);
    const tools = getAllTools();
    const failures = [];

    for (const { name, annotations } of tools) {
      if (READ_ONLY_EXCEPTIONS.has(name)) continue;
      const hasReadOnlyPrefix = READ_ONLY_PREFIXES.some((p) => name.startsWith(p));
      if (hasReadOnlyPrefix && annotations?.readOnlyHint !== true) {
        failures.push(
          `${name}: has read-only prefix but readOnlyHint=${annotations?.readOnlyHint}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} read-only-prefix tool(s) lack readOnlyHint: true:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 7. Read-only exceptions must have openWorldHint: true ──────────

  test('read-only prefix exceptions have openWorldHint: true (justifying the override)', () => {
    const EXCEPTIONS = ['search_location', 'get_directions', 'search_nearby'];
    const tools = getAllTools();
    const failures = [];

    for (const name of EXCEPTIONS) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        failures.push(`${name}: not registered (expected as read-only exception)`);
        continue;
      }
      if (tool.annotations?.openWorldHint !== true) {
        failures.push(
          `${name}: exception lacks openWorldHint=true (has ${tool.annotations?.openWorldHint})`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `read-only exception(s) lack justification:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 8. run_javascript must have destructiveHint and openWorldHint ─

  test('run_javascript has destructiveHint: true and openWorldHint: true', () => {
    const tools = getAllTools();
    const rj = tools.find((t) => t.name === 'run_javascript');
    expect(rj).toBeDefined();
    expect(rj.annotations.destructiveHint).toBe(true);
    expect(rj.annotations.openWorldHint).toBe(true);
  });

  // ── 9. Summary: report total tools checked ────────────────────────

  test('registered tool count is at least 200', () => {
    const count = server._tools.size;
    // Sanity check: we expect a broad 200+ tool catalog from many modules.
    expect(count).toBeGreaterThanOrEqual(200);
  });

  // ── 10. Persistent user-data writes must be sensitive or destructive ─

  test('known persistent user-data writes are gated by sensitive-only HITL', () => {
    const PERSISTENT_USER_DATA_WRITES = [
      'mark_message_read',
      'flag_message',
      'set_clipboard',
      'set_file_tags',
      'memory_put',
      'import_photo',
      'spotlight_sync',
      'export_shortcut',
      'import_shortcut',
      'duplicate_shortcut',
      'edit_shortcut',
      'pages_create_document',
      'numbers_create_document',
      'numbers_set_cell',
      'numbers_add_sheet',
      'numbers_rename_sheet',
      'keynote_create_document',
      'keynote_add_slide',
      'keynote_set_presenter_notes',
      'set_rating',
      'set_favorited',
      'set_disliked',
    ];
    const tools = getAllTools();
    const failures = [];

    for (const name of PERSISTENT_USER_DATA_WRITES) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        failures.push(`${name}: not registered`);
        continue;
      }
      const gated =
        tool.annotations?.destructiveHint === true ||
        tool.annotations?.sensitiveHint === true;
      if (!gated) {
        failures.push(
          `${name}: destructiveHint=${tool.annotations?.destructiveHint}, sensitiveHint=${tool.annotations?.sensitiveHint}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `persistent write tool(s) are not gated by sensitive-only HITL:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  // ── 11. Live privacy readouts must be sensitive-gated ─────────────
  //
  // The privacy-readout list is the single source of truth in
  // src/shared/privacy-sensitive-tools.ts. Three directions lock it
  // against the drift that previously let smart_clipboard / memory_query
  // / the mail / photo / chat readers slip through unmarked:
  //   (a) forward  — every listed tool that is registered is gated;
  //   (b) reverse  — every registered read-only + sensitive tool is listed;
  //   (c) anti-drift — every registered read-only tool whose NAME matches an
  //                    obvious privacy pattern is listed.

  test('(a) every privacy readout in the SSOT is gated by sensitive-only HITL', () => {
    const tools = getAllTools();
    const failures = [];

    for (const name of PRIVACY_READOUT_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      // Some readouts (health_*) only register where the platform exposes
      // them; skip names absent from this fully-registered test server only
      // if genuinely unregistered. Here every module is registered, so an
      // absent name is a real regression.
      if (!tool) {
        failures.push(`${name}: in PRIVACY_READOUT_TOOLS but not registered`);
        continue;
      }
      if (tool.annotations?.destructiveHint !== true && tool.annotations?.sensitiveHint !== true) {
        failures.push(
          `${name}: destructiveHint=${tool.annotations?.destructiveHint}, sensitiveHint=${tool.annotations?.sensitiveHint}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `live privacy readout tool(s) are not gated by sensitive-only HITL:\n  ${failures.join('\n  ')}`,
      );
    }
  });

  test('(b) every registered read-only + sensitive tool is in the privacy-readout SSOT', () => {
    const tools = getAllTools();
    const orphans = tools
      .filter(
        (t) =>
          t.annotations?.readOnlyHint === true &&
          t.annotations?.sensitiveHint === true &&
          !PRIVACY_READOUT_TOOLS.has(t.name),
      )
      .map((t) => t.name);

    if (orphans.length > 0) {
      throw new Error(
        `read-only + sensitive tool(s) missing from PRIVACY_READOUT_TOOLS ` +
          `(add them to src/shared/privacy-sensitive-tools.ts):\n  ${orphans.join('\n  ')}`,
      );
    }
  });

  test('(c) read-only tools whose name matches a privacy pattern are in the SSOT', () => {
    const tools = getAllTools();
    const matched = tools.filter(
      (t) =>
        t.annotations?.readOnlyHint === true &&
        PRIVACY_READOUT_NAME_PATTERNS.some((re) => re.test(t.name)),
    );
    const unlisted = matched
      .filter((t) => !PRIVACY_READOUT_TOOLS.has(t.name) && !PRIVACY_PATTERN_EXEMPT.has(t.name))
      .map((t) => t.name);

    if (unlisted.length > 0) {
      throw new Error(
        `read-only tool(s) look like privacy readers by name but are not in ` +
          `PRIVACY_READOUT_TOOLS — mark them sensitiveHint:true and add them, ` +
          `or tighten the pattern in src/shared/privacy-sensitive-tools.ts:\n  ${unlisted.join('\n  ')}`,
      );
    }
  });
});
