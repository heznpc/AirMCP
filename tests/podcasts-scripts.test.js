import { describe, test, expect } from '@jest/globals';
import {
  listShowsScript,
  listEpisodesScript,
  nowPlayingScript,
  playbackControlScript,
  playEpisodeScript,
  searchEpisodesScript,
} from '../dist/podcasts/scripts.js';

describe('podcasts script generators (SQLite-based)', () => {
  test('listShowsScript uses SQLite', () => {
    const script = listShowsScript();
    expect(script).toContain('sqlite3');
    expect(script).toContain('ZMTPODCAST');
    expect(script).toContain('JSON.stringify');
  });

  test('listEpisodesScript with show name', () => {
    const script = listEpisodesScript('The Daily', 20);
    expect(script).toContain('sqlite3');
    expect(script).toContain('ZMTEPISODE');
    expect(script).toContain('The Daily');
    expect(script).toContain('LIMIT 20');
  });

  test('listEpisodesScript with limit', () => {
    const script = listEpisodesScript('Tech Talk', 10);
    expect(script).toContain('LIMIT 10');
  });

  test('nowPlayingScript checks if Podcasts is running', () => {
    const script = nowPlayingScript();
    expect(script).toContain("System Events");
    expect(script).toContain('Podcasts');
  });

  test('playbackControlScript play', () => {
    const script = playbackControlScript('play');
    expect(script).toContain('Podcasts');
    expect(script).toContain('JSON.stringify');
  });

  test('playbackControlScript pause', () => {
    const script = playbackControlScript('pause');
    expect(script).toContain('Podcasts');
  });

  test('playbackControlScript nextTrack', () => {
    const script = playbackControlScript('nextTrack');
    expect(script).toContain('Podcasts');
  });

  test('playbackControlScript previousTrack', () => {
    const script = playbackControlScript('previousTrack');
    expect(script).toContain('Podcasts');
  });

  test('playbackControlScript invalid action throws', () => {
    expect(() => playbackControlScript('invalid')).toThrow('Invalid playback action');
  });

  test('playEpisodeScript uses URL scheme', () => {
    const script = playEpisodeScript('My Episode');
    expect(script).toContain('podcasts://search');
    expect(script).toContain('My%20Episode');
  });

  test('playEpisodeScript with show', () => {
    const script = playEpisodeScript('Episode 1', 'The Daily');
    expect(script).toContain('podcasts://search');
  });

  test('searchEpisodesScript', () => {
    const script = searchEpisodesScript('tech', 20);
    expect(script).toContain('sqlite3');
    expect(script).toContain('ZMTEPISODE');
    expect(script).toContain('tech');
    expect(script).toContain('LIMIT 20');
  });
});

describe('podcasts SQL injection prevention', () => {
  test('escapes single quotes in show name', () => {
    const script = listEpisodesScript("it's", 10);
    expect(script).toContain("it''s");
  });

  test('escapes single quotes in search query', () => {
    const script = searchEpisodesScript("it's", 10);
    expect(script).toContain("it''s");
  });
});
