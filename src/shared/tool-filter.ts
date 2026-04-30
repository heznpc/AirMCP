/**
 * Tool description optimizer — reduces token consumption in tools/list.
 *
 * Compact mode is ON by default. Set AIRMCP_COMPACT_TOOLS=false to disable.
 * Tool descriptions are shortened to save tokens in the LLM context window.
 *
 * Run `npm run tokens` to measure the live reduction; the script applies
 * this same transform to the manifest at docs/tool-manifest.json. As of
 * this writing the reduction is ~50% on the description budget across
 * 282 tools (heuristic 4 chars/token).
 *
 * This is the pragmatic implementation of SEP-1821 filtering:
 * rather than hacking SDK internals to intercept the tools/list handler,
 * we reduce per-tool token cost at registration time by truncating
 * descriptions to their first sentence.
 *
 * The full descriptions are preserved in the tool registry for
 * discover_tools / semantic search so search quality is unaffected.
 */

const COMPACT_MODE = process.env.AIRMCP_COMPACT_TOOLS !== "false";

/** Whether compact tool descriptions are enabled. */
export function isCompactMode(): boolean {
  return COMPACT_MODE;
}

/**
 * Shorten a tool description for compact mode.
 * Takes the first sentence only and caps at 80 characters.
 * Returns the original description unchanged when compact mode is off.
 */
export function compactDescription(description: string): string {
  if (!COMPACT_MODE) return description;
  // Find first sentence boundary: punctuation (.!?) followed by whitespace
  const match = description.match(/^(.*?[.!?])\s/);
  const firstSentence = match?.[1] ?? description;
  // Cap at 80 chars
  return firstSentence.length > 80
    ? firstSentence.slice(0, 77) + "..."
    : /[.!?]$/.test(firstSentence)
      ? firstSentence
      : firstSentence + ".";
}
