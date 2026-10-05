import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { SPROUT_REF, STALK_REF } from '../refs';
import { buildSummary } from '../summary';
import type { FailRule, FlakeInjector, ScriptedTask } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, typesOf, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

/** Every v2.2 rule off: the harness's v2. */
const V20: Partial<RunConfigInput> = {
  recheck: 'file',
  release_on_check: false,
  flake_confirm: false,
  inherited_reds: 'off',
  window: 'off',
  early_tickets: false,
  reconcile: false,
  decision_outcome: 'decline',
};

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

function summaryOf(run: RaceRun): Record<string, unknown> {
  return buildSummary(run.state, run.env, run.state.clock);
}

function beanstalkStats(run: RaceRun): Record<string, unknown> {
  const block = summaryOf(run)['beanstalk'];
  if (!isRecord(block)) throw new Error('summary has no beanstalk block');
  return block;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** t002's bug breaks t001's acceptance test once both are on the sprout. */
const BREAKS_T001: FailRule = {
  markers: ['impl:t001', 'BUG:t002'],
  file: 'tests/t001.test.ts',
  name: 't001 keeps working',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

/** A bean that also appends to the changelog (merged with the union driver). */
function changelogTask(id: string): ScriptedTask {
  return soloTask(id, {
    writes: {
      [`src/${id}/index.ts`]: `export const ${id} = 1; // impl:${id}\n`,
      'CHANGELOG.md': `changelog\n${id} entry\n`,
    },
  });
}

/** A bean that rewrites the same line of a shared file as every other such bean. */
function sharedFileTask(id: string): ScriptedTask {
  return soloTask(id, {
    writes: { 'src/shared.ts': `export const owner = '${id}'; // impl:${id}\n` },
  });
}

/** The admin's answer to a card, two simulated hours into the race. */
function adminDecision(winner: string, card = 'D001') {
  return {
    at: 2 * 3600 * 1000,
    input: (at: number) => ({
      kind: 'decision' as const,
      at,
      card,
      winner,
      actor: 'coop',
      text: null,
    }),
  };
}

const buggyT002 = (extra: Partial<ScriptedTask> = {}) =>
  soloTask('t002', {
    writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
    ...extra,
  });

describe('v2: a clean landing', () => {
  it('checks the bean in its sandbox, lands it on the sprout, then promotes it to the stalk', () => {
    const run = runV2({ tasks: [soloTask('t001')], config: { agents: 1 } });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'placement.decision')[0]).toMatchObject({
      task: 't001',
      rule: 'fifo',
      overlap: [],
      occupied: {},
      skipped: [],
    });
    const land = eventsOf(run.events, 'land')[0];
    expect(land).toMatchObject({
      task: 't001',
      ticket: null,
      kind: 'task',
      target: 'trunk',
      trunk_idx: 0,
      unvalidated: 1,
      prelanded: true,
    });
    expect(eventsOf(run.events, 'preland.check')[0]).toMatchObject({ task: 't001', green: true });
    expect(eventsOf(run.events, 'green.promote')[0]).toMatchObject({
      sha: land?.['sha'],
      trunk_idx: 0,
      tasks: ['t001'],
    });
    expect(run.world.repoRef(SPROUT_REF)).toBe(land?.['sha']);
    expect(run.world.repoRef(STALK_REF)).toBe(land?.['sha']);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('runs pre-land checks on the agent sandbox and validations on CI slots, never the reverse', () => {
    const run = runV2({ tasks: [soloTask('t001'), soloTask('t002')] });

    const checks = run.world.jobs.flatMap((job) => (job.kind === 'check' ? [job.instance] : []));
    expect(checks.filter((instance) => instance.kind === 'sandbox')).toHaveLength(2);
    expect(checks.filter((instance) => instance.kind === 'ci').length).toBeGreaterThan(0);
    const preland = eventsOf(run.events, 'preland.check');
    // The suite (1.5 s) plus the emulated latency (ci_seconds), give or take the alarm's ms.
    const seconds = preland.map((event) => Number(event['check_seconds']));
    expect(seconds.every((value) => Math.abs(value - 61.5) < 0.01)).toBe(true);
    expect(eventsOf(run.events, 'ci.start').some((event) => event['purpose'] === 'preland')).toBe(
      false,
    );
  });

  it('reports the v2 block of summary.json in the harness order, then v2.2 to v2.4', () => {
    const run = runV2({ tasks: [soloTask('t001')], config: { agents: 1 } });

    const stats = beanstalkStats(run);
    expect(Object.keys(stats)).toEqual([
      'placements_disjoint',
      'placements_overlap',
      'placement_overlap_modules',
      'landings',
      'fixer_landings',
      'reverts',
      'validations',
      'validations_green',
      'validations_red',
      'stale_reds',
      'tickets',
      'tickets_closed',
      'tickets_escalated',
      'tickets_by_method',
      'trunk_bisect_runs',
      'pauses',
      'paused_seconds',
      'fixers_without_change',
      'preland_checks',
      'preland_red',
      'preland_seconds',
      'preland_reworks',
      'preland_drops',
      'preland_mode',
      'preland_latency',
      'preland_optimistic_landings',
      'preland_rechecks',
      'preland_locked_fallbacks',
      'preland_recheck_rule',
      'preland_skipped_rechecks',
      'preland_hunk_disjoint',
      'preland_hunk_overlap',
      'informed_reworks',
      'cards',
      'card_details',
      'revert_first',
      'release_on_check',
      'agent_waits',
      'agent_wait_seconds',
      'flake_confirm',
      'validation_reruns',
      'flakes_suspected',
      'flaky_tests',
      'inherited_reds',
      'inherited_red_waits',
      'window',
      'window_size',
      'window_waits',
      'recheck_samples',
      'early_tickets',
      'early_tickets_opened',
      'confirmed_by_sighting',
      'reconcile',
      'reconciles',
      'reconciled',
      'contradictions',
      'stale_rechecks',
      'decision_outcome',
      'decision_mode',
      'amendments',
      'amendments_none',
      'amendments_rejected',
      'amendments_rolled_back',
      'reexecutions',
      'adoptions_in_place',
      'mean_suspects_per_ticket',
      'final_trunk_idx',
      'final_green_idx',
      'open_tickets_at_end',
      'ticket_details',
      'variant',
    ]);
    expect(stats).toMatchObject({
      landings: 1,
      preland_checks: 1,
      preland_recheck_rule: 'sampled',
      release_on_check: true,
      flake_confirm: true,
      inherited_reds: 'readset',
      inherited_red_waits: 0,
      window: 'aimd',
      window_size: 6,
      early_tickets: true,
      reconcile: true,
      decision_outcome: 'reexecute',
      variant: 'v2.4',
    });
    expect(summaryOf(run)['policy_rows']).toEqual([
      [
        'Variant',
        'v2.4: v2.3, with clashing tests reconciled before a card and stale reds re-checked',
      ],
      ['Informed reworks / decision cards / revert-first tickets', '0 / 0 / 0'],
      [
        'Agent released on check / reworks that waited for an agent / wait minutes',
        'yes / 0 / 0.0',
      ],
      ['Validation re-runs / suspected flakes', '0 / 0'],
      ['Inherited reds waited out (no rework round spent)', '0'],
      ['Reconciles (reconciled / contradictions) / stale re-checks', '0 (0 / 0) / 0'],
      [
        'Sprout window at the end / window waits / early tickets / re-check samples',
        '6 / 0 / 0 / 0',
      ],
      [
        'Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place',
        '0 / 0 / 0 / 0 / 0 / 0',
      ],
      ['Pre-land checks (red) / reworks / drops', '1 (0) / 0 / 0'],
      ['Pre-land check minutes', expect.stringMatching(/^1\.0[23]$/)],
      ['Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap', 'sampled / 0 / 0 / 0'],
      [
        'Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks',
        'optimistic / 60.0 / 0 / 0 / 0',
      ],
      ['Placements disjoint / overlapping', '1 / 0'],
      ['Fast-trunk landings (task / fixer / revert)', '1 / 0 / 0'],
      ['Validations (green / red)', '1 / 0'],
      ['Repair tickets (closed / escalated / by method)', '0 / 0 / {}'],
      ['Error-budget pauses / paused minutes', '0 / 0.0'],
    ]);
  });

  it('labels the run v2 when every v2.2 rule is off', () => {
    const run = runV2({ tasks: [soloTask('t001')], config: { agents: 1, ...V20 } });

    expect(beanstalkStats(run)).toMatchObject({ variant: 'v2', preland_recheck_rule: 'file' });
    expect(summaryOf(run)['policy_rows']).toContainEqual([
      'Variant',
      'v2: pre-land check, informed author repair, decision cards, revert-first',
    ]);
  });
});

describe('v2: landing while the sprout moves', () => {
  it('lands without a re-check when the commits that landed meanwhile share no file', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      durations: { t001: 30_000, t002: 20_000 },
    });

    const optimistic = eventsOf(run.events, 'preland.optimistic');
    expect(optimistic).toHaveLength(1);
    const first = eventsOf(run.events, 'land', { task: 't002' })[0];
    expect(optimistic[0]).toMatchObject({
      task: 't001',
      checked_on: run.world.baseSha,
      landed_on: first?.['sha'],
      landed_meanwhile: 2,
    });
    expect(eventsOf(run.events, 'preland.check', { task: 't001' })).toHaveLength(1);
    expect(eventsOf(run.events, 'land', { task: 't001' })[0]).toMatchObject({ trunk_idx: 1 });
    expect(beanstalkStats(run)).toMatchObject({
      preland_optimistic_landings: 1,
      preland_rechecks: 0,
    });
  });

  it('checks again when a commit that landed meanwhile touched the same file', () => {
    const run = runV2({
      tasks: [changelogTask('t001'), changelogTask('t002')],
      baseFiles: { 'README.md': 'arena\n', 'CHANGELOG.md': 'changelog\n' },
      durations: { t001: 30_000, t002: 20_000 },
    });

    const first = eventsOf(run.events, 'land', { task: 't002' })[0];
    expect(eventsOf(run.events, 'preland.recheck')).toEqual([
      expect.objectContaining({
        task: 't001',
        checked_on: run.world.baseSha,
        head: first?.['sha'],
        attempt: 1,
      }),
    ]);
    expect(eventsOf(run.events, 'preland.optimistic')).toEqual([]);
    expect(eventsOf(run.events, 'preland.check', { task: 't001' })).toHaveLength(2);
    const stalk = run.world.repoRef(STALK_REF);
    expect(stalk === undefined ? null : run.world.git.get(stalk).files.get('CHANGELOG.md')).toBe(
      'changelog\nt002 entry\nt001 entry\n',
    );
    expect(beanstalkStats(run)).toMatchObject({ preland_rechecks: 1, landings: 2 });
  });

  it('sends a conflict back to its author with the harness prompt, then lands the resolution', () => {
    const run = runV2({
      tasks: [sharedFileTask('t001'), sharedFileTask('t002')],
      durations: { t001: 20_000, t002: 100_000 },
    });

    expect(eventsOf(run.events, 'merge.conflict')[0]).toMatchObject({
      task: 't002',
      ticket: null,
      files: ['src/shared.ts'],
    });
    expect(eventsOf(run.events, 'rework.start')[0]).toMatchObject({
      task: 't002',
      ticket: null,
      reason: 'conflict',
      conflicts: ['src/shared.ts'],
      attempt: 1,
    });
    const rework = run.world.instructions.find((instruction) => instruction.kind === 'rework');
    expect(rework?.prompt).toContain('Your change could not be merged: the trunk moved on');
    expect(rework?.prompt).toContain(
      "The trunk's side was written by these landed changes:\n- t001",
    );
    expect(rework?.prompt).toContain('keep both intents');
    expect(rework?.workspace.merge).toMatchObject({
      ref: SPROUT_REF,
      conflicts: ['src/shared.ts'],
    });
    expect(eventsOf(run.events, 'land').map((event) => event['task'])).toEqual(['t001', 't002']);
  });

  it('lands a bean the runner merged structurally as a normal landing that says so', () => {
    const run = runV2({
      tasks: [changelogTask('t001'), { ...changelogTask('t002'), mergesStructurally: true }],
      durations: { t001: 20_000, t002: 100_000 },
    });

    expect(eventsOf(run.events, 'merge.conflict')).toEqual([]);
    const [first, second] = eventsOf(run.events, 'land');
    expect(first).not.toHaveProperty('resolved');
    expect(second).toMatchObject({ task: 't002', resolved: 'structural' });
  });
});

