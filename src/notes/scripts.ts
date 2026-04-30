// JXA scripts for Apple Notes automation.
// Each function returns a JXA script string to be executed via osascript.

import { esc } from "../shared/esc.js";

/**
 * JXA helper function string that builds a note result object from indexed arrays.
 * Embed this at the start of any JXA script that needs to build note results.
 * Avoids duplicating the same object construction in 6+ places.
 */
const JXA_BUILD_NOTE = `
  function buildNote(i, ids, names, containers, creationDates, modificationDates, shareds, folderName) {
    return {
      id: ids[i],
      name: names[i],
      folder: folderName || containers[i].name(),
      creationDate: creationDates[i].toISOString(),
      modificationDate: modificationDates[i].toISOString(),
      shared: shareds[i]
    };
  }
`;

export function listNotesScript(limit: number, offset: number, folder?: string): string {
  if (folder) {
    return `
      const Notes = Application('Notes');
      const folders = Notes.folders.whose({name: '${esc(folder)}'})();
      if (folders.length === 0) throw new Error('Folder not found: ${esc(folder)}');
      const f = folders[0];
      const names = f.notes.name();
      const ids = f.notes.id();
      const creationDates = f.notes.creationDate();
      const modificationDates = f.notes.modificationDate();
      const shareds = f.notes.shared();
      const start = Math.min(${offset}, names.length);
      const end = Math.min(start + ${limit}, names.length);
      const result = [];
      for (let i = start; i < end; i++) {
        result.push({
          id: ids[i],
          name: names[i],
          folder: '${esc(folder)}',
          creationDate: creationDates[i].toISOString(),
          modificationDate: modificationDates[i].toISOString(),
          shared: shareds[i]
        });
      }
      JSON.stringify({total: names.length, offset: start, returned: result.length, notes: result});
    `;
  }
  return `
    ${JXA_BUILD_NOTE}
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const creationDates = Notes.notes.creationDate();
    const modificationDates = Notes.notes.modificationDate();
    const containers = Notes.notes.container();
    const shareds = Notes.notes.shared();
    const start = Math.min(${offset}, names.length);
    const end = Math.min(start + ${limit}, names.length);
    const result = [];
    for (let i = start; i < end; i++) {
      result.push(buildNote(i, ids, names, containers, creationDates, modificationDates, shareds));
    }
    JSON.stringify({total: names.length, offset: start, returned: result.length, notes: result});
  `;
}

export function searchNotesScript(query: string, limit: number, offset: number = 0): string {
  return `
    ${JXA_BUILD_NOTE}
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const creationDates = Notes.notes.creationDate();
    const modificationDates = Notes.notes.modificationDate();
    const containers = Notes.notes.container();
    const shareds = Notes.notes.shared();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    const nameMatched = new Set();
    let matched = 0;
    const skip = ${offset};
    // Phase 1: Search by title only (cheap — no plaintext fetch)
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().includes(q)) {
        nameMatched.add(i);
        if (matched >= skip && result.length < ${limit}) {
          const pt = Notes.notes[i].plaintext();
          result.push({...buildNote(i, ids, names, containers, creationDates, modificationDates, shareds), preview: pt.substring(0, 200)});
        }
        matched++;
        if (result.length >= ${limit}) break;
      }
    }
    // Phase 2: Search body content (expensive — per-note plaintext, stops at limit)
    if (result.length < ${limit}) {
      for (let i = 0; i < names.length; i++) {
        if (nameMatched.has(i)) continue;
        if (matched < skip) {
          const pt = Notes.notes[i].plaintext();
          if (pt.toLowerCase().includes(q)) { matched++; }
          continue;
        }
        const pt = Notes.notes[i].plaintext();
        if (pt.toLowerCase().includes(q)) {
          result.push({...buildNote(i, ids, names, containers, creationDates, modificationDates, shareds), preview: pt.substring(0, 200)});
          matched++;
          if (result.length >= ${limit}) break;
        }
      }
    }
    // Note: totalMatched is a lower bound — the loop exits early once the page is full,
    // so there may be more matches beyond what was counted.
    JSON.stringify({total: names.length, totalMatched: matched, offset: skip, returned: result.length, notes: result});
  `;
}

