import { eventBus } from "../shared/event-bus.js";
import { runJxa } from "../shared/jxa.js";
import { createPollerLogger, registerPoller } from "../shared/pollers.js";
import { nowPlayingScript } from "./scripts.js";

/**
 * Music.app's JXA query is cheap but each tick spawns an osascript process
 * and wakes the CPU; 30 s is a reasonable default for "is a track change
 * happening" without hammering battery. Consider migrating to the
 * `com.apple.Music.playerInfo` DistributedNotification for zero-cost events
 * once the Swift side is wired up.
 */

// A non-numeric AIRMCP_MUSIC_POLL_MS makes parseInt return NaN, and Math.max(5000, NaN)
// is NaN — which setInterval coerces to 0, turning this into a runaway osascript hot
// loop. Fall back to the default when the value is not a finite number.
const MUSIC_POLL_PARSED = parseInt(process.env.AIRMCP_MUSIC_POLL_MS ?? "30000", 10);
const MUSIC_INTERVAL_MS = Number.isFinite(MUSIC_POLL_PARSED) ? Math.max(5_000, MUSIC_POLL_PARSED) : 30_000;

interface NowPlayingPayload {
  playerState: string;
  track: { name: string; artist: string; album: string; duration?: number; playerPosition?: number } | null;
}

let lastTrackKey: string | null = null;
let lastPlayerState: string | null = null;
const logError = createPollerLogger("now_playing");

async function tick(): Promise<void> {
  try {
    const payload = await runJxa<NowPlayingPayload>(nowPlayingScript(), "Music");
    const state = payload?.playerState ?? "stopped";
    const track = payload?.track;
    const key = track ? `${track.artist ?? ""}|${track.album ?? ""}|${track.name ?? ""}` : "";
    if (lastTrackKey === null && lastPlayerState === null) {
      lastTrackKey = key;
      lastPlayerState = state;
      return; // Baseline
    }
    const trackChanged = key !== lastTrackKey;
    const stateChanged = state !== lastPlayerState;
    if (trackChanged || stateChanged) {
      const previousState = lastPlayerState;
      lastTrackKey = key;
      lastPlayerState = state;
      eventBus.emitNodeEvent("now_playing_changed", {
        source: "poll",
        playerState: state,
        previousPlayerState: previousState,
        trackChanged,
        track: track ?? null,
      });
    }
  } catch (e) {
    logError(e);
  }
}

registerPoller({
  name: "now_playing",
  event: "now_playing_changed",
  intervalMs: MUSIC_INTERVAL_MS,
  tick,
  reset: () => {
    lastTrackKey = null;
    lastPlayerState = null;
  },
});
