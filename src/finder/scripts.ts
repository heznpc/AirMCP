// JXA scripts for Finder automation (file search, tags, info).

import { esc, escJxaShell, safeInt } from "../shared/esc.js";

/** Reject paths with directory traversal sequences to prevent path traversal attacks. */
function assertSafePath(p: string): void {
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
    throw new Error('Path traversal ("..") is not allowed');
  }
}

// JXA-runtime helper: escape a dynamic value for doShellScript double-quoted args.
// Included in scripts that handle runtime-dynamic paths (e.g. mdfind/ls output).
const JXA_SHELL_ESC_FN = `function _esc(s){return s.replace(/\\\\/g,'\\\\\\\\').replace(/"/g,'\\\\"').replace(/\\$/g,'\\\\$').replace(/\\\`/g,'\\\\\\\`');}`;

export function searchFilesScript(folder: string, query: string, limit: number): string {
  assertSafePath(folder);
  const n = safeInt(limit);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ${JXA_SHELL_ESC_FN}
    const results = app.doShellScript('mdfind -onlyin "${escJxaShell(folder)}" "${escJxaShell(query)}" | head -${n}');
    const paths = results.split(/[\\r\\n]+/).filter(p => p.length > 0);
    const result = paths.map(p => {
      try {
        const stat = app.doShellScript('stat -f "%z %m" "' + _esc(p) + '"');
        const parts = stat.trim().split(/\\s+/);
        const size = parts[0] ? parseInt(parts[0], 10) : 0;
        const mtime = parts[1] ? parseInt(parts[1], 10) : 0;
        return {
          path: p, name: p.split('/').pop(),
          size: isNaN(size) ? 0 : size,
          modificationDate: isNaN(mtime) ? null : new Date(mtime * 1000).toISOString()
        };
      } catch(e) {
        return {path: p, name: p.split('/').pop()};
      }
    });
    JSON.stringify({total: paths.length, files: result});
  `;
}

export function getFileInfoScript(path: string): string {
  assertSafePath(path);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const Finder = Application('Finder');
    const posixFile = Path('${esc(path)}');
    const item = Finder.items[posixFile.toString()];
    const tags = (function() {
      try {
        const output = app.doShellScript('mdls -name kMDItemUserTags -raw "${escJxaShell(path)}"');
        if (output.includes('null')) return [];
        return output.replace(/[()\\n\\t]/g, '').split(',').map(t => t.trim().replace(/"/g, '')).filter(t => t);
      } catch(e) { return []; }
    })();
    JSON.stringify({
      path: '${esc(path)}',
      name: item.name(),
      kind: item.kind(),
      size: item.size(),
      creationDate: item.creationDate().toISOString(),
      modificationDate: item.modificationDate().toISOString(),
      tags: tags
    });
  `;
}

export function setTagsScript(path: string, tags: string[]): string {
  assertSafePath(path);
  const tagArgs = tags.map((t) => `'${esc(t)}'`).join(", ");
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ObjC.import('Foundation');
    const url = $.NSURL.fileURLWithPath('${esc(path)}');
    const tagArray = $.NSArray.arrayWithArray([${tagArgs}]);
    url.setResourceValueForKeyError(tagArray, 'NSURLTagNamesKey', null);
    JSON.stringify({path: '${esc(path)}', tags: [${tagArgs}]});
  `;
}

export function recentFilesScript(folder: string, days: number, limit: number): string {
  assertSafePath(folder);
  const d = safeInt(days);
  const n = safeInt(limit);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const dateStr = new Date(Date.now() - ${d} * 86400000).toISOString().split('T')[0];
    const results = app.doShellScript('mdfind -onlyin "${escJxaShell(folder)}" "kMDItemContentModificationDate >= $time.iso(' + dateStr + ')" | head -${n}');
    const paths = results.split(/[\\r\\n]+/).filter(p => p.length > 0);
    const result = paths.map(p => ({path: p, name: p.split('/').pop()}));
    JSON.stringify({total: paths.length, files: result});
  `;
}

export function listDirectoryScript(path: string, limit: number): string {
  assertSafePath(path);
  const n = safeInt(limit);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ${JXA_SHELL_ESC_FN}
    const output = app.doShellScript('ls -1 "${escJxaShell(path)}" | head -${n}');
    const fileNames = output.split(/[\\r\\n]+/).filter(n => n.length > 0);
    const result = fileNames.map(name => {
      try {
        const fullPath = '${esc(path)}' + '/' + name;
        const stat = app.doShellScript('stat -f "%z %m %HT" "' + _esc(fullPath) + '"');
        const parts = stat.split(' ');
        const size = parseInt(parts[0], 10);
        const mtime = parseInt(parts[1], 10);
        const kind = parts.slice(2).join(' ') || 'unknown';
        return {
          name: name, kind: kind, size: size,
          modificationDate: new Date(mtime * 1000).toISOString()
        };
      } catch(e) {
        return {name: name, kind: 'unknown'};
      }
    });
    JSON.stringify({total: fileNames.length, returned: result.length, items: result});
  `;
}

export function moveFileScript(source: string, destination: string): string {
  assertSafePath(source);
  assertSafePath(destination);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('mv "${escJxaShell(source)}" "${escJxaShell(destination)}"');
    JSON.stringify({moved: true, source: '${esc(source)}', destination: '${esc(destination)}'});
  `;
}

export function trashFileScript(path: string): string {
  assertSafePath(path);
  return `
    const Finder = Application('Finder');
    const posixFile = Path('${esc(path)}');
    const item = Finder.items[posixFile.toString()];
    const name = item.name();
    Finder.delete(item);
    JSON.stringify({trashed: true, name: name, path: '${esc(path)}'});
  `;
}

export function createFolderScript(path: string): string {
  assertSafePath(path);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('mkdir -p "${escJxaShell(path)}"');
    JSON.stringify({created: true, path: '${esc(path)}'});
  `;
}
