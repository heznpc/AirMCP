/**
 * Pages JXA generator suite — injection focused.
 *
 * Pages interpolates a document name, body text, and an export path into
 * single-quoted JXA literals. `esc()` is the only thing standing between a
 * hostile document title and executable JXA, so these assertions check the
 * escaped form rather than merely that the value appears somewhere: an
 * assertion like `toContain(hostileInput)` would pass even if the quote broke
 * out of its literal.
 *
 * No Pages process is launched; only the generated source string is inspected.
 */
import { describe, test, expect } from '@jest/globals';
import {
  listDocumentsScript,
  openDocumentScript,
  createDocumentScript,
  getBodyTextScript,
  setBodyTextScript,
  exportPdfScript,
  closeDocumentScript,
} from '../dist/pages/scripts.js';

// A single-quote terminator followed by a statement is the payload that matters:
// if it survives unescaped, everything after it is evaluated as JXA. The prefix
// is a sentinel that cannot collide with a document name used in these tests —
// reusing a real name would trip on a benign `not found: <name>');` line instead
// of on a genuine escaping failure.
const BREAKOUT = "INJECT'); Application('Finder').trash(); ('";

describe('pages script generators — normal path', () => {
  test('listDocumentsScript targets the stable bundle id', () => {
    const script = listDocumentsScript();
    // macOS 26 renamed the iWork apps, so the bundle id is the contract.
    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain('JSON.stringify');
  });

  test('createDocumentScript pushes a new document', () => {
    const script = createDocumentScript();
    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain('Document()');
    expect(script).toContain('documents.push');
  });

  test('getBodyTextScript looks the document up by name and caps the read', () => {
    const script = getBodyTextScript('Q3 Report');
    expect(script).toContain("documents.whose({name: 'Q3 Report'})");
    expect(script).toContain('bodyText()');
    expect(script).toContain('substring(0, 10000)');
  });

  test('setBodyTextScript assigns the escaped text', () => {
    const script = setBodyTextScript('Q3 Report', 'hello world');
    expect(script).toContain("docs[0].bodyText = 'hello world'");
  });

  test('openDocumentScript wraps the path in Path()', () => {
    const script = openDocumentScript('/Users/example/Docs/report.pages');
    expect(script).toContain("Path('/Users/example/Docs/report.pages')");
  });

  test('closeDocumentScript maps saving to a yes/no literal', () => {
    expect(closeDocumentScript('Q3 Report', true)).toContain("saving: 'yes'");
    expect(closeDocumentScript('Q3 Report', false)).toContain("saving: 'no'");
  });

  test('exportPdfScript exports to the given path as PDF', () => {
    const script = exportPdfScript('Q3 Report', '/tmp/out.pdf');
    expect(script).toContain("Path('/tmp/out.pdf')");
    expect(script).toContain("as: 'PDF'");
  });
});

describe('pages esc() injection prevention', () => {
  test.each([
    ['document name', (v) => getBodyTextScript(v)],
    ['body text', (v) => setBodyTextScript('Doc', v)],
    ['open path', (v) => openDocumentScript(v)],
    ['export document name', (v) => exportPdfScript(v, '/tmp/out.pdf')],
    ['export path', (v) => exportPdfScript('Doc', v)],
    ['close document name', (v) => closeDocumentScript(v, true)],
  ])('%s cannot terminate its JXA literal', (_label, build) => {
    const script = build(BREAKOUT);
    // The raw breakout sequence must never appear...
    expect(script).not.toContain("INJECT');");
    // ...and the quote must be carried through as an escaped quote instead.
    expect(script).toContain("INJECT\\');");
  });

  test('backslashes are doubled before quote escaping', () => {
    // A lone trailing backslash would otherwise escape the closing quote.
    const script = setBodyTextScript('Doc', 'C:\\path\\');
    expect(script).toContain("'C:\\\\path\\\\'");
  });

  test('newlines and tabs become escapes, not raw line breaks', () => {
    const script = setBodyTextScript('Doc', 'line1\nline2\tend\r');
    expect(script).toContain('line1\\nline2\\tend\\r');
    expect(script).not.toContain('line1\nline2');
  });

  test('NUL and control characters are stripped', () => {
    const script = setBodyTextScript('Doc', 'a\u0000b\u0007c');
    expect(script).toContain("'abc'");
  });

  test('U+2028 / U+2029 are escaped so they cannot break the line', () => {
    const script = setBodyTextScript('Doc', 'a\u2028b\u2029c');
    expect(script).toContain('a\\u2028b\\u2029c');
  });

  test('a hostile name is escaped in every place it is interpolated', () => {
    // iworkDocLookup emits the name twice: the whose() filter and the throw
    // message. Both have to be escaped, not just the first.
    const script = getBodyTextScript("O'Brien");
    expect(script).toContain("whose({name: 'O\\'Brien'})");
    expect(script).toContain("Document not found: O\\'Brien");
    expect(script).not.toMatch(/name: 'O'Brien'/);
  });
});
