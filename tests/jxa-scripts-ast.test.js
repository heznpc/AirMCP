/**
 * JXA / AppleScript source AST validation.
 *
 * Background: the test-quality survey on 2026-05-13 flagged ~27% of the
 * suite as "mock round-trip tautology". A representative offender is
 * the per-module `*-scripts.test.js` family that asserts
 * `script.toContain("Application('Calendar')")`. That assertion would
 * happily pass on a typo'd `Application('Calandar')` if the same typo
 * lived in the test — and crucially, it cannot detect any of the
 * structural breakage that actually ships JXA scripts to runtime
 * failure: unbalanced braces, missing semicolons after template
 * literals, broken interpolation, stray backticks.
 *
 * This test runs every script-builder in `src/<module>/scripts.ts`
 * through Node's built-in `vm.Script` parser. JXA is a JavaScript
 * dialect — the same parser the osascript host uses for JXA scripts.
 * If the produced string is not parseable, this test fails BEFORE the
 * script ever reaches osascript.
 *
 * Two harness wrinkles, both inherent to how osascript hosts JXA:
 *
 *   1. JXA scripts are executed as the body of an implicit `run()`
 *      handler — top-level `return value;` is legal there. Standalone
 *      `new vm.Script(source)` parses as a Script (not a function body),
 *      so it rejects `return`. We wrap each JXA source in
 *      `(function(){ … })()` before parsing so the harness mirrors the
 *      execution context.
 *
 *   2. Some Messages builders return raw AppleScript (`tell application
 *      "Messages" …`), not JXA. Node has no AppleScript parser, so
 *      AppleScript fixtures are marked `kind: 'applescript'` and only
 *      checked for non-empty string output. A future enhancement could
 *      shell out to `osascript -ss -e` for AppleScript syntax check,
 *      but that requires a darwin runner.
 *
 * We do NOT execute the script — JXA globals like `Application()` are
 * undefined here. `vm.Script` parses without running, so an unresolved
 * reference is fine; only SyntaxError is fatal.
 */
import { describe, test, expect } from '@jest/globals';
import vm from 'node:vm';

// Generated from a one-shot module scan of src/<module>/scripts.ts.
// Each entry is the simplest parameter set that exercises the function.
// JXA semantic correctness doesn't matter here — we only care that the
// returned source is syntactically valid JavaScript.
const FIXTURES = [
  { module: '../dist/notes/scripts.js', fn: 'listNotesScript', args: [5, 0] },
  { module: '../dist/notes/scripts.js', fn: 'searchNotesScript', args: ['x', 5, 0] },
  { module: '../dist/notes/scripts.js', fn: 'readNoteScript', args: ['x'] },
  { module: '../dist/notes/scripts.js', fn: 'createNoteScript', args: ['x'] },
  { module: '../dist/notes/scripts.js', fn: 'listFoldersScript', args: [] },
  { module: '../dist/notes/scripts.js', fn: 'compareNotesScript', args: [['a', 'b']] },
  { module: '../dist/calendar/scripts.js', fn: 'listCalendarsScript', args: [] },
  { module: '../dist/calendar/scripts.js', fn: 'readEventScript', args: ['x'] },
  { module: '../dist/calendar/scripts.js', fn: 'deleteEventScript', args: ['x'] },
  { module: '../dist/calendar/scripts.js', fn: 'getUpcomingEventsScript', args: [5] },
  { module: '../dist/calendar/scripts.js', fn: 'todayEventsScript', args: [] },
  { module: '../dist/reminders/scripts.js', fn: 'listReminderListsScript', args: [] },
  { module: '../dist/reminders/scripts.js', fn: 'listRemindersScript', args: [5, 0] },
  { module: '../dist/reminders/scripts.js', fn: 'readReminderScript', args: ['x'] },
  { module: '../dist/reminders/scripts.js', fn: 'completeReminderScript', args: ['x', true] },
  { module: '../dist/reminders/scripts.js', fn: 'searchRemindersScript', args: ['x', 5] },
  { module: '../dist/mail/scripts.js', fn: 'listMailboxesScript', args: [] },
  { module: '../dist/mail/scripts.js', fn: 'listMessagesScript', args: ['INBOX', 5, 0] },
  { module: '../dist/mail/scripts.js', fn: 'getUnreadCountScript', args: [] },
  { module: '../dist/mail/scripts.js', fn: 'listAccountsScript', args: [] },
  { module: '../dist/messages/scripts.js', fn: 'listChatsScript', args: [5] },
  { module: '../dist/messages/scripts.js', fn: 'readChatScript', args: ['x'] },
  { module: '../dist/messages/scripts.js', fn: 'searchMessagesScript', args: ['x', 5] },
  { module: '../dist/messages/scripts.js', fn: 'sendMessageScript', args: ['x', 'y'], kind: 'applescript' },
  { module: '../dist/messages/scripts.js', fn: 'sendFileScript', args: ['x', 'y'], kind: 'applescript' },
  { module: '../dist/contacts/scripts.js', fn: 'listContactsScript', args: [5, 0] },
  { module: '../dist/contacts/scripts.js', fn: 'searchContactsScript', args: ['x', 5] },
  { module: '../dist/contacts/scripts.js', fn: 'readContactScript', args: ['x'] },
  { module: '../dist/contacts/scripts.js', fn: 'listGroupsScript', args: [] },
  { module: '../dist/music/scripts.js', fn: 'listPlaylistsScript', args: [] },
  { module: '../dist/music/scripts.js', fn: 'nowPlayingScript', args: [] },
  { module: '../dist/music/scripts.js', fn: 'playbackControlScript', args: ['play'] },
  { module: '../dist/music/scripts.js', fn: 'searchTracksScript', args: ['x', 5] },
  { module: '../dist/photos/scripts.js', fn: 'listAlbumsScript', args: [] },
  { module: '../dist/photos/scripts.js', fn: 'listPhotosScript', args: ['x', 5, 0] },
  { module: '../dist/photos/scripts.js', fn: 'searchPhotosScript', args: ['x', 5] },
  { module: '../dist/photos/scripts.js', fn: 'listFavoritesScript', args: [5] },
  { module: '../dist/safari/scripts.js', fn: 'listTabsScript', args: [] },
  { module: '../dist/safari/scripts.js', fn: 'getCurrentTabScript', args: [] },
  { module: '../dist/safari/scripts.js', fn: 'openUrlScript', args: ['x'] },
  { module: '../dist/safari/scripts.js', fn: 'listBookmarksScript', args: [] },
  { module: '../dist/finder/scripts.js', fn: 'searchFilesScript', args: ['x', 'y', 5] },
  { module: '../dist/finder/scripts.js', fn: 'getFileInfoScript', args: ['x'] },
  { module: '../dist/finder/scripts.js', fn: 'listDirectoryScript', args: ['x', 5] },
  { module: '../dist/finder/scripts.js', fn: 'recentFilesScript', args: ['x', 0, 5] },
  { module: '../dist/system/scripts.js', fn: 'getClipboardScript', args: [] },
  { module: '../dist/system/scripts.js', fn: 'getVolumeScript', args: [] },
  { module: '../dist/system/scripts.js', fn: 'getFrontmostAppScript', args: [] },
  { module: '../dist/system/scripts.js', fn: 'listRunningAppsScript', args: [] },
  { module: '../dist/system/scripts.js', fn: 'getBatteryStatusScript', args: [] },
  { module: '../dist/system/scripts.js', fn: 'listAllWindowsScript', args: [] },
  { module: '../dist/shortcuts/scripts.js', fn: 'listShortcutsScript', args: [] },
  { module: '../dist/shortcuts/scripts.js', fn: 'runShortcutScript', args: ['x'] },
  { module: '../dist/shortcuts/scripts.js', fn: 'searchShortcutsScript', args: ['x'] },
  { module: '../dist/shortcuts/scripts.js', fn: 'getShortcutDetailScript', args: ['x'] },
  { module: '../dist/ui/scripts.js', fn: 'uiOpenAppScript', args: ['x'] },
  { module: '../dist/ui/scripts.js', fn: 'uiTypeScript', args: ['x'] },
  { module: '../dist/ui/scripts.js', fn: 'uiPressKeyScript', args: ['a'] },
  { module: '../dist/ui/scripts.js', fn: 'uiReadScript', args: [] },
  { module: '../dist/screen/scripts.js', fn: 'captureScreenScript', args: [] },
  { module: '../dist/screen/scripts.js', fn: 'captureWindowScript', args: [] },
  { module: '../dist/screen/scripts.js', fn: 'listWindowsScript', args: [] },
  { module: '../dist/screen/scripts.js', fn: 'captureAreaScript', args: [0, 0, 100, 100] },
];

