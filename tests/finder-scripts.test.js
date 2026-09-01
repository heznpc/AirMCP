import { describe, test, expect } from '@jest/globals';
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