describe('v2: repair before landing', () => {
  it('reworks a red bean with the failing tests and the landed culprit’s intent and diff', () => {
    const run = runV2({
      tasks: [soloTask('t001'), buggyT002()],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
    });

    const t001 = eventsOf(run.events, 'land', { task: 't001' })[0];
    expect(
      eventsOf(run.events, 'preland.check', { task: 't002' }).map((event) => event['green']),
    ).toEqual([false, true]);
    expect(eventsOf(run.events, 'rework.start')).toEqual([
      expect.objectContaining({
        task: 't002',
        ticket: null,
        reason: 'preland-red',
        failing: ['tests/t001.test.ts > t001 keeps working'],
        attempt: 1,
        resumed: false,
        culprits: ['t001'],
      }),
    ]);
    const rework = run.world.instructions.find((instruction) => instruction.kind === 'rework');
    expect(rework?.prompt).toContain(
      'They involve changes that already landed and are accepted behaviour. Their intent and diffs:\n- t001: Task t001\n  Intent: Implement t001.\n  Diff:\n```diff\nsrc/t001/index.ts  | 1 +\n',
    );
    expect(rework?.prompt).toContain('diff --git a/src/t001/index.ts b/src/t001/index.ts');
    expect(rework?.workspace.merge).toEqual({ sha: t001?.['sha'], ref: SPROUT_REF, conflicts: [] });
    expect(rework?.replay).toEqual({ reset_to: t001?.['sha'], check: 'acceptance', fixes: [] });
    expect(eventsOf(run.events, 'land', { task: 't002' })).toHaveLength(1);
    expect(beanstalkStats(run)).toMatchObject({
      preland_red: 1,
      preland_reworks: 1,
      informed_reworks: 1,
      cards: 0,
    });
  });

  it('opens a decision card after two informed reworks fail; v2.0 declines the arriving bean', () => {
    const run = runV2({
      tasks: [soloTask('t001'), buggyT002({ stubborn: true })],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
      config: { decision_outcome: 'decline' },
    });

    expect(
      eventsOf(run.events, 'rework.start').map((event) => [event['reason'], event['attempt']]),
    ).toEqual([
      ['preland-red', 1],
      ['preland-red', 2],
    ]);
    const request = eventsOf(run.events, 'decision.request')[0];
    expect(request).toMatchObject({
      card: 'D001',
      task: 't002',
      against: ['t001'],
      specs: { t002: 'Task t002', t001: 'Task t001' },
      failing: ['tests/t001.test.ts > t001 keeps working'],
      attempts: 3,
    });
    const made = eventsOf(run.events, 'decision.made')[0];
    expect(made).toMatchObject({
      card: 'D001',
      winner: 't001',
      loser: 't002',
      oracle: 'landed',
      wait_seconds: 30,
    });
    expect(Number(made?.t) - Number(request?.t)).toBeCloseTo(30, 0);
    expect(eventsOf(run.events, 'task.drop', { task: 't002' })[0]).toMatchObject({
      reason: 'declined by decision D001: the accepted spec of t001 was kept',
    });
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(beanstalkStats(run)).toMatchObject({
      cards: 1,
      informed_reworks: 2,
      card_details: [
        {
          card: 'D001',
          task: 't002',
          against: ['t001'],
          winner: 't001',
          specs: { t002: 'Task t002', t001: 'Task t001' },
        },
      ],
    });
  });

  it('lets a human decide for the arriving bean: the landed loser’s tests are amended in place', () => {
    const run = runV2({
      tasks: [
        soloTask('t001', {
          amendTests: { 'tests/t001.test.ts': "test('t001'); // accepts BUG:t002\n" },
        }),
        buggyT002({ stubborn: true }),
      ],
      rules: [{ ...BREAKS_T001, unless: 'accepts BUG:t002' }],
      durations: { t001: 20_000, t002: 100_000 },
      config: { decision_mode: 'human' },
      injections: [adminDecision('t001', 'D009'), adminDecision('t999'), adminDecision('t002')],
    });

    expect(run.refusals).toEqual(['unknown_card', 'invalid_winner']);
    expect(eventsOf(run.events, 'decision.made')[0]).toMatchObject({
      card: 'D001',
      winner: 't002',
      loser: 't001',
      oracle: 'human:coop',
      outcome: 'adopt-in-place',
    });
    const author = run.world.instructions.find((instruction) => instruction.kind === 'test-author');
    expect(author).toMatchObject({ task: 't001', resume: null });
    expect(author?.prompt).toContain('t001 is implemented in this tree');
    expect(eventsOf(run.events, 'spec.amended')[0]).toMatchObject({
      card: 'D001',
      task: 't001',
      status: 'amended',
      paths: ['tests/t001.test.ts'],
      in_place: true,
      fail_first: null,
    });
    const adopt = run.world.instructions.find(
      (instruction) => instruction.task === 't002' && instruction.prompt.includes('Your spec wins'),
    );
    expect(adopt?.workspace.merge).toMatchObject({ ref: 'refs/heads/beans/t001' });
    expect(eventsOf(run.events, 'revert')).toEqual([]);
    expect(eventsOf(run.events, 'land', { task: 't002' })).toHaveLength(1);
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(run.state.amendedTests['t001']).toEqual({
      'tests/t001.test.ts': "test('t001'); // accepts BUG:t002\n",
    });
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });
});

