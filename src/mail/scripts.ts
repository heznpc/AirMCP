// JXA scripts for Apple Mail automation.

import { esc } from "../shared/esc.js";

// The interfaces below pin the shape of each script's final
// `JSON.stringify(...)`, and the `*_EXAMPLE` constants carry a concrete
// instance of it. `tests/script-shape-contract.test.js` parses every example
// through the matching tool's real `outputSchema`, so changing what a script
// emits without updating the example (and the outputSchema) fails a test rather
// than passing the tautological mock-in-mock-out runtime check. Examples and
// scripts must be kept in lockstep by hand.

// ── Return shapes ───────────────────────────────────────────────────────
export interface MailMailboxSummary {
  name: string;
  account: string;
  unreadCount: number;
}

/** `list_mailboxes` wraps the script's bare array as `{ mailboxes }`. */
export interface MailListMailboxesOutput {
  mailboxes: MailMailboxSummary[];
}

export interface MailMessageListItem {
  id: string;
  subject: string;
  sender: string;
  /** Null when the message carries no parseable received date. */
  dateReceived: string | null;
  read: boolean;
  flagged: boolean;
}

export interface MailListMessagesOutput {
  total: number;
  offset: number;
  returned: number;
  messages: MailMessageListItem[];
}

export interface MailRecipient {
  name: string | null;
  address: string | null;
}

export interface MailReadMessageOutput {
  id: string;
  subject: string;
  sender: string;
  to: MailRecipient[];
  cc: MailRecipient[];
  dateReceived: string;
  dateSent: string | null;
  read: boolean;
  flagged: boolean;
  content: string;
  mailbox: string;
  account: string;
}

/** `search_messages` returns a narrower row than `list_messages`: no `flagged`. */
export interface MailSearchMessageItem {
  id: string;
  subject: string;
  sender: string;
  dateReceived: string | null;
  read: boolean;
}

export interface MailSearchMessagesOutput {
  returned: number;
  messages: MailSearchMessageItem[];
}

export interface MailUnreadMailbox {
  account: string;
  mailbox: string;
  unread: number;
}

export interface MailUnreadCountOutput {
  totalUnread: number;
  mailboxes: MailUnreadMailbox[];
}

export interface MailAccountSummary {
  name: string;
  fullName: string | null;
  emailAddresses: string[];
}

/** `list_accounts` wraps the script's bare array as `{ accounts }`. */
export interface MailListAccountsOutput {
  accounts: MailAccountSummary[];
}

// ── Example fixtures (hand-maintained; see tests/script-shape-contract) ──
export const LIST_MAILBOXES_EXAMPLE: MailListMailboxesOutput = {
  mailboxes: [
    { name: "INBOX", account: "Work", unreadCount: 4 },
    { name: "Archive", account: "Work", unreadCount: 0 },
  ],
};

export const LIST_MESSAGES_EXAMPLE: MailListMessagesOutput = {
  total: 3,
  offset: 0,
  returned: 2,
  messages: [
    {
      id: "1001",
      subject: "Quarterly review",
      sender: "alice@example.com",
      dateReceived: "2026-03-15T09:00:00.000Z",
      read: true,
      flagged: false,
    },
    {
      // `subject` and `sender` fall back to '' and the date to null.
      id: "1002",
      subject: "",
      sender: "",
      dateReceived: null,
      read: false,
      flagged: true,
    },
  ],
};

export const READ_MESSAGE_EXAMPLE: MailReadMessageOutput = {
  id: "1001",
  subject: "Quarterly review",
  sender: "alice@example.com",
  to: [{ name: "Bob", address: "bob@example.com" }],
  cc: [{ name: null, address: null }],
  dateReceived: "2026-03-15T09:00:00.000Z",
  dateSent: "2026-03-15T08:59:00.000Z",
  read: true,
  flagged: false,
  content: "Agenda attached.",
  mailbox: "INBOX",
  account: "Work",
};

/** Same tool, unsent-draft case: `dateSent` is null and recipients are empty. */
export const READ_MESSAGE_EXAMPLE_NO_SENT_DATE: MailReadMessageOutput = {
  id: "1003",
  subject: "",
  sender: "",
  to: [],
  cc: [],
  dateReceived: "2026-03-16T10:00:00.000Z",
  dateSent: null,
  read: false,
  flagged: false,
  content: "",
  mailbox: "Drafts",
  account: "Work",
};

export const SEARCH_MESSAGES_EXAMPLE: MailSearchMessagesOutput = {
  returned: 1,
  messages: [
    {
      id: "1001",
      subject: "Quarterly review",
      sender: "alice@example.com",
      dateReceived: "2026-03-15T09:00:00.000Z",
      read: true,
    },
  ],
};

