/**
 * Server initialization — package.json loading, config parsing,
 * OS version detection, HITL client setup, and process exit handlers.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseConfig, getOsVersion, type AirMcpConfig } from "../shared/config.js";
import { HitlClient } from "../shared/hitl.js";
import { setShareGuardHitlClient } from "../shared/share-guard.js";
import { closeSkillsWatcher } from "../skills/index.js";
import { closeSwiftBridge } from "../shared/swift.js";
import { usageTracker } from "../shared/usage-tracker.js";
import { runShutdownHooks } from "./shutdown.js";
import { log, errToCtx } from "../shared/logger.js";

// Re-export so callers that depend on `init.js` do not need to know about
// the shutdown module layout. New transport code should prefer importing
// `registerShutdownHook` directly from `./shutdown.js` — that module has no
// heavy transitive dependencies, which keeps test mocks shallow.
export { registerShutdownHook } from "./shutdown.js";

export interface ServerContext {
  config: AirMcpConfig;
  osVersion: number;
  pkg: { version: string; description?: string };
  hitlClient: HitlClient | null;
}

export function initializeServer(): ServerContext {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")) as {
    version: string;
    description?: string;
  };

  const config = parseConfig();
  const osVersion = getOsVersion();

  // HITL client — shared across all servers, created once if enabled
  let hitlClient: HitlClient | null = null;
  if (config.hitl.level !== "off") {
    hitlClient = new HitlClient(config.hitl);
    setShareGuardHitlClient(hitlClient);
  }

  // Clean up resources on exit. Guarded against double-execution because
  // SIGINT/SIGTERM handlers call onExit() AND then process.exit(0), which
  // re-fires the "exit" event handler.
  let exited = false;
  function onExit() {
    if (exited) return;
    exited = true;
    usageTracker.stop();
    usageTracker.flushSync();
    closeSkillsWatcher();
    closeSwiftBridge();
    if (hitlClient) {
      hitlClient.dispose();
      hitlClient = null;
      setShareGuardHitlClient(null);
    }
  }
  async function gracefulShutdown(code: number): Promise<void> {
    if (exited) return;
    // Run async hooks first (bounded by shutdown.ts's timeout), then the
    // synchronous onExit cleanup, then finally exit. Keeping hook ownership
    // in a separate module means transport code can register cleanup
    // without pulling in init's heavy dependency graph.
    await runShutdownHooks();
    onExit();
    process.exit(code);
  }
  process.on("exit", onExit);
  process.on("SIGINT", () => {
    void gracefulShutdown(0);
  });
  process.on("SIGTERM", () => {
    void gracefulShutdown(0);
  });

  // Catch unhandled errors to prevent silent crashes
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled promise rejection", { err: errToCtx(reason) });
  });
  process.on("uncaughtException", (error) => {
    log.error("uncaught exception", { err: errToCtx(error) });
    void gracefulShutdown(1);
  });

  return { config, osVersion, pkg, hitlClient };
}
