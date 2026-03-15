import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, err } from "../shared/result.js";
import { TIMEOUT } from "../shared/constants.js";
import { zFilePath } from "../shared/validate.js";

const execFileAsync = promisify(execFile);

/** Run a script — if prefixed with "applescript:" use AppleScript, else JXA */
async function runScript<T>(script: string): Promise<T> {
  if (script.startsWith("applescript:")) {
    const as = script.slice("applescript:".length);
    const { stdout } = await execFileAsync("osascript", ["-e", as], { timeout: TIMEOUT.MESSAGE_SEND });
    // Strip control chars that AppleScript may inject
    // eslint-disable-next-line no-control-regex
    const clean = stdout.trim().replace(/[\x00-\x1f\x7f]/g, (c) => c === "\n" || c === "\r" || c === "\t" ? "" : "");
    return JSON.parse(clean) as T;
  }
  return runJxa<T>(script);
}
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
        return ok(await runJxa(listChatsScript(limit)));
      } catch (e) {
        return err(`Failed to list chats: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "read_chat",
    {
      title: "Read Chat",
      description: "Read chat details including participants and last update time by chat ID.",
      inputSchema: {
        chatId: z.string().describe("Chat ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ chatId }) => {
      try {
        return ok(await runJxa(readChatScript(chatId)));
      } catch (e) {
        return err(`Failed to read chat: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "search_chats",
    {
      title: "Search Chats",
      description: "Search chats by participant name, handle, or chat name.",
      inputSchema: {
        query: z.string().describe("Search keyword (matches chat name, participant name, or handle)"),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results (default: 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return ok(await runJxa(searchMessagesScript(query, limit)));
      } catch (e) {
        return err(`Failed to search chats: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description: "Send a text message via iMessage/SMS. Requires a phone number or email as the target handle.",
      inputSchema: {
        target: z.string().min(1).describe("Recipient handle (phone number or email, e.g. '+821012345678' or 'user@example.com')"),
        text: z.string().min(1).max(10000).describe("Message text to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ target, text }) => {
      if (!allowSendMessages) return err("Sending messages is disabled. Set AIRMCP_ALLOW_SEND_MESSAGES=true to enable.");
      try {
        return ok(await runScript(sendMessageScript(target, text)));
      } catch (e) {
        return err(`Failed to send message: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "send_file",
    {
      title: "Send File",
      description: "Send a file attachment via iMessage/SMS. Requires absolute file path and recipient handle.",
      inputSchema: {
        target: z.string().min(1).describe("Recipient handle (phone number or email)"),
        filePath: zFilePath.describe("Absolute file path to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ target, filePath }) => {
      if (!allowSendMessages) return err("Sending messages is disabled. Set AIRMCP_ALLOW_SEND_MESSAGES=true to enable.");
      try {
        return ok(await runScript(sendFileScript(target, filePath)));
      } catch (e) {
        return err(`Failed to send file: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "list_participants",
    {
      title: "List Chat Participants",
      description: "List all participants in a specific chat.",
      inputSchema: {
        chatId: z.string().describe("Chat ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ chatId }) => {
      try {
        return ok(await runJxa(listParticipantsScript(chatId)));
      } catch (e) {
        return err(`Failed to list participants: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

}
