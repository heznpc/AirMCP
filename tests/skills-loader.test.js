import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock node:fs before importing loader ───────────────────────────────
const mockReadFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockWatch = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  mkdirSync: mockMkdirSync,
  watch: mockWatch,
}));

const { loadSkillFile, loadAllSkills, mergeSkills, watchUserSkills } =
  await import('../dist/skills/loader.js');

// ─── Valid YAML fixtures ────────────────────────────────────────────────
const VALID_YAML = `
name: daily-briefing
title: Daily Briefing
description: Summarize today's calendar and mail
expose_as: tool
steps:
  - id: get_events
    tool: calendar_list_events
    args:
      date: today
`;

const VALID_YAML_WITH_TRIGGER = `
name: auto-scan
title: Auto Scan
description: Auto-scan on calendar change
expose_as: tool
trigger:
  event: calendar_changed
  debounce_ms: 3000
steps:
  - id: scan
    tool: calendar_list_events
`;

const VALID_YAML_PROMPT = `
name: morning-prompt
title: Morning Prompt
description: Morning briefing prompt
expose_as: prompt
steps:
  - id: step_one
    tool: get_stuff
`;

// ═══════════════════════════════════════════════════════════════════════════
// loadSkillFile
// ═══════════════════════════════════════════════════════════════════════════

