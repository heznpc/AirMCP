/**
 * Keynote JXA generator suite — injection focused.
 *
 * Keynote's untrusted surface is the document name, the presenter notes body,
 * and the export path. Slide numbers are numeric and are interpolated raw in
 * three places (array index, throw message, echoed result), so the assertions
 * below pin them as bare numeric literals — a string-typed slide param would
 * become an injection point in the throw message, which sits inside a
 * single-quoted JXA string.
 *
 * No Keynote process is launched; only the generated source string is inspected.
 */
import { describe, test, expect } from '@jest/globals';
import {
  listDocumentsScript,
  createDocumentScript,
  listSlidesScript,
  getSlideScript,
  addSlideScript,
  setPresenterNotesScript,
  exportPdfScript,
  startSlideshowScript,
  closeDocumentScript,
} from '../dist/keynote/scripts.js';

// A single-quote terminator followed by a statement. The prefix is a sentinel
// that cannot collide with any document name used in these tests — using "Deck"
// here would trip on the benign `Document not found: Deck');` line instead of on
// a real escaping failure.
const BREAKOUT = "INJECT'); Application('Finder').trash(); ('";

describe('keynote script generators — normal path', () => {
  test('listDocumentsScript targets the stable bundle id', () => {
    expect(listDocumentsScript()).toContain("Application('com.apple.Keynote')");
  });

  test('createDocumentScript pushes a new document', () => {
    const script = createDocumentScript();
    expect(script).toContain('Document()');
    expect(script).toContain('documents.push');
  });

  test('listSlidesScript reads title and body defensively', () => {
    const script = listSlidesScript('Kickoff');
    expect(script).toContain("documents.whose({name: 'Kickoff'})");
    // Title/body accessors throw on slides without those placeholders, so each
    // is wrapped and degrades to null rather than failing the whole listing.
    expect(script).toContain('defaultTitleItem()');
    expect(script).toContain('defaultBodyItem()');
    expect(script).toContain('catch(e) { return null; }');
    expect(script).toContain('presenterNotes()');
  });

  test('addSlideScript returns the resulting slide count', () => {
    const script = addSlideScript('Kickoff');
    expect(script).toContain('Keynote.Slide()');
    expect(script).toContain('slides.push(slide)');
    expect(script).toContain('slideNumber: total');
  });

  test('closeDocumentScript maps saving to a yes/no literal', () => {
    expect(closeDocumentScript('Kickoff', true)).toContain("saving: 'yes'");
    expect(closeDocumentScript('Kickoff', false)).toContain("saving: 'no'");
  });

  test('exportPdfScript exports to the given path as PDF', () => {
    const script = exportPdfScript('Kickoff', '/tmp/deck.pdf');
    expect(script).toContain("Path('/tmp/deck.pdf')");
    expect(script).toContain("as: 'PDF'");
  });
});

describe('keynote slide numbers stay numeric literals', () => {
  test('getSlideScript converts to a zero-based index and echoes the 1-based number', () => {
    const script = getSlideScript('Kickoff', 3);
    expect(script).toContain('docs[0].slides[2]');
    expect(script).toContain('number: 3');
    expect(script).toContain("throw new Error('Slide 3 not found')");
    // The throw message sits inside a single-quoted JXA literal, so a quoted
    // slide number here would mean a string param had slipped through.
    expect(script).not.toContain("slides['2']");
  });

  test('setPresenterNotesScript indexes and echoes the same slide', () => {
    const script = setPresenterNotesScript('Kickoff', 5, 'talk track');
    expect(script).toContain('docs[0].slides[4]');
    expect(script).toContain("slide.presenterNotes = 'talk track'");
    expect(script).toContain('slideNumber: 5');
  });

  test('startSlideshowScript starts from a zero-based index', () => {
    const script = startSlideshowScript('Kickoff', 2);
    expect(script).toContain('from: docs[0].slides[1]');
    expect(script).toContain('fromSlide: 2');
  });
});

describe('keynote esc() injection prevention', () => {
  test.each([
    ['document name', (v) => listSlidesScript(v)],
    ['get-slide document name', (v) => getSlideScript(v, 1)],
    ['presenter-notes document name', (v) => setPresenterNotesScript(v, 1, 'notes')],
    ['presenter notes body', (v) => setPresenterNotesScript('Deck', 1, v)],
    ['slideshow document name', (v) => startSlideshowScript(v, 1)],
    ['export path', (v) => exportPdfScript('Deck', v)],
    ['close document name', (v) => closeDocumentScript(v, false)],
  ])('%s cannot terminate its JXA literal', (_label, build) => {
    const script = build(BREAKOUT);
    expect(script).not.toContain("INJECT');");
    expect(script).toContain("INJECT\\');");
  });

  test('a hostile name is escaped in the filter and the throw message', () => {
    const script = listSlidesScript("O'Brien");
    expect(script).toContain("whose({name: 'O\\'Brien'})");
    expect(script).toContain("Document not found: O\\'Brien");
    expect(script).not.toMatch(/name: 'O'Brien'/);
  });

  test('presenter notes keep newlines as escapes', () => {
    // Notes are the one genuinely multi-line input here, so a raw newline would
    // terminate the JXA literal on the first line break.
    const script = setPresenterNotesScript('Deck', 1, 'point one\npoint two');
    expect(script).toContain('point one\\npoint two');
    expect(script).not.toContain('point one\npoint two');
  });

  test('backslashes are doubled before quote escaping', () => {
    const script = setPresenterNotesScript('Deck', 1, 'C:\\notes\\');
    expect(script).toContain("'C:\\\\notes\\\\'");
  });

  test('NUL and control characters are stripped from notes', () => {
    expect(setPresenterNotesScript('Deck', 1, 'a\u0000b\u0007c')).toContain("'abc'");
  });

  test('U+2028 / U+2029 in notes are escaped', () => {
    const script = setPresenterNotesScript('Deck', 1, 'a\u2028b\u2029c');
    expect(script).toContain('a\\u2028b\\u2029c');
  });
});
