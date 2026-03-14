// JXA scripts for Apple Music automation.

import { esc } from "../shared/esc.js";

export function listPlaylistsScript(): string {
  return `
    const Music = Application('Music');
    const names = Music.playlists.name();
    const ids = Music.playlists.id();
    const durations = Music.playlists.duration();
    const result = names.map((name, i) => ({
      id: ids[i],
      name: name,
      duration: durations[i],
      trackCount: Music.playlists[i].tracks.length
    }));
    JSON.stringify(result);
  `;
}

export function listTracksScript(playlist: string, limit: number): string {
  return `
    const Music = Application('Music');
    const playlists = Music.playlists.whose({name: '${esc(playlist)}'})();
    if (playlists.length === 0) throw new Error('Playlist not found: ${esc(playlist)}');
    const pl = playlists[0];
    const tracks = pl.tracks();
    const count = Math.min(tracks.length, ${limit});
    const result = [];
    for (let i = 0; i < count; i++) {
      const t = tracks[i];
      result.push({
        id: t.id(),
        name: t.name(),
        artist: t.artist(),
        album: t.album(),
        duration: t.duration(),
        trackNumber: t.trackNumber(),
        genre: t.genre(),
        year: t.year()
      });
    }
    JSON.stringify({total: tracks.length, returned: count, tracks: result});
  `;
}

export function nowPlayingScript(): string {
  return `
    const Music = Application('Music');
    const state = Music.playerState();
    if (state === 'stopped') {
      JSON.stringify({playerState: 'stopped', track: null});
    } else {
      const t = Music.currentTrack;
      JSON.stringify({
        playerState: state,
        track: {
          name: t.name(),
          artist: t.artist(),
          album: t.album(),
          duration: t.duration(),
          playerPosition: Music.playerPosition()
        }
      });
    }
  `;
}

const ALLOWED_ACTIONS = new Set(["play", "pause", "nextTrack", "previousTrack"]);

