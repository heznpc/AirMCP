import { describe, test, expect } from '@jest/globals';
import { resolveTemplates, evaluateCondition } from '../dist/skills/executor.js';

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
});
