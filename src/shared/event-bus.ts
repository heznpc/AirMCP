import { EventEmitter } from "node:events";

export interface AirMCPEvent {
  type: "calendar_changed" | "reminders_changed" | "pasteboard_changed";
  data: Record<string, unknown>;
  timestamp: string;
}

const VALID_EVENT_TYPES = new Set<AirMCPEvent["type"]>(["calendar_changed", "reminders_changed", "pasteboard_changed"]);

function isValidEventType(value: unknown): value is AirMCPEvent["type"] {
  return typeof value === "string" && VALID_EVENT_TYPES.has(value as AirMCPEvent["type"]);
}

class EventBus extends EventEmitter {
  private running = false;

  constructor() {
    super();
    this.setMaxListeners(25);
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
    } catch {
      // Not an event line — ignore
    }
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
