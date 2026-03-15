import { describe, test, expect } from '@jest/globals';
import { zFilePath } from '../dist/shared/validate.js';

describe('zFilePath', () => {
  // --- Valid paths ---
  test('accepts absolute path', () => {
    const result = zFilePath.safeParse('/Users/ren/file.txt');
    expect(result.success).toBe(true);
    expect(result.data).toBe('/Users/ren/file.txt');
  });

  test('accepts root path', () => {
    const result = zFilePath.safeParse('/');
    expect(result.success).toBe(true);
  });

  test('accepts tilde home path and resolves it', () => {
    const result = zFilePath.safeParse('~/Desktop/file.txt');
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^\/.*\/Desktop\/file\.txt$/);
    expect(result.data).not.toContain('~');
  });

  test('accepts bare tilde and resolves to HOME', () => {
    const result = zFilePath.safeParse('~');
    expect(result.success).toBe(true);
    expect(result.data).not.toBe('~');
    expect(result.data.startsWith('/')).toBe(true);
  });

  test('accepts path with double dots in filename', () => {
    const result = zFilePath.safeParse('/tmp/file..draft.txt');
    expect(result.success).toBe(true);
  });

  test('accepts path with spaces', () => {
    const result = zFilePath.safeParse('/Users/ren/My Documents/file.txt');
    expect(result.success).toBe(true);
  });

  // --- Invalid paths ---
  test('rejects relative path', () => {
    const result = zFilePath.safeParse('relative/path.txt');
    expect(result.success).toBe(false);
  });

  test('rejects empty string', () => {
    const result = zFilePath.safeParse('');
    expect(result.success).toBe(false);
  });

  test('rejects ~other (other user home)', () => {
    const result = zFilePath.safeParse('~other/file.txt');
    expect(result.success).toBe(false);
  });

  test('rejects path traversal at start', () => {
    const result = zFilePath.safeParse('../etc/passwd');
    expect(result.success).toBe(false);
  });

  test('rejects path traversal in middle', () => {
    const result = zFilePath.safeParse('/Users/ren/../../etc/passwd');
    expect(result.success).toBe(false);
  });

  test('rejects path traversal at end', () => {
    const result = zFilePath.safeParse('/Users/ren/..');
    expect(result.success).toBe(false);
  });

  test('rejects tilde with traversal', () => {
    const result = zFilePath.safeParse('~/../../etc/passwd');
    expect(result.success).toBe(false);
  });

  test('rejects bare double-dot', () => {
    const result = zFilePath.safeParse('..');
    expect(result.success).toBe(false);
  });

  // --- Tilde resolution ---
  test('tilde resolves to process HOME', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const result = zFilePath.safeParse('~/test.txt');
    expect(result.success).toBe(true);
    expect(result.data).toBe(`${home}/test.txt`);
  });

  // --- describe() chaining ---
  test('supports .describe() chaining', () => {
    const schema = zFilePath.describe('Test path');
    const result = schema.safeParse('/tmp/test');
    expect(result.success).toBe(true);
  });
});