/** A network test that fails the first CI run of every commit. */
const FIRST_CI_RUN_FAILS: FlakeInjector = ({ instance, nth }) =>
  instance.kind === 'ci' && nth === 1
    ? { file: 'tests/net.test.ts', name: 'fetches over the network' }
    : null;

describe('v2: asynchronous validation', () => {
  /** Each bean is fine alone; together they fail a test that reads both. */
  const CLASH: FailRule = {
    markers: ['impl:t001', 'impl:t002'],
    file: 'tests/clash.test.ts',
    name: 'both features together',
    reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  };

  it('reverts the culprit of a red validation first and drops its task, never fixing forward', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      rules: [CLASH],
      durations: { t001: 30_000, t002: 20_000 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const culprit = eventsOf(run.events, 'land', { task: 't001' })[0];
    expect(eventsOf(run.events, 'ticket.open')[0]).toMatchObject({
      ticket: 'R001',
      red_idx: 1,
      failing: ['tests/clash.test.ts'],
      method: 'read-set',
      suspects: [{ idx: 1, sha: culprit?.['sha'], task: 't001', kind: 'task' }],
    });
    expect(eventsOf(run.events, 'ticket.escalate')[0]).toMatchObject({
      ticket: 'R001',
      why: 'revert-first: no fix-forward on the trunk',
      attempts: 2,
    });
    expect(eventsOf(run.events, 'ticket.culprit')[0]).toMatchObject({
      ticket: 'R001',
      trunk_idx: 1,
      task: 't001',
      kind: 'task',
    });
    const revert = eventsOf(run.events, 'revert')[0];
    expect(revert).toMatchObject({
      ticket: 'R001',
      task: 't001',
      reverted: culprit?.['sha'],
      trunk_idx: 2,
    });
    expect(eventsOf(run.events, 'task.drop', { task: 't001' })[0]).toMatchObject({
      reason: 'reverted: repair ticket R001 escalated',
    });
    expect(eventsOf(run.events, 'green.promote').at(-1)).toMatchObject({
      sha: revert?.['sha'],
      trunk_idx: 2,
      tasks: [],
    });
    expect(run.world.repoRef(STALK_REF)).toBe(revert?.['sha']);
    expect(run.world.instructions.every((instruction) => instruction.kind === 'initial')).toBe(
      true,
    );
    expect(beanstalkStats(run)).toMatchObject({
      revert_first: 1,
      reverts: 1,
      tickets: 1,
      tickets_escalated: 1,
      validations_red: 1,
      tickets_by_method: { 'read-set': 1 },
    });
  });

  it('bisects the unvalidated range on CI before reverting when several beans landed', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
      rules: [CLASH],
      durations: { t001: 25_000, t002: 20_000, t003: 30_000 },
      config: { agents: 3, ci_slots: 1 },
    });

    const probes = eventsOf(run.events, 'ci.start').filter(
      (event) => event['purpose'] === 'bisect',
    );
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((event) => event['ticket'] === 'R001')).toBe(true);
    expect(eventsOf(run.events, 'revert')[0]).toMatchObject({ ticket: 'R001', task: 't001' });
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(run.state.tasks['t003']?.status).toBe('green');
    expect(beanstalkStats(run)['trunk_bisect_runs']).toBe(probes.length);
  });

  it('removes suspects one at a time when the search lands on a revert, then gives up', () => {
    // Every validation's first run fails a network test, and v2.0 never re-runs: t001 is
    // reverted for it, the revert is red too, and the search names the revert itself.
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
      flakes: FIRST_CI_RUN_FAILS,
      config: V20,
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const probe = eventsOf(run.events, 'ci.end').find((event) => 'without' in event);
    expect(probe).toMatchObject({ purpose: 'bisect', ticket: 'R002', without: 't003' });
    expect(eventsOf(run.events, 'ticket.stuck')).toEqual([
      expect.objectContaining({ ticket: 'R002', culprit_idx: 2 }),
    ]);
    expect(typesOf(run.events)).toContain('race.stuck');
  });
});

describe('v2: infrastructure failures', () => {
  it('drops only the bean whose runner job keeps failing; the race goes on', () => {
    const run = runV2({ tasks: [soloTask('t001'), soloTask('t002', { squashFails: true })] });

    expect(run.state.aborted).toBeNull();
    expect(eventsOf(run.events, 'task.drop')).toEqual([
      expect.objectContaining({
        task: 't002',
        reason: 'infrastructure failure: squash failed: runner exploded',
      }),
    ]);
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(wellFormedProblems(run.events)).toEqual([]);
  });
});

describe('v2 determinism', () => {
  it('produces the same events from the same inputs', () => {
    const scenario: RaceScenario = {
      tasks: [soloTask('t001'), buggyT002(), soloTask('t003')],
      rules: [BREAKS_T001],
      config: { agents: 2 },
      seed: 11,
    };

    const first = runV2(scenario);
    const second = runV2(scenario);

    expect(second.events).toEqual(first.events);
    expect(typesOf(first.events)).toContain('final.check');
  });
});
