/**
 * HITL level monotonicity (review finding #3/#5).
 *
 * The HITL levels are presented to users as increasing strictness:
 *   off ⊂ destructive-only ⊂ sensitive-only ⊂ all-writes ⊂ all
 * (the init wizard offers Recommended=sensitive-only then Strict=all-writes).
 * So for ANY fixed annotation shape, once a tool is gated at some level it
 * must stay gated at every stricter level. Before the fix, all-writes gated
 * only readOnlyHint===false and so DROPPED sensitive-but-readonly tools
 * (health_*, get_clipboard, capture_screen, ui_read) that sensitive-only
 * gated — making Strict weaker than Recommended. This locks the ordering.
 */
import { describe, test, expect } from '@jest/globals';

const { shouldRequireApproval } = await import('../dist/shared/hitl-guard.js');

// Increasing strictness, low → high.
const LEVELS = ['off', 'destructive-only', 'sensitive-only', 'all-writes', 'all'];

const SHAPES = {
  plainRead: { readOnlyHint: true, destructiveHint: false, sensitiveHint: false },
  sensitiveRead: { readOnlyHint: true, destructiveHint: false, sensitiveHint: true },
  plainWrite: { readOnlyHint: false, destructiveHint: false, sensitiveHint: false },
  sensitiveWrite: { readOnlyHint: false, destructiveHint: false, sensitiveHint: true },
  destructive: { readOnlyHint: false, destructiveHint: true, sensitiveHint: false },
};

describe('HITL level monotonicity', () => {
  test('gating grows monotonically across off ⊂ destructive-only ⊂ sensitive-only ⊂ all-writes ⊂ all', () => {
    const failures = [];
    for (const [shapeName, ann] of Object.entries(SHAPES)) {
      let everGated = false;
      let gatedAt = null;
      for (const level of LEVELS) {
        const gated = shouldRequireApproval(level, ann, new Set(), 'tool_x');
        if (everGated && !gated) {
          failures.push(
            `${shapeName}: gated at "${gatedAt}" but NOT at the stricter "${level}" — ordering is non-monotonic`,
          );
        }
        if (gated && !everGated) {
          everGated = true;
          gatedAt = level;
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`HITL levels are not monotonic:\n  ${failures.join('\n  ')}`);
    }
  });

  test('sensitive-readonly tools (the #3/#5 regression) are gated at sensitive-only AND all-writes AND all', () => {
    const ann = SHAPES.sensitiveRead;
    expect(shouldRequireApproval('sensitive-only', ann, new Set(), 't')).toBe(true);
    expect(shouldRequireApproval('all-writes', ann, new Set(), 't')).toBe(true);
    expect(shouldRequireApproval('all', ann, new Set(), 't')).toBe(true);
    // and NOT gated at the looser levels
    expect(shouldRequireApproval('off', ann, new Set(), 't')).toBe(false);
    expect(shouldRequireApproval('destructive-only', ann, new Set(), 't')).toBe(false);
  });

  test('whitelisted tools are never gated at any level', () => {
    const wl = new Set(['safe_tool']);
    for (const level of LEVELS) {
      expect(shouldRequireApproval(level, SHAPES.destructive, wl, 'safe_tool')).toBe(false);
    }
  });
});
