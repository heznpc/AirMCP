// eslint-disable-next-line no-control-regex
const RE_CTRL = /[\x01-\x08\x0b\x0c\x0e-\x1f]/g;

/** Escape a string for safe interpolation inside JXA single-quoted literals. */
export function esc(str: string): string {
  return (
    str
      .replace(/\0/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(RE_CTRL, "")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  );
}

/** Escape a string for safe interpolation inside AppleScript double-quoted strings. */
export function escAS(str: string): string {
  return (
    str
      .replace(/\0/g, "")
      .replace(RE_CTRL, "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  );
}

/** Escape a string for safe interpolation inside shell double-quoted arguments via doShellScript. */
export function escShell(str: string): string {
  return str
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Escape for shell double-quoted arguments INSIDE a JXA single-quoted string.
 * Produces a string safe for: doShellScript('... "VALUE" ...') in JXA.
 *
 * Two layers applied in one pass (JXA single-quote wrapping shell double-quote):
 *   raw \  → shell needs \\ → JXA needs \\\\
 *   raw "  → shell needs \" → JXA needs \\\"
 *   raw `  → shell needs \` → JXA needs \\`
 *   raw $  → shell needs \$ → JXA needs \\$
 *   raw '  → shell ignores  → JXA needs \\'
 *   newline/CR → JXA \n/\r  → shell receives literal newline/CR (valid in double quotes)
 */
export function escJxaShell(str: string): string {
  return str
    .replace(/\0/g, "")
    .replace(RE_CTRL, "")
    .replace(/\\/g, "\\\\\\\\") // \ → \\\\ (4 backslashes in source = 2 literal)
    .replace(/"/g, '\\\\\\"') // " → \\\"
    .replace(/`/g, "\\\\`") // ` → \\`
    .replace(/\$/g, "\\\\$") // $ → \\$
    .replace(/'/g, "\\'") // ' → \'
    .replace(/\n/g, "\\n") // newline → \n (JXA interprets as newline char)
    .replace(/\r/g, "\\r") // CR → \r (JXA interprets as CR char)
    .replace(/\u2028/g, "\\u2028") // LS — escape so JXA single-quoted string doesn't break
    .replace(/\u2029/g, "\\u2029"); // PS — escape so JXA single-quoted string doesn't break
}

/** Ensure n is a finite integer — prevents shell injection if a non-number leaks through validation. */
export function safeInt(n: number): number {
  const v = Math.trunc(n);
  if (!Number.isSafeInteger(v)) throw new RangeError(`Expected safe integer, got ${n}`);
  return v;
}
