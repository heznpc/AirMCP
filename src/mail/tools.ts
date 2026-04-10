import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okLinked, okUntrusted, okStructured, err, toolError } from "../shared/result.js";
import {
  listMailboxesScript,
  listMessagesScript,
  readMessageScript,
  searchMessagesScript,
  markReadScript,
  flagMessageScript,
  getUnreadCountScript,
  moveMessageScript,
  listAccountsScript,
  sendMailScript,
  replyMailScript,
} from "./scripts.js";
import { LIMITS } from "../shared/constants.js";

export function registerMailTools(server: McpServer, config: AirMcpConfig): void {
  const { allowSendMail } = config;
  server.registerTool(
    "list_mailboxes",
    {
      title: "List Mailboxes",
      description: "List all mailboxes across accounts with unread counts.",
      inputSchema: {},
      outputSchema: {
        mailboxes: z.array(
          z.object({
            name: z.string(),
            account: z.string(),
            unreadCount: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okStructured(await runJxa(listMailboxesScript()));
      } catch (e) {
        return toolError("list mailboxes", e);
      }
    },
  );

  server.registerTool(
    "list_messages",
    {
      title: "List Messages",
      description: "List recent messages in a mailbox (e.g. 'INBOX'). Returns subject, sender, date, read status.",
      inputSchema: {
        mailbox: z.string().max(500).describe("Mailbox name (e.g. 'INBOX', 'Sent Messages')"),
        account: z.string().max(500).optional().describe("Account name. Defaults to first account."),
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max messages (default: 50)"),
        offset: z.number().int().min(0).optional().default(0).describe("Pagination offset (default: 0)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ mailbox, account, limit, offset }) => {
      try {
        return okLinked("list_mail", await runJxa(listMessagesScript(mailbox, limit, offset, account)));
      } catch (e) {
        return toolError("list messages", e);
      }
    },
  );

  server.registerTool(
    "read_message",
    {
      title: "Read Message",
      description:
        "Read full content of an email message by ID. Content length is configurable (default: 5000 chars, max: 100000).",
      inputSchema: {
        id: z.string().max(500).regex(/^\d+$/, "Message ID must be numeric").describe("Message ID"),
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(100000)
          .optional()
          .default(5000)
          .describe("Max content length (default: 5000)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, maxLength }) => {
      try {
        return okUntrusted(await runJxa(readMessageScript(id, maxLength)));
      } catch (e) {
        return toolError("read message", e);
      }
    },
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search Messages",
      description: "Search messages by keyword in subject or sender within a mailbox.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        mailbox: z.string().max(500).optional().default("INBOX").describe("Mailbox to search (default: INBOX)"),
        limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, mailbox, limit }) => {
      try {
        return okUntrusted(await runJxa(searchMessagesScript(query, mailbox, limit)));
      } catch (e) {
        return toolError("search messages", e);
      }
    },
  );

  server.registerTool(
    "mark_message_read",
    {
      title: "Mark Message Read/Unread",
      description: "Mark an email message as read or unread.",
      inputSchema: {
        id: z.string().max(500).regex(/^\d+$/, "Message ID must be numeric").describe("Message ID"),
        read: z.boolean().optional().default(true).describe("true=read, false=unread (default: true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, read }) => {
      try {
        return ok(await runJxa(markReadScript(id, read)));
      } catch (e) {
        return toolError("mark message", e);
      }
    },
  );

  server.registerTool(
    "flag_message",
    {
      title: "Flag Message",
      description: "Flag or unflag an email message.",
      inputSchema: {
        id: z.string().max(500).regex(/^\d+$/, "Message ID must be numeric").describe("Message ID"),
        flagged: z.boolean().optional().default(true).describe("true=flag, false=unflag (default: true)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, flagged }) => {
      try {
        return ok(await runJxa(flagMessageScript(id, flagged)));
      } catch (e) {
        return toolError("flag message", e);
      }
    },
  );

  server.registerTool(
    "get_unread_count",
    {
      title: "Get Unread Count",
      description: "Get unread message count across all mailboxes.",
      inputSchema: {},
      outputSchema: {
        totalUnread: z.number(),
        mailboxes: z.array(
          z.object({
            account: z.string(),
            mailbox: z.string(),
            unread: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okStructured(await runJxa(getUnreadCountScript()));
      } catch (e) {
        return toolError("get unread count", e);
      }
    },
  );

  server.registerTool(
    "move_message",
    {
      title: "Move Message",
      description: "Move a message to another mailbox.",
      inputSchema: {
        id: z.string().max(500).regex(/^\d+$/, "Message ID must be numeric").describe("Message ID"),
        targetMailbox: z.string().max(500).describe("Target mailbox name (e.g. 'Archive', 'Trash')"),
        targetAccount: z
          .string()
          .max(500)
          .optional()
          .describe("Target account name. Searches all accounts if omitted."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, targetMailbox, targetAccount }) => {
      try {
        return ok(await runJxa(moveMessageScript(id, targetMailbox, targetAccount)));
      } catch (e) {
        return toolError("move message", e);
      }
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List Mail Accounts",
      description: "List all mail accounts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listAccountsScript()));
      } catch (e) {
        return toolError("list accounts", e);
      }
    },
  );

  // ── Send tools (gated by allowSendMail) ──

  server.registerTool(
    "send_mail",
    {
      title: "Send Email",
      description: "Compose and send an email via Apple Mail. Requires allowSendMail config.",
      inputSchema: {
        to: z
          .array(z.string().email())
          .min(1)
          .max(LIMITS.MAIL_RECIPIENTS)
          .describe(`Recipient email addresses (max ${LIMITS.MAIL_RECIPIENTS})`),
        subject: z.string().max(1000).describe("Email subject"),
        body: z.string().max(50000).describe("Email body text"),
        cc: z
          .array(z.string().email())
          .max(LIMITS.MAIL_RECIPIENTS)
          .optional()
          .describe(`CC recipients (max ${LIMITS.MAIL_RECIPIENTS})`),
        bcc: z
          .array(z.string().email())
          .max(LIMITS.MAIL_RECIPIENTS)
          .optional()
          .describe(`BCC recipients (max ${LIMITS.MAIL_RECIPIENTS})`),
        account: z.string().max(500).optional().describe("Sender email address (uses default account if omitted)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ to, subject, body, cc, bcc, account }) => {
      if (!allowSendMail)
        return err("Sending mail is disabled. Set allowSendMail: true in config or AIRMCP_ALLOW_SEND_MAIL=true.");
      try {
        return ok(await runJxa(sendMailScript(to, subject, body, cc, bcc, account)));
      } catch (e) {
        return toolError("send mail", e);
      }
    },
  );

  server.registerTool(
    "reply_mail",
    {
      title: "Reply to Email",
      description: "Reply to an email message. Requires allowSendMail config.",
      inputSchema: {
        id: z
          .string()
          .max(500)
          .regex(/^\d+$/, "Message ID must be numeric")
          .describe("Original message ID to reply to"),
        body: z.string().max(50000).describe("Reply body text"),
        replyAll: z.boolean().optional().default(false).describe("Reply to all recipients (default: false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, body, replyAll }) => {
      if (!allowSendMail)
        return err("Sending mail is disabled. Set allowSendMail: true in config or AIRMCP_ALLOW_SEND_MAIL=true.");
      try {
        return ok(await runJxa(replyMailScript(id, body, replyAll)));
      } catch (e) {
        return toolError("reply", e);
      }
    },
  );
}