describe('JXA script source — syntactic validity', () => {
  // Eagerly resolve every imported module so missing exports surface as
  // discrete test failures rather than blocking the whole suite.
  test.each(FIXTURES)('$module → $fn() produces parseable JavaScript', async ({ module, fn, args, kind = 'jxa' }) => {
    let mod;
    try {
      mod = await import(module);
    } catch (e) {
      throw new Error(`Cannot import ${module}: ${e.message}`);
    }
    const builder = mod[fn];
    if (typeof builder !== 'function') {
      throw new Error(
        `${module} does not export function "${fn}". Either the export was ` +
          `renamed/removed (update FIXTURES) or the build is stale (npm run build).`,
      );
    }
    let source;
    try {
      source = builder(...args);
    } catch (e) {
      throw new Error(`${fn}(...) threw while building source: ${e.message}`);
    }
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
    // AppleScript builders: Node has no AppleScript parser. Limit the
    // check to "non-empty string"; a darwin-gated test could later add
    // `osascript -ss -e` for real syntax verification.
    if (kind === 'applescript') {
      // Sanity: confirm the source DOES look like AppleScript so a
      // mis-tagged JXA fixture surfaces. AppleScript starts with `tell`
      // or `on` or `script` or a comment line; the cheap heuristic is
      // "contains 'tell application' or starts with --".
      expect(/tell application|^--|^on\s|^script\s/m.test(source)).toBe(true);
      return;
    }
    // JXA path. osascript wraps the source in an implicit `run()`
    // handler, so top-level `return` is legal. `vm.Script` parses as a
    // Script and rejects `return` — wrap in `(function(){ … })` to
    // mirror the execution context. Triple-equals braces, missing
    // semicolons inside template literals, and broken interpolation
    // still surface as SyntaxError.
    const wrapped = `(function(){\n${source}\n})`;
    try {
      // eslint-disable-next-line no-new
      new vm.Script(wrapped, { filename: `${fn}.jxa` });
    } catch (e) {
      const head = source.slice(0, 200).replace(/\n/g, '\\n');
      throw new Error(`${fn}() produced unparseable JavaScript: ${e.message}\n  source head: ${head}`);
    }
  });
});
