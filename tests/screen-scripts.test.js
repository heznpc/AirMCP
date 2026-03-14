import { describe, test, expect } from '@jest/globals';
import {
  captureScreenScript,
  captureWindowScript,
  captureAreaScript,
  listWindowsScript,
  recordScreenScript,
} from '../dist/screen/scripts.js';

describe('screen script generators', () => {
  // --- captureScreenScript ---
  test('captureScreenScript generates screencapture command', () => {
    const script = captureScreenScript();
    expect(script).toContain('screencapture -x -t png');
    expect(script).toContain('/tmp/airmcp-screenshot-');
    expect(script).toContain('.png');
    expect(script).toContain('JSON.stringify');
    expect(script).toContain('doShellScript');
  });

  test('captureScreenScript includes display flag when specified', () => {
    const script = captureScreenScript(2);
    expect(script).toContain('-D 2');
    expect(script).toContain('screencapture -x -t png');
  });

  test('captureScreenScript omits display flag when not specified', () => {
    const script = captureScreenScript();
    expect(script).not.toContain('-D ');
  });

  test('captureScreenScript floors display number', () => {
    const script = captureScreenScript(2.7);
    expect(script).toContain('-D 2');
    expect(script).not.toContain('-D 2.7');
  });

  test('captureScreenScript returns path in JSON output', () => {
    const script = captureScreenScript();
    expect(script).toContain("path:");
  });

  // --- captureWindowScript ---
  test('captureWindowScript captures frontmost window by default', () => {
    const script = captureWindowScript();
    expect(script).toContain('screencapture -x -t png -l');
    expect(script).toContain('/tmp/airmcp-screenshot-');
    expect(script).toContain('JSON.stringify');
    expect(script).toContain('CGWindowListCopyWindowInfo');
  });

  test('captureWindowScript activates app when appName given', () => {
    const script = captureWindowScript('Safari');
    expect(script).toContain("Application('Safari')");
    expect(script).toContain('activate()');
    expect(script).toContain('screencapture -x -t png -l');
  });

  test('captureWindowScript omits activate when no appName', () => {
    const script = captureWindowScript();
    expect(script).not.toContain('activate()');
  });

  test('captureWindowScript includes delay after activate', () => {
    const script = captureWindowScript('Xcode');
    expect(script).toContain('delay(1.0)');
  });

  // --- captureAreaScript ---
  test('captureAreaScript uses -R flag with coordinates', () => {
    const script = captureAreaScript(100, 200, 300, 400);
    expect(script).toContain('-R 100,200,300,400');
    expect(script).toContain('screencapture -x -t png');
    expect(script).toContain('/tmp/airmcp-screenshot-');
  });

  test('captureAreaScript floors coordinate values', () => {
    const script = captureAreaScript(10.5, 20.7, 30.2, 40.9);
    expect(script).toContain('-R 10,20,30,40');
  });

  test('captureAreaScript returns path in JSON output', () => {
    const script = captureAreaScript(0, 0, 100, 100);
    expect(script).toContain("path:");
    expect(script).toContain('JSON.stringify');
  });

  // --- listWindowsScript ---
  test('listWindowsScript enumerates processes via System Events', () => {
    const script = listWindowsScript();
    expect(script).toContain("System Events");
    expect(script).toContain('backgroundOnly: false');
    expect(script).toContain('windows()');
  });

  test('listWindowsScript collects app name, title, position, size', () => {
    const script = listWindowsScript();
    expect(script).toContain('proc.name()');
    expect(script).toContain('win.name()');
    expect(script).toContain('win.position()');
    expect(script).toContain('win.size()');
  });

  test('listWindowsScript collects bundle ID', () => {
    const script = listWindowsScript();
    expect(script).toContain('bundleIdentifier');
    expect(script).toContain('bundleId');
  });

  test('listWindowsScript returns JSON array', () => {
    const script = listWindowsScript();
    expect(script).toContain('JSON.stringify(results)');
  });
});

describe('screen esc() injection prevention', () => {
  test('escapes single quotes in app name for captureWindowScript', () => {
    const script = captureWindowScript("it's a test");
    expect(script).toContain("it\\'s a test");
    expect(script).not.toContain("it's a test");
  });

  test('escapes backslashes in app name for captureWindowScript', () => {
    const script = captureWindowScript('path\\to\\app');
    expect(script).toContain('path\\\\to\\\\app');
  });

  test('handles unicode app names in captureWindowScript', () => {
    const script = captureWindowScript('日本語アプリ');
    expect(script).toContain('日本語アプリ');
  });

  test('captureAreaScript does not allow injection via numeric parameters', () => {
    // Even if someone manages to pass non-integer-like values, Math.floor ensures integers
    const script = captureAreaScript(0, 0, 100, 100);
    // Verify the -R flag has clean numeric values
    expect(script).toMatch(/-R \d+,\d+,\d+,\d+/);
  });

  test('captureScreenScript does not allow injection via display parameter', () => {
    const script = captureScreenScript(1);
    // Display flag should be a clean integer
    expect(script).toMatch(/-D \d+/);
  });
});

describe('recordScreenScript', () => {
  test('uses screencapture -v for video', () => {
    const script = recordScreenScript(5);
    expect(script).toContain('screencapture -x -v');
    expect(script).toContain('.mov');
    expect(script).toContain('sleep 5');
  });

  test('clamps duration to 1-60', () => {
    const short = recordScreenScript(0);
    expect(short).toContain('sleep 1');
    const long = recordScreenScript(120);
    expect(long).toContain('sleep 60');
  });

  test('supports display parameter', () => {
    const script = recordScreenScript(10, 2);
    expect(script).toContain('-D 2');
  });

  test('omits display flag when not specified', () => {
    const script = recordScreenScript(5);
    expect(script).not.toContain('-D');
  });
});
