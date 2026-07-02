import { eventBus } from "../shared/event-bus.js";
import { runJxa } from "../shared/jxa.js";
import { createPollerLogger, registerPoller } from "../shared/pollers.js";
import { getUnreadCountScript } from "./scripts.js";

/**
 * Mail.app does not expose an AppleEvent notification for unread-count
 * changes, so we poll the existing JXA query at a configurable interval
 * and emit `mail_unread_changed` only when the total differs from the
 * last observed value.
 */

// A non-numeric AIRMCP_MAIL_POLL_MS makes parseInt return NaN, and Math.max(10000, NaN)
// is NaN — which setInterval coerces to 0, turning this into a runaway osascript hot
// loop. Fall back to the default when the value is not a finite number.
const MAIL_POLL_PARSED = parseInt(process.env.AIRMCP_MAIL_POLL_MS ?? "60000", 10);
const MAIL_INTERVAL_MS = Number.isFinite(MAIL_POLL_PARSED) ? Math.max(10_000, MAIL_POLL_PARSED) : 60_000;

interface UnreadPayload {
  totalUnread: number;
  mailboxes: Array<{ account: string; mailbox: string; unread: number }>;
}

let lastUnread: number | null = null;
const logError = createPollerLogger("mail_unread");

async function tick(): Promise<void> {
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
    logError(e);
  }
}

registerPoller({
  name: "mail_unread",
  event: "mail_unread_changed",
  intervalMs: MAIL_INTERVAL_MS,
  tick,
  reset: () => {
    lastUnread = null;
  },
});
