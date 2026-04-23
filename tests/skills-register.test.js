import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock executor before importing register ────────────────────────────
const mockExecuteSkill = jest.fn();
jest.unstable_mockModule('../dist/skills/executor.js', () => ({
  executeSkill: mockExecuteSkill,
}));

// ─── Mock result helpers ────────────────────────────────────────────────
// Include every export touched by the transitive import graph so ESM
// strict-mode "missing export" errors do not surface when register.ts
// pulls in tool-registry (which uses withResultSizeHint for size hints).
jest.unstable_mockModule('../dist/shared/result.js', () => ({
  ok: jest.fn((data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })),
  err: jest.fn((msg) => ({ content: [{ type: 'text', text: msg }], isError: true })),
  errUpstream: jest.fn((msg) => ({
    content: [{ type: 'text', text: `[upstream_error] ${msg}` }],
    isError: true,
    structuredContent: { error: { category: 'upstream_error', message: msg } },
  })),
  withResultSizeHint: jest.fn((result) => result),
}));

// ─── Mock tool-registry (register.ts consults it for name collisions) ──
jest.unstable_mockModule('../dist/shared/tool-registry.js', () => ({
  toolRegistry: {
    getPromptNames: jest.fn(() => []),
    getToolNames: jest.fn(() => []),
  },
}));

// ─── Mock prompt helper ─────────────────────────────────────────────────
jest.unstable_mockModule('../dist/shared/prompt.js', () => ({
  userPrompt: jest.fn((desc, text) => ({
    description: desc,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  })),
}));

const { registerSkills } = await import('../dist/skills/register.js');
const { ok, err, errUpstream } = await import('../dist/shared/result.js');

// ─── Helpers ────────────────────────────────────────────────────────────
function makeSkill(overrides = {}) {
  return {
    name: 'test-skill',
    title: 'Test Skill',
    description: 'A test skill',
    expose_as: 'tool',
    steps: [{ id: 'step1', tool: 'some_tool', args: { key: 'val' } }],
    ...overrides,
  };
}

