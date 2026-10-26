import { afterEach, describe, expect, jest, test } from '@jest/globals';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const runJxa = jest.fn();
const runSwift = jest.fn();
const hasSwiftCommand = jest.fn().mockResolvedValue(false);
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift, hasSwiftCommand, checkSwiftBridge: jest.fn(),
}));
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({ runJxa }));
const { registerSafariTools } = await import('../dist/safari/tools.js');
const { registerMailTools } = await import('../dist/mail/tools.js');
const { registerReminderTools } = await import('../dist/reminders/tools.js');
const { registerShortcutsTools } = await import('../dist/shortcuts/tools.js');
const { listShortcutsScript, searchShortcutsScript, runShortcutScript } = await import('../dist/shortcuts/scripts.js');
const { setTagsScript } = await import('../dist/finder/scripts.js');

function registry(register) {
  const tools = new Map();
  register({ registerTool: (name, config, handler) => tools.set(name, { config, handler }) }, {});
  return tools;
}

afterEach(() => {
  runJxa.mockReset();
  runSwift.mockReset();
  hasSwiftCommand.mockReset().mockResolvedValue(false);
});

describe('executed Apple producers conform to their registered output schema', () => {
  test('Safari list_tabs wraps the actual producer array, including an empty browser', async () => {
    const tool = registry(registerSafariTools).get('list_tabs');
    for (const windows of [[], [{ tabs: () => [{ name: () => 'Fixture', url: () => 'https://example.test' }] }]]) {
      runJxa.mockImplementation(async script => JSON.parse(vm.runInNewContext(script, {
        Application: () => ({ windows: () => windows }),
      })));
      const result = await tool.handler({});
      expect(z.object(tool.config.outputSchema).safeParse(result.structuredContent).success).toBe(true);
      expect(result.structuredContent.tabs).toHaveLength(windows.length);
    }
  });

  test('Mail integer IDs from its scripting dictionary become strings', async () => {
    const messages = {
      length: 1, id: () => [42], subject: () => ['Fixture'], sender: () => ['fixture@example.test'],
      dateReceived: () => [new Date('2026-10-26T00:00:00Z')], readStatus: () => [false], flaggedStatus: () => [false],
    };
    runJxa.mockImplementation(async script => JSON.parse(vm.runInNewContext(script, {
      Application: () => ({ accounts: () => [{ mailboxes: { whose: () => () => [{ messages }] } }] }),
    })));
    const tool = registry(registerMailTools).get('list_messages');
    const result = await tool.handler({ mailbox: 'INBOX', limit: 50, offset: 0 });
    expect(z.object(tool.config.outputSchema).safeParse(result.structuredContent).success).toBe(true);
    expect(result.structuredContent.messages[0].id).toBe('42');
  });
});

describe('Reminder backend contracts preserve flags and IDs', () => {
  test('a recurring reminder keeps its native ID through subsequent CRUD calls', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    const id = 'eventkit-fixture-id';
    const state = { id, title: 'Fixture', priority: 1, completed: false };
    runSwift.mockImplementation(async (command, json) => {
      const input = JSON.parse(json);
      if (command === 'create-recurring-reminder') return { id, title: state.title, recurring: true };
      expect(input.id).toBe(id);
      if (command === 'update-reminder') {
        if (input.flagged !== undefined) throw new Error('EventKit cannot change reminder flags');
        state.title = input.title ?? state.title;
      }
      if (command === 'complete-reminder') state.completed = input.completed;
      return { ...state, name: state.title };
    });
    const tools = registry(registerReminderTools);
    const created = await tools.get('create_recurring_reminder').handler({
      title: state.title, recurrence: { frequency: 'daily', interval: 1 },
    });
    expect(created.isError).toBeFalsy();
    for (const [tool, args] of [
      ['read_reminder', { id }], ['update_reminder', { id, title: 'Edited' }],
      ['complete_reminder', { id, completed: true }], ['delete_reminder', { id }],
    ]) expect((await tools.get(tool).handler(args)).isError).toBeFalsy();
    expect(runSwift.mock.calls.map(([command]) => command)).toEqual([
      'create-recurring-reminder', 'read-reminder', 'update-reminder', 'complete-reminder', 'delete-reminder',
    ]);
    expect(runJxa).not.toHaveBeenCalled();
  });

  test('a native flag update error is returned without replaying the mutation in JXA', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    runSwift.mockRejectedValue(new Error('EventKit cannot change reminder flags'));
    const result = await registry(registerReminderTools).get('update_reminder').handler({
      id: 'eventkit-fixture-id', title: 'Unapplied title', flagged: false,
    });
    expect(result.isError).toBe(true);
    expect(runJxa).not.toHaveBeenCalled();
  });

  test('an unflag update preserves an existing high priority and reads back the real flag', async () => {
    const state = {
      id: 'fixture', name: 'Fixture', body: '', completed: false, completionDate: null,
      creationDate: new Date('2026-01-01T00:00:00Z'), modificationDate: new Date('2026-01-01T00:00:00Z'),
      dueDate: null, priority: 1, flagged: true, container: { name: () => 'Fixture list' },
    };
    const reminder = new Proxy({}, {
      get: (_, key) => () => state[key],
      set: (_, key, value) => { state[key] = value; return true; },
    });
    runJxa.mockImplementation(async script => JSON.parse(vm.runInNewContext(script, {
      Application: () => ({ reminders: { byId(id) { expect(id).toBe('fixture'); return reminder; } } }),
    })));
    const tools = registry(registerReminderTools);
    const updated = await tools.get('update_reminder').handler({ id: 'fixture', flagged: false });
    expect(updated.isError).toBeFalsy();
    const read = await tools.get('read_reminder').handler({ id: 'fixture' });
    expect(read.structuredContent).toMatchObject({ id: 'fixture', flagged: false, priority: 1 });
    expect(runJxa).toHaveBeenCalledTimes(2);
  });
});

