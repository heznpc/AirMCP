import { describe, test, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  searchFilesScript,
  getFileInfoScript,
  setTagsScript,
  recentFilesScript,
} from '../dist/finder/scripts.js';

describe('finder script generators', () => {
  test('searchFilesScript uses mdfind', () => {
    const script = searchFilesScript('~', 'report', 50);
    expect(script).toContain('mdfind');
    expect(script).toContain('report');
    expect(script).toContain('50');
  });

  test('getFileInfoScript reads metadata', () => {
    const script = getFileInfoScript('/Users/test/file.txt');
    expect(script).toContain('/Users/test/file.txt');
    expect(script).toContain('kMDItemUserTags');
    expect(script).toContain('item.size()');
  });

  test('setTagsScript sets tags via NSURL', () => {
    const script = setTagsScript('/Users/test/file.txt', ['Important', 'Work']);
    expect(script).toContain('NSURLTagNamesKey');
    expect(script).toContain("'Important'");
    expect(script).toContain("'Work'");
  });

  test('recentFilesScript uses mdfind with date', () => {
    const script = recentFilesScript('~', 7, 30);
    expect(script).toContain('mdfind');
    expect(script).toContain('kMDItemContentModificationDate');
    expect(script).toContain('30');
  });

  test('recentFilesScript preserves the Spotlight $time token through JXA and the shell', () => {
    const script = recentFilesScript('/Users/test', 7, 30);
    let command = '';
    const app = {
      includeStandardAdditions: false,
      doShellScript(value) {
        command = value;
        return '';
      },
    };

    vm.runInNewContext(`(function(){${script}})()`, {
      Application: { currentApplication: () => app },
    });

    expect(command).toMatch(/kMDItemContentModificationDate >= \\\$time\.iso\(\d{4}-\d{2}-\d{2}\)/);

    const binDir = mkdtempSync(join(tmpdir(), 'airmcp-finder-test-'));
    try {
      const fakeMdfind = join(binDir, 'mdfind');
      writeFileSync(fakeMdfind, '#!/bin/sh\nprintf "%s\\n" "$3"\n');
      chmodSync(fakeMdfind, 0o755);
      const output = execFileSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, time: 'EXPANDED_BY_SHELL' },
      }).trim();

      expect(output).toMatch(/^kMDItemContentModificationDate >= \$time\.iso\(\d{4}-\d{2}-\d{2}\)$/);
      expect(output).not.toContain('EXPANDED_BY_SHELL');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});

describe('finder esc() injection prevention', () => {
  test('escapes single quotes in path', () => {
    const script = getFileInfoScript("/Users/test/it's a file.txt");
    expect(script).toContain("it\\'s a file.txt");
  });

  test('escapes double quotes in query (JXA+shell context)', () => {
    const script = searchFilesScript('~', 'say "hello"', 10);
    expect(script).toContain('say \\\\\\"hello\\\\\\"');
  });
});