function createMockServer() {
  return {
    registerTool: jest.fn(),
    prompt: jest.fn(),
    registerPrompt: jest.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// registerSkills — routing
// ═══════════════════════════════════════════════════════════════════════════

describe('registerSkills', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    mockExecuteSkill.mockReset();
    ok.mockClear();
    err.mockClear();
  });

  test('registers a tool-type skill via server.registerTool', () => {
    const skill = makeSkill({ expose_as: 'tool' });

    const result = registerSkills(server, [skill]);

    expect(result).toEqual({ prompts: 0, tools: 1, skipped: 0 });
    expect(server.registerTool).toHaveBeenCalledTimes(1);
    expect(server.registerTool).toHaveBeenCalledWith(
      'skill_test-skill',
      expect.objectContaining({
        title: 'Test Skill',
        description: '[Skill] A test skill',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
      expect.any(Function),
    );
  });

  test('registers a prompt-type skill via server.prompt', () => {
    const skill = makeSkill({ expose_as: 'prompt' });

    const result = registerSkills(server, [skill]);

    expect(result).toEqual({ prompts: 1, tools: 0, skipped: 0 });
    expect(server.prompt).toHaveBeenCalledTimes(1);
    expect(server.prompt).toHaveBeenCalledWith(
      'test-skill',
      'A test skill',
      expect.any(Function),
    );
  });

  test('registers mix of tool and prompt skills and counts correctly', () => {
    const toolSkill = makeSkill({ name: 'tool-one', expose_as: 'tool' });
    const promptSkill = makeSkill({ name: 'prompt-one', expose_as: 'prompt' });
    const toolSkill2 = makeSkill({ name: 'tool-two', expose_as: 'tool' });

    const result = registerSkills(server, [toolSkill, promptSkill, toolSkill2]);

    expect(result).toEqual({ prompts: 1, tools: 2, skipped: 0 });
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(server.prompt).toHaveBeenCalledTimes(1);
  });

  test('returns zero counts for empty skills array', () => {
    const result = registerSkills(server, []);

    expect(result).toEqual({ prompts: 0, tools: 0, skipped: 0 });
    expect(server.registerTool).not.toHaveBeenCalled();
    expect(server.prompt).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// registerAsTool — handler execution
// ═══════════════════════════════════════════════════════════════════════════

describe('registerAsTool handler', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
    mockExecuteSkill.mockReset();
    ok.mockClear();
    err.mockClear();
  });

  test('handler returns ok(result) when skill execution succeeds', async () => {
    const skillResult = {
      skill: 'test-skill',
      success: true,
      steps: [{ id: 'step1', status: 'ok', data: 'done' }],
    };
    mockExecuteSkill.mockResolvedValue(skillResult);

    const skill = makeSkill();
    registerSkills(server, [skill]);

    // Extract the handler (3rd argument to registerTool)
    const handler = server.registerTool.mock.calls[0][2];
    const response = await handler();

    expect(mockExecuteSkill).toHaveBeenCalledWith(server, skill, {});
    expect(ok).toHaveBeenCalledWith(skillResult);
    expect(response.isError).toBeUndefined();
  });

  test('handler returns err() when skill has a failed step', async () => {
    const skillResult = {
      skill: 'test-skill',
      success: false,
      steps: [{ id: 'step1', status: 'error', error: 'something broke' }],
    };
    mockExecuteSkill.mockResolvedValue(skillResult);

    const skill = makeSkill();
    registerSkills(server, [skill]);

    const handler = server.registerTool.mock.calls[0][2];
    const response = await handler();

    // Wave 2+ (RFC 0001): skill failures classify as `upstream_error`.
    expect(errUpstream).toHaveBeenCalledWith(
      expect.stringContaining('failed at step "step1"'),
    );
    expect(response.isError).toBe(true);
  });

  test('handler returns errUpstream() when executeSkill throws Error', async () => {
    mockExecuteSkill.mockRejectedValue(new Error('execution crashed'));

    const skill = makeSkill();
    registerSkills(server, [skill]);

    const handler = server.registerTool.mock.calls[0][2];
    const response = await handler();

    expect(errUpstream).toHaveBeenCalledWith(
      expect.stringContaining('execution crashed'),
    );
    expect(response.isError).toBe(true);
  });

  test('handler returns errUpstream() when executeSkill throws non-Error', async () => {
    mockExecuteSkill.mockRejectedValue('raw string rejection');

    const skill = makeSkill();
    registerSkills(server, [skill]);

    const handler = server.registerTool.mock.calls[0][2];
    const response = await handler();

    expect(errUpstream).toHaveBeenCalledWith(
      expect.stringContaining('raw string rejection'),
    );
    expect(response.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// registerAsPrompt — prompt text generation
// ═══════════════════════════════════════════════════════════════════════════

describe('registerAsPrompt handler', () => {
  let server;

  beforeEach(() => {
    server = createMockServer();
  });

  test('generates prompt text with step descriptions', () => {
    const skill = makeSkill({
      expose_as: 'prompt',
      steps: [
        { id: 'get_events', tool: 'calendar_list_events', args: { date: 'today' } },
        { id: 'send', tool: 'send_mail', args: {} },
      ],
    });

    registerSkills(server, [skill]);

    // Execute the prompt callback to get the generated text
    const promptCallback = server.prompt.mock.calls[0][2];
    const promptResult = promptCallback();

    expect(promptResult.description).toBe('A test skill');
    expect(promptResult.messages).toHaveLength(1);

    const text = promptResult.messages[0].content.text;
    expect(text).toContain('Test Skill');
    expect(text).toContain('[get_events]');
    expect(text).toContain('calendar_list_events');
    expect(text).toContain('with args:');
    expect(text).toContain('[send]');
    expect(text).toContain('send_mail');
  });

  test('includes only_if and skip_if annotations in prompt text', () => {
    const skill = makeSkill({
      expose_as: 'prompt',
      steps: [
        { id: 'step1', tool: 'check_tool', only_if: '{{flag}} == true' },
        { id: 'step2', tool: 'skip_tool', skip_if: '{{done}}' },
      ],
    });

    registerSkills(server, [skill]);

    const promptCallback = server.prompt.mock.calls[0][2];
    const promptResult = promptCallback();
    const text = promptResult.messages[0].content.text;

    expect(text).toContain('only if {{flag}} == true is truthy');
    expect(text).toContain('skip if {{done}} is truthy');
  });

  test('generates step line without args clause when args is empty', () => {
    const skill = makeSkill({
      expose_as: 'prompt',
      steps: [{ id: 'simple', tool: 'simple_tool' }],
    });

    registerSkills(server, [skill]);

    const promptCallback = server.prompt.mock.calls[0][2];
    const promptResult = promptCallback();
    const text = promptResult.messages[0].content.text;

    expect(text).toContain('[simple] Call `simple_tool`');
    expect(text).not.toContain('with args:');
  });
});

describe('registerSkills — runtime inputs', () => {
  let server;
  beforeEach(() => {
    server = createMockServer();
    mockExecuteSkill.mockReset();
    ok.mockClear();
    err.mockClear();
  });

  test('builds a Zod inputSchema from the declared inputs', () => {
    const skill = makeSkill({
      name: 'with-inputs',
      expose_as: 'tool',
      inputs: {
        query: { type: 'string', description: 'search keyword', default: 'newsletter' },
        limit: { type: 'number', description: 'max hits', default: 10 },
        archive: { type: 'boolean', required: true },
      },
    });

    registerSkills(server, [skill]);

    // Grab the config passed to server.registerTool — we care about the
    // fields existing and carrying the right ZodTypes.
    const [, config] = server.registerTool.mock.calls[0];
    expect(config.inputSchema).toBeDefined();
    expect(Object.keys(config.inputSchema).sort()).toEqual(['archive', 'limit', 'query']);
    // query has a default → safeParse({}) should populate it
    const parsed = config.inputSchema.query.safeParse(undefined);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('newsletter');
    // archive is required → missing value is a parse error
    expect(config.inputSchema.archive.safeParse(undefined).success).toBe(false);
    expect(config.inputSchema.archive.safeParse(true).success).toBe(true);
  });

  test('forwards call-time arguments to executeSkill', async () => {
    mockExecuteSkill.mockResolvedValue({ success: true, steps: [], skill: 'with-inputs' });
    const skill = makeSkill({
      name: 'with-inputs',
      expose_as: 'tool',
      inputs: { query: { type: 'string', default: 'newsletter' } },
    });

    registerSkills(server, [skill]);
    const [, , handler] = server.registerTool.mock.calls[0];
    await handler({ query: 'invoice' });

    expect(mockExecuteSkill).toHaveBeenCalledWith(server, skill, { query: 'invoice' });
  });

  test('handler without args still works (empty object default)', async () => {
    mockExecuteSkill.mockResolvedValue({ success: true, steps: [], skill: 'no-inputs' });
    const skill = makeSkill({ name: 'no-inputs', expose_as: 'tool' });

    registerSkills(server, [skill]);
    const [, , handler] = server.registerTool.mock.calls[0];
    await handler();

    expect(mockExecuteSkill).toHaveBeenCalledWith(server, skill, {});
  });
});

describe('registerSkills — prompt arguments', () => {
  let server;
  beforeEach(() => {
    server = createMockServer();
    mockExecuteSkill.mockReset();
    ok.mockClear();
    err.mockClear();
  });

  test('prompt skill without inputs uses the legacy server.prompt() path', () => {
    const skill = makeSkill({ name: 'legacy-prompt', expose_as: 'prompt' });
    registerSkills(server, [skill]);

    expect(server.prompt).toHaveBeenCalledTimes(1);
    expect(server.registerPrompt).not.toHaveBeenCalled();
  });

  test('prompt skill WITH inputs uses registerPrompt + argsSchema', () => {
    const skill = makeSkill({
      name: 'prompt-with-inputs',
      expose_as: 'prompt',
      inputs: {
        query: { type: 'string', description: 'search term', required: true },
        limit: { type: 'number', description: 'max hits', default: 10 },
      },
    });
    registerSkills(server, [skill]);

    expect(server.registerPrompt).toHaveBeenCalledTimes(1);
    expect(server.prompt).not.toHaveBeenCalled();

    const [name, config, cb] = server.registerPrompt.mock.calls[0];
    expect(name).toBe('prompt-with-inputs');
    expect(config.title).toBe(skill.title);
    expect(config.description).toBe(skill.description);
    expect(config.argsSchema).toBeDefined();
    expect(Object.keys(config.argsSchema).sort()).toEqual(['limit', 'query']);
    // Prompt args are always string on the wire — the schema should reflect that
    expect(config.argsSchema.query.safeParse('hello').success).toBe(true);
    expect(config.argsSchema.query.safeParse(undefined).success).toBe(false); // required
    expect(config.argsSchema.limit.safeParse(undefined).success).toBe(true); // optional

    // Callback folds args into the generated prompt body
    const result = cb({ query: 'newsletter', limit: '5' });
    const text = result.messages[0].content.text;
    expect(text).toContain('Inputs:');
    expect(text).toContain('query = "newsletter"');
  });

  test('registerPrompt callback handles no args (returns text without Inputs block)', () => {
    const skill = makeSkill({
      name: 'prompt-args-optional',
      expose_as: 'prompt',
      inputs: { query: { type: 'string' } },
    });
    registerSkills(server, [skill]);
    const [, , cb] = server.registerPrompt.mock.calls[0];
    const text = cb().messages[0].content.text;
    expect(text).not.toContain('Inputs:');
  });
});
