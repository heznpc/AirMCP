import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const services = readFileSync(
  new URL('../app/Sources/AirMCPApp/ServicesProvider.swift', import.meta.url),
  'utf8',
);
const intents = readFileSync(
  new URL('../app/Sources/AirMCPApp/AppIntents.swift', import.meta.url),
  'utf8',
);

describe('macOS Services governance boundary', () => {
  test('all Services call the shared governed runtime client', () => {
    expect(intents).toContain('enum AppRuntimeClient');
    expect(services).toContain('AppRuntimeClient.callTool(tool, args: arguments)');
    expect(services).toContain('"create_note"');
    expect(services).toContain('"create_reminder"');
    expect(services).toContain('"semantic_search"');
  });

  test('Services do not bypass the runtime or emit an unconsumed clipboard sentinel', () => {
    expect(services).not.toContain('NSAppleScript');
    expect(services).not.toContain('tell application');
    expect(services).not.toContain('airmcp-search:');
  });
});