export const GET_UNREAD_COUNT_EXAMPLE: MailUnreadCountOutput = {
  totalUnread: 4,
  mailboxes: [{ account: "Work", mailbox: "INBOX", unread: 4 }],
};

export const LIST_ACCOUNTS_EXAMPLE: MailListAccountsOutput = {
  accounts: [
    { name: "Work", fullName: "Example User", emailAddresses: ["user@example.com"] },
    // `fullName` comes straight from Mail and can be null.
    { name: "Legacy", fullName: null, emailAddresses: [] },
  ],
};

export function listMailboxesScript(): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const result = [];
    for (const acct of accounts) {
      const aName = acct.name();
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        result.push({
          name: box.name(),
          account: aName,
          unreadCount: box.unreadCount()
        });
      }
    }
    JSON.stringify(result);
  `;
}

export function listMessagesScript(mailbox: string, limit: number, offset: number, account?: string): string {
  const acctFilter = account
    ? `const accts = Mail.accounts.whose({name: '${esc(account)}'})(); if (accts.length === 0) throw new Error('Account not found: ${esc(account)}'); const acct = accts[0];`
    : `const acct = Mail.accounts()[0];`;
  return `
    const Mail = Application('Mail');
    ${acctFilter}
    const boxes = acct.mailboxes.whose({name: '${esc(mailbox)}'})();
    if (boxes.length === 0) throw new Error('Mailbox not found: ${esc(mailbox)}');
    const box = boxes[0];
    const total = box.messages.length;
    const start = Math.min(${offset}, total);
    const ids = box.messages.id();
    const subjects = box.messages.subject();
    const senders = box.messages.sender();
    const dates = box.messages.dateReceived();
    const reads = box.messages.readStatus();
    const flags = box.messages.flaggedStatus();
    const safe = Math.min(total, ids.length, subjects.length, senders.length, dates.length, reads.length, flags.length);
    const count = Math.min(safe - start, ${limit});
    const result = [];
    for (let i = start; i < start + count; i++) {
      result.push({
        id: ids[i],
        subject: subjects[i] || '',
        sender: senders[i] || '',
        dateReceived: dates[i] ? dates[i].toISOString() : null,
        read: reads[i] ?? false,
        flagged: flags[i] ?? false
      });
    }
    JSON.stringify({total: total, offset: start, returned: count, messages: result});
  `;
}

export function readMessageScript(id: string, maxLength: number): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    let found = null;
    for (const acct of accounts) {
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const msgs = box.messages.whose({id: Number('${esc(id)}')})();
        if (msgs.length > 0) {
          const m = msgs[0];
          const toRecips = m.toRecipients();
          const ccRecips = m.ccRecipients();
          found = {
            id: String(m.id()),
            subject: m.subject(),
            sender: m.sender(),
            to: toRecips.map(r => ({name: r.name(), address: r.address()})),
            cc: ccRecips.map(r => ({name: r.name(), address: r.address()})),
            dateReceived: m.dateReceived().toISOString(),
            dateSent: m.dateSent() ? m.dateSent().toISOString() : null,
            read: m.readStatus(),
            flagged: m.flaggedStatus(),
            content: m.content().substring(0, ${maxLength}),
            mailbox: box.name(),
            account: acct.name()
          };
          break;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error('Message not found');
    JSON.stringify(found);
  `;
}

export function searchMessagesScript(query: string, mailbox: string, limit: number): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    for (const acct of accounts) {
      const boxes = acct.mailboxes.whose({name: '${esc(mailbox)}'})();
      if (boxes.length === 0) continue;
      const box = boxes[0];
      const subjects = box.messages.subject();
      const senders = box.messages.sender();
      const ids = box.messages.id();
      const dates = box.messages.dateReceived();
      const reads = box.messages.readStatus();
      for (let i = 0; i < subjects.length && result.length < ${limit}; i++) {
        const subj = subjects[i] || '';
        const sender = senders[i] || '';
        if (subj.toLowerCase().includes(q) || sender.toLowerCase().includes(q)) {
          result.push({
            id: String(ids[i]),
            subject: subj,
            sender: sender,
            dateReceived: dates[i] ? dates[i].toISOString() : null,
            read: reads[i] ?? false
          });
        }
      }
      if (result.length >= ${limit}) break;
    }
    JSON.stringify({returned: result.length, messages: result});
  `;
}

export function markReadScript(id: string, read: boolean): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    let foundId = null;
    for (const acct of accounts) {
      if (foundId) break;
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const msgs = box.messages.whose({id: Number('${esc(id)}')})();
        if (msgs.length > 0) {
          msgs[0].readStatus = ${read};
          foundId = msgs[0].id();
          break;
        }
      }
    }
    if (!foundId) throw new Error('Message not found');
    JSON.stringify({id: foundId, read: ${read}});
  `;
}