export function playbackControlScript(action: string): string {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Invalid playback action: ${action}`);
  }
  return `
    const Music = Application('Music');
    Music.${action}();
    const state = Music.playerState();
    JSON.stringify({action: '${action}', playerState: state});
  `;
}

export function searchTracksScript(query: string, limit: number): string {
  return `
    const Music = Application('Music');
    const lib = Music.playlists.whose({name: 'Library'})();
    if (lib.length === 0) {
      JSON.stringify({total: 0, returned: 0, tracks: []});
    } else {
      const tracks = lib[0].tracks();
      const q = '${esc(query)}'.toLowerCase();
      const result = [];
      for (let i = 0; i < tracks.length && result.length < ${limit}; i++) {
        const name = tracks[i].name() || '';
        const artist = tracks[i].artist() || '';
        const album = tracks[i].album() || '';
        if (name.toLowerCase().includes(q) || artist.toLowerCase().includes(q) || album.toLowerCase().includes(q)) {
          result.push({
            id: tracks[i].id(),
            name: name,
            artist: artist,
            album: album,
            duration: tracks[i].duration()
          });
        }
      }
      JSON.stringify({total: tracks.length, returned: result.length, tracks: result});
    }
  `;
}

export function playTrackScript(trackName: string, playlist?: string): string {
  if (playlist) {
    return `
      const Music = Application('Music');
      const pls = Music.playlists.whose({name: '${esc(playlist)}'})();
      if (pls.length === 0) throw new Error('Playlist not found: ${esc(playlist)}');
      const tracks = pls[0].tracks.whose({name: '${esc(trackName)}'})();
      if (tracks.length === 0) throw new Error('Track not found: ${esc(trackName)}');
      tracks[0].play();
      JSON.stringify({playing: true, track: tracks[0].name(), artist: tracks[0].artist()});
    `;
  }
  return `
    const Music = Application('Music');
    const lib = Music.playlists.whose({name: 'Library'})();
    if (lib.length === 0) throw new Error('Library not found');
    const tracks = lib[0].tracks.whose({name: '${esc(trackName)}'})();
    if (tracks.length === 0) throw new Error('Track not found: ${esc(trackName)}');
    tracks[0].play();
    JSON.stringify({playing: true, track: tracks[0].name(), artist: tracks[0].artist()});
  `;
}

export function playPlaylistScript(name: string, shuffle?: boolean): string {
  return `
    const Music = Application('Music');
    const pls = Music.playlists.whose({name: '${esc(name)}'})();
    if (pls.length === 0) throw new Error('Playlist not found: ${esc(name)}');
    ${shuffle !== undefined ? `Music.shuffleEnabled = ${shuffle};` : ''}
    pls[0].play();
    JSON.stringify({playing: true, playlist: '${esc(name)}', shuffle: Music.shuffleEnabled()});
  `;
}

export function getTrackInfoScript(trackName: string): string {
  return `
    const Music = Application('Music');
    const lib = Music.playlists.whose({name: 'Library'})();
    if (lib.length === 0) throw new Error('Library not found');
    const tracks = lib[0].tracks.whose({name: '${esc(trackName)}'})();
    if (tracks.length === 0) throw new Error('Track not found: ${esc(trackName)}');
    const t = tracks[0];
    JSON.stringify({
      id: t.id(),
      name: t.name(),
      artist: t.artist(),
      album: t.album(),
      albumArtist: t.albumArtist(),
      genre: t.genre(),
      year: t.year(),
      trackNumber: t.trackNumber(),
      discNumber: t.discNumber(),
      duration: t.duration(),
      playedCount: t.playedCount(),
      rating: t.rating(),
      loved: t.loved(),
      dateAdded: t.dateAdded() ? t.dateAdded().toISOString() : null,
      sampleRate: t.sampleRate(),
      bitRate: t.bitRate(),
      size: t.size()
    });
  `;
}

export function setShuffleScript(shuffle?: boolean, songRepeat?: string): string {
  const lines: string[] = [];
  if (shuffle !== undefined) lines.push(`Music.shuffleEnabled = ${shuffle};`);
  if (songRepeat !== undefined) lines.push(`Music.songRepeat = '${esc(songRepeat)}';`);
  return `
    const Music = Application('Music');
    ${lines.join('\n    ')}
    JSON.stringify({
      shuffleEnabled: Music.shuffleEnabled(),
      songRepeat: Music.songRepeat()
    });
  `;
}

export function createPlaylistScript(name: string): string {
  return `
    const Music = Application('Music');
    const pl = Music.make({new: 'playlist', withProperties: {name: '${esc(name)}'}});
    JSON.stringify({name: pl.name(), id: pl.id()});
  `;
}

export function addToPlaylistScript(playlistName: string, trackName: string): string {
  return `
    const Music = Application('Music');
    const pls = Music.playlists.whose({name: '${esc(playlistName)}'})();
    if (pls.length === 0) throw new Error('Playlist not found: ${esc(playlistName)}');
    const tracks = Music.tracks.whose({name: '${esc(trackName)}'})();
    if (tracks.length === 0) throw new Error('Track not found: ${esc(trackName)}');
    Music.duplicate(tracks[0], {to: pls[0]});
    JSON.stringify({added: true, track: '${esc(trackName)}', playlist: '${esc(playlistName)}'});
  `;
}

export function removeFromPlaylistScript(playlistName: string, trackName: string): string {
  return `
    const Music = Application('Music');
    const pls = Music.playlists.whose({name: '${esc(playlistName)}'})();
    if (pls.length === 0) throw new Error('Playlist not found: ${esc(playlistName)}');
    const tracks = pls[0].tracks.whose({name: '${esc(trackName)}'})();
    if (tracks.length === 0) throw new Error('Track not found: ${esc(trackName)}');
    tracks[0].delete();
    JSON.stringify({removed: true, track: '${esc(trackName)}', playlist: '${esc(playlistName)}'});
  `;
}

export function deletePlaylistScript(name: string): string {
  return `
    const Music = Application('Music');
    const pls = Music.playlists.whose({name: '${esc(name)}'})();
    if (pls.length === 0) throw new Error('Playlist not found: ${esc(name)}');
    pls[0].delete();
    JSON.stringify({deleted: true, playlist: '${esc(name)}'});
  `;
}
