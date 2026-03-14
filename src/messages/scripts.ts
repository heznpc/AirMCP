// JXA scripts for Apple Messages automation.

import { esc } from "../shared/esc.js";

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
  return `
    const Messages = Application('Messages');
    const service = Messages.services().find(s => s.serviceType() === 'iMessage') || Messages.services()[0];
    if (!service) throw new Error('No messaging service available');
    const buddy = service.buddies.whose({handle: '${esc(target)}'})();
    if (buddy.length === 0) throw new Error('Buddy not found for handle: ${esc(target)}');
    Messages.send('${esc(text)}', {to: buddy[0]});
    JSON.stringify({sent: true, to: '${esc(target)}', text: '${esc(text)}'.substring(0, 100)});
  `;
}

export function sendFileScript(
  target: string,
  filePath: string,
): string {
  return `
    const Messages = Application('Messages');
    const service = Messages.services().find(s => s.serviceType() === 'iMessage') || Messages.services()[0];
    if (!service) throw new Error('No messaging service available');
    const buddy = service.buddies.whose({handle: '${esc(target)}'})();
    if (buddy.length === 0) throw new Error('Buddy not found for handle: ${esc(target)}');
    const file = Path('${esc(filePath)}');
    Messages.send(file, {to: buddy[0]});
    JSON.stringify({sent: true, to: '${esc(target)}', file: '${esc(filePath)}'});
  `;
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

