import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, toolError } from "../shared/result.js";
import {
  listShowsScript,
  listEpisodesScript,
  nowPlayingScript,
  playbackControlScript,
  playEpisodeScript,
  searchEpisodesScript,
} from "./scripts.js";

export function registerPodcastsTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_podcast_shows",
    {
      title: "List Podcast Shows",
      description: "List all subscribed podcast shows with episode counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrusted(await runJxa(listShowsScript()));
      } catch (e) {
        return toolError("list podcast shows", e);
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ showName, limit }) => {
      try {
        return okUntrusted(await runJxa(listEpisodesScript(showName, limit)));
      } catch (e) {
        return toolError("list podcast episodes", e);
      }
    },
  );

  server.registerTool(
    "podcast_now_playing",
    {
      title: "Podcast Now Playing",
      description: "Get the currently playing podcast episode and playback state.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrusted(await runJxa(nowPlayingScript()));
      } catch (e) {
        return toolError("get podcast now playing", e);
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action }) => {
      try {
        return ok(await runJxa(playbackControlScript(action)));
      } catch (e) {
        return toolError("control podcast playback", e);
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ episodeName, showName }) => {
      try {
        return ok(await runJxa(playEpisodeScript(episodeName, showName)));
      } catch (e) {
        return toolError("play podcast episode", e);
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return okUntrusted(await runJxa(searchEpisodesScript(query, limit)));
      } catch (e) {
        return toolError("search podcast episodes", e);
      }
    },
  );
}
