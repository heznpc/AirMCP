/** Escape a string for safe interpolation inside JXA single-quoted literals. */
export function esc(str: string): string {
  return str
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
 * Two layers: inner escShell for shell, outer esc for JXA single-quote context.
 * Use this whenever doShellScript("...${value}...") is inside a JXA '...' literal.
 */
export function escJxaShell(str: string): string {
  const shellSafe = escShell(str);
  return shellSafe
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
