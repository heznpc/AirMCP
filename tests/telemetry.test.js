import { describe, test, expect } from '@jest/globals';
import { traceToolCall } from '../dist/shared/telemetry.js';

// @opentelemetry/api is NOT installed in this project (optional peer dep),
// so all tests exercise the no-op / fallback path.

describe('traceToolCall (no OTel SDK installed)', () => {
  test('runs fn directly and returns its result', async () => {
    const result = await traceToolCall('test_tool', 2, async () => 'hello');
    expect(result).toBe('hello');
  });

  test('propagates errors from fn', async () => {
    await expect(
      traceToolCall('failing_tool', 0, async () => {
        throw new Error('tool failed');
      }),
    ).rejects.toThrow('tool failed');
  });

  test('works with zero argCount', async () => {
    const result = await traceToolCall('no_args_tool', 0, async () => ({ data: 42 }));
    expect(result).toEqual({ data: 42 });
  });

  test('preserves complex return types', async () => {
    const expected = {
      content: [{ type: 'text', text: 'result' }],
      isError: false,
      _meta: { key: 'value' },
    };
    const result = await traceToolCall('complex_tool', 3, async () => expected);
    expect(result).toEqual(expected);
  });
});
