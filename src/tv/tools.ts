import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, okUntrusted, toolError } from "../shared/result.js";
import {
  listPlaylistsScript,
  listTracksScript,
  nowPlayingScript,
  playbackControlScript,
  searchTracksScript,
  playTrackScript,
} from "./scripts.js";

export function registerTvTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "tv_list_playlists",
    {
      title: "List TV Playlists",
      description: "List all playlists (libraries) in Apple TV app.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrusted(await runJxa(listPlaylistsScript()));
      } catch (e) {
        return toolError("list TV playlists", e);
      }
    },
  );

  server.registerTool(
    "tv_list_tracks",
    {
      title: "List TV Tracks",
      description: "List movies/episodes in a TV playlist.",
      inputSchema: {
        playlist: z.string().max(500).describe("Playlist name (e.g. 'Library', 'Movies')"),
        limit: z.number().int().min(1).max(200).optional().default(50).describe("Max items (default: 50)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlist, limit }) => {
      try {
        return okUntrusted(await runJxa(listTracksScript(playlist, limit)));
      } catch (e) {
        return toolError("list TV tracks", e);
      }
    },
  );

  server.registerTool(
    "tv_now_playing",
    {
      title: "TV Now Playing",
      description: "Get currently playing content in Apple TV app.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okUntrusted(await runJxa(nowPlayingScript()));
      } catch (e) {
        return toolError("get TV now playing", e);
      }
    },
  );

  server.registerTool(
    "tv_playback_control",
    {
      title: "TV Playback Control",
      description: "Control Apple TV playback: play, pause, next, previous.",
      inputSchema: {
        action: z.enum(["play", "pause", "nextTrack", "previousTrack"]).describe("Playback action"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action }) => {
      try {
        return ok(await runJxa(playbackControlScript(action)));
      } catch (e) {
        return toolError("control TV playback", e);
      }
    },
  );

  server.registerTool(
    "tv_search",
    {
      title: "Search TV Library",
      description: "Search movies and TV shows by name or show title.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(100).optional().default(20).describe("Max results (default: 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return okUntrusted(await runJxa(searchTracksScript(query, limit)));
      } catch (e) {
        return toolError("search TV", e);
      }
    },
  );

  server.registerTool(
    "tv_play",
    {
      title: "Play TV Content",
      description: "Play a movie or episode by name.",
      inputSchema: {
        name: z.string().max(500).describe("Movie or episode name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(playTrackScript(name)));
      } catch (e) {
        return toolError("play TV content", e);
      }
    },
  );
}
