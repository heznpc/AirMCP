import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ─── Mock all dependencies of skills/index.js ───────────────────────────

const mockLoadAllSkills = jest.fn();
const mockMergeSkills = jest.fn();
const mockWatchUserSkills = jest.fn();

jest.unstable_mockModule('../dist/skills/loader.js', () => ({
  loadAllSkills: mockLoadAllSkills,
  mergeSkills: mockMergeSkills,
  watchUserSkills: mockWatchUserSkills,
}));

const mockRegisterSkills = jest.fn();
jest.unstable_mockModule('../dist/skills/register.js', () => ({
  registerSkills: mockRegisterSkills,
}));

const mockRegisterTrigger = jest.fn();
const mockResetTriggers = jest.fn();
const mockStartTriggerListener = jest.fn();
jest.unstable_mockModule('../dist/skills/triggers.js', () => ({
  registerTrigger: mockRegisterTrigger,
  resetTriggers: mockResetTriggers,
  startTriggerListener: mockStartTriggerListener,
}));

const { registerSkillEngine, closeSkillsWatcher } =
  await import('../dist/skills/index.js');

// ─── Helpers ────────────────────────────────────────────────────────────
function makeSkill(name, hasTrigger = false) {
  const skill = {
    name,
    title: `Title ${name}`,
    description: `Desc ${name}`,
    expose_as: 'tool',
    steps: [{ id: 'step1', tool: 'some_tool' }],
  };
  if (hasTrigger) {
    skill.trigger = { event: 'calendar_changed' };
  }
  return skill;
}

const fakeServer = {};

// ═══════════════════════════════════════════════════════════════════════════
// registerSkillEngine
//
// NOTE: skillsWatcher is module-level state. The first registerSkillEngine
// call that finds skills will call watchUserSkills and store the watcher.
// Subsequent calls skip watchUserSkills because skillsWatcher is non-null.
// closeSkillsWatcher sets it back to null, allowing re-creation.
//
// Tests are ordered to account for this singleton behavior:
// 1. "no skills found" — returns early, never sets watcher
// 2. "full flow" — first successful call, sets watcher
// 3. "repeated calls" — watcher already set, skips creation
// 4. "closeSkillsWatcher" — resets watcher, allows new creation
// ═══════════════════════════════════════════════════════════════════════════

describe('registerSkillEngine', () => {
  beforeEach(() => {
    mockLoadAllSkills.mockReset();
    mockMergeSkills.mockReset();
    mockWatchUserSkills.mockReset();
    mockRegisterSkills.mockReset();
    mockRegisterTrigger.mockReset();
    mockResetTriggers.mockReset();
    mockStartTriggerListener.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('returns early when no skills found (merged is empty)', async () => {
    mockLoadAllSkills.mockReturnValue({ builtins: [], user: [] });
    mockMergeSkills.mockReturnValue([]);

    await registerSkillEngine(fakeServer);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('no skills found'),
    );
    expect(mockRegisterSkills).not.toHaveBeenCalled();
    expect(mockResetTriggers).not.toHaveBeenCalled();
    expect(mockStartTriggerListener).not.toHaveBeenCalled();
    // watchUserSkills not called either (early return before watcher setup)
    expect(mockWatchUserSkills).not.toHaveBeenCalled();
  });

  test('orchestrates full skill registration flow', async () => {
    const skills = [makeSkill('skill-a'), makeSkill('skill-b', true)];
    const mockClose = jest.fn();
    mockLoadAllSkills.mockReturnValue({ builtins: skills, user: [] });
    mockMergeSkills.mockReturnValue(skills);
    mockRegisterSkills.mockReturnValue({ prompts: 0, tools: 2 });
    mockWatchUserSkills.mockReturnValue({ close: mockClose });

    await registerSkillEngine(fakeServer);

    // loadAllSkills called with builtins directory
    expect(mockLoadAllSkills).toHaveBeenCalledTimes(1);
    expect(mockLoadAllSkills.mock.calls[0][0]).toContain('builtins');

    // mergeSkills called with loaded builtins and user
    expect(mockMergeSkills).toHaveBeenCalledWith(skills, []);

    // registerSkills called with server and merged skills
    expect(mockRegisterSkills).toHaveBeenCalledWith(fakeServer, skills);

    // resetTriggers called before registering new triggers
    expect(mockResetTriggers).toHaveBeenCalledTimes(1);

    // registerTrigger called for each merged skill
    expect(mockRegisterTrigger).toHaveBeenCalledTimes(2);
    expect(mockRegisterTrigger).toHaveBeenCalledWith(skills[0]);
    expect(mockRegisterTrigger).toHaveBeenCalledWith(skills[1]);

    // startTriggerListener called with server
    expect(mockStartTriggerListener).toHaveBeenCalledWith(fakeServer);

    // watchUserSkills called (first time — watcher was null)
    expect(mockWatchUserSkills).toHaveBeenCalledTimes(1);

    // Exercise the callback passed to watchUserSkills to cover the
    // "User skills changed" log line (index.js line 24)
    const watchCallback = mockWatchUserSkills.mock.calls[0][0];
    watchCallback();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('User skills changed'),
    );
  });

  test('does not create a second watcher on repeated calls', async () => {
    // skillsWatcher is already set from the previous test.
    const skills = [makeSkill('skill-x')];
    mockLoadAllSkills.mockReturnValue({ builtins: skills, user: [] });
    mockMergeSkills.mockReturnValue(skills);

    await registerSkillEngine(fakeServer);

    // watchUserSkills should NOT be called (watcher already exists)
    expect(mockWatchUserSkills).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// closeSkillsWatcher
// ═══════════════════════════════════════════════════════════════════════════

describe('closeSkillsWatcher', () => {
  beforeEach(() => {
    mockLoadAllSkills.mockReset();
    mockMergeSkills.mockReset();
    mockWatchUserSkills.mockReset();
    mockRegisterSkills.mockReset();
    mockRegisterTrigger.mockReset();
    mockResetTriggers.mockReset();
    mockStartTriggerListener.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('closes the watcher and allows a new one on next registerSkillEngine call', async () => {
    // At this point skillsWatcher is set from the "orchestrates full flow" test.
    // closeSkillsWatcher should call .close() on it and set it to null.
    closeSkillsWatcher();

    // Now a new registerSkillEngine call should create a new watcher.
    const mockClose2 = jest.fn();
    mockWatchUserSkills.mockReturnValue({ close: mockClose2 });

    const skills = [makeSkill('skill-z')];
    mockLoadAllSkills.mockReturnValue({ builtins: skills, user: [] });
    mockMergeSkills.mockReturnValue(skills);

    await registerSkillEngine(fakeServer);
    expect(mockWatchUserSkills).toHaveBeenCalledTimes(1);

    // Clean up: close the new watcher so other test files don't see stale state
    closeSkillsWatcher();
    expect(mockClose2).toHaveBeenCalledTimes(1);
  });

  test('closeSkillsWatcher is safe to call when no watcher exists', () => {
    // skillsWatcher is null after the previous test's cleanup
    expect(() => closeSkillsWatcher()).not.toThrow();
  });
});
