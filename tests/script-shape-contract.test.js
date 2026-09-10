/**
 * Hand-maintained example ↔ outputSchema compatibility test.
 *
 * Wave 1/2/3 runtime tests mock `runJxa`/`runSwift`, so the mock return value
 * becomes the `structuredContent` verbatim — those tests can only confirm
 * that a schema is self-consistent with whatever shape the test wrote down.
 * They cannot detect a real drift where `scripts.ts` changes the JSON it
 * emits without the matching outputSchema update (or vice versa).
 *
 * Each `scripts.ts` exports a hand-maintained `*_EXAMPLE` constant pinned to
 * the same TypeScript interface the script's final `JSON.stringify(...)` is
 * expected to produce. Here we parse every example through the tool's real
 * declared `outputSchema` via strict Zod. This is a useful review checklist,
 * but the examples are not derived from script execution: changing a script
 * without updating its example can still pass. Domain-level VM/osascript or
 * Swift execution tests are required for a real producer/schema contract.
 *
 * Scope: JXA-backed tools only. Swift-bridge tools (health_*, some photos)
 * need a different contract (Swift `--dump-schema` or similar) and are
 * tracked separately.
 */
import { describe, test, expect } from '@jest/globals';
import { z } from 'zod';
import { setupPlatformMocks } from './helpers/mock-runtime.js';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

setupPlatformMocks();

const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');
const { registerCalendarTools } = await import('../dist/calendar/tools.js');
const healthTools = await import('../dist/health/tools.js');
const { registerHealthTools } = healthTools;
const messagesScripts = await import('../dist/messages/scripts.js');
const shortcutsScripts = await import('../dist/shortcuts/scripts.js');
const calendarScripts = await import('../dist/calendar/scripts.js');
const { registerFinderTools } = await import('../dist/finder/tools.js');
const finderScripts = await import('../dist/finder/scripts.js');
const { registerMailTools } = await import('../dist/mail/tools.js');
const mailScripts = await import('../dist/mail/scripts.js');
const { registerNoteTools } = await import('../dist/notes/tools.js');
const notesScripts = await import('../dist/notes/scripts.js');
const { registerReminderTools } = await import('../dist/reminders/tools.js');
const remindersScripts = await import('../dist/reminders/scripts.js');

/**
 * Strictness has to reach INSIDE arrays, or the guard is only shallow. Zod's
 * `.strict()` applies to one object level, so a row inside `events` / `messages`
 * / `notes` would happily accept an undeclared field and the drift this file
 * exists to catch would slip through one nesting level down.
 */
function deepStrict(type) {
  const def = type?._def;
  const kind = def?.typeName ?? def?.type;
  if (kind === 'ZodObject' || kind === 'object') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    const rebuilt = {};
    for (const [key, value] of Object.entries(shape)) rebuilt[key] = deepStrict(value);
    return z.object(rebuilt).strict();
  }
  if (kind === 'ZodArray' || kind === 'array') {
    return z.array(deepStrict(def.element ?? def.type));
  }
  if (kind === 'ZodNullable' || kind === 'nullable') return deepStrict(def.innerType).nullable();
  if (kind === 'ZodOptional' || kind === 'optional') return deepStrict(def.innerType).optional();
  if (kind === 'ZodDefault' || kind === 'default') return deepStrict(def.innerType).optional();
  return type;
}

function schemaFor(server, toolName) {
  const tool = server._tools.get(toolName);
  expect(tool).toBeDefined();
  expect(tool.opts.outputSchema).toBeDefined();
  const rebuilt = {};
  for (const [key, value] of Object.entries(tool.opts.outputSchema)) rebuilt[key] = deepStrict(value);
  return z.object(rebuilt).strict();
}

