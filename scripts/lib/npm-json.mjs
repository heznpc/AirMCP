/**
 * Parse the package list out of `npm pack --json` stdout, across npm majors.
 *
 * Two independent problems make naive parsing fragile:
 *
 * 1. npm 11+ interleaves notice/log lines around the payload — including
 *    lines that contain brackets — so `JSON.parse(stdout)` and
 *    first-`[`/last-`]` slices both break.
 * 2. npm 12 changed the payload shape from an ARRAY of pack objects to an
 *    OBJECT keyed by package name (`{"airmcp": {...}}`), so bracket-hunting
 *    for `[` finds the inner `files` array instead of the payload.
 *
 * Strategy: walk every `[`/`{` in the text, extract the balanced span
 * (tracking string/escape state), parse it, normalize array vs. keyed-object
 * shapes to a list, and accept the first candidate whose entries all look
 * like pack metadata (string `name` and `version`). Returns null when no
 * candidate matches.
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

function looksLikePack(item) {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof item.name === "string" &&
    typeof item.version === "string"
  );
}

export function parseNpmPackList(output) {
  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (ch !== "[" && ch !== "{") continue;
    const span = balancedSpanFrom(output, i);
    if (!span) continue;
    let parsed;
    try {
      parsed = JSON.parse(span);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed !== null && typeof parsed === "object"
        ? Object.values(parsed)
        : [];
    if (list.length > 0 && list.every(looksLikePack)) return list;
  }
  return null;
}