describe('loadSkillFile', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('loads and parses a valid YAML skill file', () => {
    mockReadFileSync.mockReturnValue(VALID_YAML);

    const result = loadSkillFile('/path/to/skill.yaml');

    expect(result).not.toBeNull();
    expect(result.name).toBe('daily-briefing');
    expect(result.title).toBe('Daily Briefing');
    expect(result.expose_as).toBe('tool');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].id).toBe('get_events');
    expect(result.steps[0].tool).toBe('calendar_list_events');
  });

  test('loads skill with trigger field', () => {
    mockReadFileSync.mockReturnValue(VALID_YAML_WITH_TRIGGER);

    const result = loadSkillFile('/path/to/trigger-skill.yaml');

    expect(result).not.toBeNull();
    expect(result.trigger).toEqual({ event: 'calendar_changed', debounce_ms: 3000 });
  });

  test('returns null for file exceeding MAX_SKILL_FILE_SIZE (256KB)', () => {
    mockReadFileSync.mockReturnValue('x'.repeat(256_001));

    const result = loadSkillFile('/path/to/huge.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Skill file too large'),
    );
  });

  test('returns null for invalid YAML (bad schema)', () => {
    const invalidYaml = `
name: BAD NAME WITH SPACES
title: ok
description: ok
expose_as: tool
steps:
  - id: step1
    tool: sometool
`;
    mockReadFileSync.mockReturnValue(invalidYaml);

    const result = loadSkillFile('/path/to/bad.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid skill'),
    );
  });

  test('returns null when YAML has no steps', () => {
    const noSteps = `
name: empty-steps
title: No Steps
description: Has no steps
expose_as: tool
steps: []
`;
    mockReadFileSync.mockReturnValue(noSteps);

    const result = loadSkillFile('/path/to/empty.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid skill'),
    );
  });

  test('returns null when readFileSync throws (file not found)', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });

    const result = loadSkillFile('/path/to/missing.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load skill'),
    );
  });

  test('returns null when readFileSync throws non-Error value', () => {
    mockReadFileSync.mockImplementation(() => { throw 'raw string error'; });

    const result = loadSkillFile('/path/to/bad.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('raw string error'),
    );
  });

  test('returns null for malformed YAML that fails parse', () => {
    mockReadFileSync.mockReturnValue(':::: not valid yaml {{{{');

    const result = loadSkillFile('/path/to/malformed.yaml');

    expect(result).toBeNull();
  });

  test('accepts a skill with runtime inputs that do not collide with step ids', () => {
    mockReadFileSync.mockReturnValue(`
name: with-inputs
title: With Inputs
description: Runtime inputs
expose_as: tool
inputs:
  query:
    type: string
    description: A search keyword
    default: newsletter
  mailbox:
    type: string
    default: INBOX
steps:
  - id: search
    tool: search_messages
    args:
      q: "{{query}}"
`);
    const result = loadSkillFile('/path/to/with-inputs.yaml');
    expect(result).not.toBeNull();
    expect(result.inputs.query.default).toBe('newsletter');
  });

  test('rejects a skill when an input name collides with a step id', () => {
    mockReadFileSync.mockReturnValue(`
name: collision
title: Collision
description: Input name collides with step id
expose_as: tool
inputs:
  search:
    type: string
steps:
  - id: search
    tool: some_tool
    args: {}
`);
    const result = loadSkillFile('/path/to/collision.yaml');
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('input name(s) collide with step id(s): search'),
    );
  });

  test('rejects invalid input names (uppercase / hyphen)', () => {
    mockReadFileSync.mockReturnValue(`
name: bad-input-name
title: Bad input name
description: Input name must be lowercase identifier
expose_as: tool
inputs:
  BadName:
    type: string
steps:
  - id: s
    tool: t
    args: {}
`);
    const result = loadSkillFile('/path/to/bad.yaml');
    expect(result).toBeNull();
  });

  test('validates step ID must be lowercase alphanumeric with underscores', () => {
    const badStepId = `
name: bad-step
title: Bad Step
description: Has bad step ID
expose_as: tool
steps:
  - id: BAD-STEP-ID
    tool: sometool
`;
    mockReadFileSync.mockReturnValue(badStepId);

    const result = loadSkillFile('/path/to/bad-step.yaml');

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid skill'),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// loadAllSkills — scanDirectory + builtins cache
//
// NOTE: builtinsCache is a module-level singleton. The first successful
// loadAllSkills call populates it; subsequent calls return the cached
// builtins regardless of the directory argument. We structure these tests
// so the FIRST call is the one that populates the cache, and later tests
// work with that cached state.
// ═══════════════════════════════════════════════════════════════════════════

describe('loadAllSkills', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('scans builtins dir, loads .yaml/.yml files, caches builtins, and scans user dir', () => {
    // First call in this test suite — builtinsCache is null so scanDirectory
    // will run for the builtins dir.
    mockReaddirSync
      // First call: builtins dir
      .mockReturnValueOnce(['skill1.yaml', 'skill2.yml', 'readme.txt'])
      // Second call: user skills dir
      .mockReturnValueOnce([]);

    mockReadFileSync
      .mockReturnValueOnce(VALID_YAML)
      .mockReturnValueOnce(VALID_YAML_WITH_TRIGGER);

    const { builtins, user } = loadAllSkills('/fake/builtins');

    expect(builtins).toHaveLength(2);
    expect(builtins[0].name).toBe('daily-briefing');
    expect(builtins[1].name).toBe('auto-scan');
    expect(user).toHaveLength(0);
    // Filtered out 'readme.txt' — only .yaml and .yml loaded
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  test('uses builtins cache on subsequent calls (does not re-scan builtins dir)', () => {
    // builtinsCache is already populated from the previous test.
    // readdirSync should only be called once (for the user dir).
    mockReaddirSync.mockReturnValueOnce([]);

    const { builtins, user } = loadAllSkills('/different/builtins');

    // Builtins come from cache, not from re-scanning /different/builtins
    expect(builtins).toHaveLength(2);
    expect(user).toHaveLength(0);
    // Only one readdirSync call (user dir), not two
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  test('returns empty user array when user skills dir does not exist', () => {
    // User dir throws on readdirSync
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const { builtins, user } = loadAllSkills('/fake/builtins');

    // Builtins still come from cache
    expect(builtins).toHaveLength(2);
    // User dir scan fails gracefully
    expect(user).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeSkills
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeSkills', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  const makeSkill = (name, expose_as = 'tool') => ({
    name,
    title: `Title ${name}`,
    description: `Desc ${name}`,
    expose_as,
    steps: [{ id: 'step1', tool: 'some_tool' }],
  });

  test('merges builtins and user skills without conflicts', () => {
    const builtins = [makeSkill('builtin-a'), makeSkill('builtin-b')];
    const user = [makeSkill('user-a'), makeSkill('user-b')];

    const result = mergeSkills(builtins, user);

    expect(result).toHaveLength(4);
    expect(result.map((s) => s.name)).toEqual(['builtin-a', 'builtin-b', 'user-a', 'user-b']);
  });

  test('skips user skill that conflicts with built-in name', () => {
    const builtins = [makeSkill('daily-briefing')];
    const user = [makeSkill('daily-briefing'), makeSkill('custom-skill')];

    const result = mergeSkills(builtins, user);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(['daily-briefing', 'custom-skill']);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('conflicts with built-in skill'),
    );
  });

  test('returns empty array when both inputs are empty', () => {
    const result = mergeSkills([], []);
    expect(result).toEqual([]);
  });

  test('returns only builtins when no user skills exist', () => {
    const builtins = [makeSkill('builtin-only')];
    const result = mergeSkills(builtins, []);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('builtin-only');
  });

  test('returns only user skills when no builtins exist', () => {
    const user = [makeSkill('user-only')];
    const result = mergeSkills([], user);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('user-only');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// watchUserSkills
// ═══════════════════════════════════════════════════════════════════════════

describe('watchUserSkills', () => {
  beforeEach(() => {
    mockMkdirSync.mockReset();
    mockWatch.mockReset();
  });

  test('creates user dir and sets up fs.watch', () => {
    const fakeWatcher = { close: jest.fn() };
    mockWatch.mockReturnValue(fakeWatcher);

    const callback = jest.fn();
    const watcher = watchUserSkills(callback);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('skills'),
      { recursive: true },
    );
    expect(mockWatch).toHaveBeenCalled();
    expect(watcher).toBe(fakeWatcher);
  });

  test('debounces callback invocations via watch handler', () => {
    let watchHandler;
    mockWatch.mockImplementation((_dir, handler) => {
      watchHandler = handler;
      return { close: jest.fn() };
    });

    const callback = jest.fn();
    watchUserSkills(callback);

    expect(watchHandler).toBeDefined();

    jest.useFakeTimers();
    watchHandler();
    watchHandler();
    watchHandler();

    // Callback not called yet (within debounce window)
    expect(callback).not.toHaveBeenCalled();

    // After 500ms debounce
    jest.advanceTimersByTime(500);
    expect(callback).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
