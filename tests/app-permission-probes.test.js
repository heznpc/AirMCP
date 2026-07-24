import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../app/Sources/AirMCPApp/PermissionManager.swift', import.meta.url),
  'utf8',
);

describe('macOS permission probes', () => {
  test('perform a minimal application read instead of constructing an Application object', () => {
    expect(source).not.toContain("Application('Notes'); void 0");
    expect(source).toContain('a.folders().length');
    expect(source).toContain('a.lists().length');
    expect(source).toContain('a.calendars().length');
    expect(source).toContain('a.people().length');
    expect(source).toContain('a.applicationProcesses().length');
  });

  test('requires an explicit successful probe payload', () => {
    expect(source).toContain('output.contains("\\\"ok\\\":true")');
    expect(source).toContain('lastCheckedAt = Date()');
  });
});
