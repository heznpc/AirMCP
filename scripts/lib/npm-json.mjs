/**
 * Extract the top-level JSON array payload from npm's stdout.
 *
 * Newer npm releases (11+) interleave notice/log lines around `--json`
 * payloads — including lines that themselves contain brackets (progress
 * bars, dedupe notes) — so neither `JSON.parse(stdout)` nor a
 * first-`[`/last-`]` slice is reliable. Walk every `[` in the text, extract
 * the balanced bracket span (tracking string/escape state), and return the
 * first span that parses to a non-empty array of objects — the shape every
 * `npm ... --json` array payload has.
 */
function balancedSpanFrom(output, start) {
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
      if (depth < 0) return null;
    }
  }
  return null;
}

export function extractJsonArray(output) {
  let idx = output.indexOf("[");
  while (idx >= 0) {
    const candidate = balancedSpanFrom(output, idx);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((item) => typeof item === "object" && item !== null)
        ) {
          return candidate;
        }
      } catch {
        // not JSON at this bracket — keep scanning
      }
    }
    idx = output.indexOf("[", idx + 1);
  }
  return output;
}