export function readNoteScript(id: string): string {
  return `
    const Notes = Application('Notes');
    const note = Notes.notes.byId('${esc(id)}');
    JSON.stringify({
      id: note.id(),
      name: note.name(),
      body: note.body(),
      plaintext: note.plaintext(),
      creationDate: note.creationDate().toISOString(),
      modificationDate: note.modificationDate().toISOString(),
      folder: note.container().name(),
      shared: note.shared(),
      passwordProtected: note.passwordProtected()
    });
  `;
}

export function createNoteScript(body: string, folder?: string): string {
  if (folder) {
    return `
      const Notes = Application('Notes');
      const folders = Notes.folders.whose({name: '${esc(folder)}'})();
      if (folders.length === 0) throw new Error('Folder not found: ${esc(folder)}');
      if (folders[0].shared()) throw new Error('Cannot create notes in shared folder: ${esc(folder)}. Set AIRMCP_INCLUDE_SHARED=true to allow.');
      const note = Notes.Note({body: '${esc(body)}'});
      folders[0].notes.push(note);
      JSON.stringify({id: note.id(), name: note.name()});
    `;
  }
  return `
    const Notes = Application('Notes');
    const note = Notes.Note({body: '${esc(body)}'});
    Notes.defaultAccount().defaultFolder().notes.push(note);
    JSON.stringify({id: note.id(), name: note.name()});
  `;
}

export function createNoteSharedScript(body: string, folder?: string): string {
  if (folder) {
    return `
      const Notes = Application('Notes');
      const folders = Notes.folders.whose({name: '${esc(folder)}'})();
      if (folders.length === 0) throw new Error('Folder not found: ${esc(folder)}');
      const note = Notes.Note({body: '${esc(body)}'});
      folders[0].notes.push(note);
      JSON.stringify({id: note.id(), name: note.name()});
    `;
  }
  return `
    const Notes = Application('Notes');
    const note = Notes.Note({body: '${esc(body)}'});
    Notes.defaultAccount().defaultFolder().notes.push(note);
    JSON.stringify({id: note.id(), name: note.name()});
  `;
}

export function guardSharedBulkScript(ids: string[]): string {
  const idsArray = ids.map((id) => `'${esc(id)}'`).join(",");
  return `
    const Notes = Application('Notes');
    const ids = [${idsArray}];
    const sharedIds = ids.filter(id => Notes.notes.byId(id).shared());
    JSON.stringify({sharedIds: sharedIds});
  `;
}

export function guardSharedScript(id: string): string {
  return `
    const Notes = Application('Notes');
    const note = Notes.notes.byId('${esc(id)}');
    JSON.stringify({shared: note.shared()});
  `;
}

export function updateNoteScript(id: string, body: string): string {
  return `
    const Notes = Application('Notes');
    const note = Notes.notes.byId('${esc(id)}');
    note.body = '${esc(body)}';
    JSON.stringify({id: note.id(), name: note.name()});
  `;
}

export function deleteNoteScript(id: string): string {
  return `
    const Notes = Application('Notes');
    const note = Notes.notes.byId('${esc(id)}');
    const name = note.name();
    Notes.delete(note);
    JSON.stringify({deleted: true, name: name});
  `;
}

export function listFoldersScript(): string {
  return `
    const Notes = Application('Notes');
    const accounts = Notes.accounts();
    const result = [];
    for (const acct of accounts) {
      const aName = acct.name();
      const fIds = acct.folders.id();
      const fNames = acct.folders.name();
      const fShared = acct.folders.shared();
      for (let i = 0; i < fIds.length; i++) {
        result.push({
          id: fIds[i],
          name: fNames[i],
          account: aName,
          noteCount: acct.folders[i].notes.length,
          shared: fShared[i]
        });
      }
    }
    JSON.stringify(result);
  `;
}

