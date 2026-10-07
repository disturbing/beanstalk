import { describe, expect, it } from 'vitest';

import { classifyByKeywords } from '../ask/classifier';
import { creditOf, lastPush } from '../home/sessions';
import { parseRaceEvents } from '../race/race-events';
import { reduceRace } from '../race/reduce-race';
import { suggestDecision, suggestions } from './lead';

const BASE = '26eecce0d764943d0c89a6139e3491055e9ff00c';
const SHA_A = '822e661f90b8cd852d625acae8cc3ce36520d6cd';
const SHA_B = 'b8da0156785efc5e20d5ec34f9db8fce173beed6';

/** A repository engine after two pushed beans landed and a third started checking. */
function repositoryState() {
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
    {
      type: 'land',
      task: 'add-truncate',
      sha: SHA_A,
      target: 'trunk',
      files: ['src/text.ts', 'test/text.test.ts'],
    },
    { type: 'task.start', task: 'add-pad', agent: 'a0', base: SHA_A },
    { type: 'land', task: 'add-pad', sha: SHA_B, target: 'trunk', files: ['src/text.ts'] },
    { type: 'task.start', task: 'add-wrap', agent: 'a1', base: SHA_B },
  ];
  const events = raw.map((fields, index) =>
    Object.assign(
      {
        seq: index + 1,
        t: index * 10,
        ts: new Date(Date.UTC(2026, 9, 7, 10, 0, index * 10)).toISOString(),
      },
      fields,
    ),
  );
  const parsed = parseRaceEvents(events);
  expect(parsed.skipped).toEqual([]);
  return reduceRace(parsed.events);
}

const PUSHERS = { 'add-truncate': 'coop', 'add-pad': 'dana', 'add-wrap': 'coop' };

describe("a repository's suggested questions", () => {
  it('never names an agent slot, and asks who changed the busiest file instead', () => {
    const state = repositoryState();
    const questions = suggestions(state, state.clock, 'repository').map((item) => item.question);
    expect(questions.some((question) => /\ba\d+\b/.test(question))).toBe(false);
    expect(questions).toContain('who changed src/text.ts and why?');
  });

  it('suggests only questions the keyword router answers with the intended view', () => {
    const state = repositoryState();
    const intended: Readonly<Record<string, string>> = {
      area: 'recent-changes',
      swarm: 'in-flight',
      red: 'what-broke',
      decision: 'decisions',
      pending: 'pending-promotion',
      who: 'who-why',
    };
    const items = suggestions(state, state.clock, 'repository');
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(['swarm', 'who']));
    for (const item of items)
      expect(classifyByKeywords(item.question, 'sprout').class).toBe(intended[item.id]);
  });

  it('still asks after the busiest agent in a race', () => {
    const state = repositoryState();
    const questions = suggestions(state, state.clock).map((item) => item.question);
    expect(questions).toContain('what has a0 done?');
  });

  it('orders the who question and words its rule for a repository', () => {
    const state = repositoryState();
    const items = suggestions(state, state.clock, 'repository');
    const rule = suggestDecision(items, true, 'repository').rule();
    expect(rule.chosen).toContain('who');
    expect(rule.why).toBe('Rule: a growing repository suggests what is happening now.');
  });
});

describe('who grew a bean', () => {
  it('names the person who pushed it, not the slot', () => {
    expect(creditOf({ id: 'add-pad', agent: 'a0' }, {}, PUSHERS)).toEqual({
      kind: 'pusher',
      who: '@dana',
      detail: 'pushed by @dana',
    });
  });

  it('falls back to the slot and its session in a race', () => {
    const sessions = { a0: { slot: 'a0', owner: 'coop', harness: 'Codex' } };
    expect(creditOf({ id: 't001', agent: 'a0' }, sessions, {})).toEqual({
      kind: 'session',
      who: 'a0',
      detail: 'Codex session of coop',
    });
  });

  it('reports the newest push and how many people pushed', () => {
    expect(lastPush(repositoryState(), PUSHERS)).toEqual({
      pusher: 'coop',
      bean: 'add-wrap',
      people: 2,
    });
  });

  it('reports no push when no bean has a pusher', () => {
    expect(lastPush(repositoryState(), {})).toBeNull();
  });
});
