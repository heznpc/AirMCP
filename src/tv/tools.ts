import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errJxaFor } from "../shared/result.js";
import {
  listPlaylistsScript,
  listTracksScript,
  nowPlayingScript,
  playbackControlScript,
  searchTracksScript,
  playTrackScript,
} from "./scripts.js";

// Shared shape for a TV playlist descriptor as returned by listPlaylistsScript.
// All fields come from the user's local Apple TV library.
const tvPlaylistSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  duration: z.number().nullable(),
  trackCount: z.number().int(),
});

// Shared shape for a TV track (movie/episode) in a playlist listing.
// year/genre may be empty strings or 0 when not set in the library; the
// JXA script doesn't normalise these so the schema stays permissive.
const tvTrackSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  duration: z.number().nullable(),
  genre: z.string().nullable(),
  year: z.number().nullable(),
});

// Shape for a search result track — narrower than tvTrackSchema because
// searchTracksScript only emits show/season/episode metadata.
const tvSearchTrackSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  show: z.string(),
  seasonNumber: z.number().int().nullable(),
  episodeNumber: z.number().int().nullable(),
  duration: z.number().nullable(),
});

export function registerTvTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "tv_list_playlists",
    {
      title: "List TV Playlists",
      description: "List all playlists (libraries) in Apple TV app.",
      inputSchema: {},
      // Playlist names are user-controlled library labels — payload
      // wrapped with untrusted markers via okUntrustedStructured.
      outputSchema: {
        playlists: z.array(tvPlaylistSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const playlists = (await runJxa(listPlaylistsScript())) as Array<unknown>;
        return okUntrustedStructured({ playlists });
      } catch (e) {
        return errJxaFor("list TV playlists", e);
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
      // Track names, artists, albums are user-library metadata — untrusted.
      outputSchema: {
        total: z.number().int(),
        returned: z.number().int(),
        tracks: z.array(tvTrackSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlist, limit }) => {
      try {
        const result = (await runJxa(listTracksScript(playlist, limit))) as {
          total: number;
          returned: number;
          tracks: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("list TV tracks", e);
      }
    },
  );

  server.registerTool(
    "tv_now_playing",
    {
      title: "TV Now Playing",
      description: "Get currently playing content in Apple TV app.",
      inputSchema: {},
      // `track` is null when the player is stopped; otherwise carries
      // user-controlled metadata about the current item.
      outputSchema: {
        playerState: z.string(),
        track: z
          .object({
            name: z.string(),
            show: z.string().nullable(),
            seasonNumber: z.number().int().nullable(),
            episodeNumber: z.number().int().nullable(),
            duration: z.number().nullable(),
            playerPosition: z.number().nullable(),
          })
          .nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const result = (await runJxa(nowPlayingScript())) as {
          playerState: string;
          track: unknown;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("get TV now playing", e);
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
      // action echoes the input enum; playerState is the resulting TV
      // player state string ("playing", "paused", "stopped", etc.).
      outputSchema: {
        action: z.string(),
        playerState: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action }) => {
      try {
        const result = (await runJxa(playbackControlScript(action))) as { action: string; playerState: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("control TV playback", e);
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
      // Search hits echo user-library titles/shows — untrusted.
      outputSchema: {
        returned: z.number().int(),
        tracks: z.array(tvSearchTrackSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const result = (await runJxa(searchTracksScript(query, limit))) as {
          returned: number;
          tracks: Array<unknown>;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("search TV", e);
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
      // `track` is the resolved track name from the user's library,
      // which is user-controlled text — wrap with untrusted markers.
      outputSchema: {
        playing: z.literal(true),
        track: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const result = (await runJxa(playTrackScript(name))) as { playing: true; track: string };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("play TV content", e);
      }
    },
  );
}
