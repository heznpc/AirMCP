import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const updateManager = readFileSync(
  new URL('../app/Sources/AirMCPApp/UpdateManager.swift', import.meta.url),
  'utf8',
);

describe('self-contained app update boundary', () => {
  test('only offers a version when the matching signed app archive exists', () => {
    expect(updateManager).toContain('fetchLatestSignedAppRelease()');
    expect(updateManager).toContain('let expectedAsset = "AirMCP-\\(version).zip"');
    expect(updateManager).toContain('release.assets.contains');
  });

  test('does not claim that a global npm install updates the signed app', () => {
    expect(updateManager).not.toContain('npm install');
    expect(updateManager).not.toContain('runNpmInstall');
    expect(updateManager).toContain('NSWorkspace.shared.open(releasePageURL)');
  });
});
