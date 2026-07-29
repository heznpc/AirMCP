/**
 * Extract the balanced top-level JSON array from npm's stdout.
 *
 * Newer npm releases (11+) interleave notice/log lines around `--json`
 * payloads, so neither `JSON.parse(stdout)` nor a first-`[`/last-`]` slice is
 * reliable — trailing log lines can themselves contain `]`. Walk the text from
 * the first `[` tracking string/escape state and bracket depth to find the
 * true end of the array.
 */
export function extractJsonArray(output) {
  const start = output.indexOf("[");
  if (start < 0) return output;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < output.length; i++) {
    const ch = output[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return output.slice(start, i + 1);
    }
  }
  return output.slice(start);
}
