// Podcasts scripts — SQLite for reading, Shortcuts for playback.
//
// Apple Podcasts has NO AppleScript/JXA scripting dictionary.
// The previous JXA-based scripts never worked.
//
// New approach:
// - Read operations: query the Podcasts SQLite database directly
// - Playback: use `shortcuts run` or `open podcasts://` URL scheme

import { escJxaShell } from "../shared/esc.js";

const PODCASTS_DB = "~/Library/Group\\\\ Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite";

function sqliteQuery(sql: string): string {
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
      const raw = app.doShellScript('sqlite3 -json ${PODCASTS_DB} "${sql}"');
      JSON.stringify(JSON.parse(raw));
    } catch(e) {
      JSON.stringify({error: e.message, hint: "Podcasts database may require Full Disk Access. Check System Settings > Privacy > Full Disk Access."});
    }
  `;
}

export function listShowsScript(): string {
  return sqliteQuery(
    "SELECT ZTITLE as name, ZAUTHOR as author, " +
    "(SELECT COUNT(*) FROM ZMTEPISODE WHERE ZMTEPISODE.ZPODCAST = ZMTPODCAST.Z_PK) as episodeCount " +
    "FROM ZMTPODCAST ORDER BY ZTITLE"
  );
}

export function listEpisodesScript(showName: string, limit: number): string {
  const safe = showName.replace(/'/g, "''");
  return sqliteQuery(
    `SELECT e.ZTITLE as title, e.ZPUBDATE as date, e.ZDURATION as duration, e.ZPLAYCOUNT as playCount ` +
    `FROM ZMTEPISODE e JOIN ZMTPODCAST p ON e.ZPODCAST = p.Z_PK ` +
    `WHERE p.ZTITLE = '${safe}' ORDER BY e.ZPUBDATE DESC LIMIT ${limit}`
  );
}

export function searchEpisodesScript(query: string, limit: number): string {
  const safe = query.replace(/'/g, "''");
  return sqliteQuery(
    `SELECT e.ZTITLE as title, p.ZTITLE as show, e.ZPUBDATE as date, e.ZDURATION as duration ` +
    `FROM ZMTEPISODE e JOIN ZMTPODCAST p ON e.ZPODCAST = p.Z_PK ` +
    `WHERE e.ZTITLE LIKE '%${safe}%' OR e.ZITEMDESCRIPTION LIKE '%${safe}%' ` +
    `ORDER BY e.ZPUBDATE DESC LIMIT ${limit}`
  );
}

export function nowPlayingScript(): string {
  // Use System Events to check if Podcasts is running and get now-playing info
  return `
    const se = Application('System Events');
    const running = se.applicationProcesses.whose({name: 'Podcasts'})().length > 0;
    if (!running) {
      JSON.stringify({playerState: 'stopped', episode: null, hint: 'Podcasts app is not running'});
    } else {
      const app = Application.currentApplication();
      app.includeStandardAdditions = true;
      try {
        const raw = app.doShellScript('sqlite3 -json ${PODCASTS_DB} "SELECT e.ZTITLE as title, p.ZTITLE as show, e.ZDURATION as duration FROM ZMTEPISODE e JOIN ZMTPODCAST p ON e.ZPODCAST = p.Z_PK WHERE e.ZLASTDATEPLAYED IS NOT NULL ORDER BY e.ZLASTDATEPLAYED DESC LIMIT 1"');
        const episodes = JSON.parse(raw);
        JSON.stringify({playerState: 'running', lastPlayed: episodes[0] || null});
      } catch(e) {
        JSON.stringify({playerState: 'running', error: e.message});
      }
    }
  `;
}

export function playbackControlScript(action: string): string {
  // Use System Events keyboard simulation for playback control
  const keyMap: Record<string, string> = {
    play: "space",
    pause: "space",
    nextTrack: "using {command down}, \"right arrow\"",
    previousTrack: "using {command down}, \"left arrow\"",
  };
  const key = keyMap[action];
  if (!key) throw new Error(`Invalid playback action: ${action}`);

  return `
    const se = Application('System Events');
    const procs = se.applicationProcesses.whose({name: 'Podcasts'})();
    if (procs.length === 0) throw new Error('Podcasts app is not running. Launch it first.');
    Application('Podcasts').activate();
    delay(0.3);
    se.keystroke(${action === "play" || action === "pause" ? '" "' : ""}, ${key.includes("command") ? `{${key}}` : ""});
    JSON.stringify({action: '${action}', sent: true});
  `;
}

export function playEpisodeScript(episodeName: string, _showName?: string): string {
  // Open the Podcasts app and use URL scheme to search
  const q = encodeURIComponent(episodeName);
  return `
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.openLocation('podcasts://search?term=${q}');
    JSON.stringify({action: 'openSearch', query: '${escJxaShell(episodeName)}', hint: 'Opened Podcasts search. Select and play the episode manually.'});
  `;
}
