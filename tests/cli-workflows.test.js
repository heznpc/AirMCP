import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';

const mockBuildSnapshot = jest.fn();
jest.unstable_mockModule('../dist/shared/resources.js', () => ({
  buildSnapshot: mockBuildSnapshot,
}));

const { WORKFLOWS, runWorkflows } = await import('../dist/cli/workflows.js');
const { MODULE_NAMES, STARTER_MODULES } = await import('../dist/shared/config.js');

describe('cli workflows command', () => {
  let logSpy;

  beforeEach(() => {
    mockBuildSnapshot.mockReset();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  test('prints curated workflow names and prompts', async () => {
    await runWorkflows([]);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('AirMCP Workflows');
    expect(output).toContain('Daily Briefing');
    expect(output).toContain('Inbox Triage');
    expect(output).toContain('Project Digest');
    expect(output).toContain('triage my inbox');
  });

  test('emits machine-readable JSON catalog', async () => {
    await runWorkflows(['--json']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.workflows).toHaveLength(WORKFLOWS.length);
    expect(parsed.workflows.map((w) => w.id)).toEqual([
      'daily-briefing',
      'inbox-triage',
      'meeting-prep',
      'project-digest',
      'focus-blocks',
      'research-output',
    ]);
  });

  test('prints one copyable workflow prompt', async () => {
    await runWorkflows(['daily-briefing', '--prompt']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe(
      "Brief me on today's calendar, overdue reminders, unread mail, and recent notes.",
    );
  });

  test('emits machine-readable JSON for one workflow', async () => {
    await runWorkflows(['project-digest', '--json']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.workflow).toMatchObject({
      id: 'project-digest',
      title: 'Project Digest',
      requiredModules: ['memory', 'notes', 'calendar', 'reminders', 'mail', 'finder'],
      implementation: 'built-in-skill',
    });
  });

  test('prints one workflow module list', async () => {
    await runWorkflows(['meeting-prep', '--modules']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe('calendar, notes, contacts, finder, reminders');
  });

  test('runs a real read-only daily briefing preview path', async () => {
    mockBuildSnapshot.mockResolvedValue('{"timestamp":"2026-06-17T00:00:00.000Z","depth":"brief","calendar":{}}');

    await runWorkflows(['daily-briefing', '--preview']);

    expect(mockBuildSnapshot).toHaveBeenCalledTimes(1);
    const enabled = mockBuildSnapshot.mock.calls[0][0];
    expect(enabled('calendar')).toBe(true);
    expect(enabled('reminders')).toBe(true);
    expect(enabled('mail')).toBe(true);
    expect(enabled('notes')).toBe(true);
    expect(enabled('weather')).toBe(false);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('AirMCP read-only preview: Daily Briefing');
    expect(output).toContain('Writes: none');
    expect(output).toContain('"depth":"brief"');
  });

  test('references only tools that exist in the generated manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../docs/tool-manifest.json', import.meta.url), 'utf8'));
    const toolNames = new Set(manifest.tools.map((tool) => tool.name));

    for (const workflow of WORKFLOWS) {
      for (const tool of workflow.tools) {
        expect(toolNames.has(tool)).toBe(true);
      }
    }
  });

  test('references only modules that exist in config', () => {
    const moduleNames = new Set(MODULE_NAMES);

    for (const workflow of WORKFLOWS) {
      expect(workflow.requiredModules.length).toBeGreaterThan(0);
      for (const moduleName of workflow.requiredModules) {
        expect(moduleNames.has(moduleName)).toBe(true);
      }
    }
  });

  test('keeps the workflow guide in sync with the CLI catalog', () => {
    const guide = readFileSync(new URL('../docs/workflows.md', import.meta.url), 'utf8');

    for (const workflow of WORKFLOWS) {
      expect(guide).toContain(workflow.title);
      expect(guide).toContain(workflow.prompt);
      expect(guide).toContain(workflow.implementation);
      for (const moduleName of workflow.requiredModules) {
        expect(guide).toContain(`\`${moduleName}\``);
      }
    }

    expect(guide).toContain('AIRMCP_ENABLE_FOUNDATION_MODELS');
  });

  test('documents the actual starter module preset', () => {
    const mcpb = readFileSync(new URL('../docs/mcpb.md', import.meta.url), 'utf8');

    for (const moduleName of STARTER_MODULES) {
      expect(mcpb).toContain(moduleName);
    }
    expect(mcpb).not.toContain('contacts, mail, finder, system');
  });

  test('keeps onboarding workflow cards aligned with the CLI catalog', () => {
    const onboarding = readFileSync(
      new URL('../app/Sources/AirMCPApp/Views/OnboardingView.swift', import.meta.url),
      'utf8',
    );

    for (const workflow of WORKFLOWS) {
      expect(onboarding).toContain(`id: "${workflow.id}"`);
      const camelId = workflow.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      expect(onboarding).toContain(`promptKey: "workflow.${camelId}.prompt"`);
      for (const moduleName of workflow.requiredModules) {
        expect(onboarding).toContain(`"${moduleName}"`);
      }
    }
  });

  test('onboarding exposes Codex CLI setup', () => {
    const onboarding = readFileSync(
      new URL('../app/Sources/AirMCPApp/Views/OnboardingView.swift', import.meta.url),
      'utf8',
    );

    expect(onboarding).toContain('id: "codex"');
    expect(onboarding).toContain('NodeEnvironment.findExecutable(named: "codex")');
    expect(onboarding).toContain('"mcp", "add", "airmcp", "--", "npx", "-y"');
  });

  test('onboarding final step can copy the selected workflow prompt', () => {
    const onboarding = readFileSync(
      new URL('../app/Sources/AirMCPApp/Views/OnboardingView.swift', import.meta.url),
      'utf8',
    );

    expect(onboarding).toContain('selectedWorkflowActions');
    expect(onboarding).toContain('AirMcpConstants.copyToClipboard(selectedWorkflow.prompt)');
    expect(onboarding).toContain('AirMcpConstants.copyToClipboard("Hey Siri, \\(siriPhrase)")');
  });
});