describe('Shortcuts executes only supported CLI contracts', () => {
  test.each(['get_shortcut_detail', 'delete_shortcut', 'export_shortcut', 'import_shortcut', 'duplicate_shortcut'])(
    '%s is not advertised without a supported implementation', name => {
      expect(registry(registerShortcutsTools).has(name)).toBe(false);
    },
  );

  test.each(['\r', '\n', '\r\n'])('list and search split CLI line ending %j', separator => {
    const Application = { currentApplication: () => ({ doShellScript: () => `Fixture One${separator}Fixture Two${separator}` }) };
    expect(JSON.parse(vm.runInNewContext(listShortcutsScript(), { Application }))).toEqual({
      total: 2, shortcuts: ['Fixture One', 'Fixture Two'],
    });
    expect(JSON.parse(vm.runInNewContext(searchShortcutsScript('two'), { Application }))).toEqual({
      total: 1, shortcuts: ['Fixture Two'],
    });
  });

  test('a failing shortcut propagates its exit status and removes its text input', () => {
    let inputPath;
    expect(() => vm.runInNewContext(runShortcutScript('Fixture Shortcut', 'private input'), {
      Application: { currentApplication: () => ({ doShellScript(command) {
        const result = spawnSync('/bin/sh', ['-c', `shortcuts() { printf '%s' "$4"; return 42; }
${command}`], { encoding: 'utf8' });
        inputPath = result.stdout;
        if (result.status !== 0) throw new Error(`shortcut exited ${result.status}`);
        return result.stdout;
      } }) },
    })).toThrow('shortcut exited 42');
    expect(inputPath.endsWith('/input.txt')).toBe(true);
    expect(existsSync(dirname(inputPath))).toBe(false);
  });

  test.each(['hello\nworld\n', '"quote" $HOME `id` \\ slash\r\n', ''])(
    'text input reaches --input-path verbatim and the temporary file is removed: %j', input => {
      const fixture = `shortcuts() {
        [ "$1" = run ] && [ "$2" = 'Fixture Shortcut' ] && [ "$3" = --input-path ] && [ "$#" -eq 4 ] || return 64
        [ -f "$4" ] || return 66
        printf '%s\\n' "$4"
        base64 < "$4"
      }`;
      const output = JSON.parse(vm.runInNewContext(runShortcutScript('Fixture Shortcut', input), {
        Application: { currentApplication: () => ({ doShellScript(command) {
          const result = spawnSync('/bin/sh', ['-c', `${fixture}\n${command}`], { encoding: 'utf8' });
          if (result.status !== 0) throw new Error(`fixture CLI exited ${result.status}: ${result.stderr}`);
          return result.stdout.trimEnd();
        } }) },
      }));
      const [path, ...encoded] = output.output.split('\n');
      expect(path.endsWith('/input.txt')).toBe(true);
      expect(Buffer.from(encoded.join(''), 'base64').toString()).toBe(input);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(dirname(path))).toBe(false);
    },
  );
});

describe('Finder tag failures propagate', () => {
  test('the producer does not turn a false NSURL write result into success', () => {
    expect(() => vm.runInNewContext(setTagsScript('/tmp/nonexistent-fixture', ['test']), {
      Application: { currentApplication: () => ({}) },
      ObjC: { import() {}, unwrap: x => x }, Ref: () => [],
      $: { NSURL: { fileURLWithPath: () => ({ setResourceValueForKeyError: () => false }) },
        NSArray: { arrayWithArray: x => x }, NSURLTagNamesKey: 'NSURLTagNamesKey' },
    })).toThrow();
  });

  (process.platform === 'darwin' ? test : test.skip)('real osascript rejects a missing fixture file', () => {
    const root = mkdtempSync(join(tmpdir(), 'airmcp-tags-regression-'));
    try {
      const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', setTagsScript(join(root, 'missing'), ['fixture'])], {
        encoding: 'utf8', timeout: 10000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout.trim()).toBe('');
      expect(result.stderr).toContain('error');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
