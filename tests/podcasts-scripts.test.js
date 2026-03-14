import { describe, test, expect } from '@jest/globals';
import {
  listShowsScript,
  listEpisodesScript,
  nowPlayingScript,
  playbackControlScript,
  playEpisodeScript,
  searchEpisodesScript,
} from '../dist/podcasts/scripts.js';

describe('podcasts script generators', () => {
  test('listShowsScript', () => {
    const script = listShowsScript();
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain('Podcasts.shows()');
    expect(script).toContain('JSON.stringify(result)');
  });

  test('listEpisodesScript with show name', () => {
    const script = listEpisodesScript('The Daily', 20);
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain("whose({name: 'The Daily'})");
    expect(script).toContain('20');
  });

  test('listEpisodesScript with limit', () => {
    const script = listEpisodesScript('Tech Talk', 10);
    expect(script).toContain('Math.min(episodes.length, 10)');
  });

  test('nowPlayingScript', () => {
    const script = nowPlayingScript();
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain('Podcasts.playerState()');
    expect(script).toContain('Podcasts.currentTrack');
  });

  test('playbackControlScript play', () => {
    const script = playbackControlScript('play');
    expect(script).toContain('Podcasts.play()');
  });

  test('playbackControlScript pause', () => {
    const script = playbackControlScript('pause');
    expect(script).toContain('Podcasts.pause()');
  });

  test('playbackControlScript nextTrack', () => {
    const script = playbackControlScript('nextTrack');
    expect(script).toContain('Podcasts.nextTrack()');
  });

  test('playbackControlScript previousTrack', () => {
    const script = playbackControlScript('previousTrack');
    expect(script).toContain('Podcasts.previousTrack()');
  });

  test('playbackControlScript throws on invalid action', () => {
    expect(() => playbackControlScript('stop')).toThrow('Invalid playback action: stop');
    expect(() => playbackControlScript('rewind')).toThrow('Invalid playback action: rewind');
    expect(() => playbackControlScript('')).toThrow('Invalid playback action: ');
  });

  test('playEpisodeScript without show', () => {
    const script = playEpisodeScript('Episode 1');
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain("whose({name: 'Episode 1'})");
    expect(script).toContain('found.play()');
  });

  test('playEpisodeScript with show', () => {
    const script = playEpisodeScript('Pilot', 'Serial');
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain("whose({name: 'Serial'})");
    expect(script).toContain("whose({name: 'Pilot'})");
    expect(script).toContain('episodes[0].play()');
  });

  test('searchEpisodesScript', () => {
    const script = searchEpisodesScript('technology', 20);
    expect(script).toContain("Application('Podcasts')");
    expect(script).toContain("'technology'");
    expect(script).toContain('toLowerCase()');
    expect(script).toContain('20');
  });
});

describe('podcasts esc() injection prevention', () => {
  test('escapes single quotes in show name', () => {
    const script = listEpisodesScript("80's Podcast", 10);
    expect(script).toContain("80\\'s Podcast");
  });

  test('escapes single quotes in search query', () => {
    const script = searchEpisodesScript("it's a podcast", 10);
    expect(script).toContain("it\\'s a podcast");
  });

  test('escapes single quotes in episode name', () => {
    const script = playEpisodeScript("Ocean's Story");
    expect(script).toContain("Ocean\\'s Story");
  });

  test('escapes backslashes in show name', () => {
    const script = listEpisodesScript('back\\slash', 10);
    expect(script).toContain('back\\\\slash');
  });

  test('escapes backslashes in search query', () => {
    const script = searchEpisodesScript('path\\to', 5);
    expect(script).toContain('path\\\\to');
  });

  test('escapes backslashes in episode name', () => {
    const script = playEpisodeScript('file\\name');
    expect(script).toContain('file\\\\name');
  });
});
