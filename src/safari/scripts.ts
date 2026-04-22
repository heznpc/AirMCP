// JXA scripts for Apple Safari automation.

import { esc } from "../shared/esc.js";

export function listTabsScript(): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    const result = [];
    for (let w = 0; w < wins.length; w++) {
      const tabs = wins[w].tabs();
      for (let t = 0; t < tabs.length; t++) {
        result.push({
          windowIndex: w,
          tabIndex: t,
          title: tabs[t].name(),
          url: tabs[t].url()
        });
      }
    }
    JSON.stringify(result);
  `;
}

export function readPageContentScript(windowIndex: number, tabIndex: number, maxLength: number): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    if (${windowIndex} >= wins.length) throw new Error('Window index out of range');
    const tabs = wins[${windowIndex}].tabs();
    if (${tabIndex} >= tabs.length) throw new Error('Tab index out of range');
    const tab = tabs[${tabIndex}];
    const source = tab.source() || '';
    const truncated = source.slice(0, ${maxLength});
    JSON.stringify({
      title: tab.name(),
      url: tab.url(),
      content: truncated,
      truncated: source.length > ${maxLength}
    });
  `;
}

export function getCurrentTabScript(): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    if (wins.length === 0) throw new Error('No Safari windows open');
    const tab = wins[0].currentTab();
    JSON.stringify({
      title: tab.name(),
      url: tab.url()
    });
  `;
}

export function openUrlScript(url: string): string {
  // openLocation removed in macOS 26; create a new tab/document instead
  return `
    const Safari = Application('Safari');
    Safari.activate();
    const u = '${esc(url)}';
    const wins = Safari.windows();
    if (wins.length > 0) {
      const tab = Safari.Tab({url: u});
      wins[0].tabs.push(tab);
    } else {
      const doc = Safari.Document({url: u});
      Safari.documents.push(doc);
    }
    JSON.stringify({opened: true, url: u});
  `;
}

export function closeTabScript(windowIndex: number, tabIndex: number): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    if (${windowIndex} >= wins.length) throw new Error('Window index out of range');
    const tabs = wins[${windowIndex}].tabs();
    if (${tabIndex} >= tabs.length) throw new Error('Tab index out of range');
    const name = tabs[${tabIndex}].name();
    tabs[${tabIndex}].close();
    JSON.stringify({closed: true, title: name});
  `;
}

export function activateTabScript(windowIndex: number, tabIndex: number): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    if (${windowIndex} >= wins.length) throw new Error('Window index out of range');
    const tabs = wins[${windowIndex}].tabs();
    if (${tabIndex} >= tabs.length) throw new Error('Tab index out of range');
    wins[${windowIndex}].currentTab = tabs[${tabIndex}];
    Safari.activate();
    JSON.stringify({activated: true, title: tabs[${tabIndex}].name(), url: tabs[${tabIndex}].url()});
  `;
}

/** URL schemes where JavaScript execution is blocked for security. */
const BLOCKED_URL_SCHEMES = [
  "file:",
  "about:",
  "safari-extension:",
  "safari-web-extension:",
  "blob:",
  "javascript:",
  "data:",
];
const BLOCKED_URL_SCHEMES_JSON = JSON.stringify(BLOCKED_URL_SCHEMES);

export function runJavascriptScript(code: string, windowIndex: number, tabIndex: number): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    if (${windowIndex} >= wins.length) throw new Error('Window index out of range');
    const tabs = wins[${windowIndex}].tabs();
    if (${tabIndex} >= tabs.length) throw new Error('Tab index out of range');
    const tabUrl = (tabs[${tabIndex}].url() || '').toLowerCase();
    const blocked = ${BLOCKED_URL_SCHEMES_JSON};
    for (const scheme of blocked) {
      if (tabUrl.startsWith(scheme)) {
        throw new Error('JavaScript execution blocked on ' + scheme + '// URLs for security');
      }
    }
    const result = Safari.doJavaScript('${esc(code)}', {in: tabs[${tabIndex}]});
    JSON.stringify({result: String(result || '')});
  `;
}

export function searchTabsScript(query: string): string {
  return `
    const Safari = Application('Safari');
    const wins = Safari.windows();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    for (let w = 0; w < wins.length; w++) {
      const tabs = wins[w].tabs();
      for (let t = 0; t < tabs.length; t++) {
        const title = tabs[t].name() || '';
        const url = tabs[t].url() || '';
        if (title.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
          result.push({
            windowIndex: w,
            tabIndex: t,
            title: title,
            url: url
          });
        }
      }
    }
    JSON.stringify({returned: result.length, tabs: result});
  `;
}

/**
 * List Safari bookmarks.
 *
 * macOS 26+ removed bookmarkFolder/bookmarkItem from Safari's scripting
 * dictionary, so the JXA approach no longer works.  We now read
 * ~/Library/Safari/Bookmarks.plist directly via `plutil -convert json`.
 * This requires Full Disk Access on macOS 14+.
 *
 * Falls back to the legacy JXA approach on older macOS.
 */
