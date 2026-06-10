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
 * we reduce per-tool token cost at registration time by sending only as
 * many leading complete sentences as fit a fixed character budget.
 *
 * The full descriptions are preserved in the tool registry for
 * discover_tools / semantic search so search quality is unaffected.
 */

const COMPACT_MODE = process.env.AIRMCP_COMPACT_TOOLS !== "false";

/** Whether compact tool descriptions are enabled. */
export function isCompactMode(): boolean {
  return COMPACT_MODE;
}

/** Character budget for the compacted description sent over the wire. */
const COMPACT_BUDGET = 160;

/**
 * Shorten a tool description for compact mode.
 *
 * Keeps as many leading COMPLETE sentences as fit COMPACT_BUDGET, so the
 * wire description never ends in a mid-word cut — agents (and registry
 * quality scorers) always see whole sentences. A boundary is sentence
 * punctuation followed by whitespace, so "etc.)", "e.g.," and version
 * numbers don't split. Only when the first sentence alone exceeds the
 * budget does it fall back to a word-boundary cut with an ellipsis.
 * Returns the original description unchanged when compact mode is off.
 *
 * History: the previous form kept the first sentence but hard-capped it at
 * 80 chars with a mid-word slice(0,77)+"..." — every tool whose first
 * sentence ran past 80 shipped broken prose over the wire, which registry
 * quality scoring flagged catalog-wide. Whole sentences within a slightly
 * larger budget keep the token savings without the broken text.
 */
export function compactDescription(description: string): string {
  if (!COMPACT_MODE) return description;
  const text = description.trim();
  if (text.length <= COMPACT_BUDGET) {
    return /[.!?]$/.test(text) ? text : text + ".";
  }
  // Find the last sentence boundary that still fits the budget.
  const boundary = /[.!?](?=\s)/g;
  let cutEnd = 0;
  for (let m = boundary.exec(text); m !== null; m = boundary.exec(text)) {
    if (m.index + 1 > COMPACT_BUDGET) break;
    cutEnd = m.index + 1;
  }
  if (cutEnd > 0) return text.slice(0, cutEnd);
  // First sentence alone exceeds the budget (or no sentence punctuation):
  // cut at the last word boundary, never mid-word.
  const head = text.slice(0, COMPACT_BUDGET - 1);
  const lastSpace = head.lastIndexOf(" ");
  return (lastSpace > 40 ? head.slice(0, lastSpace) : head).trimEnd() + "…";
}