export function createFolderScript(name: string, account?: string): string {
  if (account) {
    return `
      const Notes = Application('Notes');
      const acct = Notes.accounts.whose({name: '${esc(account)}'})()[0];
      if (!acct) throw new Error('Account not found: ${esc(account)}');
      const existing = acct.folders.whose({name: '${esc(name)}'})();
      let out;
      if (existing.length > 0) {
        out = {id: existing[0].id(), name: existing[0].name(), existing: true};
      } else {
        const folder = Notes.Folder({name: '${esc(name)}'});
        acct.folders.push(folder);
        out = {id: folder.id(), name: folder.name(), existing: false};
      }
      JSON.stringify(out);
    `;
  }
  return `
    const Notes = Application('Notes');
    const acct = Notes.defaultAccount();
    const existing = acct.folders.whose({name: '${esc(name)}'})();
    let out;
    if (existing.length > 0) {
      out = {id: existing[0].id(), name: existing[0].name(), existing: true};
    } else {
      const folder = Notes.Folder({name: '${esc(name)}'});
      acct.folders.push(folder);
      out = {id: folder.id(), name: folder.name(), existing: false};
    }
    JSON.stringify(out);
  `;
}

export function scanNotesScript(limit: number, previewLength: number, offset: number, folder?: string): string {
  if (folder) {
    return `
      const Notes = Application('Notes');
      const folders = Notes.folders.whose({name: '${esc(folder)}'})();
      if (folders.length === 0) throw new Error('Folder not found: ${esc(folder)}');
      const f = folders[0];
      const names = f.notes.name();
      const ids = f.notes.id();
      const creationDates = f.notes.creationDate();
      const modificationDates = f.notes.modificationDate();
      const shareds = f.notes.shared();
      const start = Math.min(${offset}, names.length);
      const end = Math.min(start + ${limit}, names.length);
      const result = [];
      for (let i = start; i < end; i++) {
        const pt = f.notes[i].plaintext();
        result.push({
          id: ids[i],
          name: names[i],
          folder: '${esc(folder)}',
          creationDate: creationDates[i].toISOString(),
          modificationDate: modificationDates[i].toISOString(),
          preview: pt.substring(0, ${previewLength}),
          charCount: pt.length,
          shared: shareds[i]
        });
      }
      JSON.stringify({total: names.length, offset: start, returned: result.length, notes: result});
    `;
  }
  return `
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const creationDates = Notes.notes.creationDate();
    const modificationDates = Notes.notes.modificationDate();
    const containers = Notes.notes.container();
    const shareds = Notes.notes.shared();
    const start = Math.min(${offset}, names.length);
    const end = Math.min(start + ${limit}, names.length);
    const result = [];
    for (let i = start; i < end; i++) {
      const pt = Notes.notes[i].plaintext();
      result.push({
        id: ids[i],
        name: names[i],
        folder: containers[i].name(),
        creationDate: creationDates[i].toISOString(),
        modificationDate: modificationDates[i].toISOString(),
        preview: pt.substring(0, ${previewLength}),
        charCount: pt.length,
        shared: shareds[i]
      });
    }
    JSON.stringify({total: names.length, offset: start, returned: result.length, notes: result});
  `;
}

export function compareNotesScript(ids: string[]): string {
  const idsArray = ids.map((id) => `'${esc(id)}'`).join(",");
  return `
    const Notes = Application('Notes');
    const targetIds = [${idsArray}];
    const result = targetIds.map(id => {
      const note = Notes.notes.byId(id);
      const text = note.plaintext();
      return {
        id: note.id(),
        name: note.name(),
        plaintext: text,
        folder: note.container().name(),
        creationDate: note.creationDate().toISOString(),
        modificationDate: note.modificationDate().toISOString(),
        charCount: text.length,
        shared: note.shared()
      };
    });
    JSON.stringify(result);
  `;
}

