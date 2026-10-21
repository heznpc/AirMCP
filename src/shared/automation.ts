import { runSwift, hasSwiftCommand } from "./swift.js";
import { runJxa } from "./jxa.js";
import { log, errToCtx } from "./logger.js";

/**
 * Prefer Swift when available. Once a Swift request has been attempted its
 * outcome may be unknown (for example after a timeout), so only explicitly
 * read-only operations may fall back to JXA. Writes must never be replayed.
 */
export async function runAutomation<T>(options: {
  swift: { command: string; input?: unknown };
  readOnly?: boolean;
  jxa: () => string;
  parse?: (raw: string) => T;
}): Promise<T> {
  // Check if the Swift bridge supports this command before trying it
  if (await hasSwiftCommand(options.swift.command)) {
    try {
      return await runSwift<T>(options.swift.command, JSON.stringify(options.swift.input ?? {}));
    } catch (swiftErr) {
      if (options.readOnly !== true) throw swiftErr;
      // Retrying a read cannot duplicate a mutation.
      log.warn("swift bridge failed — falling back to JXA", {
        command: options.swift.command,
        err: errToCtx(swiftErr),
      });
    }
  }

  // Fallback to JXA
  const raw = await runJxa<T>(
    options.jxa(),
    undefined,
    options.readOnly === true ? { retryMode: "read-only" } : undefined,
  );
  return raw;
}
