import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { okLinkedStructured, okStructured, okUntrustedStructured, errJxaFor } from "../shared/result.js";
// Side-effect import: register the now_playing poller with the shared registry
// at module load time. The poller itself only starts when startPollers() is
// invoked by the cross/event observer tool.
import "./poller.js";
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
      outputSchema: {
        playlists: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            duration: z.number(),
            trackCount: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const playlists =
          await runJxa<Array<{ id: string; name: string; duration: number; trackCount: number }>>(
            listPlaylistsScript(),
          );
        return okStructured({ playlists });
      } catch (e) {
        return errJxaFor("list playlists", e);
      }
    },
  );

  server.registerTool(
    "list_tracks",
    {
      title: "List Tracks",
      description: "List tracks in a playlist with name, artist, album, and duration.",
      inputSchema: {
        playlist: z.string().max(500).describe("Playlist name"),
        limit: z.number().int().min(1).max(500).optional().default(100).describe("Max tracks (default: 100)"),
      },
      outputSchema: {
        total: z.number(),
        returned: z.number(),
        tracks: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            artist: z.string().nullable(),
            album: z.string().nullable(),
            duration: z.number().nullable(),
            trackNumber: z.number().nullable(),
            genre: z.string().nullable(),
            year: z.number().nullable(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlist, limit }) => {
      try {
        return okStructured(await runJxa(listTracksScript(playlist, limit)));
      } catch (e) {
        return errJxaFor("list tracks", e);
      }
    },
  );

  server.registerTool(
    "now_playing",
    {
      title: "Now Playing",
      description: "Get the currently playing track and playback state.",
      inputSchema: {},
      outputSchema: {
        playerState: z.string(),
        track: z
          .object({
            name: z.string(),
            artist: z.string(),
            album: z.string(),
            duration: z.number(),
            playerPosition: z.number(),
          })
          .nullable(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okLinkedStructured("now_playing", await runJxa(nowPlayingScript()));
      } catch (e) {
        return errJxaFor("get now playing", e);
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
      // Echoes the action plus the resulting player state. `playerState`
      // is the JXA enum string ("playing", "paused", "stopped", etc.).
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
        return errJxaFor("control playback", e);
      }
    },
  );

  server.registerTool(
    "search_tracks",
    {
      title: "Search Tracks",
      description: "Search tracks in Music library by name, artist, or album.",
      inputSchema: {
        query: z.string().max(500).describe("Search keyword"),
        limit: z.number().int().min(1).max(200).optional().default(30).describe("Max results (default: 30)"),
      },
      outputSchema: {
        total: z.number().int().min(0),
        returned: z.number().int().min(0),
        tracks: z.array(
          z.object({
            id: z.number().int(),
            name: z.string(),
            artist: z.string(),
            album: z.string(),
            duration: z.number(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return okUntrustedStructured(await runJxa(searchTracksScript(query, limit)));
      } catch (e) {
        return errJxaFor("search tracks", e);
      }
    },
  );

  server.registerTool(
    "play_track",
    {
      title: "Play Track",
      description: "Play a specific track by name, optionally from a specific playlist.",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name to play"),
        playlist: z.string().max(500).optional().describe("Playlist to search in (default: Library)"),
      },
      // `track` and `artist` are user-controlled library metadata; the
      // helper marks the response untrusted.
      outputSchema: {
        playing: z.literal(true),
        track: z.string(),
        artist: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ trackName, playlist }) => {
      try {
        const result = (await runJxa(playTrackScript(trackName, playlist))) as {
          playing: true;
          track: string;
          artist: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("play track", e);
      }
    },
  );

  server.registerTool(
    "play_playlist",
    {
      title: "Play Playlist",
      description: "Start playing a playlist by name, with optional shuffle control.",
      inputSchema: {
        name: z.string().max(500).describe("Playlist name"),
        shuffle: z.boolean().optional().describe("Enable or disable shuffle"),
      },
      // `shuffle` reflects the actual Music.shuffleEnabled value after
      // the action — the script always reads it back rather than
      // echoing the input flag.
      outputSchema: {
        playing: z.literal(true),
        playlist: z.string(),
        shuffle: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, shuffle }) => {
      try {
        const result = (await runJxa(playPlaylistScript(name, shuffle))) as {
          playing: true;
          playlist: string;
          shuffle: boolean;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("play playlist", e);
      }
    },
  );

  server.registerTool(
    "get_track_info",
    {
      title: "Get Track Info",
      description: "Get detailed metadata for a specific track by name.",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name to look up"),
      },
      outputSchema: {
        id: z.number().int(),
        name: z.string(),
        artist: z.string(),
        album: z.string(),
        albumArtist: z.string(),
        genre: z.string(),
        year: z.number().int(),
        trackNumber: z.number().int(),
        discNumber: z.number().int(),
        duration: z.number(),
        playedCount: z.number().int(),
        rating: z.number().int(),
        favorited: z.boolean(),
        disliked: z.boolean(),
        dateAdded: z.string().nullable(),
        sampleRate: z.number().int(),
        bitRate: z.number().int(),
        size: z.number(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName }) => {
      try {
        return okUntrustedStructured(await runJxa(getTrackInfoScript(trackName)));
      } catch (e) {
        return errJxaFor("get track info", e);
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
      // Returns the post-write Music.shuffleEnabled / Music.songRepeat
      // values, not the input — gives callers ground truth even when
      // only one of the two args was supplied.
      outputSchema: {
        shuffleEnabled: z.boolean(),
        songRepeat: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ shuffle, songRepeat }) => {
      try {
        const result = (await runJxa(setShuffleScript(shuffle, songRepeat))) as {
          shuffleEnabled: boolean;
          songRepeat: string;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("set shuffle/repeat", e);
      }
    },
  );

  server.registerTool(
    "create_playlist",
    {
      title: "Create Playlist",
      description: "Create a new playlist in Music.",
      inputSchema: {
        name: z.string().max(500).describe("Name for the new playlist"),
      },
      // `id` is the persistent Music database ID — useful for tools that
      // need to reference the playlist without relying on the
      // user-supplied name.
      outputSchema: {
        name: z.string(),
        id: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const result = (await runJxa(createPlaylistScript(name))) as { name: string; id: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("create playlist", e);
      }
    },
  );

  server.registerTool(
    "add_to_playlist",
    {
      title: "Add to Playlist",
      description: "Add a track to an existing playlist.",
      inputSchema: {
        playlistName: z.string().max(500).describe("Playlist name"),
        trackName: z.string().max(500).describe("Track name to add"),
      },
      outputSchema: {
        added: z.literal(true),
        track: z.string(),
        playlist: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistName, trackName }) => {
      try {
        const result = (await runJxa(addToPlaylistScript(playlistName, trackName))) as {
          added: true;
          track: string;
          playlist: string;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("add to playlist", e);
      }
    },
  );

  server.registerTool(
    "remove_from_playlist",
    {
      title: "Remove from Playlist",
      description: "Remove a track from a playlist.",
      inputSchema: {
        playlistName: z.string().max(500).describe("Playlist name"),
        trackName: z.string().max(500).describe("Track name to remove"),
      },
      outputSchema: {
        removed: z.literal(true),
        track: z.string(),
        playlist: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistName, trackName }) => {
      try {
        const result = (await runJxa(removeFromPlaylistScript(playlistName, trackName))) as {
          removed: true;
          track: string;
          playlist: string;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("remove from playlist", e);
      }
    },
  );

  server.registerTool(
    "delete_playlist",
    {
      title: "Delete Playlist",
      description: "Delete an existing playlist from Music.",
      inputSchema: {
        name: z.string().max(500).describe("Playlist name to delete"),
      },
      outputSchema: {
        deleted: z.literal(true),
        playlist: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      try {
        const result = (await runJxa(deletePlaylistScript(name))) as { deleted: true; playlist: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("delete playlist", e);
      }
    },
  );

  server.registerTool(
    "get_rating",
    {
      title: "Get Rating",
      description: "Get the rating, favorited, and disliked status for a track.",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name to look up"),
      },
      outputSchema: {
        name: z.string(),
        artist: z.string(),
        rating: z.number().int(),
        favorited: z.boolean(),
        disliked: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName }) => {
      try {
        return okUntrustedStructured(await runJxa(getRatingScript(trackName)));
      } catch (e) {
        return errJxaFor("get rating", e);
      }
    },
  );

  server.registerTool(
    "set_rating",
    {
      title: "Set Rating",
      description:
        "Set the star rating (0-100) for a track. Use multiples of 20 for full stars (0, 20, 40, 60, 80, 100).",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name"),
        rating: z.number().int().min(0).max(100).describe("Rating value (0-100)"),
      },
      // `rating` is read back from the track post-write — Music can
      // round/clamp the requested value, so we surface what actually
      // landed rather than echoing the input.
      outputSchema: {
        name: z.string(),
        rating: z.number().int(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, rating }) => {
      try {
        const result = (await runJxa(setRatingScript(trackName, rating))) as { name: string; rating: number };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("set rating", e);
      }
    },
  );

  server.registerTool(
    "set_favorited",
    {
      title: "Set Favorited",
      description: "Mark or unmark a track as favorited (loved).",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name"),
        favorited: z.boolean().describe("Whether to mark as favorited"),
      },
      outputSchema: {
        name: z.string(),
        favorited: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, favorited }) => {
      try {
        const result = (await runJxa(setFavoritedScript(trackName, favorited))) as {
          name: string;
          favorited: boolean;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("set favorited", e);
      }
    },
  );

  server.registerTool(
    "set_disliked",
    {
      title: "Set Disliked",
      description: "Mark or unmark a track as disliked.",
      inputSchema: {
        trackName: z.string().max(500).describe("Track name"),
        disliked: z.boolean().describe("Whether to mark as disliked"),
      },
      outputSchema: {
        name: z.string(),
        disliked: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ trackName, disliked }) => {
      try {
        const result = (await runJxa(setDislikedScript(trackName, disliked))) as {
          name: string;
          disliked: boolean;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("set disliked", e);
      }
    },
  );
}
