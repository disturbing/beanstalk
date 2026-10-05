import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import type { FailRule } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };
const WITHOUT_E6: Partial<RunConfigInput> = {
  start_cards: false,
  rescue: false,
  dynamic_culprits: false,
};

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

function stats(run: RaceRun): Record<string, unknown> {
  const block: unknown = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
  if (typeof block !== 'object' || block === null) throw new Error('no beanstalk block');
  return { ...block };
}

const AMENDED_T002 = "test('t002'); // AMENDED under the decision\n";

/**
 * t002's own test pins behaviour that t001 changes (t031's `$1000.00` against t005's grouped
 * money): it fails whenever both features are in the tree, unless the test is amended.
 */
const T002_MEETS_T001: FailRule = {
  markers: ['impl:t001', 'impl:t002'],
  file: 'tests/t002.test.ts',
  name: 't002 prints the old format',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  unless: 'AMENDED',
};

/** t001 lands first; t003 keeps the one agent busy until then; t002 declares the coupling. */
function landedPartner(config: Partial<RunConfigInput> = {}): RaceScenario {
  return {
    tasks: [
      soloTask('t001'),
      soloTask('t003'),
      soloTask('t002', {
        coupledWith: ['t001'],
        amendTests: { 'tests/t002.test.ts': AMENDED_T002 },
      }),
    ],
    rules: [T002_MEETS_T001],
    durations: { t001: 10_000, t003: 120_000, t002: 20_000 },
    config: { agents: 1, ...config },
  };
}

describe('v2.5: start cards from declared couplings', () => {
  it('decides a landed partner’s card before the bean starts, so no work is wasted', () => {
    const run = runV2(landedPartner());

    expect(wellFormedProblems(run.events)).toEqual([]);
    const request = eventsOf(run.events, 'decision.request')[0];
    expect(request).toMatchObject({ task: 't002', against: ['t001'], trigger: 'start' });
    const t002Start = eventsOf(run.events, 'task.start', { task: 't002' })[0];
    expect(Number(t002Start?.seq)).toBeGreaterThan(Number(request?.seq));
    expect(eventsOf(run.events, 'spec.amended')[0]).toMatchObject({
      task: 't002',
      status: 'amended',
      fail_first: { failing_files: ['tests/t002.test.ts'] },
    });
    const initial = run.world.instructions.find(
      (instruction) => instruction.task === 't002' && instruction.kind === 'initial',
    );
    expect(initial?.prompt).toContain('Product decision D001 (decided by the product owner)');
    expect(initial?.prompt).toContain('This decision was made before you started');
    expect(initial?.prompt).toContain('t001 "Task t001" is accepted behaviour on the trunk');
    expect(initial?.workspace.acceptance).toEqual({ 'tests/t002.test.ts': AMENDED_T002 });
    expect(eventsOf(run.events, 'preland.check', { task: 't002', green: false })).toEqual([]);
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
    expect(stats(run)).toMatchObject({ cards: 1, start_cards_raised: 1, reexecutions: 0 });
  });

  it('without start cards, the red that names no culprit costs the bean (v2.4)', () => {
    const run = runV2(landedPartner(WITHOUT_E6));

    expect(eventsOf(run.events, 'decision.request')).toEqual([]);
    expect(run.state.tasks['t002']?.dropReason).toBe(
      'pre-land check still red after --max-rework attempts',
    );
  });

  it('starts the winner over the landed partner’s amended tests, carried until it lands', () => {
    const adopted = runV2({
      ...landedPartner({ decision_oracle: 'arriving' }),
      tasks: [
        soloTask('t001', { amendTests: { 'tests/t001.test.ts': "test('t001'); // amended\n" } }),
        soloTask('t003'),
        soloTask('t002', { coupledWith: ['t001'] }),
      ],
      rules: [{ ...T002_MEETS_T001, file: 'tests/t001.test.ts', unless: 'amended' }],
    });
    expect(eventsOf(adopted.events, 'decision.made')[0]).toMatchObject({
      winner: 't002',
      outcome: 'adopt-in-place',
    });
    const initial = adopted.world.instructions.find(
      (instruction) => instruction.task === 't002' && instruction.kind === 'initial',
    );
    expect(initial?.prompt).toContain('your spec wins');
    expect(initial?.workspace.merge?.ref).toBe('refs/heads/beans/t001');
    expect(adopted.state.tasks['t002']?.status).toBe('green');
    expect(adopted.state.amendedTests['t001']).toEqual({
      'tests/t001.test.ts': "test('t001'); // amended\n",
    });
  });

  it('re-checks after a declared partner lands, and raises the card at the first red against it', () => {
    const scenario: RaceScenario = {
      tasks: [
        soloTask('t001'),
        soloTask('t002', {
          coupledWith: ['t001'],
          amendTests: { 'tests/t002.test.ts': AMENDED_T002 },
        }),
      ],
      rules: [T002_MEETS_T001],
      durations: { t001: 10_000, t002: 40_000 },
    };
    const run = runV2(scenario);

    expect(eventsOf(run.events, 'decision.request')[0]).toMatchObject({
      task: 't002',
      attempts: 1,
    });
    expect(eventsOf(run.events, 'decision.request')[0]).not.toHaveProperty('trigger');
    expect(eventsOf(run.events, 'preland.check', { task: 't002', green: false })).toHaveLength(1);
    expect(run.state.tasks['t002']?.status).toBe('green');

    expect(eventsOf(run.events, 'preland.recheck', { task: 't002' })).toHaveLength(1);

    // v2.4: t001 landed during t002's check on disjoint files, so t002 landed unchecked
    // against it, turned the sprout red and was reverted.
    const unchecked = runV2({ ...scenario, config: WITHOUT_E6 });
    expect(unchecked.state.tasks['t002']?.dropReason).toMatch(/^reverted/);
  });
});

