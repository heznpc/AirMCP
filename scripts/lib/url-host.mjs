/** Return true only when an absolute URL has the exact expected hostname. */
export function hasExactHostname(value, expectedHostname) {
  try {
    return new URL(String(value)).hostname === expectedHostname;
  } catch {
    return false;
  }
}
