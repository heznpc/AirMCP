import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function reset(pattern) {
  pattern.lastIndex = 0;
}

function hasReplacementValue(replacement) {
  return Object.prototype.hasOwnProperty.call(replacement, "replacement");
}

/**
 * Apply anchored replacements to one string.
 *
 * A required replacement that matches zero times is reported as missing even
 * when the file would otherwise look "ok". That keeps registry/version sync
 * checks from silently passing after an anchor is renamed or deleted, while
 * allowing legacy doc-copy variants to remain optional.
 */
export function applyReplacements(content, replacements) {
  let next = content;
  let changed = false;
  const missing = [];

  for (const item of replacements) {
    const label = item.label ?? String(item.pattern);
    let matched = false;

    if (hasReplacementValue(item)) {
      reset(item.pattern);
      matched = item.pattern.test(next);
      reset(item.pattern);

      if (matched) {
        const updated = next.replace(item.pattern, item.replacement);
        if (updated !== next) {
          changed = true;
          next = updated;
        }
      }
    } else {
      next = next.replace(item.pattern, (...args) => {
        matched = true;
        const match = args[0];
        const num = args[1];

        if (num === undefined) {
          throw new Error(`sync replacement "${label}" must capture the current number`);
        }

        const current = Number.parseInt(num, 10);
        if (current !== item.value) {
          changed = true;
          return match.replace(num, String(item.value));
        }
        return match;
      });
    }

    if (!matched && item.required === true) {
      missing.push(label);
    }
  }

  return { content: next, changed, missing };
}

export function syncFile(root, relPath, replacements, { mode, logger = console } = {}) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    logger.warn(`  skip: ${relPath} (not found)`);
    return { skipped: true, changed: false, dirty: false, fatal: false };
  }

  const original = readFileSync(absPath, "utf-8");
  const result = applyReplacements(original, replacements);

  if (result.missing.length > 0) {
    for (const label of result.missing) {
      logger.error(`  MISSING: ${relPath} - pattern not found for "${label}"`);
    }
    return { skipped: false, changed: false, dirty: true, fatal: true };
  }

  if (result.changed) {
    if (mode === "check") {
      logger.error(`  STALE: ${relPath}`);
      return { skipped: false, changed: false, dirty: true, fatal: false };
    }

    writeFileSync(absPath, result.content);
    logger.log(`  sync: ${relPath}`);
    return { skipped: false, changed: true, dirty: false, fatal: false };
  }

  logger.log(`  ok:   ${relPath}`);
  return { skipped: false, changed: false, dirty: false, fatal: false };
}
