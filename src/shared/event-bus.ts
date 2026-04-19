import { EventEmitter } from "node:events";

export type AirMCPEventType =
  | "calendar_changed"
  | "reminders_changed"
  | "pasteboard_changed"
  | "mail_unread_changed"
  | "focus_mode_changed"
  | "now_playing_changed"
  | "file_modified"
  | "screen_locked"
  | "screen_unlocked";

export interface AirMCPEvent {
  type: AirMCPEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

const VALID_EVENT_TYPES = new Set<AirMCPEventType>([
  "calendar_changed",
  "reminders_changed",
  "pasteboard_changed",
  "mail_unread_changed",
  "focus_mode_changed",
  "now_playing_changed",
  "file_modified",
  "screen_locked",
  "screen_unlocked",
]);

function isValidEventType(value: unknown): value is AirMCPEventType {
  return typeof value === "string" && VALID_EVENT_TYPES.has(value as AirMCPEventType);
}

class EventBus extends EventEmitter {
  private running = false;

  constructor() {
    super();
    // Raised from the default 10 to accommodate 7 typed event names × a
    // handful of listeners each (skills engine + mcp-setup handlers + the
    // generic "event" channel). 50 leaves headroom for future triggers.
    this.setMaxListeners(50);
  }

  /** Process a raw event line from the Swift bridge. */
  processLine(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const obj = parsed as Record<string, unknown>;
      if (!isValidEventType(obj.event)) return;
      const data =
        obj.data !== null && typeof obj.data === "object" && !Array.isArray(obj.data)
          ? (obj.data as Record<string, unknown>)
          : {};
      const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : new Date().toISOString();
      const event: AirMCPEvent = { type: obj.event, data, timestamp };
      this.emit("event", event);
      this.emit(event.type, event);
    } catch (e) {
      // Regular output (progress messages, debug prints, non-JSON chatter)
      // is interleaved with event lines on the same stream, so a silent
      // ignore is the default. BUT if the line *looks* like an event
      // attempt — mentions an "event" or "type" key — surface the parse
      // failure so protocol drift between the Swift side and Node side
      // does not go undetected.
      if (line.includes('"event"') || line.includes('"type"')) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[AirMCP event-bus] Malformed event line dropped: ${msg} — ${line.slice(0, 120)}${line.length > 120 ? "…" : ""}`,
        );
      }
    }
  }

  /**
   * Emit an event from a Node-side source (pollers for mail_unread_changed,
   * now_playing_changed, etc. that don't have a native observer API).
   * Uses the same shape as processLine'd events so downstream listeners
   * (skills triggers, resource invalidation) treat them identically.
   */
  emitNodeEvent(type: AirMCPEventType, data: Record<string, unknown> = {}): void {
    if (!VALID_EVENT_TYPES.has(type)) return;
    const event: AirMCPEvent = { type, data, timestamp: new Date().toISOString() };
    this.emit("event", event);
    this.emit(event.type, event);
  }

  /** Check if the event bus is active. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Mark as running. */
  start(): void {
    this.running = true;
  }

  /** Mark as stopped and remove all listeners. */
  stop(): void {
    this.running = false;
    this.removeAllListeners();
  }
}

export const eventBus = new EventBus();
