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

/** Register a skill's trigger with the event bus. */
export function registerTrigger(skill: SkillDefinition): void {
  if (!skill.trigger) return;
  const { event, debounce_ms } = skill.trigger;
  const list = bindings.get(event) ?? [];
  list.push({ skill, debounceMs: debounce_ms ?? 5000, lastFired: 0 });
  bindings.set(event, list);
}

/** Start listening for events and dispatching skills. */
export function startTriggerListener(server: McpServer): void {
  eventBus.on("event", (evt: AirMCPEvent) => {
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
        // Single retry after 2s delay
        setTimeout(() => {
          executeSkill(server, binding.skill).catch((e2) => {
            console.error(
              `[AirMCP] Trigger ${binding.skill.name} failed (attempt 2): ${e2 instanceof Error ? e2.message : String(e2)}`,
            );
          });
        }, 2000);
      });
    }
  });
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