function assertExampleFits(server, toolName, example) {
  const schema = schemaFor(server, toolName);
  const result = schema.safeParse(example);
  if (!result.success) {
    throw new Error(
      `${toolName}: scripts.ts example drifted from outputSchema. ` +
        `Issues: ${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
}

describe('Script shape ↔ outputSchema contract — messages', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerMessagesTools(server, createMockConfig());
  });

  test('list_chats example conforms', () => {
    assertExampleFits(server, 'list_chats', messagesScripts.LIST_CHATS_EXAMPLE);
  });
  test('read_chat example conforms', () => {
    assertExampleFits(server, 'read_chat', messagesScripts.READ_CHAT_EXAMPLE);
  });
  test('search_chats example conforms', () => {
    assertExampleFits(server, 'search_chats', messagesScripts.SEARCH_CHATS_EXAMPLE);
  });
  test('list_participants example conforms', () => {
    assertExampleFits(server, 'list_participants', messagesScripts.LIST_PARTICIPANTS_EXAMPLE);
  });
});

describe('Script shape ↔ outputSchema contract — shortcuts', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerShortcutsTools(server, createMockConfig());
  });

  test('list_shortcuts example conforms', () => {
    assertExampleFits(server, 'list_shortcuts', shortcutsScripts.LIST_SHORTCUTS_EXAMPLE);
  });
  test('search_shortcuts example conforms', () => {
    assertExampleFits(server, 'search_shortcuts', shortcutsScripts.SEARCH_SHORTCUTS_EXAMPLE);
  });
  test('get_shortcut_detail example conforms', () => {
    assertExampleFits(server, 'get_shortcut_detail', shortcutsScripts.GET_SHORTCUT_DETAIL_EXAMPLE);
  });
});

// Calendar tools route through `runAutomation`, so each shape is a contract for
// two backends at once: the EventKit Swift bridge and the JXA fallback. Writing
// this contract down surfaced three real drifts that no runtime test could see —
// `search_events` and `today_events` emitted `returned` from both backends
// without declaring it, and the JXA upcoming/today scripts emitted a null
// `location` against a non-nullable schema (Swift types it `String`).
describe('Script shape ↔ outputSchema contract — calendar', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerCalendarTools(server, createMockConfig());
  });

  test('list_calendars example conforms', () => {
    assertExampleFits(server, 'list_calendars', calendarScripts.LIST_CALENDARS_EXAMPLE);
  });
  test('list_events example conforms', () => {
    assertExampleFits(server, 'list_events', calendarScripts.LIST_EVENTS_EXAMPLE);
  });
  test('read_event example conforms', () => {
    assertExampleFits(server, 'read_event', calendarScripts.READ_EVENT_EXAMPLE);
  });
  test('read_event unset-optional example conforms', () => {
    assertExampleFits(server, 'read_event', calendarScripts.READ_EVENT_EXAMPLE_EMPTY);
  });
  test('search_events example conforms', () => {
    assertExampleFits(server, 'search_events', calendarScripts.SEARCH_EVENTS_EXAMPLE);
  });
  test('get_upcoming_events example conforms', () => {
    assertExampleFits(server, 'get_upcoming_events', calendarScripts.GET_UPCOMING_EVENTS_EXAMPLE);
  });
  test('today_events example conforms', () => {
    assertExampleFits(server, 'today_events', calendarScripts.TODAY_EVENTS_EXAMPLE);
  });

  // The guard has to bite in both directions, or it is just a snapshot of
  // whatever the example happens to say. A field the schema does not declare
  // must fail (strict), and a renamed field must fail too.
  test('an undeclared field fails the contract', () => {
    expect(() =>
      assertExampleFits(server, 'today_events', {
        ...calendarScripts.TODAY_EVENTS_EXAMPLE,
        unexpected: true,
      }),
    ).toThrow(/drifted from outputSchema/);
  });
  test('a renamed field fails the contract', () => {
    const { returned, ...withoutReturned } = calendarScripts.TODAY_EVENTS_EXAMPLE;
    expect(() =>
      assertExampleFits(server, 'today_events', { ...withoutReturned, returnedCount: returned }),
    ).toThrow(/drifted from outputSchema/);
  });
});

// The three list-shaped notes tools share `buildNote`'s row and each appends
// only its own extra fields, so the rows must NOT be interchangeable: a
// list_notes row is missing search_notes' preview, and scan_notes adds charCount
// on top of that.
describe('Script shape ↔ outputSchema contract — notes', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerNoteTools(server, createMockConfig());
  });

  test('list_notes example conforms', () => {
    assertExampleFits(server, 'list_notes', notesScripts.LIST_NOTES_EXAMPLE);
  });
  test('search_notes example conforms', () => {
    assertExampleFits(server, 'search_notes', notesScripts.SEARCH_NOTES_EXAMPLE);
  });
  test('read_note example conforms', () => {
    assertExampleFits(server, 'read_note', notesScripts.READ_NOTE_EXAMPLE);
  });
  test('list_folders example conforms', () => {
    assertExampleFits(server, 'list_folders', notesScripts.LIST_FOLDERS_EXAMPLE);
  });
  test('scan_notes example conforms', () => {
    assertExampleFits(server, 'scan_notes', notesScripts.SCAN_NOTES_EXAMPLE);
  });

  test('search_notes rejects a row without its preview', () => {
    expect(() =>
      assertExampleFits(server, 'search_notes', {
        ...notesScripts.SEARCH_NOTES_EXAMPLE,
        notes: notesScripts.LIST_NOTES_EXAMPLE.notes,
      }),
    ).toThrow(/drifted from outputSchema/);
  });
  test('list_notes rejects a scan_notes row', () => {
    expect(() =>
      assertExampleFits(server, 'list_notes', {
        ...notesScripts.LIST_NOTES_EXAMPLE,
        notes: notesScripts.SCAN_NOTES_EXAMPLE.notes,
      }),
    ).toThrow(/drifted from outputSchema/);
  });
});

// Reminder tools also route through `runAutomation`, so each shape is a contract
// for the EventKit Swift bridge and the JXA fallback at once.
describe('Script shape ↔ outputSchema contract — reminders', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerReminderTools(server, createMockConfig());
  });

  test('list_reminder_lists example conforms', () => {
    assertExampleFits(server, 'list_reminder_lists', remindersScripts.LIST_REMINDER_LISTS_EXAMPLE);
  });
  test('list_reminders example conforms', () => {
    assertExampleFits(server, 'list_reminders', remindersScripts.LIST_REMINDERS_EXAMPLE);
  });
  test('read_reminder example conforms', () => {
    assertExampleFits(server, 'read_reminder', remindersScripts.READ_REMINDER_EXAMPLE);
  });
  test('read_reminder completed example conforms', () => {
    assertExampleFits(server, 'read_reminder', remindersScripts.READ_REMINDER_EXAMPLE_COMPLETED);
  });
  test('search_reminders example conforms', () => {
    assertExampleFits(server, 'search_reminders', remindersScripts.SEARCH_REMINDERS_EXAMPLE);
  });

  // read_reminder rows carry four fields the list rows do not, so feeding a
  // detail row to list_reminders must fail.
  test('list_reminders rejects a read_reminder row', () => {
    expect(() =>
      assertExampleFits(server, 'list_reminders', {
        ...remindersScripts.LIST_REMINDERS_EXAMPLE,
        reminders: [remindersScripts.READ_REMINDER_EXAMPLE],
      }),
    ).toThrow(/drifted from outputSchema/);
  });
});

// Writing this contract down caught `list_mailboxes` shipping the script's bare
// array against an object schema: its mock in output-schema-structured.test.js
// claimed the script already returned `{ mailboxes }`, so the runtime test
// validated the mock's lie instead of the tool's real output.
describe('Script shape ↔ outputSchema contract — mail', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerMailTools(server, createMockConfig());
  });

  test('list_mailboxes example conforms', () => {
    assertExampleFits(server, 'list_mailboxes', mailScripts.LIST_MAILBOXES_EXAMPLE);
  });
  test('list_messages example conforms', () => {
    assertExampleFits(server, 'list_messages', mailScripts.LIST_MESSAGES_EXAMPLE);
  });
  test('read_message example conforms', () => {
    assertExampleFits(server, 'read_message', mailScripts.READ_MESSAGE_EXAMPLE);
  });
  test('read_message unsent-draft example conforms', () => {
    assertExampleFits(server, 'read_message', mailScripts.READ_MESSAGE_EXAMPLE_NO_SENT_DATE);
  });
  test('search_messages example conforms', () => {
    assertExampleFits(server, 'search_messages', mailScripts.SEARCH_MESSAGES_EXAMPLE);
  });
  test('get_unread_count example conforms', () => {
    assertExampleFits(server, 'get_unread_count', mailScripts.GET_UNREAD_COUNT_EXAMPLE);
  });
  test('list_accounts example conforms', () => {
    assertExampleFits(server, 'list_accounts', mailScripts.LIST_ACCOUNTS_EXAMPLE);
  });

  // search_messages deliberately returns a narrower row than list_messages, so
  // the two must not be allowed to converge by accident.
  test('search_messages rejects a list_messages row', () => {
    expect(() =>
      assertExampleFits(server, 'search_messages', {
        returned: 1,
        messages: [mailScripts.LIST_MESSAGES_EXAMPLE.messages[0]],
      }),
    ).toThrow(/drifted from outputSchema/);
  });
});

// Finder rows shell out to `stat` and fall back to a REDUCED row when that call
// throws, so the optional fields are a real branch rather than decoration. Each
// example pins both branches — a fallback row that stopped validating would
// otherwise only surface on a live Mac.
describe('Script shape ↔ outputSchema contract — finder', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerFinderTools(server, createMockConfig());
  });

  test('search_files example conforms', () => {
    assertExampleFits(server, 'search_files', finderScripts.SEARCH_FILES_EXAMPLE);
  });
  test('get_file_info example conforms', () => {
    assertExampleFits(server, 'get_file_info', finderScripts.GET_FILE_INFO_EXAMPLE);
  });
  test('recent_files example conforms', () => {
    assertExampleFits(server, 'recent_files', finderScripts.RECENT_FILES_EXAMPLE);
  });
  test('list_directory example conforms', () => {
    assertExampleFits(server, 'list_directory', finderScripts.LIST_DIRECTORY_EXAMPLE);
  });
});

describe('Swift bridge shape ↔ outputSchema contract — health', () => {
  let server;
  beforeAll(() => {
    server = createMockServer();
    registerHealthTools(server, createMockConfig());
  });

  test('health_summary example conforms', () => {
    assertExampleFits(server, 'health_summary', healthTools.HEALTH_SUMMARY_EXAMPLE);
  });
  test('health_today_steps example conforms', () => {
    assertExampleFits(server, 'health_today_steps', healthTools.HEALTH_STEPS_EXAMPLE);
  });
  test('health_heart_rate value-case example conforms', () => {
    assertExampleFits(server, 'health_heart_rate', healthTools.HEALTH_HEART_RATE_EXAMPLE_VALUE);
  });
  test('health_heart_rate null-case example conforms', () => {
    assertExampleFits(server, 'health_heart_rate', healthTools.HEALTH_HEART_RATE_EXAMPLE_NULL);
  });
  test('health_sleep example conforms', () => {
    assertExampleFits(server, 'health_sleep', healthTools.HEALTH_SLEEP_EXAMPLE);
  });
});