export function flagMessageScript(id: string, flagged: boolean): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    let foundId = null;
    for (const acct of accounts) {
      if (foundId) break;
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const msgs = box.messages.whose({id: Number('${esc(id)}')})();
        if (msgs.length > 0) {
          msgs[0].flaggedStatus = ${flagged};
          foundId = msgs[0].id();
          break;
        }
      }
    }
    if (!foundId) throw new Error('Message not found');
    JSON.stringify({id: foundId, flagged: ${flagged}});
  `;
}

export function getUnreadCountScript(): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const result = [];
    let total = 0;
    for (const acct of accounts) {
      const aName = acct.name();
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const count = box.unreadCount();
        if (count > 0) {
          result.push({account: aName, mailbox: box.name(), unread: count});
          total += count;
        }
      }
    }
    JSON.stringify({totalUnread: total, mailboxes: result});
  `;
}

export function moveMessageScript(id: string, targetMailbox: string, targetAccount?: string): string {
  const targetFilter = targetAccount
    ? `const tAccts = Mail.accounts.whose({name: '${esc(targetAccount)}'})(); if (tAccts.length === 0) throw new Error('Target account not found'); const tBoxes = tAccts[0].mailboxes.whose({name: '${esc(targetMailbox)}'})();`
    : `let tBoxes = []; for (const a of Mail.accounts()) { const b = a.mailboxes.whose({name: '${esc(targetMailbox)}'})(); if (b.length > 0) { tBoxes = b; break; } }`;
  return `
    const Mail = Application('Mail');
    ${targetFilter}
    if (tBoxes.length === 0) throw new Error('Target mailbox not found: ${esc(targetMailbox)}');
    const target = tBoxes[0];
    const accounts = Mail.accounts();
    let moved = false;
    for (const acct of accounts) {
      if (moved) break;
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const msgs = box.messages.whose({id: Number('${esc(id)}')})();
        if (msgs.length > 0) {
          Mail.move(msgs[0], {to: target});
          moved = true;
          break;
        }
      }
    }
    if (!moved) throw new Error('Message not found');
    JSON.stringify({moved: true, id: Number('${esc(id)}'), targetMailbox: '${esc(targetMailbox)}'});
  `;
}

export function sendMailScript(
  to: string[],
  subject: string,
  body: string,
  cc?: string[],
  bcc?: string[],
  account?: string,
): string {
  const toList = to.map((a) => `msg.toRecipients.push(Mail.Recipient({address: '${esc(a)}'}));`).join("\n    ");
  const ccList = (cc ?? []).map((a) => `msg.ccRecipients.push(Mail.Recipient({address: '${esc(a)}'}));`).join("\n    ");
  const bccList = (bcc ?? [])
    .map((a) => `msg.bccRecipients.push(Mail.Recipient({address: '${esc(a)}'}));`)
    .join("\n    ");
  const acctLine = account ? `msg.sender = '${esc(account)}';` : "";
  return `
    const Mail = Application('Mail');
    const msg = Mail.OutgoingMessage({
      subject: '${esc(subject)}',
      content: '${esc(body)}'
    });
    Mail.outgoingMessages.push(msg);
    ${toList}
    ${ccList}
    ${bccList}
    ${acctLine}
    msg.send();
    JSON.stringify({sent: true, to: ${JSON.stringify(to)}, subject: '${esc(subject)}'});
  `;
}

export function replyMailScript(id: string, body: string, replyAll: boolean): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    let found = null;
    for (const acct of accounts) {
      if (found) break;
      const boxes = acct.mailboxes();
      for (const box of boxes) {
        const msgs = box.messages.whose({id: Number('${esc(id)}')})();
        if (msgs.length > 0) { found = msgs[0]; break; }
      }
    }
    if (!found) throw new Error('Message not found');
    const reply = Mail.reply(found, {openingWindow: false, replyToAll: ${replyAll}});
    reply.content = '${esc(body)}' + '\\n\\n' + reply.content();
    reply.send();
    JSON.stringify({replied: true, id: Number('${esc(id)}'), replyAll: ${replyAll}});
  `;
}

export function listAccountsScript(): string {
  return `
    const Mail = Application('Mail');
    const accounts = Mail.accounts();
    const result = accounts.map(a => ({
      name: a.name(),
      fullName: a.fullName(),
      emailAddresses: a.emailAddresses()
    }));
    JSON.stringify(result);
  `;
}
