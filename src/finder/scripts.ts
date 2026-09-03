// JXA scripts for Finder automation (file search, tags, info).

import { esc, escJxaShell, safeInt } from "../shared/esc.js";

// The interfaces below pin the shape of each script's final
// `JSON.stringify(...)`, and the `*_EXAMPLE` constants carry a concrete
// instance of it. `tests/script-shape-contract.test.js` parses every example
// through the matching tool's real `outputSchema`, so changing what a script
// emits without updating the example (and the outputSchema) fails a test rather
// than passing the tautological mock-in-mock-out runtime check. Examples and
// scripts must be kept in lockstep by hand.
//
// Finder rows are shelling out to `stat`, and both `search_files` and
// `list_directory` fall back to a REDUCED row when that call throws — the
// optional fields below are that fallback, not decoration, so each example
// pins both branches.

// ── Return shapes ───────────────────────────────────────────────────────
export interface FinderSearchFileItem {
  path: string;
  name: string;
  /** Absent when the `stat` call for this row threw. */
  size?: number;
  /** Absent on the `stat` fallback; null when the mtime did not parse. */
  modificationDate?: string | null;
}

export interface FinderSearchFilesOutput {
  total: number;
  files: FinderSearchFileItem[];
}

export interface FinderFileInfoOutput {
  path: string;
  name: string;
  kind: string;
  size: number;
  creationDate: string;
  modificationDate: string;
  tags: string[];
}

export interface FinderRecentFileItem {
  path: string;
  name: string;
}

export interface FinderRecentFilesOutput {
  total: number;
  files: FinderRecentFileItem[];
}

export interface FinderDirectoryItem {
  name: string;
  kind: string;
  /** Both absent on the `stat` fallback, which reports `kind: 'unknown'`. */
  size?: number;
  modificationDate?: string;
}

export interface FinderListDirectoryOutput {
  total: number;
  returned: number;
  items: FinderDirectoryItem[];
}

// ── Example fixtures (hand-maintained; see tests/script-shape-contract) ──
export const SEARCH_FILES_EXAMPLE: FinderSearchFilesOutput = {
  total: 3,
  files: [
    {
      path: "/Users/example/Documents/report.pdf",
      name: "report.pdf",
      size: 20480,
      modificationDate: "2026-03-15T09:00:00.000Z",
    },
    // `stat` returned an unparseable mtime.
    { path: "/Users/example/Documents/draft.md", name: "draft.md", size: 0, modificationDate: null },
    // `stat` threw — the reduced fallback row.
    { path: "/Users/example/Documents/locked.key", name: "locked.key" },
  ],
};

export const GET_FILE_INFO_EXAMPLE: FinderFileInfoOutput = {
  path: "/Users/example/Documents/report.pdf",
  name: "report.pdf",
  kind: "PDF document",
  size: 20480,
  creationDate: "2026-03-01T08:00:00.000Z",
  modificationDate: "2026-03-15T09:00:00.000Z",
  tags: ["Work", "Important"],
};

export const RECENT_FILES_EXAMPLE: FinderRecentFilesOutput = {
  total: 2,
  files: [
    { path: "/Users/example/Documents/report.pdf", name: "report.pdf" },
    { path: "/Users/example/Downloads/invoice.pdf", name: "invoice.pdf" },
  ],
};

export const LIST_DIRECTORY_EXAMPLE: FinderListDirectoryOutput = {
  total: 2,
  returned: 2,
  items: [
    { name: "report.pdf", kind: "PDF document", size: 20480, modificationDate: "2026-03-15T09:00:00.000Z" },
    // `stat` threw — the reduced fallback row.
    { name: "Projects", kind: "unknown" },
  ],
};

/** Reject paths with directory traversal sequences to prevent path traversal attacks. */
function assertSafePath(p: string): void {
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
    throw new Error('Path traversal ("..") is not allowed');
  }
}

// JXA-runtime helper: escape a dynamic value for doShellScript double-quoted args.
// Included in scripts that handle runtime-dynamic paths (e.g. mdfind/ls output).
const JXA_SHELL_ESC_FN = `function _esc(s){return s.replace(/\\\\/g,'\\\\\\\\').replace(/"/g,'\\\\"').replace(/\\$/g,'\\\\$').replace(/\\\`/g,'\\\\\\\`');}`;

// Run the producer to completion before limiting its output. A direct
// `producer | head` reports head's status instead of the producer's, while
// pipefail makes a healthy producer look failed when head closes the pipe.
// The temporary file preserves both the producer status and the output cap.
// Check the directory explicitly because mdfind reports rc 0 + no output for a
// missing `-onlyin` path, which is indistinguishable from a real empty result.
function checkedLimitShellPrefix(directory: string): string {
  return String.raw`test -d "${escJxaShell(directory)}" || exit $?; airmcp_tmp=$(/usr/bin/mktemp -t airmcp-finder) || exit $?; trap \'/bin/rm -f "$airmcp_tmp"\' 0; `;
}

function checkedLimitShellSuffix(limit: number): string {
  return String.raw` >"$airmcp_tmp"; airmcp_producer_status=$?; [ "$airmcp_producer_status" -eq 0 ] || exit "$airmcp_producer_status"; /usr/bin/head -n ${limit} "$airmcp_tmp"`;
}

export function searchFilesScript(folder: string, query: string, limit: number): string {
  assertSafePath(folder);
  const n = safeInt(limit);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    ${JXA_SHELL_ESC_FN}
    const results = app.doShellScript('${checkedLimitShellPrefix(folder)}mdfind -onlyin "${escJxaShell(folder)}" "${escJxaShell(query)}"${checkedLimitShellSuffix(n)}');
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
    // Prefix the Spotlight time token with a literal shell backslash. Building
    // that character explicitly avoids losing it to this generated JXA string.
    const query = 'kMDItemContentModificationDate >= ' + String.fromCharCode(92) + '$time.iso(' + dateStr + ')';
    const results = app.doShellScript('${checkedLimitShellPrefix(folder)}mdfind -onlyin "${escJxaShell(folder)}" "' + query + '"${checkedLimitShellSuffix(n)}');
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
    const output = app.doShellScript('${checkedLimitShellPrefix(path)}ls -1 "${escJxaShell(path)}"${checkedLimitShellSuffix(n)}');
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
