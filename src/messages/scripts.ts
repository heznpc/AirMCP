// JXA scripts for Apple Messages automation.
//
// Each exported `*Script` function returns a JXA source string whose final
// expression is `JSON.stringify(...)`. The TypeScript interfaces below pin
// the shape of that JSON, and the `*_EXAMPLE` constants carry a concrete
// instance of that shape. Tests in `tests/script-shape-contract.test.js`
// parse each example through the matching tool's `outputSchema`, so drifting
// a scripts JSON shape without updating the example (and outputSchema) fails
// a test — rather than silently passing a tautological mock-in-mock-out
// check. Example constants and scripts must be kept in lockstep by hand.

import { esc, escAS } from "../shared/esc.js";

// ── Return shapes ───────────────────────────────────────────────────────
export interface MessagesParticipant {
  name: string | null;
  handle: string | null;
}

export interface MessagesChatSummary {
  id: string;
  name: string | null;
  participants: MessagesParticipant[];
  updated: string | null;
}

export interface MessagesListChatsOutput {
  total: number;
  returned: number;
  chats: MessagesChatSummary[];
}

export type MessagesReadChatOutput = MessagesChatSummary;

export type MessagesSearchChatsOutput = MessagesListChatsOutput;

export interface MessagesListParticipantsOutput {
  chatId: string;
  chatName: string | null;
  participants: MessagesParticipant[];
}

// ── Example fixtures (hand-maintained; see tests/script-shape-contract) ──
export const LIST_CHATS_EXAMPLE: MessagesListChatsOutput = {
  total: 3,
  returned: 2,
  chats: [
    {
      id: "iMessage;+;alice@example.com",
      name: "Alice",
      participants: [{ name: "Alice", handle: "alice@example.com" }],
      updated: "2026-04-20T10:00:00.000Z",
    },
    {
      id: "iMessage;-;chat123",
      name: null,
      participants: [
        { name: null, handle: "+821012345678" },
        { name: "Bob", handle: "bob@example.com" },
      ],
      updated: null,
    },
  ],
};

export const READ_CHAT_EXAMPLE: MessagesReadChatOutput = LIST_CHATS_EXAMPLE.chats[0]!;

export const SEARCH_CHATS_EXAMPLE: MessagesSearchChatsOutput = {
  total: 5,
  returned: 1,
  chats: [LIST_CHATS_EXAMPLE.chats[0]!],
};

export const LIST_PARTICIPANTS_EXAMPLE: MessagesListParticipantsOutput = {
  chatId: "iMessage;+;alice@example.com",
  chatName: "Alice",
  participants: [
    { name: "Alice", handle: "alice@example.com" },
    { name: null, handle: null },
  ],
};

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

export function searchMessagesScript(query: string, limit: number): string {
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

// macOS 26: JXA services() throws -1708; use AppleScript via runAppleScript().
// Do not echo user input back in the return to avoid multi-layer escaping issues (AS→JSON).
function buildSendScript(target: string, sendLine: string, errPrefix: string): string {
  const t = escAS(target);
  return `tell application "Messages"
try
set targetService to 1st service whose service type = iMessage
on error
set targetService to 1st service
end try
try
set targetBuddy to buddy "${t}" of targetService
${sendLine}
on error errMsg number errNum
error "${errPrefix}: " & errMsg number errNum
end try
end tell
return "{\\"sent\\":true}"`;
}

export function sendMessageScript(target: string, text: string): string {
  return buildSendScript(target, `send "${escAS(text)}" to targetBuddy`, "Message send failed");
}

export function sendFileScript(target: string, filePath: string): string {
  return buildSendScript(target, `send POSIX file "${escAS(filePath)}" to targetBuddy`, "File send failed");
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
