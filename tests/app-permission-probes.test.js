import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../app/Sources/AirMCPApp/PermissionManager.swift', import.meta.url),
  'utf8',
);
const systemProbe = readFileSync(
  new URL('../app/Sources/AirMCPApp/SystemPermissionStatus.swift', import.meta.url),
  'utf8',
);
const trustView = readFileSync(
  new URL('../app/Sources/AirMCPApp/Views/TrustCenterView.swift', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../swift/Sources/AirMcpBridge/main.swift', import.meta.url),
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

describe('non-promptable system permission probes', () => {
  test('use read-only preflight checks that never enqueue a TCC prompt', () => {
    expect(systemProbe).toContain('CGPreflightScreenCaptureAccess()');
    expect(systemProbe).toContain('AXIsProcessTrusted()');
    // Full Disk Access has no API at all — proven by opening a TCC-protected file.
    expect(systemProbe).toContain('com.apple.TCC/TCC.db');
    // The request variants would show system UI from a background refresh.
    expect(systemProbe).not.toContain('CGRequestScreenCaptureAccess');
    expect(systemProbe).not.toContain('AXIsProcessTrustedWithOptions');
  });

  test('cover the three panes macOS cannot prompt for, with their settings anchors', () => {
    for (const anchor of ['Privacy_ScreenCapture', 'Privacy_Accessibility', 'Privacy_AllFiles']) {
      expect(systemProbe).toContain(anchor);
    }
    expect(systemProbe).toContain('x-apple.systempreferences:com.apple.preference.security');
  });

  test('Trust Center permissions tab shows the rows and an Open Settings deep link', () => {
    expect(trustView).toContain('SystemPermissionProbe.current()');
    expect(trustView).toContain('L("trust.systemPermissions")');
    expect(trustView).toContain('L("trust.openSettings")');
    expect(trustView).toContain('NSWorkspace.shared.open(url)');
    expect(trustView).toContain('L("trust.notGranted")');
  });

  test('Swift bridge keeps the native process probe for app-owned callers', () => {
    expect(bridge).toContain('case "permission-status":');
    expect(bridge).toContain('CGPreflightScreenCaptureAccess()');
    expect(bridge).toContain('AXIsProcessTrusted()');
    expect(bridge).toMatch(/"permission-status",\n/);
  });
});
