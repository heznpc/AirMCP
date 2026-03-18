import { describe, test, expect } from '@jest/globals';
import {
  listReminderListsScript,
  listRemindersScript,
  readReminderScript,
  createReminderScript,
  updateReminderScript,
  completeReminderScript,
  deleteReminderScript,
} from '../dist/reminders/scripts.js';

describe('reminders script generators', () => {
  test('listReminderListsScript returns valid JXA', () => {
    const script = listReminderListsScript();
    expect(script).toContain("Application('Reminders')");
    expect(script).toContain("Reminders.lists.name()");
    expect(script).toContain("JSON.stringify");
  });

  test('listRemindersScript without filters', () => {
    const script = listRemindersScript(200, 0);
    expect(script).toContain("Application('Reminders')");
    expect(script).toContain("l.reminders");
    expect(script).not.toContain(".filter");
  });

  test('listRemindersScript with list filter', () => {
    const script = listRemindersScript(200, 0, 'Shopping');
    expect(script).toContain("whose({name: 'Shopping'})");
  });

  test('listRemindersScript with completed filter', () => {
    const script = listRemindersScript(200, 0, undefined, false);
    expect(script).toContain(".whose({completed: false})");
  });

  test('listRemindersScript with both filters', () => {
    const script = listRemindersScript(200, 0, 'Work', true);
    expect(script).toContain("whose({name: 'Work'})");
    expect(script).toContain("r.completed()");
  });

  test('readReminderScript uses byId', () => {
    const script = readReminderScript('reminder-123');
    expect(script).toContain("byId('reminder-123')");
    expect(script).toContain("r.body()");
    expect(script).toContain("r.priority()");
  });

  test('createReminderScript with only title', () => {
    const script = createReminderScript('Buy milk', {});
    expect(script).toContain("name: 'Buy milk'");
    expect(script).toContain("defaultList()");
  });

  test('createReminderScript with all options', () => {
    const script = createReminderScript('Meeting', {
      body: 'Bring notes',
      dueDate: '2026-03-15T10:00:00Z',
      priority: 1,
      list: 'Work',
    });
    expect(script).toContain("name: 'Meeting'");
    expect(script).toContain("body: 'Bring notes'");
    expect(script).toContain("priority: 1");
    expect(script).toContain("whose({name: 'Work'})");
    expect(script).toContain("new Date('2026-03-15T10:00:00Z')");
  });

  test('updateReminderScript with partial updates', () => {
    const script = updateReminderScript('id-1', { name: 'Updated', priority: 5 });
    expect(script).toContain("byId('id-1')");
    expect(script).toContain("r.name = 'Updated'");
    expect(script).toContain("r.priority = 5");
  });

  test('updateReminderScript clears dueDate with null', () => {
    const script = updateReminderScript('id-1', { dueDate: null });
    expect(script).toContain("r.dueDate = null");
  });

  test('completeReminderScript marks complete', () => {
    const script = completeReminderScript('id-1', true);
    expect(script).toContain("byId('id-1')");
    expect(script).toContain("r.completed = true");
  });

  test('completeReminderScript un-completes', () => {
    const script = completeReminderScript('id-1', false);
    expect(script).toContain("r.completed = false");
  });

  test('deleteReminderScript deletes by id', () => {
    const script = deleteReminderScript('id-1');
    expect(script).toContain("byId('id-1')");
    expect(script).toContain("Reminders.delete(r)");
  });
});

describe('reminders esc() injection prevention', () => {
  test('escapes single quotes in list name', () => {
    const script = listRemindersScript(200, 0, "it's a list");
    expect(script).toContain("it\\'s a list");
    expect(script).not.toContain("it's a list");
  });

  test('escapes backslashes in title', () => {
    const script = createReminderScript('path\\file', {});
    expect(script).toContain('path\\\\file');
  });

  test('escapes newlines in body', () => {
    const script = createReminderScript('Test', { body: 'line1\nline2' });
    expect(script).toContain('line1\\nline2');
  });

  test('handles unicode content', () => {
    const script = createReminderScript('장보기', { body: '우유 사기' });
    expect(script).toContain('장보기');
    expect(script).toContain('우유 사기');
  });
});
