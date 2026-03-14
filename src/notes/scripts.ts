// JXA scripts for Apple Notes automation.
// Each function returns a JXA script string to be executed via osascript.

import { esc } from "../shared/esc.js";

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
      result.push({
        id: ids[i],
        name: names[i],
        folder: containers[i].name(),
        creationDate: creationDates[i].toISOString(),
        modificationDate: modificationDates[i].toISOString(),
        shared: shareds[i]
      });
    }
    JSON.stringify({total: names.length, offset: start, returned: result.length, notes: result});
  `;
}

export function searchNotesScript(query: string, limit: number): string {
  return `
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const plaintexts = Notes.notes.plaintext();
    const creationDates = Notes.notes.creationDate();
    const modificationDates = Notes.notes.modificationDate();
    const containers = Notes.notes.container();
    const shareds = Notes.notes.shared();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    for (let i = 0; i < names.length && result.length < ${limit}; i++) {
      if (names[i].toLowerCase().includes(q) || plaintexts[i].toLowerCase().includes(q)) {
        result.push({
          id: ids[i],
          name: names[i],
          folder: containers[i].name(),
          creationDate: creationDates[i].toISOString(),
          modificationDate: modificationDates[i].toISOString(),
          preview: plaintexts[i].substring(0, 200),
          shared: shareds[i]
        });
      }
    }
    JSON.stringify({total: names.length, returned: result.length, notes: result});
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
      if (existing.length > 0) JSON.stringify({id: existing[0].id(), name: existing[0].name(), existing: true});
      else {
        const folder = Notes.Folder({name: '${esc(name)}'});
        acct.folders.push(folder);
        JSON.stringify({id: folder.id(), name: folder.name(), existing: false});
      }
    `;
  }
  return `
    const Notes = Application('Notes');
    const acct = Notes.defaultAccount();
    const existing = acct.folders.whose({name: '${esc(name)}'})();
    if (existing.length > 0) JSON.stringify({id: existing[0].id(), name: existing[0].name(), existing: true});
    else {
      const folder = Notes.Folder({name: '${esc(name)}'});
      acct.folders.push(folder);
      JSON.stringify({id: folder.id(), name: folder.name(), existing: false});
    }
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

export function bulkMoveNotesScript(ids: string[], targetFolder: string): string {
  const idsArray = ids.map((id) => `'${esc(id)}'`).join(",");
  return `
    const Notes = Application('Notes');
    const folders = Notes.folders.whose({name: '${esc(targetFolder)}'})();
    if (folders.length === 0) throw new Error('Folder not found: ${esc(targetFolder)}');
    const targetIds = [${idsArray}];
    const results = [];
    for (const id of targetIds) {
      try {
        const note = Notes.notes.byId(id);
        const body = note.body();
        const originalName = note.name();
        const newNote = Notes.Note({body: body});
        folders[0].notes.push(newNote);
        const newId = newNote.id();
        if (!newId) throw new Error('Failed to create note copy');
        Notes.delete(note);
        results.push({success: true, originalName, newId: newId});
      } catch(e) {
        results.push({success: false, id: id, error: e.message});
      }
    }
    JSON.stringify({targetFolder: '${esc(targetFolder)}', moved: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results: results});
  `;
}

