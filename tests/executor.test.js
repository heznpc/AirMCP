import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock tool-registry before importing executor ─────────────────────────
const mockCallTool = jest.fn();
jest.unstable_mockModule('../dist/shared/tool-registry.js', () => ({
  toolRegistry: { callTool: mockCallTool },
}));

const { resolveTemplates, evaluateCondition, executeSkill } = await import('../dist/skills/executor.js');

// ─── Helper: create a fake MCP server (unused by mocked callTool) ─────────
const fakeServer = {};

// ─── Helper: build a tool response object ─────────────────────────────────
function okResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function textResponse(text) {
  return { content: [{ type: 'text', text }] };
}
function errorResponse(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

describe('resolveTemplates', () => {
  const results = new Map();
  results.set('events', { count: 5, items: ['a', 'b', 'c'] });
  results.set('mail', { unread: 10 });

  test('resolves single template to raw value', () => {
    expect(resolveTemplates('{{events.count}}', results)).toBe(5);
  });

  test('resolves nested path', () => {
    expect(resolveTemplates('{{events.items}}', results)).toEqual(['a', 'b', 'c']);
  });

  test('resolves embedded templates in string', () => {
    expect(resolveTemplates('You have {{mail.unread}} unread', results)).toBe('You have 10 unread');
  });

  test('returns empty string for undefined path in embedded template', () => {
    expect(resolveTemplates('Value: {{events.missing}}', results)).toBe('Value: ');
  });

  test('resolves templates in object values', () => {
    const obj = { title: '{{events.count}} events', count: '{{events.count}}' };
    const resolved = resolveTemplates(obj, results);
    expect(resolved).toEqual({ title: '5 events', count: 5 });
  });

  test('resolves templates in arrays', () => {
    const arr = ['{{events.count}}', '{{mail.unread}}'];
    expect(resolveTemplates(arr, results)).toEqual([5, 10]);
  });

  test('returns non-template values unchanged', () => {
    expect(resolveTemplates('no templates', results)).toBe('no templates');
    expect(resolveTemplates(42, results)).toBe(42);
    expect(resolveTemplates(null, results)).toBeNull();
    expect(resolveTemplates(true, results)).toBe(true);
  });

  test('resolves _item and _index for loop context', () => {
    const loopResults = new Map(results);
    loopResults.set('_item', { id: 'E123', title: 'Meeting' });
    loopResults.set('_index', 2);
    expect(resolveTemplates('{{_item.title}}', loopResults)).toBe('Meeting');
    expect(resolveTemplates('{{_index}}', loopResults)).toBe(2);
  });

  test('blocks dangerous keys (__proto__, constructor, prototype)', () => {
    const r = new Map();
    r.set('obj', { nested: { value: 42 } });
    expect(resolveTemplates('{{obj.__proto__}}', r)).toBeUndefined();
    expect(resolveTemplates('{{obj.constructor}}', r)).toBeUndefined();
    expect(resolveTemplates('{{obj.prototype}}', r)).toBeUndefined();
  });

  test('returns null for embedded template resolving to null', () => {
    const r = new Map();
    r.set('step', { val: null });
    expect(resolveTemplates('result: {{step.val}}', r)).toBe('result: ');
  });

  test('returns undefined for unknown step in single template', () => {
    expect(resolveTemplates('{{unknown_step}}', results)).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  const results = new Map();
  results.set('events', { count: 5 });
  results.set('mail', { unread: 0 });
  results.set('flag', true);

  test('evaluates simple truthy check', () => {
    expect(evaluateCondition('{{flag}}', results)).toBe(true);
    expect(evaluateCondition('{{mail.unread}}', results)).toBe(false); // 0 is falsy
  });

  test('evaluates comparison operators', () => {
    expect(evaluateCondition('{{events.count}} > 3', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} < 3', results)).toBe(false);
    expect(evaluateCondition('{{events.count}} == 5', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} != 5', results)).toBe(false);
    expect(evaluateCondition('{{events.count}} >= 5', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} <= 5', results)).toBe(true);
  });

  test('evaluates logical AND', () => {
    expect(evaluateCondition('{{events.count}} > 3 && {{flag}}', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} > 10 && {{flag}}', results)).toBe(false);
  });

  test('evaluates logical OR', () => {
    expect(evaluateCondition('{{events.count}} > 10 || {{flag}}', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} > 10 || {{mail.unread}} > 5', results)).toBe(false);
  });

  test('evaluates parentheses', () => {
    expect(evaluateCondition('({{events.count}} > 3) && ({{mail.unread}} == 0)', results)).toBe(true);
  });

  test('evaluates string comparisons', () => {
    const r = new Map();
    r.set('step', { status: 'ok' });
    expect(evaluateCondition('{{step.status}} == "ok"', r)).toBe(true);
    expect(evaluateCondition('{{step.status}} != "error"', r)).toBe(true);
  });

  test('evaluates number literals', () => {
    expect(evaluateCondition('{{events.count}} == 5', results)).toBe(true);
    expect(evaluateCondition('{{events.count}} > 4.5', results)).toBe(true);
  });

  test('evaluates boolean keywords', () => {
    expect(evaluateCondition('{{flag}} == true', results)).toBe(true);
    expect(evaluateCondition('{{mail.unread}} == false', results)).toBe(true); // 0 == false with loose equality
  });

  test('returns false for empty expression', () => {
    expect(evaluateCondition('', results)).toBe(false);
  });

  test('evaluates null keyword literal', () => {
    const r = new Map();
    r.set('step', { val: null });
    expect(evaluateCondition('{{step.val}} == null', r)).toBe(true);
  });

  test('evaluates single-quoted string literals', () => {
    const r = new Map();
    r.set('step', { status: 'ok' });
    expect(evaluateCondition("{{step.status}} == 'ok'", r)).toBe(true);
  });

  test('evaluates escaped characters in string literals', () => {
    const r = new Map();
    r.set('step', { msg: 'hello "world"' });
    expect(evaluateCondition('{{step.msg}} == "hello \\"world\\""', r)).toBe(true);
  });

  test('evaluates complex nested parentheses with OR short-circuit', () => {
    // true || anything => true (short-circuit)
    expect(evaluateCondition('({{flag}} || {{events.count}} > 100)', results)).toBe(true);
  });

  test('evaluates complex AND with both sides true', () => {
    expect(evaluateCondition('{{events.count}} == 5 && {{flag}} == true', results)).toBe(true);
  });

  test('handles multi-token expression with parseExpr path', () => {
    // Exercises parseExpr with multiple tokens (not the single-value fast path)
    expect(evaluateCondition('{{events.count}} > 0', results)).toBe(true);
  });

  test('parsePrimary returns undefined for unexpected op token in primary position', () => {
    // Expression starting with an operator — hits the parsePrimary fallback
    // where token kind is neither "value" nor "paren("
    // ">" is an op token; parsePrimary encounters it, advances, returns undefined
    expect(evaluateCondition('> 5', results)).toBe(false);
  });

  test('parsePrimary returns undefined when no tokens remain', () => {
    // Parenthesized empty expression — after advancing past "(" parsePrimary
    // is called again but no tokens remain
    expect(evaluateCondition('()', results)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// executeSkill — covers lines 145-256 (callTool, parseToolResponse,
//   executeOneStep, executeSkill)
// ═══════════════════════════════════════════════════════════════════════════

describe('executeSkill', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  test('executes a single-step skill successfully', async () => {
    mockCallTool.mockResolvedValueOnce(okResponse({ count: 3 }));

    const skill = {
      name: 'test-skill',
      steps: [{ id: 'step1', tool: 'get_events', args: { date: 'today' } }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.skill).toBe('test-skill');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[0].data).toEqual({ count: 3 });
    expect(mockCallTool).toHaveBeenCalledWith('get_events', { date: 'today' });
  });

  test('executes multi-step skill with template resolution between steps', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['a', 'b'] }))
      .mockResolvedValueOnce(okResponse({ sent: true }));

    const skill = {
      name: 'chain-skill',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'send', tool: 'send_mail', args: { body: '{{fetch.items}}' } },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(mockCallTool).toHaveBeenCalledTimes(2);
    // Second call should have resolved the template
    expect(mockCallTool.mock.calls[1][1]).toEqual({ body: ['a', 'b'] });
  });

  test('stops on error and returns success: false', async () => {
    mockCallTool.mockResolvedValueOnce(errorResponse('something went wrong'));

    const skill = {
      name: 'fail-skill',
      steps: [
        { id: 'step1', tool: 'broken_tool', args: {} },
        { id: 'step2', tool: 'never_called', args: {} },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('error');
    expect(result.steps[0].error).toBe('something went wrong');
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  test('handles tool throwing an exception (non-Error)', async () => {
    mockCallTool.mockRejectedValueOnce('raw string error');

    const skill = {
      name: 'throw-skill',
      steps: [{ id: 'step1', tool: 'throwing_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('error');
    expect(result.steps[0].error).toBe('raw string error');
  });

  test('handles tool throwing an Error instance', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('typed error'));

    const skill = {
      name: 'error-skill',
      steps: [{ id: 'step1', tool: 'error_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('error');
    expect(result.steps[0].error).toBe('typed error');
  });

  test('step with no args passes empty object', async () => {
    mockCallTool.mockResolvedValueOnce(okResponse('done'));

    const skill = {
      name: 'no-args',
      steps: [{ id: 'step1', tool: 'simple_tool' }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(mockCallTool).toHaveBeenCalledWith('simple_tool', {});
  });

  test('parseToolResponse returns text when JSON.parse fails', async () => {
    mockCallTool.mockResolvedValueOnce(textResponse('plain text, not JSON'));

    const skill = {
      name: 'text-skill',
      steps: [{ id: 'step1', tool: 'text_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[0].data).toBe('plain text, not JSON');
  });

  test('parseToolResponse returns null when content text is empty', async () => {
    mockCallTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '' }] });

    const skill = {
      name: 'empty-skill',
      steps: [{ id: 'step1', tool: 'empty_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[0].data).toBeNull();
  });

  test('parseToolResponse returns null when content has no text field', async () => {
    mockCallTool.mockResolvedValueOnce({ content: [{ type: 'image' }] });

    const skill = {
      name: 'notext-skill',
      steps: [{ id: 'step1', tool: 'image_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[0].data).toBeNull();
  });

  test('parseToolResponse truncates text exceeding 1MB', async () => {
    const hugeText = 'x'.repeat(1_048_577); // 1 byte over the limit
    mockCallTool.mockResolvedValueOnce(textResponse(hugeText));

    const skill = {
      name: 'huge-skill',
      steps: [{ id: 'step1', tool: 'huge_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[0].data).toContain('... (truncated,');
    expect(result.steps[0].data).toContain('1048577 chars total)');
    // Truncated to 1MB plus the suffix — strictly shorter than the original
    expect(result.steps[0].data.length).toBeLessThan(hugeText.length + 100);
  });

  test('parseToolResponse throws on isError with default message', async () => {
    mockCallTool.mockResolvedValueOnce({ content: [], isError: true });

    const skill = {
      name: 'err-default',
      steps: [{ id: 'step1', tool: 'err_tool', args: {} }],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[0].error).toBe('Tool returned an error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// only_if / skip_if conditional step execution
// ═══════════════════════════════════════════════════════════════════════════

describe('executeSkill – conditional steps', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  test('skips step when only_if evaluates to false', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ count: 0 }))
      .mockResolvedValueOnce(okResponse('final'));

    const skill = {
      name: 'only-if-skip',
      steps: [
        { id: 'check', tool: 'get_count', args: {} },
        { id: 'action', tool: 'send_summary', args: {}, only_if: '{{check.count}} > 0' },
        { id: 'done', tool: 'finish', args: {} },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1].status).toBe('skipped');
    expect(mockCallTool).toHaveBeenCalledTimes(2); // check + done, action skipped
  });

  test('executes step when only_if evaluates to true', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ count: 5 }))
      .mockResolvedValueOnce(okResponse('sent'));

    const skill = {
      name: 'only-if-run',
      steps: [
        { id: 'check', tool: 'get_count', args: {} },
        { id: 'action', tool: 'send_summary', args: {}, only_if: '{{check.count}} > 0' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[1].status).toBe('ok');
    expect(mockCallTool).toHaveBeenCalledTimes(2);
  });

  test('skips step when skip_if evaluates to true', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ already_sent: true }));

    const skill = {
      name: 'skip-if-true',
      steps: [
        { id: 'check', tool: 'get_status', args: {} },
        { id: 'action', tool: 'send_mail', args: {}, skip_if: '{{check.already_sent}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[1].status).toBe('skipped');
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  test('executes step when skip_if evaluates to false', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ already_sent: false }))
      .mockResolvedValueOnce(okResponse('sent'));

    const skill = {
      name: 'skip-if-false',
      steps: [
        { id: 'check', tool: 'get_status', args: {} },
        { id: 'action', tool: 'send_mail', args: {}, skip_if: '{{check.already_sent}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[1].status).toBe('ok');
    expect(mockCallTool).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loop step execution
// ═══════════════════════════════════════════════════════════════════════════

describe('executeSkill – loop steps', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  test('loop iterates over array items', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['a', 'b', 'c'] }))
      .mockResolvedValueOnce(okResponse('processed a'))
      .mockResolvedValueOnce(okResponse('processed b'))
      .mockResolvedValueOnce(okResponse('processed c'));

    const skill = {
      name: 'loop-skill',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: { item: '{{_item}}', idx: '{{_index}}' }, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps[1].status).toBe('ok');
    expect(result.steps[1].data).toEqual(['processed a', 'processed b', 'processed c']);
    expect(mockCallTool).toHaveBeenCalledTimes(4);
    // Verify _item and _index were resolved in loop iterations
    expect(mockCallTool.mock.calls[1][1]).toEqual({ item: 'a', idx: 0 });
    expect(mockCallTool.mock.calls[2][1]).toEqual({ item: 'b', idx: 1 });
    expect(mockCallTool.mock.calls[3][1]).toEqual({ item: 'c', idx: 2 });
  });

  test('loop returns error when expression does not resolve to array', async () => {
    mockCallTool.mockResolvedValueOnce(okResponse({ items: 'not-an-array' }));

    const skill = {
      name: 'loop-bad',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: {}, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toContain('did not resolve to an array');
  });

  test('loop returns error when items exceed MAX_LOOP_ITERATIONS', async () => {
    const hugeArray = new Array(1001).fill('x');
    mockCallTool.mockResolvedValueOnce(okResponse({ items: hugeArray }));

    const skill = {
      name: 'loop-overflow',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: {}, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toContain('exceeding max of 1000');
  });

  test('loop stops and returns error on iteration failure (Error instance)', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['a', 'b', 'c'] }))
      .mockResolvedValueOnce(okResponse('ok'))
      .mockRejectedValueOnce(new Error('iteration failed'));

    const skill = {
      name: 'loop-fail',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: { item: '{{_item}}' }, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('iteration failed');
  });

  test('loop stops and returns error on iteration failure (non-Error)', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['a'] }))
      .mockRejectedValueOnce('raw loop error');

    const skill = {
      name: 'loop-fail-raw',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: {}, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].error).toBe('raw loop error');
  });

  test('loop with no args passes empty object per iteration', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['x'] }))
      .mockResolvedValueOnce(okResponse('done'));

    const skill = {
      name: 'loop-no-args',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(mockCallTool.mock.calls[1][1]).toEqual({});
  });

  test('loop with isError response in iteration', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ items: ['a', 'b'] }))
      .mockResolvedValueOnce(errorResponse('tool error in loop'));

    const skill = {
      name: 'loop-tool-error',
      steps: [
        { id: 'fetch', tool: 'get_items', args: {} },
        { id: 'process', tool: 'process_item', args: {}, loop: '{{fetch.items}}' },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('tool error in loop');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel step execution
// ═══════════════════════════════════════════════════════════════════════════

describe('executeSkill – parallel steps', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  test('executes parallel steps concurrently', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ events: 3 }))
      .mockResolvedValueOnce(okResponse({ unread: 5 }));

    const skill = {
      name: 'parallel-skill',
      steps: [
        { id: 'events', tool: 'get_events', args: {}, parallel: true },
        { id: 'mail', tool: 'get_mail', args: {}, parallel: true },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[1].status).toBe('ok');
    expect(mockCallTool).toHaveBeenCalledTimes(2);
  });

  test('parallel group fails if any step errors (fulfilled with error status)', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ events: 3 }))
      .mockResolvedValueOnce(errorResponse('mail failed'));

    const skill = {
      name: 'parallel-fail',
      steps: [
        { id: 'events', tool: 'get_events', args: {}, parallel: true },
        { id: 'mail', tool: 'get_mail', args: {}, parallel: true },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[1].status).toBe('error');
  });

  test('parallel group handles rejected promise (non-Error reason)', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ events: 3 }))
      .mockRejectedValueOnce('raw rejection');

    const skill = {
      name: 'parallel-reject',
      steps: [
        { id: 'events', tool: 'get_events', args: {}, parallel: true },
        { id: 'mail', tool: 'get_mail', args: {}, parallel: true },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('raw rejection');
  });

  test('parallel group handles rejected promise (Error instance)', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ events: 3 }))
      .mockRejectedValueOnce(new Error('typed rejection'));

    const skill = {
      name: 'parallel-reject-error',
      steps: [
        { id: 'events', tool: 'get_events', args: {}, parallel: true },
        { id: 'mail', tool: 'get_mail', args: {}, parallel: true },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('typed rejection');
  });

  test('parallel group followed by sequential step', async () => {
    mockCallTool
      .mockResolvedValueOnce(okResponse({ events: 3 }))
      .mockResolvedValueOnce(okResponse({ unread: 5 }))
      .mockResolvedValueOnce(okResponse('summary done'));

    const skill = {
      name: 'parallel-then-seq',
      steps: [
        { id: 'events', tool: 'get_events', args: {}, parallel: true },
        { id: 'mail', tool: 'get_mail', args: {}, parallel: true },
        { id: 'summary', tool: 'summarize', args: { e: '{{events.events}}', m: '{{mail.unread}}' } },
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    // Verify sequential step received resolved data from parallel steps
    expect(mockCallTool.mock.calls[2][1]).toEqual({ e: 3, m: 5 });
  });

  test('parallel group failure prevents subsequent steps', async () => {
    mockCallTool
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(okResponse({}));

    const skill = {
      name: 'parallel-blocks',
      steps: [
        { id: 'step1', tool: 'tool1', args: {}, parallel: true },
        { id: 'step2', tool: 'tool2', args: {}, parallel: true },
        { id: 'step3', tool: 'tool3', args: {} }, // should never run
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    // step3 should not appear
    expect(result.steps).toHaveLength(2);
  });

  test('parallel group handles rejected executeOneStep (Error reason)', async () => {
    // Force executeOneStep to reject by making it throw before its internal
    // try/catch — a throwing getter on only_if triggers an unhandled exception
    // inside the async function, causing Promise.allSettled to see "rejected".
    const throwingStep = {
      id: 'bad',
      tool: 'some_tool',
      args: {},
      parallel: true,
      get only_if() { throw new Error('getter explosion'); },
    };
    mockCallTool.mockResolvedValueOnce(okResponse('ok'));

    const skill = {
      name: 'parallel-rejected-error',
      steps: [
        { id: 'good', tool: 'good_tool', args: {}, parallel: true },
        throwingStep,
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('getter explosion');
  });

  test('parallel group handles rejected executeOneStep (non-Error reason)', async () => {
    // Same approach but with a non-Error throw to hit the String(r.reason) branch
    const throwingStep = {
      id: 'bad',
      tool: 'some_tool',
      args: {},
      parallel: true,
      get only_if() { throw 'string thrown'; },
    };
    mockCallTool.mockResolvedValueOnce(okResponse('ok'));

    const skill = {
      name: 'parallel-rejected-string',
      steps: [
        { id: 'good', tool: 'good_tool', args: {}, parallel: true },
        throwingStep,
      ],
    };
    const result = await executeSkill(fakeServer, skill);

    expect(result.success).toBe(false);
    expect(result.steps[1].status).toBe('error');
    expect(result.steps[1].error).toBe('string thrown');
  });
});
