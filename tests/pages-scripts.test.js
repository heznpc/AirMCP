import { describe, test, expect } from '@jest/globals';
import {
  listDocumentsScript,
  createDocumentScript,
  getBodyTextScript,
  setBodyTextScript,
  exportPdfScript,
  closeDocumentScript,
} from '../dist/pages/scripts.js';

describe('pages script generators', () => {
  test('listDocumentsScript returns valid JXA', () => {
    const script = listDocumentsScript();

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain('Pages.documents()');
    expect(script).toContain('JSON.stringify');
  });

  test('createDocumentScript returns valid JXA', () => {
    const script = createDocumentScript();

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain('Pages.activate()');
    expect(script).toContain('Pages.Document()');
    expect(script).toContain('Pages.documents.push(doc)');
    expect(script).toContain('JSON.stringify');
  });

  test('getBodyTextScript looks up document by name', () => {
    const script = getBodyTextScript('My Document');

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain("whose({name: 'My Document'})");
    expect(script).toContain('bodyText()');
    expect(script).toContain('substring(0, 10000)');
  });

  test('setBodyTextScript updates document body text', () => {
    const script = setBodyTextScript('My Document', 'Hello world');

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain("whose({name: 'My Document'})");
    expect(script).toContain("docs[0].bodyText = 'Hello world'");
    expect(script).toContain('updated: true');
  });

  test('exportPdfScript exports document to PDF', () => {
    const script = exportPdfScript('My Document', '/tmp/output.pdf');

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain("whose({name: 'My Document'})");
    expect(script).toContain("Path('/tmp/output.pdf')");
    expect(script).toContain("as: 'PDF'");
    expect(script).toContain('exported: true');
  });

  test('closeDocumentScript closes document with saving', () => {
    const script = closeDocumentScript('My Document', true);

    expect(script).toContain("Application('com.apple.Pages')");
    expect(script).toContain("whose({name: 'My Document'})");
    expect(script).toContain("saving: 'yes'");
    expect(script).toContain('closed: true');
  });

  test('closeDocumentScript closes document without saving', () => {
    const script = closeDocumentScript('My Document', false);

    expect(script).toContain("saving: 'no'");
  });
});

describe('pages esc() injection prevention', () => {
  test('escapes single quotes in document name', () => {
    const script = getBodyTextScript("it's mine");

    expect(script).toContain("it\\'s mine");
    expect(script).not.toContain("it's mine");
  });

  test('escapes single quotes in body text', () => {
    const script = setBodyTextScript('Doc', "it's a test");

    expect(script).toContain("it\\'s a test");
    expect(script).not.toContain("it's a test");
  });

  test('escapes backslashes in body text', () => {
    const script = setBodyTextScript('Doc', 'path\\file');

    expect(script).toContain('path\\\\file');
  });

  test('escapes newlines in body text', () => {
    const script = setBodyTextScript('Doc', 'line1\nline2');

    expect(script).toContain('line1\\nline2');
  });

  test('handles unicode body text', () => {
    const script = setBodyTextScript('Doc', 'مرحبا 世界 🚀');

    expect(script).toContain('مرحبا 世界 🚀');
  });
});