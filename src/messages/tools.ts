import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa, runAppleScript } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okLinked, okUntrusted, err, toolError } from "../shared/result.js";
import { TIMEOUT } from "../shared/constants.js";
import { zFilePath } from "../shared/validate.js";
import {
  listChatsScript,
  readChatScript,
  searchMessagesScript,
  sendMessageScript,
  sendFileScript,
  listParticipantsScript,
} from "./scripts.js";

export function registerMessagesTools(server: McpServer, config: AirMcpConfig): void {
  const { allowSendMessages } = config;
  server.registerTool(
    "list_chats",
    {
      title: "List Chats",
      description: "List recent chats in Messages with participants and last update time.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max chats to return (default: 50)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      try {
        return okLinked("list_chats", await runJxa(listChatsScript(limit)));
      } catch (e) {
        return toolError("list chats", e);
      }
    },
  );

  server.registerTool(
    "read_chat",
    {
      title: "Read Chat",
      description: "Read chat details including participants and last update time by chat ID.",
      inputSchema: {
        chatId: z.string().max(500).describe("Chat ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ chatId }) => {
      try {
        return okUntrusted(await runJxa(readChatScript(chatId)));
      } catch (e) {
        return toolError("read chat", e);
      }
    },
  );

  server.registerTool(
    "search_chats",
    {
      title: "Search Chats",
      description: "Search chats by participant name, handle, or chat name.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword (matches chat name, participant name, or handle)"),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results (default: 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return okUntrusted(await runJxa(searchMessagesScript(query, limit)));
      } catch (e) {
        return toolError("search chats", e);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description: "Send a text message via iMessage/SMS. Requires a phone number or email as the target handle.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .describe("Recipient handle (phone number or email, e.g. '+821012345678' or 'user@example.com')"),
        text: z.string().min(1).max(10000).describe("Message text to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ target, text }) => {
      if (!allowSendMessages)
        return err("Sending messages is disabled. Set AIRMCP_ALLOW_SEND_MESSAGES=true to enable.");
      try {
        await runAppleScript(sendMessageScript(target, text), { app: "Messages", timeout: TIMEOUT.MESSAGE_SEND });
        return ok({ sent: true, to: target, text: text.substring(0, 80) });
      } catch (e) {
        return toolError("send message", e);
      }
    },
  );

  server.registerTool(
    "send_file",
    {
      title: "Send File",
      description: "Send a file attachment via iMessage/SMS. Requires absolute file path and recipient handle.",
      inputSchema: {
        target: z.string().min(1).max(1000).describe("Recipient handle (phone number or email)"),
        filePath: zFilePath.describe("Absolute file path to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ target, filePath }) => {
      if (!allowSendMessages)
        return err("Sending messages is disabled. Set AIRMCP_ALLOW_SEND_MESSAGES=true to enable.");
      try {
        await runAppleScript(sendFileScript(target, filePath), { app: "Messages", timeout: TIMEOUT.MESSAGE_SEND });
        return ok({ sent: true, to: target, file: filePath });
      } catch (e) {
        return toolError("send file", e);
      }
    },
  );

  server.registerTool(
    "list_participants",
    {
      title: "List Chat Participants",
      description: "List all participants in a specific chat.",
      inputSchema: {
        chatId: z.string().max(500).describe("Chat ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ chatId }) => {
      try {
        return okUntrusted(await runJxa(listParticipantsScript(chatId)));
      } catch (e) {
        return toolError("list participants", e);
      }
    },
  );
}
