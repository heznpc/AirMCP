import { runSwift, hasSwiftCommand } from "./swift.js";
import { runJxa } from "./jxa.js";

/**
 * Run an automation command, preferring Swift bridge when available.
 * Falls back to JXA if the Swift bridge is not built, the command is
 * not implemented in Swift, or the Swift call fails.
 *
 * @param options.swift.command  The Swift bridge command name (e.g. "get-clipboard")
 * @param options.swift.input    Optional input payload (will be JSON-serialized)
 * @param options.jxa            Lazy JXA script generator (only called if needed)
 * @param options.parse          Optional parser for JXA raw output (defaults to JSON.parse)
 */
export async function runAutomation<T>(options: {
  swift: { command: string; input?: unknown };
  jxa: () => string;
  parse?: (raw: string) => T;
}): Promise<T> {
  // Check if the Swift bridge supports this command before trying it
  if (await hasSwiftCommand(options.swift.command)) {
    try {
      return await runSwift<T>(
        options.swift.command,
        JSON.stringify(options.swift.input ?? {}),
      );
    } catch (swiftErr) {
      // Swift bridge failed — fall through to JXA fallback
      console.error(
        `[AirMCP] Swift bridge failed for "${options.swift.command}", falling back to JXA: ${swiftErr instanceof Error ? swiftErr.message : String(swiftErr)}`,
      );
    }
  }

  // Fallback to JXA
  const raw = await runJxa<T>(options.jxa());
  return raw;
}
