#!/usr/bin/env node
/**
 * check-i18n.mjs — Verify all locale files have the same keys as en.json.
 *
 * Usage: node scripts/check-i18n.mjs
 * Exit code 1 if any locale is missing keys.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "locales");
const en = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf-8"));
const enKeys = new Set(Object.keys(en));

let ok = true;
for (const file of readdirSync(LOCALES).filter(f => f.endsWith(".json") && f !== "en.json")) {
  const locale = JSON.parse(readFileSync(join(LOCALES, file), "utf-8"));
  const localeKeys = new Set(Object.keys(locale));
  const missing = [...enKeys].filter(k => !localeKeys.has(k));
  const extra = [...localeKeys].filter(k => !enKeys.has(k));
  if (missing.length) {
    console.error(`${file}: missing ${missing.length} keys: ${missing.join(", ")}`);
    ok = false;
  }
  // Extra keys are also a parity failure — otherwise removing a key from the
  // en.json reference makes it "extra" in every other locale and the guard
  // passes silently (a key dropped from the reference goes undetected).
  if (extra.length) {
    console.error(`${file}: ${extra.length} extra keys (not in en.json): ${extra.join(", ")}`);
    ok = false;
  }
}

if (ok) console.log(`i18n OK: all locales have ${enKeys.size} keys`);
else process.exit(1);
