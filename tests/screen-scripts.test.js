import { join } from 'node:path';
import { Script } from 'node:vm';
import { describe, test, expect, jest } from '@jest/globals';
import { PATHS } from '../dist/shared/constants.js';
import {
  captureScreenScript,
  captureWindowScript,
  captureAreaScript,
  listWindowsScript,
  recordScreenScript,
} from '../dist/screen/scripts.js';

describe('screen script generators', () => {
  test.each([
    ['capture_screen', () => captureScreenScript()],
    ['capture_window', () => captureWindowScript()],
    ['capture_area', () => captureAreaScript(0, 0, 100, 100)],
    ['record_screen', () => recordScreenScript(1)],
  ])('%s preflights the responsible process Screen Recording grant', (_name, buildScript) => {
    const script = buildScript();
    expect(script).toContain("ObjC.bindFunction('CGPreflightScreenCaptureAccess'");
    expect(script).toContain('$.CGPreflightScreenCaptureAccess()');
    expect(script).toContain('Screen Recording permission denied for the app hosting AirMCP.');
    expect(script).not.toContain('CGRequestScreenCaptureAccess');
  });

  // --- captureScreenScript ---
  test('captureScreenScript generates screencapture command', () => {
    const script = captureScreenScript();
    expect(script).toContain('screencapture -x -t png');
    // Path is now derived from os.tmpdir() / PATHS.TEMP_DIR — match the filename only
    expect(script).toContain('airmcp-screenshot-');
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
    expect(script).toContain('airmcp-screenshot-');
    expect(script).toContain('JSON.stringify');
    expect(script).toContain('CGWindowListCopyWindowInfo');
    expect(script).toContain("ObjC.import('CoreGraphics')");
    expect(script).toContain('ObjC.castRefToObject');
    expect(script).toContain('ObjC.deepUnwrap');
    expect(script).not.toContain('python3');
    expect(script).not.toContain('import Quartz');
  });

  test('captureWindowScript activates app when appName given', () => {
    const script = captureWindowScript('Safari');
    expect(script).toContain("Application('Safari')");
    expect(script).toContain('activate()');
    expect(script).toContain("win.kCGWindowOwnerName !== 'Safari'");
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

  test('captureWindowScript fails closed when no target window is found', () => {
    const script = captureWindowScript('Finder');
    const shellCalls = [];
    const currentApp = {
      includeStandardAdditions: false,
      doShellScript: (command) => shellCalls.push(command),
    };
    const Application = () => ({ activate() {} });
    Application.currentApplication = () => currentApp;

    expect(() =>
      new Script(script).runInNewContext({
        Application,
        delay() {},
        ObjC: {
          import() {},
          bindFunction() {},
          castRefToObject: (value) => value,
          deepUnwrap: (value) => value,
        },
        $: {
          CGPreflightScreenCaptureAccess: () => true,
          CGWindowListCopyWindowInfo: () => [],
          kCGWindowListOptionOnScreenOnly: 1,
          kCGWindowListExcludeDesktopElements: 2,
        },
      }),
    ).toThrow('No capturable window found for the requested application.');
    expect(shellCalls).toEqual([]);
  });

  // --- captureAreaScript ---
  test('captureAreaScript uses -R flag with coordinates', () => {
    const script = captureAreaScript(100, 200, 300, 400);
    expect(script).toContain('-R 100,200,300,400');
    expect(script).toContain('screencapture -x -t png');
    expect(script).toContain('airmcp-screenshot-');
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

  test('escapes AIRMCP_TEMP_DIR across both JXA and shell string boundaries', () => {
    const originalTempDir = PATHS.TEMP_DIR;
    const maliciousTempDir = `/tmp/airmcp'); globalThis.jxaInjected = true; ('" ; $(id) ; \`id\` ; "$HOME`;
    PATHS.TEMP_DIR = maliciousTempDir;

    try {
      const scripts = [
        captureScreenScript(),
        captureWindowScript(),
        captureAreaScript(0, 0, 10, 10),
        recordScreenScript(1),
      ];

      for (const script of scripts) {
        const commands = [];
        const currentApp = {
          includeStandardAdditions: false,
          doShellScript: (command) => commands.push(command),
        };
        const Application = () => ({ activate() {} });
        Application.currentApplication = () => currentApp;
        const sandbox = {
          jxaInjected: false,
          Application,
          ObjC: {
            import() {},
            bindFunction() {},
            castRefToObject: (value) => value,
            deepUnwrap: (value) => value,
          },
          $: {
            CGPreflightScreenCaptureAccess: () => true,
            CGWindowListCopyWindowInfo: () => [
              { kCGWindowLayer: 0, kCGWindowOwnerName: 'Finder', kCGWindowNumber: 42 },
            ],
            kCGWindowListOptionOnScreenOnly: 1,
            kCGWindowListExcludeDesktopElements: 2,
          },
        };

        const result = new Script(script).runInNewContext(sandbox);
        const { path: returnedPath } = JSON.parse(result);
        const filename = returnedPath.split('/').at(-1);
        expect(returnedPath).toBe(join(maliciousTempDir, filename));
        expect(sandbox.jxaInjected).toBe(false);
        expect(commands).toHaveLength(1);

        const quotedArguments = shellDoubleQuotedArguments(commands[0]);
        expect(quotedArguments).toHaveLength(1);
        const encodedPath = quotedArguments[0];
        for (let i = 0; i < encodedPath.length; i++) {
          if (encodedPath[i] === '$' || encodedPath[i] === '`' || encodedPath[i] === '"') {
            expect(isShellEscaped(encodedPath, i)).toBe(true);
          }
        }
        expect(decodeShellDoubleQuoted(encodedPath)).toBe(returnedPath);
      }
    } finally {
      PATHS.TEMP_DIR = originalTempDir;
    }
  });
});

function isShellEscaped(value, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
}

function shellDoubleQuotedArguments(command) {
  const values = [];
  let start = -1;
  for (let i = 0; i < command.length; i++) {
    if (command[i] !== '"' || isShellEscaped(command, i)) continue;
    if (start < 0) {
      start = i + 1;
    } else {
      values.push(command.slice(start, i));
      start = -1;
    }
  }
  expect(start).toBe(-1);
  return values;
}

function decodeShellDoubleQuoted(value) {
  let decoded = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length && '$`"\\'.includes(value[i + 1])) {
      decoded += value[++i];
    } else {
      decoded += value[i];
    }
  }
  return decoded;
}

describe('screen temp path uniqueness', () => {
  test('same-millisecond parallel captures receive distinct paths', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(123456789);
    try {
      const scripts = [
        ...Array.from({ length: 8 }, () => captureScreenScript()),
        ...Array.from({ length: 8 }, () => captureWindowScript()),
        ...Array.from({ length: 8 }, () => captureAreaScript(0, 0, 10, 10)),
        ...Array.from({ length: 8 }, () => recordScreenScript(1)),
      ];
      const paths = scripts.map(
        (script) => script.match(/airmcp-(?:screenshot|recording)-\d+-[0-9a-f-]+\.(?:png|mov)/)?.[0],
      );
      expect(paths.every(Boolean)).toBe(true);
      expect(new Set(paths).size).toBe(paths.length);
    } finally {
      now.mockRestore();
    }
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
