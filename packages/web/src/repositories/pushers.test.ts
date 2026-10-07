import { describe, expect, it } from 'vitest';

import { classifyByKeywords } from '@beanstalk/shared-ask/ask/classifier';
import { parseRaceEvents } from '@beanstalk/shared-ask/race/race-events';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { lastPushLine, sessionsActiveLine } from '../people/contributor-line';
import { pushersOf } from './pushers';
import { REPOSITORY_SUGGESTIONS } from './questions';

const BASE = '26eecce0d764943d0c89a6139e3491055e9ff00c';
const SHA = '822e661f90b8cd852d625acae8cc3ce36520d6cd';

/** A repository engine whose first pushed bean landed. */
function pushedState() {
  const raw: readonly Record<string, unknown>[] = [
    {
      type: 'race.start',
      policy: 'beanstalk-v2',
      agent: 'push',
      model: 'push',
      agents: 32,
      ci_seconds: 0,
      ci_slots: 1,
      batch: 1,
      tasks: [],
      budget_usd: 0,
      seed: 0,
      base: BASE,
    },
    { type: 'task.start', task: 'add-truncate', agent: 'a0', base: BASE },
    { type: 'land', task: 'add-truncate', sha: SHA, target: 'trunk', files: ['src/text.ts'] },
  ];
  const parsed = parseRaceEvents(
    raw.map((fields, index) =>
      Object.assign(
        {
          seq: index + 1,
          t: index * 5,
          ts: new Date(Date.UTC(2026, 9, 7, 9, 0, index * 5)).toISOString(),
        },
        fields,
      ),
    ),
  );
  return reduceRace(parsed.events);
}

function gateway(answer: unknown) {
  return { pushedBeans: (_engine: string) => Promise.resolve(answer) };
}

describe("a repository's pushers", () => {
  it('maps each pushed bean to the handle that pushed it', async () => {
    const binding = gateway({
      ok: true,
      value: [{ bean: 'add-truncate', actor: 'coop', phase: 'green', title: 'Add truncate' }],
    });
    expect(await pushersOf(binding, 'r123')).toEqual({ 'add-truncate': 'coop' });
  });

  it('reads as nobody pushed when the gateway refuses, answers nonsense or lacks the method', async () => {
    const refused = gateway({ ok: false, error: { code: 'not_found', message: 'no' } });
    expect(await pushersOf(refused, 'r123')).toEqual({});
    expect(await pushersOf(gateway({ ok: true, value: 'x' }), 'r123')).toEqual({});
    expect(await pushersOf({}, 'r123')).toEqual({});
  });
});

describe("the status line's who", () => {
  it('names the person who pushed last in a repository, not "0 people, 0 sessions"', () => {
    expect(lastPushLine(pushedState(), { 'add-truncate': 'coop' })).toBe(
      'last push @coop: add-truncate',
    );
  });

  it('says so before anyone pushed', () => {
    expect(lastPushLine(pushedState(), {})).toBe('no pushes yet');
  });

  it('keeps the race wording for races', () => {
    expect(sessionsActiveLine(pushedState(), {})).toBe('0 people, 0 sessions active');
  });
});

describe("a repository's Files examples", () => {
  it('name no agent slot or race bean and each reaches a real view', () => {
    for (const question of REPOSITORY_SUGGESTIONS) {
      expect(question).not.toMatch(/\ba\d+\b|\bt\d{3}\b/);
      expect(classifyByKeywords(question, 'sprout').class).not.toBe('explore');
    }
  });
});
