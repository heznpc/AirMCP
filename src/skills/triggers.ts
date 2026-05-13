import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition } from "./types.js";
import { executeSkill } from "./executor.js";
import { eventBus, type AirMCPEvent } from "../shared/event-bus.js";
import { runWithRequestContext, getRequestContext } from "../shared/request-context.js";
import { randomUUID } from "node:crypto";

interface TriggerBinding {
  skill: SkillDefinition;
  debounceMs: number;
  lastFired: number;
}

const bindings = new Map<string, TriggerBinding[]>();

// Retry policy for failed trigger dispatches. Exponential backoff (2s → 4s
// → 8s …) with jitter avoids thundering-herd retries when many triggers fire
// on the same event (e.g. a burst of `calendar_changed`). Override via env
// for tests / aggressive polling setups.
const TRIGGER_MAX_RETRIES = Math.max(0, parseInt(process.env.AIRMCP_TRIGGER_MAX_RETRIES ?? "2", 10));
const TRIGGER_BASE_BACKOFF_MS = Math.max(100, parseInt(process.env.AIRMCP_TRIGGER_BASE_BACKOFF_MS ?? "2000", 10));
const TRIGGER_MAX_BACKOFF_MS = Math.max(
  TRIGGER_BASE_BACKOFF_MS,
  parseInt(process.env.AIRMCP_TRIGGER_MAX_BACKOFF_MS ?? "60000", 10),
);

function computeBackoff(attempt: number): number {
  // attempt is 1-indexed: the 1st retry waits BASE, the 2nd waits 2×BASE, …
  const exp = Math.min(TRIGGER_MAX_BACKOFF_MS, TRIGGER_BASE_BACKOFF_MS * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * (exp * 0.25));
  return exp + jitter;
}

function runWithRetry(server: McpServer, skill: SkillDefinition, attempt: number): void {
  // Stamp an autonomous-origin actor + fresh correlation ID on the
  // AsyncLocalStorage context so every tool call inside this skill
  // execution lands in the audit log as `actor: "daemon-skill:<name>"`.
  // Without this stamp, autonomous tool calls were indistinguishable
  // from user-initiated ones during audit review.
  const existing = getRequestContext();
  const ctx = {
    ...(existing ?? {}),
    actor: `daemon-skill:${skill.name}`,
    correlationId: existing?.correlationId ?? randomUUID(),
  };
  runWithRequestContext(ctx, () => {
    executeSkill(server, skill).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[AirMCP] Trigger ${skill.name} failed (attempt ${attempt}): ${msg}`);
      if (attempt >= 1 + TRIGGER_MAX_RETRIES) return;
      const delay = computeBackoff(attempt);
      const t = setTimeout(() => runWithRetry(server, skill, attempt + 1), delay);
      t.unref?.();
    });
  });
}

/** Reset all registered trigger bindings and listener state. Called by
 *  registerSkillEngine before re-registering, so per-session createServer
 *  calls don't accumulate duplicate bindings. Also resets the listener
 *  flag so triggers survive an eventBus.stop() + restart cycle. */
export function resetTriggers(): void {
  bindings.clear();
  listenerInstalled = false;
  activeServer = null;
}

/** Register a skill's trigger with the event bus. */
export function registerTrigger(skill: SkillDefinition): void {
  if (!skill.trigger) return;
  const { event, debounce_ms } = skill.trigger;
  const list = bindings.get(event) ?? [];
  list.push({ skill, debounceMs: debounce_ms ?? 5000, lastFired: 0 });
  bindings.set(event, list);
}

// Singleton listener — created once per process. Subsequent calls to
// startTriggerListener swap the active server reference instead of attaching
// a new listener, so per-session createServer calls don't accumulate listeners
// on the eventBus.
let activeServer: McpServer | null = null;
let listenerInstalled = false;

function dispatch(evt: AirMCPEvent): void {
  const server = activeServer;
  if (!server) return;
  const list = bindings.get(evt.type);
  if (!list) return;

  const now = Date.now();
  for (const binding of list) {
    if (now - binding.lastFired < binding.debounceMs) continue;
    binding.lastFired = now;

    // Fire and forget — don't block the event loop. `runWithRetry` handles
    // exponential backoff with jitter so bursty events (e.g. many calendar
    // updates in quick succession) don't line their retries up.
    runWithRetry(server, binding.skill, 1);
  }
}

/** Start listening for events and dispatching skills. Idempotent. */
export function startTriggerListener(server: McpServer): void {
  activeServer = server;
  if (listenerInstalled) return;
  eventBus.on("event", dispatch);
  listenerInstalled = true;
}

/** Get all registered triggers for diagnostics. */
export function getRegisteredTriggers(): Array<{ skill: string; event: string; debounceMs: number }> {
  const result: Array<{ skill: string; event: string; debounceMs: number }> = [];
  for (const [event, list] of bindings) {
    for (const b of list) {
      result.push({ skill: b.skill.name, event, debounceMs: b.debounceMs });
    }
  }
  return result;
}
