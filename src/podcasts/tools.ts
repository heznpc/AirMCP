import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errJxaFor } from "../shared/result.js";
import {
  listShowsScript,
  listEpisodesScript,
  nowPlayingScript,
  playbackControlScript,
  playEpisodeScript,
  searchEpisodesScript,
} from "./scripts.js";

// SQLite-backed read tools may return either the requested rows or, when
// the Podcasts library is not accessible (Full Disk Access missing), an
// `{error, hint}` payload describing the failure. The outputSchema unions
// model that exact dual shape — no padding, no omission.
const podcastShowSchema = z.object({
  name: z.string().nullable(),
  author: z.string().nullable(),
  episodeCount: z.number().int(),
});

const podcastEpisodeListItemSchema = z.object({
  title: z.string().nullable(),
  date: z.number().nullable(),
  duration: z.number().nullable(),
  playCount: z.number().nullable(),
});

const podcastEpisodeSearchItemSchema = z.object({
  title: z.string().nullable(),
  show: z.string().nullable(),
  date: z.number().nullable(),
  duration: z.number().nullable(),
});

export function registerPodcastsTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_podcast_shows",
    {
      title: "List Podcast Shows",
      description: "List all subscribed podcast shows with episode counts.",
      inputSchema: {},
      // The JXA script returns either the parsed sqlite rows (array) or an
      // `{error, hint}` object if Full Disk Access is missing. We wrap
      // arrays into a `shows` field so the structured payload has an
      // object root, as required by MCP.
      outputSchema: {
        shows: z.array(podcastShowSchema).optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const raw = (await runJxa(listShowsScript())) as Array<unknown> | { error: string; hint: string };
        const result = Array.isArray(raw) ? { shows: raw } : raw;
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("list podcast shows", e);
      }
    },
  );

  server.registerTool(
    "list_podcast_episodes",
    {
      title: "List Podcast Episodes",
      description: "List episodes of a podcast show with title, date, duration, and played status.",
      inputSchema: {
        showName: z.string().max(500).describe("Podcast show name"),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max episodes (default: 20)"),
      },
      outputSchema: {
        episodes: z.array(podcastEpisodeListItemSchema).optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ showName, limit }) => {
      try {
        const raw = (await runJxa(listEpisodesScript(showName, limit))) as
          | Array<unknown>
          | { error: string; hint: string };
        const result = Array.isArray(raw) ? { episodes: raw } : raw;
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("list podcast episodes", e);
      }
    },
  );

  server.registerTool(
    "podcast_now_playing",
    {
      title: "Podcast Now Playing",
      description: "Get the currently playing podcast episode and playback state.",
      inputSchema: {},
      // The script branches on whether Podcasts is running and whether the
      // sqlite query succeeded — `episode`, `lastPlayed`, `hint`, and
      // `error` are each present only in specific branches.
      outputSchema: {
        playerState: z.enum(["stopped", "running"]),
        episode: z.null().optional(),
        lastPlayed: z
          .object({
            title: z.string().nullable(),
            show: z.string().nullable(),
            duration: z.number().nullable(),
          })
          .nullable()
          .optional(),
        hint: z.string().optional(),
        error: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = (await runJxa(nowPlayingScript())) as {
          playerState: "stopped" | "running";
          episode?: null;
          lastPlayed?: { title: string | null; show: string | null; duration: number | null } | null;
          hint?: string;
          error?: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("get podcast now playing", e);
      }
    },
  );

  server.registerTool(
    "podcast_playback_control",
    {
      title: "Podcast Playback Control",
      description: "Control Podcasts playback: play, pause, next, previous.",
      inputSchema: {
        action: z.enum(["play", "pause", "nextTrack", "previousTrack"]).describe("Playback action"),
      },
      outputSchema: {
        action: z.string(),
        sent: z.literal(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action }) => {
      try {
        const result = (await runJxa(playbackControlScript(action))) as { action: string; sent: true };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("control podcast playback", e);
      }
    },
  );

  server.registerTool(
    "play_podcast_episode",
    {
      title: "Play Podcast Episode",
      description: "Play a specific podcast episode by name, optionally from a specific show.",
      inputSchema: {
        episodeName: z.string().max(500).describe("Episode name to play"),
        showName: z.string().max(500).optional().describe("Show to search in (searches all shows if omitted)"),
      },
      // `query` echoes user-supplied input, so the payload is marked
      // untrusted to keep downstream consumers cautious.
      outputSchema: {
        action: z.string(),
        query: z.string(),
        hint: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ episodeName, showName }) => {
      try {
        const result = (await runJxa(playEpisodeScript(episodeName, showName))) as {
          action: string;
          query: string;
          hint: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("play podcast episode", e);
      }
    },
  );

  server.registerTool(
    "search_podcast_episodes",
    {
      title: "Search Podcast Episodes",
      description: "Search across all podcast episodes by name or description.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results (default: 20)"),
      },
      outputSchema: {
        episodes: z.array(podcastEpisodeSearchItemSchema).optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const raw = (await runJxa(searchEpisodesScript(query, limit))) as
          | Array<unknown>
          | { error: string; hint: string };
        const result = Array.isArray(raw) ? { episodes: raw } : raw;
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("search podcast episodes", e);
      }
    },
  );
}