const bugRule = (id: string): FailRule => ({
  markers: [`BUG:${id}`],
  file: `tests/${id}.test.ts`,
  name: `${id} works`,
});

const BREAKS_T001: FailRule = {
  markers: ['impl:t001', 'BUG:t002'],
  file: 'tests/t001.test.ts',
  name: 't001 keeps working',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

describe('v2.5: rescue re-execution', () => {
  const stuck = soloTask('t001', {
    writes: { 'src/t001/index.ts': 'export const t001 = 1; // impl:t001 BUG:t001\n' },
    stubborn: true,
  });

  it('re-executes a bean once from scratch when its rework rounds run out', () => {
    const run = runV2({ tasks: [stuck], rules: [bugRule('t001')], config: { agents: 1 } });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'rescue.start')).toEqual([
      expect.objectContaining({ task: 't001', why: 'pre-land check still red', rounds: 3 }),
    ]);
    expect(eventsOf(run.events, 'rework.start', { reason: 'rescue' })[0]).toMatchObject({
      resumed: false,
    });
    const rescue = run.world.instructions.find(
      (instruction) => instruction.kind === 'rework' && instruction.workspace.headSha === null,
    );
    expect(rescue?.resume).toBeNull();
    expect(rescue?.prompt).toContain('Your earlier attempts could not be landed');
    expect(rescue?.prompt).toContain(
      'The last merged tree failed these tests:\n- tests/t001.test.ts > t001 works',
    );
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(stats(run)).toMatchObject({ rescues: 1, preland_drops: 0 });
  });

  it('drops the bean as before when the rescue is off', () => {
    const run = runV2({
      tasks: [stuck],
      rules: [bugRule('t001')],
      config: { agents: 1, rescue: false },
    });

    expect(eventsOf(run.events, 'rescue.start')).toEqual([]);
    expect(run.state.tasks['t001']?.status).toBe('dropped');
  });

  it('rescues a card’s loser whose re-execution still fails, once', () => {
    const buggy = 'export const t002 = 1; // impl:t002 BUG:t002\n';
    const run = runV2({
      tasks: [
        soloTask('t001'),
        soloTask('t002', {
          writes: { 'src/t002/index.ts': buggy },
          stubborn: true,
          reexecutions: [
            { 'src/t002/index.ts': buggy },
            { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002\n' },
          ],
        }),
      ],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
    });

    expect(eventsOf(run.events, 'decision.made')).toHaveLength(1);
    expect(eventsOf(run.events, 'rework.start', { reason: 'decision' })).toHaveLength(1);
    const rescue = eventsOf(run.events, 'rescue.start')[0];
    expect(rescue).toMatchObject({ task: 't002' });
    const rescueRun = run.world.instructions.findLast(
      (instruction) => instruction.task === 't002' && instruction.workspace.headSha === null,
    );
    expect(rescueRun?.prompt).toContain('Other decisions in force for this task:\n- D001');
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(stats(run)).toMatchObject({ cards: 1, reexecutions: 1, rescues: 1 });
  });
});

describe('v2.5: dynamic culprits', () => {
  /** t001 and a decoy t003 land before t002 starts; t002's own test reads both, and t001 breaks it. */
  const scenario: RaceScenario = {
    tasks: [
      soloTask('t001'),
      soloTask('t003'),
      soloTask('t004'),
      soloTask('t002', { amendTests: { 'tests/t002.test.ts': AMENDED_T002 } }),
    ],
    rules: [{ ...T002_MEETS_T001, reads: ['src/t001/index.ts', 'src/t003/index.ts'] }],
    durations: { t001: 10_000, t003: 12_000, t004: 150_000, t002: 20_000 },
    config: { agents: 2, start_cards: false, release_on_check: false },
  };

  it('names a bean that landed before the snapshot, confirmed by leave-one-out probes', () => {
    const run = runV2(scenario);

    expect(wellFormedProblems(run.events)).toEqual([]);
    const search = eventsOf(run.events, 'culprit.dynamic', { task: 't002' })[0];
    expect(search).toMatchObject({ confirmed: ['t001'] });
    expect(search?.['candidates']).toEqual(expect.arrayContaining(['t001', 't003']));
    expect(eventsOf(run.events, 'rework.start', { task: 't002' })[0]).toMatchObject({
      culprits: ['t001'],
    });
    expect(eventsOf(run.events, 'decision.request')[0]).toMatchObject({
      task: 't002',
      against: ['t001'],
    });
    expect(run.state.tasks['t002']?.status).toBe('green');
  });

  it('names no culprit from before the snapshot without it (v2.4)', () => {
    const run = runV2({ ...scenario, config: { ...scenario.config, ...WITHOUT_E6 } });

    expect(eventsOf(run.events, 'culprit.dynamic')).toEqual([]);
    expect(eventsOf(run.events, 'rework.start', { task: 't002' })[0]).toMatchObject({
      culprits: [],
    });
    expect(run.state.tasks['t002']?.status).toBe('dropped');
  });
});
