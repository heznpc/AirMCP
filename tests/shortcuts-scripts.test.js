import { describe, test, expect } from '@jest/globals';
import {
  listShortcutsScript,
  runShortcutScript,
} from '../dist/shortcuts/scripts.js';

describe('shortcuts script generators', () => {
  test('listShortcutsScript calls shortcuts CLI', () => {
    const script = listShortcutsScript();
    expect(script).toContain('doShellScript');
    expect(script).toContain('shortcuts list');
  });

  test('runShortcutScript runs by name', () => {
    const script = runShortcutScript('My Shortcut');
    expect(script).toContain('shortcuts run');
    expect(script).toContain('My Shortcut');
    expect(script).not.toContain('--input-type');
  });

  test('runShortcutScript passes text input', () => {
    const script = runShortcutScript('Process Text', 'hello world');
    expect(script).toContain('shortcuts run');
    expect(script).toContain('Process Text');
    expect(script).toContain('--input-type text');
    expect(script).toContain('hello world');
  });
});

describe('shortcuts escJxaShell() injection prevention', () => {
  test('escapes double quotes in shortcut name', () => {
    const script = runShortcutScript('Say "Hello"');
    expect(script).toContain('Say \\\\\\"Hello\\\\\\"');
  });

  test('escapes dollar signs in input', () => {
    const script = runShortcutScript('Test', '$HOME');
    expect(script).toContain('\\\\$HOME');
  });

  test('escapes backticks in input', () => {
    const script = runShortcutScript('Test', '`whoami`');
    expect(script).toContain('\\\\`whoami\\\\`');
  });
});
