import { describe, test, expect } from '@jest/globals';
import { esc, escAS, escShell, escJxaShell, safeInt } from '../dist/shared/esc.js';

describe('esc (JXA single-quoted literals)', () => {
  test('normal string passes through unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  test('empty string returns empty', () => {
    expect(esc('')).toBe('');
  });

  test('strips null bytes', () => {
    expect(esc('hello\0world')).toBe('helloworld');
    expect(esc('\0\0\0')).toBe('');
  });

  test('escapes backslashes', () => {
    expect(esc('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  test('escapes single quotes', () => {
    expect(esc("it's a test")).toBe("it\\'s a test");
  });

  test('escapes newlines', () => {
    expect(esc('line1\nline2')).toBe('line1\\nline2');
  });

  test('escapes carriage returns', () => {
    expect(esc('line1\rline2')).toBe('line1\\rline2');
  });

  test('escapes tabs', () => {
    expect(esc('col1\tcol2')).toBe('col1\\tcol2');
  });

  test('strips control characters (\\x01-\\x08, \\x0b, \\x0c, \\x0e-\\x1f)', () => {
    expect(esc('a\x01b\x02c')).toBe('abc');
    expect(esc('a\x08b')).toBe('ab');
    expect(esc('a\x0bb')).toBe('ab');
    expect(esc('a\x0cb')).toBe('ab');
    expect(esc('a\x0eb')).toBe('ab');
    expect(esc('a\x1fb')).toBe('ab');
  });

  test('escapes unicode line separator (\\u2028)', () => {
    expect(esc('before\u2028after')).toBe('before\\u2028after');
  });

  test('escapes unicode paragraph separator (\\u2029)', () => {
    expect(esc('before\u2029after')).toBe('before\\u2029after');
  });

  test('combined attack string with multiple special chars', () => {
    const input = "it's a\\\0\n\r\t\x01\u2028\u2029test";
    const result = esc(input);
    expect(result).not.toContain('\0');
    expect(result).not.toContain('\x01');
    expect(result).toContain("\\'");
    expect(result).toContain('\\\\');
    expect(result).toContain('\\n');
    expect(result).toContain('\\r');
    expect(result).toContain('\\t');
    expect(result).toContain('\\u2028');
    expect(result).toContain('\\u2029');
  });

  test('injection attempt is escaped', () => {
    const injection = "'); Application('Finder').delete(...); ('";
    const result = esc(injection);
    expect(result).toBe("\\'); Application(\\'Finder\\').delete(...); (\\'");
    // The escaped result should not contain unescaped single quotes
    expect(result).not.toMatch(/(?<!\\)'/);
  });
});

describe('escAS (AppleScript double-quoted strings)', () => {
  test('normal string passes through unchanged', () => {
    expect(escAS('hello world')).toBe('hello world');
  });

  test('empty string returns empty', () => {
    expect(escAS('')).toBe('');
  });

  test('escapes double quotes', () => {
    expect(escAS('say "hello"')).toBe('say \\"hello\\"');
  });

  test('escapes backslashes', () => {
    expect(escAS('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  test('strips null bytes', () => {
    expect(escAS('hello\0world')).toBe('helloworld');
  });

  test('strips control characters', () => {
    expect(escAS('a\x01b\x08c\x0bd\x0ce\x0ef\x1fg')).toBe('abcdefg');
  });

  test('escapes newlines', () => {
    expect(escAS('line1\nline2')).toBe('line1\\nline2');
  });

  test('escapes carriage returns', () => {
    expect(escAS('line1\rline2')).toBe('line1\\rline2');
  });

  test('escapes tabs', () => {
    expect(escAS('col1\tcol2')).toBe('col1\\tcol2');
  });

  test('escapes unicode line separator (\\u2028)', () => {
    expect(escAS('before\u2028after')).toBe('before\\u2028after');
  });

  test('escapes unicode paragraph separator (\\u2029)', () => {
    expect(escAS('before\u2029after')).toBe('before\\u2029after');
  });

  test('combined attack string with multiple special chars', () => {
    const input = 'say "\\\0hello\n\r\t\x05\u2028\u2029"';
    const result = escAS(input);
    expect(result).not.toContain('\0');
    expect(result).not.toContain('\x05');
    expect(result).toContain('\\"');
    expect(result).toContain('\\\\');
    expect(result).toContain('\\n');
    expect(result).toContain('\\r');
    expect(result).toContain('\\t');
    expect(result).toContain('\\u2028');
    expect(result).toContain('\\u2029');
  });

  test('injection attempt is escaped', () => {
    const injection = '" & do shell script "rm -rf /" & "';
    const result = escAS(injection);
    expect(result).toBe('\\" & do shell script \\"rm -rf /\\" & \\"');
    // The escaped result should not contain unescaped double quotes
    expect(result).not.toMatch(/(?<!\\)"/);
  });
});

describe('escShell (shell double-quoted arguments)', () => {
  test('normal string passes through unchanged', () => {
    expect(escShell('hello world')).toBe('hello world');
  });

  test('empty string returns empty', () => {
    expect(escShell('')).toBe('');
  });

  test('escapes backslashes', () => {
    expect(escShell('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  test('escapes double quotes', () => {
    expect(escShell('say "hello"')).toBe('say \\"hello\\"');
  });

  test('escapes backticks', () => {
    expect(escShell('run `cmd`')).toBe('run \\`cmd\\`');
  });

  test('escapes dollar signs', () => {
    expect(escShell('cost is $100')).toBe('cost is \\$100');
    expect(escShell('${HOME}')).toBe('\\${HOME}');
  });

  test('escapes newlines', () => {
    expect(escShell('line1\nline2')).toBe('line1\\nline2');
  });

  test('escapes carriage returns', () => {
    expect(escShell('line1\rline2')).toBe('line1\\rline2');
  });

  test('strips null bytes', () => {
    expect(escShell('hello\0world')).toBe('helloworld');
  });

  test('injection attempt $(rm -rf /) is escaped', () => {
    const injection = '$(rm -rf /)';
    const result = escShell(injection);
    expect(result).toBe('\\$(rm -rf /)');
    // Dollar sign must be escaped so subshell expansion cannot occur
    expect(result.startsWith('\\$')).toBe(true);
  });

  test('backtick injection is escaped', () => {
    const injection = '`rm -rf /`';
    const result = escShell(injection);
    expect(result).toBe('\\`rm -rf /\\`');
  });

  test('combined shell special characters', () => {
    const input = '\\"`$\n\r';
    const result = escShell(input);
    // input chars: \ " ` $ \n \r
    // escShell: \ -> \\, " -> \", ` -> \`, $ -> \$, \n -> \n, \r -> \r
    expect(result).toBe('\\\\\\"\\`\\$\\n\\r');
    expect(result).toContain('\\\\');
    expect(result).toContain('\\"');
    expect(result).toContain('\\`');
    expect(result).toContain('\\$');
    expect(result).toContain('\\n');
    expect(result).toContain('\\r');
  });
});

describe('escJxaShell (two-layer: shell + JXA)', () => {
  test('normal string passes through unchanged', () => {
    expect(escJxaShell('hello world')).toBe('hello world');
  });

  test('empty string returns empty', () => {
    expect(escJxaShell('')).toBe('');
  });

  test('double-escapes backslashes for both shell and JXA contexts', () => {
    // escShell('\\') => '\\\\', then JXA layer doubles each \\ => '\\\\\\\\'
    const result = escJxaShell('\\');
    expect(result).toBe('\\\\\\\\');
  });

  test('escapes single quotes for JXA layer', () => {
    // escShell("'") => "'" (no shell escaping for single quotes in double-quoted context)
    // JXA layer: "'" => "\\'"
    const result = escJxaShell("it's");
    expect(result).toContain("\\'");
  });

  test('double-escapes dollar sign', () => {
    // escShell('$') => '\\$', then JXA re-escapes the backslash => '\\\\$'
    const result = escJxaShell('$HOME');
    expect(result).toBe('\\\\$HOME');
  });

  test('double-escapes double quotes', () => {
    // " → shell needs \" → JXA escapes both \ and " → \\\"
    const result = escJxaShell('"');
    expect(result).toBe('\\\\\\"');
  });

  test('double-escapes backtick', () => {
    // escShell('`') => '\\`', then JXA re-escapes the backslash => '\\\\`'
    const result = escJxaShell('`cmd`');
    expect(result).toBe('\\\\`cmd\\\\`');
  });

  test('injection attempt is doubly escaped', () => {
    const injection = "'; $(rm -rf /); echo '";
    const result = escJxaShell(injection);
    // Should not contain unescaped single quotes in JXA context
    expect(result).not.toMatch(/(?<!\\)'/);
    // Dollar sign must also be escaped
    expect(result).not.toMatch(/(?<!\\)\$/);
  });

  test('strips control characters (consistent with esc/escAS)', () => {
    expect(escJxaShell('a\x01b\x08c')).toBe('abc');
    expect(escJxaShell('\x0e\x1f')).toBe('');
    // \t is not in the stripped range — passes through unchanged
    expect(escJxaShell('a\tb')).toBe('a\tb');
    // \n is escaped to literal \n by the newline handler
    expect(escJxaShell('a\nb')).toBe('a\\nb');
  });

  test('strips null bytes', () => {
    expect(escJxaShell('a\0b')).toBe('ab');
  });
});

describe('safeInt', () => {
  test('normal integer passes through', () => {
    expect(safeInt(42)).toBe(42);
    expect(safeInt(1)).toBe(1);
    expect(safeInt(1000000)).toBe(1000000);
  });

  test('returns 0 for 0', () => {
    expect(safeInt(0)).toBe(0);
  });

  test('handles negative integers', () => {
    expect(safeInt(-1)).toBe(-1);
    expect(safeInt(-42)).toBe(-42);
    expect(safeInt(-1000000)).toBe(-1000000);
  });

  test('truncates decimal to integer', () => {
    expect(safeInt(3.7)).toBe(3);
    expect(safeInt(3.2)).toBe(3);
    expect(safeInt(-3.7)).toBe(-3);
    expect(safeInt(0.9)).toBe(0);
  });

  test('throws RangeError on Infinity', () => {
    expect(() => safeInt(Infinity)).toThrow(RangeError);
  });

  test('throws RangeError on -Infinity', () => {
    expect(() => safeInt(-Infinity)).toThrow(RangeError);
  });

  test('throws RangeError on NaN', () => {
    expect(() => safeInt(NaN)).toThrow(RangeError);
  });

  test('throws RangeError on Number.MAX_SAFE_INTEGER + 1', () => {
    expect(() => safeInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  test('accepts Number.MAX_SAFE_INTEGER', () => {
    expect(safeInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('accepts Number.MIN_SAFE_INTEGER', () => {
    expect(safeInt(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });

  test('throws RangeError on Number.MIN_SAFE_INTEGER - 1', () => {
    expect(() => safeInt(Number.MIN_SAFE_INTEGER - 1)).toThrow(RangeError);
  });
});
