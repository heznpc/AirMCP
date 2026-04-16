import type { McpServer } from "../shared/mcp.js";
import type { SkillDefinition } from "./types.js";
import { executeSkill } from "./executor.js";
import { eventBus, type AirMCPEvent } from "../shared/event-bus.js";

interface TriggerBinding {
  skill: SkillDefinition;
  debounceMs: number;
  lastFired: number;
}

const bindings = new Map<string, TriggerBinding[]>();

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

    // Fire and forget — don't block the event loop. Retry once on failure.
    executeSkill(server, binding.skill).catch((e) => {
      console.error(
        `[AirMCP] Trigger ${binding.skill.name} failed (attempt 1): ${e instanceof Error ? e.message : String(e)}`,
      );
      setTimeout(() => {
        executeSkill(server, binding.skill).catch((e2) => {
          console.error(
            `[AirMCP] Trigger ${binding.skill.name} failed (attempt 2): ${e2 instanceof Error ? e2.message : String(e2)}`,
          );
        });
      }, 2000);
    });
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
