// JXA scripts for Apple Messages automation.

import { esc } from "../shared/esc.js";

/** Escape for AppleScript double-quoted strings */
function escAS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function listChatsScript(limit: number): string {
  return `
    const Messages = Application('Messages');
    const chats = Messages.chats();
    const count = Math.min(chats.length, ${limit});
    const result = [];
    for (let i = 0; i < count; i++) {
      const c = chats[i];
      let parts = [];
      try {
        const participants = c.participants();
        parts = participants.map(p => {
          let name = null, handle = null;
          try { name = p.name(); } catch(e) {}
          try { handle = p.handle(); } catch(e) {}
          return {name, handle};
        });
      } catch(e) {}
      let updated = null;
      try { updated = c.updatedDate() ? c.updatedDate().toISOString() : null; } catch(e) {}
      result.push({
        id: c.id(),
        name: c.name() || null,
        participants: parts,
        updated: updated
      });
    }
    JSON.stringify({total: chats.length, returned: count, chats: result});
  `;
}

export function readChatScript(chatId: string): string {
  return `
    const Messages = Application('Messages');
    const chats = Messages.chats.whose({id: '${esc(chatId)}'})();
    if (chats.length === 0) throw new Error('Chat not found: ${esc(chatId)}');
    const chat = chats[0];
    let parts = [];
    try {
      const participants = chat.participants();
      parts = participants.map(p => {
        let name = null, handle = null;
        try { name = p.name(); } catch(e) {}
        try { handle = p.handle(); } catch(e) {}
        return {name, handle};
      });
    } catch(e) {}
    let updated = null;
    try { updated = chat.updatedDate() ? chat.updatedDate().toISOString() : null; } catch(e) {}
    JSON.stringify({
      id: chat.id(),
      name: chat.name() || null,
      participants: parts,
      updated: updated
    });
  `;
}

export function searchMessagesScript(
  query: string,
  limit: number,
): string {
  return `
    const Messages = Application('Messages');
    const chats = Messages.chats();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    for (const chat of chats) {
      if (result.length >= ${limit}) break;
      const name = chat.name() || '';
      let parts = [];
      let participantNames = '';
      let participantHandles = '';
      try {
        const participants = chat.participants();
        parts = participants.map(p => {
          let pn = null, ph = null;
          try { pn = p.name(); } catch(e) {}
          try { ph = p.handle(); } catch(e) {}
          return {name: pn, handle: ph};
        });
        participantNames = parts.map(p => p.name || '').join(' ');
        participantHandles = parts.map(p => p.handle || '').join(' ');
      } catch(e) {}
      if (name.toLowerCase().includes(q) ||
          participantNames.toLowerCase().includes(q) ||
          participantHandles.toLowerCase().includes(q)) {
        let updated = null;
        try { updated = chat.updatedDate() ? chat.updatedDate().toISOString() : null; } catch(e) {}
        result.push({
          id: chat.id(),
          name: name || null,
          participants: parts,
          updated: updated
        });
      }
    }
    JSON.stringify({total: chats.length, returned: result.length, chats: result});
  `;
}

export function sendMessageScript(
  target: string,
  text: string,
): string {
  // macOS 26: JXA services() throws -1708; use AppleScript fallback.
  // Prefixed with "applescript:" so tool handler runs via osascript -e.
  const t = escAS(target);
  const m = escAS(text);
  const jsonTarget = target.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const jsonText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").substring(0, 80);
  return `applescript:tell application "Messages"
try
set targetService to 1st service whose service type = iMessage
on error
set targetService to 1st service
end try
set targetBuddy to buddy "${t}" of targetService
send "${m}" to targetBuddy
end tell
return "{\\"sent\\":true,\\"to\\":\\"${jsonTarget}\\",\\"text\\":\\"${jsonText}\\"}"`;
}

export function sendFileScript(
  target: string,
  filePath: string,
): string {
  const t = escAS(target);
  const p = escAS(filePath);
  const jsonTarget = target.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const jsonPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `applescript:tell application "Messages"
try
set targetService to 1st service whose service type = iMessage
on error
set targetService to 1st service
end try
set targetBuddy to buddy "${t}" of targetService
send POSIX file "${p}" to targetBuddy
end tell
return "{\\"sent\\":true,\\"to\\":\\"${jsonTarget}\\",\\"file\\":\\"${jsonPath}\\"}"`;
}

export function listParticipantsScript(chatId: string): string {
  return `
    const Messages = Application('Messages');
    const chats = Messages.chats.whose({id: '${esc(chatId)}'})();
    if (chats.length === 0) throw new Error('Chat not found: ${esc(chatId)}');
    const chat = chats[0];
    let result = [];
    try {
      const participants = chat.participants();
      result = participants.map(p => {
        let name = null, handle = null;
        try { name = p.name(); } catch(e) {}
        try { handle = p.handle(); } catch(e) {}
        return {name, handle};
      });
    } catch(e) {}
    JSON.stringify({chatId: '${esc(chatId)}', chatName: chat.name() || null, participants: result});
  `;
}