export function listBookmarksScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const home = app.systemAttribute('HOME');
    const plistPath = home + '/Library/Safari/Bookmarks.plist';

    let raw;
    try {
      raw = app.doShellScript('plutil -convert json -o - ' + JSON.stringify(plistPath));
    } catch (e) {
      // plutil failed — try legacy JXA (macOS ≤ 15)
      try {
        const Safari = Application('Safari');
        const folders = Safari.bookmarkFolders();
        const result = [];
        function collect(folder, path) {
          const items = folder.bookmarkItems();
          for (let i = 0; i < items.length; i++) {
            try {
              result.push({ title: items[i].name(), url: items[i].url(), folder: path });
            } catch (_) {}
          }
          const subs = folder.bookmarkFolders();
          for (let s = 0; s < subs.length; s++) {
            collect(subs[s], path + '/' + subs[s].name());
          }
        }
        for (let f = 0; f < folders.length; f++) {
          collect(folders[f], folders[f].name());
        }
        return JSON.stringify({ count: result.length, bookmarks: result });
      } catch (_) {
        throw new Error('Cannot read bookmarks. On macOS 26+ grant Full Disk Access to your terminal, or on older macOS grant Safari automation permission.');
      }
    }

    const plist = JSON.parse(raw);
    const result = [];
    function walk(node, path) {
      if (!node) return;
      const children = node.Children;
      if (!children) return;
      for (const child of children) {
        if (child.WebBookmarkType === 'WebBookmarkTypeLeaf') {
          result.push({
            title: child.URIDictionary && child.URIDictionary.title || child.Title || '',
            url: child.URLString || '',
            folder: path,
          });
        } else if (child.WebBookmarkType === 'WebBookmarkTypeList') {
          const name = child.Title || '';
          if (name !== 'com.apple.ReadingList') {
            walk(child, path ? path + '/' + name : name);
          }
        }
      }
    }
    walk(plist, '');
    JSON.stringify({ count: result.length, bookmarks: result });
  `;
}

/**
 * Add a bookmark to Safari.
 *
 * macOS 26 removed bookmark scripting from Safari's sdef.
 * We fall back to opening the URL and showing an instructional message.
 */
export function addBookmarkScript(url: string, title: string, folder?: string): string {
  return `
    const Safari = Application('Safari');
    // Try legacy JXA first (macOS ≤ 15)
    try {
      const folders = Safari.bookmarkFolders();
      ${
        folder
          ? `
      let target = null;
      const wanted = '${esc(folder)}';
      for (let f = 0; f < folders.length; f++) {
        if (folders[f].name() === wanted) { target = folders[f]; break; }
      }
      if (!target) throw new Error('Bookmark folder not found: ' + wanted);
      `
          : `
      let target = null;
      for (let f = 0; f < folders.length; f++) {
        if (folders[f].name() === 'BookmarksBar' || folders[f].name() === 'Favorites') {
          target = folders[f]; break;
        }
      }
      if (!target) target = folders[0];
      `
      }
      const bm = Safari.BookmarkItem({ url: '${esc(url)}', name: '${esc(title)}' });
      target.bookmarkItems.push(bm);
      JSON.stringify({ added: true, title: '${esc(title)}', url: '${esc(url)}', folder: target.name() });
    } catch (e) {
      // macOS 26+: bookmark scripting removed from Safari
      throw new Error('add_bookmark is not supported on macOS 26+. Safari removed bookmark scripting. Use add_to_reading_list instead, or add bookmarks manually.');
    }
  `;
}

/**
 * List Safari Reading List items.
 *
 * macOS 26+ removed bookmarkFolder from Safari's sdef.
 * We read ~/Library/Safari/Bookmarks.plist and extract the
 * com.apple.ReadingList subtree. Falls back to legacy JXA on older macOS.
 */
export function listReadingListScript(): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const home = app.systemAttribute('HOME');
    const plistPath = home + '/Library/Safari/Bookmarks.plist';

    let raw;
    try {
      raw = app.doShellScript('plutil -convert json -o - ' + JSON.stringify(plistPath));
    } catch (e) {
      // plutil failed — try legacy JXA (macOS ≤ 15)
      try {
        const Safari = Application('Safari');
        const folders = Safari.bookmarkFolders();
        let rl = null;
        for (let f = 0; f < folders.length; f++) {
          if (folders[f].name() === 'com.apple.ReadingList') { rl = folders[f]; break; }
        }
        if (!rl) throw new Error('Reading List folder not found');
        const items = rl.bookmarkItems();
        const result = [];
        for (let i = 0; i < items.length; i++) {
          try { result.push({ title: items[i].name(), url: items[i].url() }); } catch (_) {}
        }
        return JSON.stringify({ count: result.length, items: result });
      } catch (_) {
        throw new Error('Cannot read Reading List. On macOS 26+ grant Full Disk Access to your terminal.');
      }
    }

    const plist = JSON.parse(raw);
    const result = [];
    function findRL(node) {
      if (!node || !node.Children) return null;
      for (const child of node.Children) {
        if (child.Title === 'com.apple.ReadingList') return child;
      }
      return null;
    }
    const rl = findRL(plist);
    if (rl && rl.Children) {
      for (const item of rl.Children) {
        if (item.WebBookmarkType === 'WebBookmarkTypeLeaf') {
          result.push({
            title: item.URIDictionary && item.URIDictionary.title || item.Title || '',
            url: item.URLString || '',
          });
        }
      }
    }
    JSON.stringify({ count: result.length, items: result });
  `;
}

export function addToReadingListScript(url: string, title?: string): string {
  const titleArg = title ? `'${esc(title)}'` : "null";
  return `
    const Safari = Application('Safari');
    Safari.activate();
    Safari.addReadingListItem('${esc(url)}', { withTitle: ${titleArg} });
    JSON.stringify({ added: true, url: '${esc(url)}', title: ${titleArg} || '${esc(url)}' });
  `;
}
