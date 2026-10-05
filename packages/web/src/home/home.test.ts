import { describe, expect, it } from 'vitest';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { keywordClassifier } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';
import { busiestMoment } from '@beanstalk/shared-ask/home/busiest-moment';
import { composeAnswer } from '@beanstalk/shared-ask/home/composition';
import { dirListing } from '@beanstalk/shared-ask/home/file-rows';
import { activeContributors, placeholderSessions } from '@beanstalk/shared-ask/home/sessions';
import { stalkRows } from '@beanstalk/shared-ask/home/stalk';
import { rulesPicker } from '@beanstalk/shared-ask/pick/picker';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { recordedSource } from '../forge/recorded-source';
import { titlesOf } from '../recorded/race-pair';
import { recordedRun } from '../recorded/recorded-runs';

const v2 = RunId.parse('7z4j84eqvl');
const recorded = recordedRun(v2);
const events = recorded?.events ?? [];
const titles = recorded === undefined ? {} : titlesOf(recorded);
const START = events.find((event) => event.type === 'race.start')?.t ?? 0;

function at(seconds: number) {
  const now = START + seconds;
  const visible: readonly RaceEvent[] = events.filter((event) => event.t <= now);
  return { now, visible, state: reduceRace(visible) };
}

describe('the stalk of the recorded v2 run', () => {
  it('grows beans at the tip mid-run, then sprout leaves above the stalk pointer', () => {
    const { now, visible, state } = at(760);
    const rows = stalkRows({ state, events: visible, now, titles });
    const kinds = rows.map((row) => row.kind);
    expect(kinds.slice(0, 6)).toEqual(['bean', 'bean', 'bean', 'bean', 'bean', 'bean']);
    const pointer = kinds.indexOf('pointer');
    expect(
      rows.slice(6, pointer).every((row) => row.kind !== 'leaf' || row.status === 'sprout'),
    ).toBe(true);
    expect(rows.some((row) => row.kind === 'fell')).toBe(true);
  });

  it('says nothing is growing when the run is over, and keeps the culprit red', () => {
    const state = reduceRace(events);
    const rows = stalkRows({ state, events, now: state.endedAt ?? 0, titles });
    expect(rows[0]).toEqual({ kind: 'idle', key: 'idle', finished: true });
    const culprit = rows.find((row) => row.kind === 'leaf' && row.task === 't018');
    expect(culprit?.kind === 'leaf' ? culprit.status : null).toBe('red');
  });
});

describe('the validation moment', () => {
  it('marks the batch a validation just matured, under one bracket', () => {
    const promotes = events.flatMap((event) => (event.type === 'green.promote' ? [event] : []));
    const second = promotes[1];
    if (second === undefined) throw new Error('the recorded run has no second validation');
    const { now, visible, state } = at(second.t - START + 2);
    const rows = stalkRows({ state, events: visible, now, titles });
    const bracket = rows.find((row) => row.kind === 'matured');
    const matured = rows.filter((row) => row.kind === 'leaf' && row.matured);
    expect(bracket?.kind === 'matured' ? bracket.count : 0).toBe(matured.length);
    expect(matured.length).toBeGreaterThan(0);
    expect(matured.every((row) => row.kind === 'leaf' && row.status !== 'sprout')).toBe(true);
  });

  it('shows ideas not started as one queued row', () => {
    const { now, visible, state } = at(60);
    const queued = stalkRows({ state, events: visible, now, titles }).find(
      (row) => row.kind === 'queued',
    );
    expect(queued?.kind === 'queued' ? queued.count : 0).toBeGreaterThan(0);
  });
});

describe('the Files rows', () => {
  it('names the last bean on each area and the beans in flight on it', () => {
    const { now, state, visible } = at(760);
    const paths = [
      ...new Set(visible.flatMap((event) => (event.type === 'land' ? event.files : []))),
    ];
    const listing = dirListing({ paths, state, now, dir: 'src', changedOnly: true });
    const billing = listing.rows.find((row) => row.path === 'src/billing');
    expect(billing?.dir).toBe(true);
    expect(billing?.last?.task).toBe('t040');
    expect(billing?.flying.length).toBeGreaterThan(1);
  });
});

describe('people and sessions', () => {
  it('counts one person and their busy sessions on a recorded run', () => {
    const { state } = at(760);
    const sessions = placeholderSessions(state, 'coop');
    expect(sessions['a0']).toEqual({ slot: 'a0', owner: 'coop', harness: 'Claude Code' });
    expect(activeContributors(state, sessions)).toEqual({ people: 1, sessions: 6 });
  });
});

const ask = (question: string, bean: string | null = null) =>
  planAnswer({
    source: recordedSource(),
    run: v2,
    question,
    classifier: keywordClassifier,
    removed: [],
    ref: null,
    selection: { file: null, bean: TaskId.safeParse(bean).data ?? null, view: null },
    picker: rulesPicker,
  });

describe('the generated explorer', () => {
  it('puts the red-validation card first for "why did the sprout go red?"', async () => {
    const composition = composeAnswer(await ask('why did the sprout go red?'), null);
    expect(composition.components[0]).toBe('red');
    expect(composition.components).toContain('files');
    expect(composition.relevant).toContain('t018');
  });

  it('opens a bean as its journey, with the decision card when it had one', async () => {
    const composition = composeAnswer(await ask('', 't032'), TaskId.parse('t032'));
    expect(composition.components).toEqual(['journey', 'decision']);
    expect(composition.relevant).toEqual(['t032']);
  });

  it('answers who is working with overlaps, files last', async () => {
    const composition = composeAnswer(
      await ask("what's being worked on in billing right now?"),
      null,
    );
    expect(composition.components.at(0)).toBe('overlaps');
    expect(composition.components.at(-1)).toBe('files');
  });

  it('knows the busiest moment of the run', () => {
    const moment = busiestMoment(events);
    expect(moment).not.toBeNull();
    expect(at((moment ?? 0) - START).state.lanes.length).toBe(12);
  });
});