export function moveNoteScript(id: string, targetFolder: string): string {
  return `
    const Notes = Application('Notes');
    const note = Notes.notes.byId('${esc(id)}');
    const folders = Notes.folders.whose({name: '${esc(targetFolder)}'})();
    if (folders.length === 0) throw new Error('Folder not found: ${esc(targetFolder)}');
    const body = note.body();
    const originalName = note.name();
    const newNote = Notes.Note({body: body});
    folders[0].notes.push(newNote);
    const newId = newNote.id();
    if (!newId) throw new Error('Failed to create note in target folder');
    Notes.delete(note);
    JSON.stringify({
      originalName: originalName,
      newId: newId,
      newName: newNote.name(),
      targetFolder: '${esc(targetFolder)}'
    });
  `;
}

export function bulkMoveNotesScript(
  ids: string[],
  targetFolder: string,
  opts: { dryRun?: boolean; stopOnError?: boolean } = {},
): string {
  const idsArray = ids.map((id) => `'${esc(id)}'`).join(",");
  const dryRun = opts.dryRun === true;
  const stopOnError = opts.stopOnError !== false; // default true
  return `
    const Notes = Application('Notes');
    const folders = Notes.folders.whose({name: '${esc(targetFolder)}'})();
    if (folders.length === 0) throw new Error('Folder not found: ${esc(targetFolder)}');
    const targetFolderObj = folders[0];
    const targetIds = [${idsArray}];
    const results = [];
    let stoppedAt = null;
    for (let i = 0; i < targetIds.length; i++) {
      const id = targetIds[i];
      try {
        const note = Notes.notes.byId(id);
        const originalName = note.name();
        const originalFolder = note.container().name();
        const creationDate = note.creationDate().toISOString();
        const modificationDate = note.modificationDate().toISOString();
        const body = note.body();
        if (originalFolder === '${esc(targetFolder)}') {
          // No-op for same-folder moves — avoids body-copy meta loss when
          // target equals source. Reported as success with unchanged: true.
          results.push({success: true, originalName, originalFolder, unchanged: true});
          continue;
        }
        if (${dryRun}) {
          results.push({
            success: true,
            dryRun: true,
            id: id,
            originalName: originalName,
            originalFolder: originalFolder,
            creationDate: creationDate,
            modificationDate: modificationDate,
            charCount: body.length,
            metaPreservation: {
              creationDateLost: true,
              modificationDateLost: true,
              attachmentsLost: true,
              note: 'Notes JXA cannot set creationDate/modificationDate on new copies; the move re-creates the note with the body only.'
            }
          });
          continue;
        }
        const newNote = Notes.Note({body: body});
        targetFolderObj.notes.push(newNote);
        const newId = newNote.id();
        if (!newId) throw new Error('Failed to create note copy');
        Notes.delete(note);
        results.push({
          success: true,
          originalName: originalName,
          originalFolder: originalFolder,
          newId: newId,
          metaLost: {creationDate: creationDate, modificationDate: modificationDate}
        });
      } catch(e) {
        results.push({success: false, id: id, error: e.message});
        if (${stopOnError}) {
          stoppedAt = i;
          break;
        }
      }
    }
    JSON.stringify({
      targetFolder: '${esc(targetFolder)}',
      dryRun: ${dryRun},
      stopOnError: ${stopOnError},
      total: targetIds.length,
      processed: results.length,
      moved: results.filter(r => r.success && !r.unchanged && !r.dryRun).length,
      unchanged: results.filter(r => r.unchanged).length,
      previewed: results.filter(r => r.dryRun).length,
      failed: results.filter(r => !r.success).length,
      stoppedAt: stoppedAt,
      results: results
    });
  `;
}
