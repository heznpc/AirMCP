// JXA scripts for Apple Podcasts automation.

import { esc } from "../shared/esc.js";

export function listShowsScript(): string {
  return `
    const Podcasts = Application('Podcasts');
    const shows = Podcasts.shows();
    const result = [];
    for (let i = 0; i < shows.length; i++) {
      result.push({name: shows[i].name(), author: shows[i].author(), episodeCount: shows[i].episodes.length});
    }
    JSON.stringify(result);
  `;
}

export function listEpisodesScript(showName: string, limit: number): string {
  return `
    const Podcasts = Application('Podcasts');
    const shows = Podcasts.shows.whose({name: '${esc(showName)}'})();
    if (shows.length === 0) throw new Error('Show not found: ${esc(showName)}');
    const episodes = shows[0].episodes();
    const count = Math.min(episodes.length, ${limit});
    const result = [];
    for (let i = 0; i < count; i++) {
      const ep = episodes[i];
      result.push({
        title: ep.name(),
        date: ep.releaseDate() ? ep.releaseDate().toISOString() : null,
        duration: ep.duration(),
        played: ep.played()
      });
    }
    JSON.stringify({total: episodes.length, returned: count, episodes: result});
  `;
}

export function nowPlayingScript(): string {
  return `
    const Podcasts = Application('Podcasts');
    const state = Podcasts.playerState();
    if (state === 'stopped') {
      JSON.stringify({playerState: 'stopped', episode: null});
    } else {
      const t = Podcasts.currentTrack;
      JSON.stringify({
        playerState: state,
        episode: {
          name: t.name(),
          show: t.show(),
          duration: t.duration(),
          playerPosition: Podcasts.playerPosition()
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
    const Podcasts = Application('Podcasts');
    Podcasts.${action}();
    const state = Podcasts.playerState();
    JSON.stringify({action: '${action}', playerState: state});
  `;
}

export function playEpisodeScript(episodeName: string, showName?: string): string {
  if (showName) {
    return `
      const Podcasts = Application('Podcasts');
      const shows = Podcasts.shows.whose({name: '${esc(showName)}'})();
      if (shows.length === 0) throw new Error('Show not found: ${esc(showName)}');
      const episodes = shows[0].episodes.whose({name: '${esc(episodeName)}'})();
      if (episodes.length === 0) throw new Error('Episode not found: ${esc(episodeName)}');
      episodes[0].play();
      JSON.stringify({playing: true, episode: episodes[0].name(), show: '${esc(showName)}'});
    `;
  }
  return `
    const Podcasts = Application('Podcasts');
    const shows = Podcasts.shows();
    let found = null;
    for (let i = 0; i < shows.length && !found; i++) {
      const episodes = shows[i].episodes.whose({name: '${esc(episodeName)}'})();
      if (episodes.length > 0) found = episodes[0];
    }
    if (!found) throw new Error('Episode not found: ${esc(episodeName)}');
    found.play();
    JSON.stringify({playing: true, episode: found.name(), show: found.show()});
  `;
}

export function searchEpisodesScript(query: string, limit: number): string {
  return `
    const Podcasts = Application('Podcasts');
    const shows = Podcasts.shows();
    const q = '${esc(query)}'.toLowerCase();
    const result = [];
    for (let s = 0; s < shows.length && result.length < ${limit}; s++) {
      const episodes = shows[s].episodes();
      for (let i = 0; i < episodes.length && result.length < ${limit}; i++) {
        const name = episodes[i].name() || '';
        const desc = episodes[i].description() || '';
        if (name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
          result.push({
            title: name,
            show: shows[s].name(),
            date: episodes[i].releaseDate() ? episodes[i].releaseDate().toISOString() : null,
            duration: episodes[i].duration(),
            played: episodes[i].played()
          });
        }
      }
    }
    JSON.stringify({returned: result.length, episodes: result});
  `;
}
