import { describe, expect, it } from 'vitest';

import { RunId } from '@beanstalk/shared-race/ids';

import { classifyByKeywords, keywordClassifier } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';
import { isFinished, leadDecision, leadFacts, suggestions } from '@beanstalk/shared-ask/pick/lead';
import { rulesPicker } from '@beanstalk/shared-ask/pick/picker';
import { busiestMoment } from '@beanstalk/shared-ask/plot/busiest-moment';
import { bedsOf, plotModel } from '@beanstalk/shared-ask/plot/plot-model';
import type { PlotFocus } from '@beanstalk/shared-ask/plot/plot-model';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { recordedSource } from '../forge/recorded-source';
import { titlesOf } from '../recorded/race-pair';
import { recordedRun } from '../recorded/recorded-runs';

const v2 = RunId.parse('7z4j84eqvl');
const recorded = recordedRun(v2);
const events = recorded?.events ?? [];
const titles = recorded === undefined ? {} : titlesOf(recorded);

async function plotAt(now: number, focus: PlotFocus | null = null) {
  const source = recordedSource();
  const [tree, log] = await Promise.all([
    source.repoTree(v2, 'sprout'),
    source.repoLog(v2, 'sprout'),
  ]);
  const visible: readonly RaceEvent[] = events.filter((event) => event.t <= now);
  const state = reduceRace(visible);
  return plotModel({
    state,
    events: visible,
    now,
    beds: bedsOf(tree.files.map((file) => file.path)),
    stats: Object.fromEntries(log.map((commit) => [commit.sha, commit.files])),
    titles,
    focus,
  });
}

const END = events.findLast((event) => event.type === 'race.end')?.t ?? 0;

describe('the Plot of the recorded v2 run', () => {
  it('shows every landing at the end, newest first, and nothing in flight', async () => {
    const model = await plotAt(END);
    const landings = model.rows.filter((row) => row.kind === 'landing');
    expect(landings).toHaveLength(35);
    expect(landings[0]?.kind === 'landing' ? landings[0].idx : null).toBe(34);
    expect(model.buds).toHaveLength(0);
  });

  it('marks the bean bisecting named as the culprit of the red validation', async () => {
    const model = await plotAt(END);
    const culprit = model.rows.find((row) => row.kind === 'landing' && row.task === 't018');
    expect(culprit?.kind === 'landing' ? culprit.status : null).toBe('culprit');
  });

  it('opens the asked files as columns and folds the other landings', async () => {
    const focus: PlotFocus = {
      files: ['src/billing/coupons.ts'],
      beans: ['t024'],
      layout: 'files',
    };
    const model = await plotAt(END, focus);
    expect(model.columns.filter((column) => column.kind === 'file')).toEqual([
      { kind: 'file', bed: 'billing', path: 'src/billing/coupons.ts' },
    ]);
    expect(model.rows.some((row) => row.kind === 'fold')).toBe(true);
    const marked = model.rows.find((row) => row.kind === 'landing' && row.emphasis === 'match');
    expect(marked?.kind === 'landing' ? marked.task : null).toBe('t024');
  });

  it('shows twelve buds at the busiest moment', async () => {
    const moment = busiestMoment(events);
    expect(moment).not.toBeNull();
    const model = await plotAt(moment ?? 0);
    expect(model.buds).toHaveLength(12);
    expect(model.crowd.some((count) => count > 1)).toBe(true);
  });
});

describe('the headline and suggestions', () => {
  it('leads a finished run with how far it grew by rule, from facts code computed', () => {
    const state = reduceRace(events);
    const facts = leadFacts(state, END);
    expect(facts.map((fact) => fact.id)).toEqual(['growth', 'red-history', 'decision', 'drops']);
    expect(facts[0]?.sentence).toBe('35 of 40 beans reached the stalk in 17 minutes 30 seconds.');
    const rule = leadDecision(facts, isFinished(state, END)).rule();
    expect(rule.chosen.slice(0, 3)).toEqual(['growth', 'decision', 'drops']);
  });

  it('suggests questions the keyword router sends where they belong', () => {
    const state = reduceRace(events);
    const expected: Readonly<Record<string, string>> = {
      area: 'recent-changes',
      red: 'what-broke',
      decision: 'decisions',
      agent: 'agent-activity',
    };
    for (const item of suggestions(state, END)) {
      expect(classifyByKeywords(item.question, 'sprout').class, item.question).toBe(
        expected[item.id],
      );
    }
  });
});

describe('asking with a picker', () => {
  it('leaves a receipt for the route, the files and the sections', async () => {
    const answer = await planAnswer({
      source: recordedSource(),
      run: v2,
      question: 'what changed recently on coupons?',
      classifier: keywordClassifier,
      removed: [],
      ref: null,
      selection: { file: null, bean: null, view: null },
      picker: rulesPicker,
    });
    expect(answer.picks.map((receipt) => receipt.decision)).toEqual(['route', 'files', 'sections']);
    expect(answer.sections[0]).toBe('main');
    expect(answer.picks.every((receipt) => receipt.by === 'rules')).toBe(true);
  });

  it('opens a file with blame by bean when the Plot asks for it', async () => {
    const answer = await planAnswer({
      source: recordedSource(),
      run: v2,
      question: '',
      classifier: keywordClassifier,
      removed: [],
      ref: null,
      selection: { file: 'src/billing/tax.ts', bean: null, view: 'blame' },
    });
    expect(answer.main.kind).toBe('file');
    expect(
      answer.main.kind === 'file' ? answer.main.blame?.some((line) => line.task !== null) : false,
    ).toBe(true);
  });
});
