import { describe, test, expect } from '@jest/globals';
import {
  listTabsScript,
  readPageContentScript,
  getCurrentTabScript,
  openUrlScript,
  runJavascriptScript,
} from '../dist/safari/scripts.js';

describe('safari script generators', () => {
  test('listTabsScript accesses Safari windows and tabs', () => {
    const script = listTabsScript();
    expect(script).toContain("Application('Safari')");
    expect(script).toContain('windows()');
    expect(script).toContain('tabs()');
    expect(script).toContain('.name()');
    expect(script).toContain('.url()');
  });

  test('readPageContentScript reads source with bounds check', () => {
    const script = readPageContentScript(0, 2, 5000);
    expect(script).toContain("Application('Safari')");
    expect(script).toContain('tabs[2]');
    expect(script).toContain('source()');
    expect(script).toContain('5000');
  });

  test('getCurrentTabScript reads frontmost tab', () => {
    const script = getCurrentTabScript();
    expect(script).toContain('currentTab()');
    expect(script).toContain('tab.name()');
    expect(script).toContain('tab.url()');
  });

  test('openUrlScript sets document URL', () => {
    const script = openUrlScript('https://example.com');
    expect(script).toContain('https://example.com');
    expect(script).toContain('Safari.Tab');
    expect(script).toContain('activate()');
  });
});

describe('safari esc() injection prevention', () => {
  test('escapes single quotes in URL', () => {
    const script = openUrlScript("https://example.com/it's-a-page");
    expect(script).toContain("it\\'s-a-page");
  });
});

describe('runJavascriptScript', () => {
  test('generates valid Safari JavaScript execution script', () => {
    const script = runJavascriptScript('document.title', 0, 0);
    expect(script).toContain("Application('Safari')");
    expect(script).toContain('doJavaScript');
    expect(script).toContain('document.title');
  });

  test('uses correct window and tab indices', () => {
    const script = runJavascriptScript('1+1', 2, 3);
    expect(script).toContain('wins[2]');
    expect(script).toContain('tabs[3]');
  });

  test('includes bounds checking for window index', () => {
    const script = runJavascriptScript('1+1', 0, 0);
    expect(script).toContain('>= wins.length');
    expect(script).toContain("throw new Error('Window index out of range')");
  });

  test('includes bounds checking for tab index', () => {
    const script = runJavascriptScript('1+1', 0, 0);
    expect(script).toContain('>= tabs.length');
    expect(script).toContain("throw new Error('Tab index out of range')");
  });

  test('escapes single quotes in code to prevent JXA injection', () => {
    const script = runJavascriptScript("alert('xss')", 0, 0);
    expect(script).toContain("alert(\\'xss\\')");
    expect(script).not.toContain("alert('xss')");
  });

  test('escapes backslashes in code', () => {
    const script = runJavascriptScript('a\\b', 0, 0);
    expect(script).not.toMatch(/[^\\]\\[^\\'"]/); // no unescaped backslash
  });

  // ── URL scheme blocking (security hardening) ────────────────────

  test.each(['file:', 'about:', 'safari-extension:', 'safari-web-extension:', 'blob:', 'javascript:', 'data:'])(
    'blocks execution on %s URLs',
    (scheme) => {
      const script = runJavascriptScript('1+1', 0, 0);
      expect(script).toContain(scheme);
      expect(script).toContain('JavaScript execution blocked');
    },
  );

  test('URL check reads tab URL before executing code', () => {
    const script = runJavascriptScript('1+1', 0, 0);
    const urlCheckIdx = script.indexOf('tabUrl');
    const execIdx = script.indexOf('doJavaScript');
    expect(urlCheckIdx).toBeLessThan(execIdx);
    expect(urlCheckIdx).toBeGreaterThan(-1);
  });
});
