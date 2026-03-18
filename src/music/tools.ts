import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import {
  listPlaylistsScript,
  listTracksScript,
  nowPlayingScript,
  playbackControlScript,
  searchTracksScript,
  playTrackScript,
  playPlaylistScript,
  getTrackInfoScript,
  setShuffleScript,
  createPlaylistScript,
  addToPlaylistScript,
  removeFromPlaylistScript,
  deletePlaylistScript,
  getRatingScript,
  setRatingScript,
  setFavoritedScript,
  setDislikedScript,
} from "./scripts.js";

export function registerMusicTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "list_playlists",
    {
      title: "List Playlists",
      description: "List all Music playlists with track counts and duration.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(listPlaylistsScript()));
      } catch (e) {
        return toolError("list playlists", e);
      }
    },
  );

  server.registerTool(
    "list_tracks",
    {
      title: "List Tracks",
      description: "List tracks in a playlist with name, artist, album, and duration.",
      inputSchema: {
        playlist: z.string().describe("Playlist name"),
        limit: z.number().int().min(1).max(500).optional().default(100).describe("Max tracks (default: 100)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlist, limit }) => {
      try {
        return ok(await runJxa(listTracksScript(playlist, limit)));
      } catch (e) {
        return toolError("list tracks", e);
      }
    },
  );

  server.registerTool(
    "now_playing",
    {
      title: "Now Playing",
      description: "Get the currently playing track and playback state.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runJxa(nowPlayingScript()));
      } catch (e) {
        return toolError("get now playing", e);
      }
    },
  );

  server.registerTool(
    "playback_control",
    {
      title: "Playback Control",
      description: "Control Music playback: play, pause, nextTrack, previousTrack.",
      inputSchema: {
        action: z.enum(["play", "pause", "nextTrack", "previousTrack"]).describe("Playback action"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action }) => {
      try {
        return ok(await runJxa(playbackControlScript(action)));
      } catch (e) {
        return toolError("control playback", e);
      }
    },
  );

  server.registerTool(
    "search_tracks",
    {
      title: "Search Tracks",
      description: "Search tracks in Music library by name, artist, or album.",
      inputSchema: {
        query: z.string().describe("Search keyword"),
        limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return ok(await runJxa(searchTracksScript(query, limit)));
      } catch (e) {
        return toolError("search tracks", e);
      }
    },
  );

  server.registerTool(
    "play_track",
    {
      title: "Play Track",
      description: "Play a specific track by name, optionally from a specific playlist.",
      inputSchema: {
        trackName: z.string().describe("Track name to play"),
        playlist: z.string().optional().describe("Playlist to search in (default: Library)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ trackName, playlist }) => {
      try {
        return ok(await runJxa(playTrackScript(trackName, playlist)));
      } catch (e) {
        return toolError("play track", e);
      }
    },
  );

  server.registerTool(
    "play_playlist",
    {
      title: "Play Playlist",
      description: "Start playing a playlist by name, with optional shuffle control.",
      inputSchema: {
        name: z.string().describe("Playlist name"),
        shuffle: z.boolean().optional().describe("Enable or disable shuffle"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, shuffle }) => {
      try {
        return ok(await runJxa(playPlaylistScript(name, shuffle)));
      } catch (e) {
        return toolError("play playlist", e);
      }
    },
  );

  server.registerTool(
    "get_track_info",
    {
      title: "Get Track Info",
      description: "Get detailed metadata for a specific track by name.",
      inputSchema: {
        trackName: z.string().describe("Track name to look up"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName }) => {
      try {
        return ok(await runJxa(getTrackInfoScript(trackName)));
      } catch (e) {
        return toolError("get track info", e);
      }
    },
  );

  server.registerTool(
    "set_shuffle",
    {
      title: "Set Shuffle & Repeat",
      description: "Enable/disable shuffle and set repeat mode (off, one, all).",
      inputSchema: {
        shuffle: z.boolean().optional().describe("Enable or disable shuffle"),
        songRepeat: z.enum(["off", "one", "all"]).optional().describe("Repeat mode"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ shuffle, songRepeat }) => {
      try {
        return ok(await runJxa(setShuffleScript(shuffle, songRepeat)));
      } catch (e) {
        return toolError("set shuffle/repeat", e);
      }
    },
  );

  server.registerTool(
    "create_playlist",
    {
      title: "Create Playlist",
      description: "Create a new playlist in Music.",
      inputSchema: {
        name: z.string().describe("Name for the new playlist"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(createPlaylistScript(name)));
      } catch (e) {
        return toolError("create playlist", e);
      }
    },
  );

  server.registerTool(
    "add_to_playlist",
    {
      title: "Add to Playlist",
      description: "Add a track to an existing playlist.",
      inputSchema: {
        playlistName: z.string().describe("Playlist name"),
        trackName: z.string().describe("Track name to add"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistName, trackName }) => {
      try {
        return ok(await runJxa(addToPlaylistScript(playlistName, trackName)));
      } catch (e) {
        return toolError("add to playlist", e);
      }
    },
  );

  server.registerTool(
    "remove_from_playlist",
    {
      title: "Remove from Playlist",
      description: "Remove a track from a playlist.",
      inputSchema: {
        playlistName: z.string().describe("Playlist name"),
        trackName: z.string().describe("Track name to remove"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistName, trackName }) => {
      try {
        return ok(await runJxa(removeFromPlaylistScript(playlistName, trackName)));
      } catch (e) {
        return toolError("remove from playlist", e);
      }
    },
  );

  server.registerTool(
    "delete_playlist",
    {
      title: "Delete Playlist",
      description: "Delete an existing playlist from Music.",
      inputSchema: {
        name: z.string().describe("Playlist name to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        return ok(await runJxa(deletePlaylistScript(name)));
      } catch (e) {
        return toolError("delete playlist", e);
      }
    },
  );

  server.registerTool(
    "get_rating",
    {
      title: "Get Rating",
      description: "Get the rating, favorited, and disliked status for a track.",
      inputSchema: {
        trackName: z.string().describe("Track name to look up"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName }) => {
      try {
        return ok(await runJxa(getRatingScript(trackName)));
      } catch (e) {
        return toolError("get rating", e);
      }
    },
  );

  server.registerTool(
    "set_rating",
    {
      title: "Set Rating",
      description: "Set the star rating (0-100) for a track. Use multiples of 20 for full stars (0, 20, 40, 60, 80, 100).",
      inputSchema: {
        trackName: z.string().describe("Track name"),
        rating: z.number().int().min(0).max(100).describe("Rating value (0-100)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, rating }) => {
      try {
        return ok(await runJxa(setRatingScript(trackName, rating)));
      } catch (e) {
        return toolError("set rating", e);
      }
    },
  );

  server.registerTool(
    "set_favorited",
    {
      title: "Set Favorited",
      description: "Mark or unmark a track as favorited (loved).",
      inputSchema: {
        trackName: z.string().describe("Track name"),
        favorited: z.boolean().describe("Whether to mark as favorited"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, favorited }) => {
      try {
        return ok(await runJxa(setFavoritedScript(trackName, favorited)));
      } catch (e) {
        return toolError("set favorited", e);
      }
    },
  );

  server.registerTool(
    "set_disliked",
    {
      title: "Set Disliked",
      description: "Mark or unmark a track as disliked.",
      inputSchema: {
        trackName: z.string().describe("Track name"),
        disliked: z.boolean().describe("Whether to mark as disliked"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, disliked }) => {
      try {
        return ok(await runJxa(setDislikedScript(trackName, disliked)));
      } catch (e) {
        return toolError("set disliked", e);
      }
    },
  );
}
