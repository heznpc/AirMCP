import { randomUUID } from "node:crypto";

export const TOOL_SESSION_CONTROL_TOOLS = ["start_tool_session", "tool_session_status", "end_tool_session"] as const;

export interface ToolSessionInfo {
  sessionId: string;
  label?: string;
  allowedTools: string[];
  createdAt: string;
  expiresAt: string;
  remainingSeconds: number;
}

interface ToolSessionEntry {
  sessionId: string;
  label?: string;
  allowedTools: Set<string>;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface StartToolSessionInput {
  tools: string[];
  ttlSeconds?: number;
  label?: string;
}

const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 60 * 60;
const MAX_TOOLS_PER_SESSION = 64;

function clampTtlSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(Math.trunc(value), 30), MAX_TTL_SECONDS);
}

function toInfo(entry: ToolSessionEntry, now = Date.now()): ToolSessionInfo {
  return {
    sessionId: entry.sessionId,
    ...(entry.label ? { label: entry.label } : {}),
    allowedTools: [...entry.allowedTools].sort(),
    createdAt: new Date(entry.createdAtMs).toISOString(),
    expiresAt: new Date(entry.expiresAtMs).toISOString(),
    remainingSeconds: Math.max(0, Math.ceil((entry.expiresAtMs - now) / 1000)),
  };
}

class ToolSessionStore {
  private sessions = new Map<string, ToolSessionEntry>();

  start(input: StartToolSessionInput): ToolSessionInfo {
    this.pruneExpired();
    const allowedTools = [...new Set(input.tools.map((name) => name.trim()).filter(Boolean))].slice(
      0,
      MAX_TOOLS_PER_SESSION,
    );
    const ttlSeconds = clampTtlSeconds(input.ttlSeconds);
    const now = Date.now();
    const entry: ToolSessionEntry = {
      sessionId: randomUUID(),
      ...(input.label?.trim() ? { label: input.label.trim().slice(0, 120) } : {}),
      allowedTools: new Set(allowedTools),
      createdAtMs: now,
      expiresAtMs: now + ttlSeconds * 1000,
    };
    this.sessions.set(entry.sessionId, entry);
    return toInfo(entry, now);
  }

  get(sessionId: string): ToolSessionInfo | null {
    const entry = this.getEntry(sessionId);
    return entry ? toInfo(entry) : null;
  }

  getAllowedTools(sessionId: string): Set<string> | null {
    const entry = this.getEntry(sessionId);
    return entry ? new Set(entry.allowedTools) : null;
  }

  assertAllowed(sessionId: string | undefined, toolName: string): { ok: true } | { ok: false; message: string } {
    if (!sessionId) return { ok: true };
    const entry = this.getEntry(sessionId);
    if (!entry) return { ok: false, message: `Tool session "${sessionId}" was not found or has expired.` };
    if (!entry.allowedTools.has(toolName)) {
      return {
        ok: false,
        message: `Tool "${toolName}" is outside tool session "${sessionId}". Allowed tools: ${[...entry.allowedTools]
          .sort()
          .join(", ")}`,
      };
    }
    return { ok: true };
  }

  end(sessionId: string): boolean {
    this.pruneExpired();
    return this.sessions.delete(sessionId);
  }

  activeCount(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  resetForTests(): void {
    this.sessions.clear();
  }

  private getEntry(sessionId: string): ToolSessionEntry | null {
    this.pruneExpired();
    return this.sessions.get(sessionId) ?? null;
  }

  private pruneExpired(now = Date.now()): void {
    for (const [sessionId, entry] of this.sessions) {
      if (entry.expiresAtMs <= now) this.sessions.delete(sessionId);
    }
  }
}

export const toolSessions = new ToolSessionStore();
