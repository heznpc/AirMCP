import { eventBus, type AirMCPEventType } from "./event-bus.js";
import { runJxa } from "./jxa.js";
import { getUnreadCountScript } from "../mail/scripts.js";
import { nowPlayingScript } from "../music/scripts.js";

/**
 * Node-side pollers for events that don't have a native observer API.
 *
 * Mail.app does not expose an AppleEvent notification for unread-count
 * changes, and cross-app "now playing" requires the private MediaRemote
 * framework. For these signals we poll existing JXA tools at a
 * configurable interval, diff against the last observed value, and emit
 * into the event bus only when the value changes.
 *
 * Pollers are strictly passive — if the app isn't running or the user
 * hasn't granted Automation permission, we silence transient errors and
 * keep trying on the next tick instead of spamming stderr.
 */

// Default intervals keep polling cheap. Overridable via env for dev/testing.
const MAIL_INTERVAL_MS = Math.max(10_000, parseInt(process.env.AIRMCP_MAIL_POLL_MS ?? "60000", 10));
// Music.app's JXA query is cheap but each tick spawns an osascript process
// and wakes the CPU; 30 s is a reasonable default for "is a track change
// happening" without hammering battery. Consider migrating to the
// `com.apple.Music.playerInfo` DistributedNotification for zero-cost events
// once the Swift side is wired up.
const MUSIC_INTERVAL_MS = Math.max(5_000, parseInt(process.env.AIRMCP_MUSIC_POLL_MS ?? "30000", 10));

interface UnreadPayload {
  totalUnread: number;
  mailboxes: Array<{ account: string; mailbox: string; unread: number }>;
}

interface NowPlayingPayload {
  playerState: string;
  track: { name: string; artist: string; album: string; duration?: number; playerPosition?: number } | null;
}

interface Poller {
  name: string;
  event: AirMCPEventType;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  tick: () => Promise<void>;
}

let lastUnread: number | null = null;
let lastTrackKey: string | null = null;
let lastPlayerState: string | null = null;

// Error throttling — only log one failure per poller per 5 minutes.
const errorThrottle = new Map<string, number>();
const ERROR_THROTTLE_MS = 5 * 60 * 1000;

function shouldLogError(key: string): boolean {
  const now = Date.now();
  const last = errorThrottle.get(key) ?? 0;
  if (now - last < ERROR_THROTTLE_MS) return false;
  errorThrottle.set(key, now);
  return true;
}

async function pollMailUnread(): Promise<void> {
  try {
    const payload = await runJxa<UnreadPayload>(getUnreadCountScript(), "Mail");
    const total = typeof payload?.totalUnread === "number" ? payload.totalUnread : 0;
    if (lastUnread === null) {
      lastUnread = total;
      return; // First read — establish baseline, don't emit
    }
    if (total !== lastUnread) {
      const delta = total - lastUnread;
      const previous = lastUnread;
      lastUnread = total;
      eventBus.emitNodeEvent("mail_unread_changed", {
        source: "poll",
        totalUnread: total,
        previousUnread: previous,
        delta,
        mailboxes: payload.mailboxes ?? [],
      });
    }
  } catch (e) {
    if (shouldLogError("mail")) {
      console.error(`[AirMCP pollers] mail_unread poll failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function pollNowPlaying(): Promise<void> {
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
    if (shouldLogError("music")) {
      console.error(`[AirMCP pollers] now_playing poll failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const pollers: Poller[] = [
  {
    name: "mail_unread",
    event: "mail_unread_changed",
    intervalMs: MAIL_INTERVAL_MS,
    timer: null,
    tick: pollMailUnread,
  },
  {
    name: "now_playing",
    event: "now_playing_changed",
    intervalMs: MUSIC_INTERVAL_MS,
    timer: null,
    tick: pollNowPlaying,
  },
];

let started = false;

/** Start all pollers. Idempotent. */
export function startPollers(): void {
  if (started) return;
  if (process.env.AIRMCP_DISABLE_POLLERS === "1") return;
  started = true;
  for (const p of pollers) {
    // Fire once immediately to establish baseline, then on interval.
    p.tick().catch(() => undefined);
    p.timer = setInterval(() => {
      p.tick().catch(() => undefined);
    }, p.intervalMs);
    // unref so pollers don't keep the process alive on exit
    p.timer.unref?.();
  }
}

/** Stop all pollers and clear cached state. */
export function stopPollers(): void {
  for (const p of pollers) {
    if (p.timer) clearInterval(p.timer);
    p.timer = null;
  }
  lastUnread = null;
  lastTrackKey = null;
  lastPlayerState = null;
  errorThrottle.clear();
  started = false;
}

/** Inspect poller status (diagnostics only). */
export function getPollerStatus(): Array<{ name: string; event: string; intervalMs: number; running: boolean }> {
  return pollers.map((p) => ({ name: p.name, event: p.event, intervalMs: p.intervalMs, running: p.timer !== null }));
}
