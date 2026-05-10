/**
 * RFC 0012 Phase 1 prep — POSIX 5-field cron parser tests.
 *
 * Covers: parse correctness, range / list / step grammar, error
 * surfaces, and `nextFireAt` arithmetic for representative skill
 * shapes (hourly / daily / weekday-only / monthly / once-yearly).
 */
import { describe, test, expect } from '@jest/globals';

const { parseCron, nextFireAt, nextFireFromExpr } = await import('../dist/skills/scheduler/cron.js');

describe('parseCron', () => {
  test('every minute (5 stars)', () => {
    const c = parseCron('* * * * *');
    expect(c.minute.length).toBe(60);
    expect(c.hour.length).toBe(24);
    expect(c.dayOfMonth.length).toBe(31);
    expect(c.month.length).toBe(12);
    expect(c.dayOfWeek.length).toBe(7);
    expect(c.raw).toBe('* * * * *');
  });

  test('weekdays at 9am', () => {
    const c = parseCron('0 9 * * 1-5');
    expect(c.minute).toEqual([0]);
    expect(c.hour).toEqual([9]);
    expect(c.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  test('list grammar', () => {
    const c = parseCron('0,15,30,45 * * * *');
    expect(c.minute).toEqual([0, 15, 30, 45]);
  });

  test('step grammar (every-15-minutes)', () => {
    const c = parseCron('*/15 * * * *');
    expect(c.minute).toEqual([0, 15, 30, 45]);
  });

  test('range + step', () => {
    const c = parseCron('0-30/10 * * * *');
    expect(c.minute).toEqual([0, 10, 20, 30]);
  });

  test('mixed list + range + step', () => {
    const c = parseCron('5,10-20/5,30 * * * *');
    expect(c.minute).toEqual([5, 10, 15, 20, 30]);
  });

  test('first of month at midnight', () => {
    const c = parseCron('0 0 1 * *');
    expect(c.dayOfMonth).toEqual([1]);
    expect(c.hour).toEqual([0]);
  });

  test('rejects 4-field expression', () => {
    expect(() => parseCron('0 9 * *')).toThrow(/5 space-separated fields/);
  });

  test('rejects 6-field expression', () => {
    expect(() => parseCron('0 9 * * * *')).toThrow(/5 space-separated fields/);
  });

  test('rejects out-of-range minute', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/out of range/);
  });

  test('rejects out-of-range hour', () => {
    expect(() => parseCron('0 24 * * *')).toThrow(/out of range/);
  });

  test('rejects empty expression', () => {
    expect(() => parseCron('')).toThrow(/empty/);
    expect(() => parseCron('   ')).toThrow(/empty/);
  });

  test('rejects malformed range (start > end)', () => {
    expect(() => parseCron('5-3 * * * *')).toThrow(/out of range/);
  });

  test('rejects non-positive step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/non-positive step/);
  });

  test('de-dupes overlapping list elements', () => {
    const c = parseCron('5,5,5,10 * * * *');
    expect(c.minute).toEqual([5, 10]);
  });
});

describe('nextFireAt', () => {
  test('every-minute fires next minute boundary', () => {
    const cron = parseCron('* * * * *');
    const from = new Date('2026-05-11T10:30:25.500Z');
    const next = nextFireAt(cron, from);
    expect(next.getSeconds()).toBe(0);
    expect(next.getMilliseconds()).toBe(0);
    // Wall-clock check: at least 1 minute later.
    expect(next.getTime() - from.getTime()).toBeGreaterThanOrEqual(34_500);
    expect(next.getTime() - from.getTime()).toBeLessThanOrEqual(60_000);
  });

  test('weekday 9am from a Monday morning', () => {
    const cron = parseCron('0 9 * * 1-5');
    // 2026-05-11 is a Monday in local time (chosen to match the date the test writes about)
    const from = new Date(2026, 4, 11, 8, 30, 0); // Monday 8:30am local
    const next = nextFireAt(cron, from);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(11); // same Monday
  });

  test('weekday 9am from Monday 9:01 — skips to Tuesday', () => {
    const cron = parseCron('0 9 * * 1-5');
    const from = new Date(2026, 4, 11, 9, 1, 0); // Monday 9:01am local
    const next = nextFireAt(cron, from);
    expect(next.getDay()).toBe(2); // Tuesday
    expect(next.getHours()).toBe(9);
    expect(next.getDate()).toBe(12); // next day
  });

  test('weekday 9am from Friday afternoon — skips weekend', () => {
    const cron = parseCron('0 9 * * 1-5');
    const from = new Date(2026, 4, 15, 18, 0, 0); // Friday 6pm local
    const next = nextFireAt(cron, from);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(18); // Monday 5/18
  });

  test('every 15 minutes from xx:07', () => {
    const cron = parseCron('*/15 * * * *');
    const from = new Date(2026, 4, 11, 10, 7, 30);
    const next = nextFireAt(cron, from);
    expect(next.getMinutes()).toBe(15);
    expect(next.getHours()).toBe(10);
  });

  test('first of month rolls to next month after 1st passes', () => {
    const cron = parseCron('0 0 1 * *');
    const from = new Date(2026, 4, 5, 12, 0, 0); // May 5
    const next = nextFireAt(cron, from);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(5); // June (0-indexed)
  });

  test('once yearly (Apr 1 at 8am)', () => {
    const cron = parseCron('0 8 1 4 *');
    const from = new Date(2026, 4, 1, 0, 0, 0); // May 1 — already past April
    const next = nextFireAt(cron, from);
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(8);
    expect(next.getFullYear()).toBe(2027);
  });

  test('impossible expression (Feb 30) throws', () => {
    const cron = parseCron('0 0 30 2 *');
    expect(() => nextFireAt(cron, new Date(2026, 0, 1))).toThrow(/no fire time within 4 years/);
  });

  test('nextFireFromExpr convenience matches parse + next pipeline', () => {
    const expr = '0 9 * * 1-5';
    const from = new Date(2026, 4, 11, 8, 30, 0);
    const direct = nextFireFromExpr(expr, from);
    const indirect = nextFireAt(parseCron(expr), from);
    expect(direct.getTime()).toBe(indirect.getTime());
  });
});
