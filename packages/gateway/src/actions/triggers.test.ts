import { describe, expect, it } from 'vitest';

import { nextFireMs, parseCron } from '@beanstalk/shared-race/cron';
import { selectedBy } from './filter-pattern';
import { checkDispatchInputs, namesStalk, pushFires } from './triggers';

const push = (filters: Partial<Parameters<typeof pushFires>[0]> = {}) => ({
  kind: 'push' as const,
  branches: [],
  branchesIgnore: [],
  paths: [],
  pathsIgnore: [],
  ...filters,
});
const move = (changedPaths: string[] | null = null) => ({ defaultBranch: 'stalk', changedPaths });

describe('push triggers on the stalk', () => {
  it('fires for main, stalk and the default branch, which all name the stalk', () => {
    expect(pushFires(push(), move())).toBe(true);
    expect(pushFires(push({ branches: ['main'] }), move())).toBe(true);
    expect(pushFires(push({ branches: ['stalk'] }), move())).toBe(true);
    expect(pushFires(push({ branches: ['release/*'] }), move())).toBe(false);
    expect(pushFires(push({ branchesIgnore: ['main'] }), move())).toBe(false);
    expect(pushFires(push({ branches: ['**', '!main', '!stalk'] }), move())).toBe(false);
  });

  it('applies path filters to the files the stalk move changed', () => {
    expect(pushFires(push({ paths: ['src/**'] }), move(['src/a.ts']))).toBe(true);
    expect(pushFires(push({ paths: ['src/**'] }), move(['docs/a.md']))).toBe(false);
    expect(pushFires(push({ pathsIgnore: ['docs/**'] }), move(['docs/a.md']))).toBe(false);
    expect(pushFires(push({ pathsIgnore: ['docs/**'] }), move(['docs/a.md', 'b.ts']))).toBe(true);
    expect(pushFires(push({ paths: ['src/**'] }), move(null))).toBe(true);
  });

  it('names the stalk by any of its names', () => {
    expect(namesStalk('refs/heads/main', 'stalk')).toBe(true);
    expect(namesStalk('stalk', 'stalk')).toBe(true);
    expect(namesStalk('sprout', 'stalk')).toBe(false);
  });

  it('matches GitHub filter patterns', () => {
    expect(selectedBy(['*.md'], 'a.md')).toBe(true);
    expect(selectedBy(['*.md'], 'docs/a.md')).toBe(false);
    expect(selectedBy(['docs/**/a.md'], 'docs/a.md')).toBe(true);
    expect(selectedBy(['feature/?'], 'feature/x')).toBe(true);
  });
});

describe('dispatch inputs', () => {
  const declared = [
    {
      name: 'level',
      description: null,
      type: 'choice' as const,
      required: true,
      default: 'a',
      options: ['a', 'b'],
    },
    {
      name: 'dry',
      description: null,
      type: 'boolean' as const,
      required: false,
      default: null,
      options: [],
    },
  ];

  it('fills defaults and stringifies values', () => {
    expect(checkDispatchInputs(declared, { dry: true })).toEqual({
      ok: true,
      inputs: { level: 'a', dry: 'true' },
    });
  });

  it('refuses unknown inputs, bad choices and bad booleans', () => {
    expect(checkDispatchInputs(declared, { nope: 1 })).toMatchObject({ ok: false });
    expect(checkDispatchInputs(declared, { level: 'c' })).toMatchObject({ ok: false });
    expect(checkDispatchInputs(declared, { dry: 'maybe' })).toMatchObject({ ok: false });
  });
});

describe('cron schedules', () => {
  const at = (iso: string) => Date.parse(iso);

  it('finds the next fire time in UTC', () => {
    const daily = parseCron('30 3 * * *');
    expect(daily).not.toBeNull();
    if (daily === null) return;
    expect(new Date(nextFireMs(daily, at('2026-10-08T12:00:00Z')) ?? 0).toISOString()).toBe(
      '2026-10-09T03:30:00.000Z',
    );
    const quarter = parseCron('*/15 * * * *');
    if (quarter === null) throw new Error('valid cron');
    expect(new Date(nextFireMs(quarter, at('2026-10-08T12:07:10Z')) ?? 0).toISOString()).toBe(
      '2026-10-08T12:15:00.000Z',
    );
  });

  it('reads names, ranges and cron’s either-day rule', () => {
    const weekdays = parseCron('0 9 * JAN-MAR MON-FRI');
    if (weekdays === null) throw new Error('valid cron');
    // 2026-10-08 is a Thursday: the next January weekday 09:00 is Friday 1 January 2027.
    expect(new Date(nextFireMs(weekdays, at('2026-10-08T00:00:00Z')) ?? 0).toISOString()).toBe(
      '2027-01-01T09:00:00.000Z',
    );
    const either = parseCron('0 0 13 * 5');
    if (either === null) throw new Error('valid cron');
    expect(new Date(nextFireMs(either, at('2026-10-08T00:00:00Z')) ?? 0).toISOString()).toBe(
      '2026-10-09T00:00:00.000Z',
    );
  });

  it('refuses what is not cron', () => {
    for (const line of ['* * * *', '60 * * * *', '* * * 13 *', 'a b c d e', '5-1 * * * *'])
      expect(parseCron(line)).toBeNull();
  });
});
