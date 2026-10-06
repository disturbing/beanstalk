import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { SlotId, TaskId } from '@beanstalk/shared-race/ids';

import type { JobSpec } from '../model';
import { requestAgent } from './v2-agents';
import { onLeaveOneOutBuilt, onProbe } from './v2-tickets';
import type { FlakeInjector, World } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import {
  eventsOf,
  landingFlowOf,
  redCheckOf,
  runRace,
  soloTask,
  v2StepAfter,
  wellFormedProblems,
} from '../testing/scenario';
import type { LandingFlow, Ticket, V2Step } from './v2-state';

/**
 * The red-window reset (`red_reset`) and its guards: no green may arrive for a tree the reset
 * discards, superseded validations keep their CI slot until the runner returns it, a parked
 * suspect does not hold the requeue chain, and stale reds on a discarded tree cost no round.
 */
const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', ci_seconds: 60, ci_slots: 2 };
const FLAKY = 'tests/flaky.test.ts';
/** How long the runner takes to build a reset commit in these scenarios (it is 0.3 s otherwise). */
const SLOW_RESET_MS = 120_000;

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

function isReset(spec: JobSpec): boolean {
  return spec.kind === 'revert' && spec.to !== undefined;
}

/** The n-th validation-side suite run (CI instance) flakes red; pre-land checks never do. */
function nthCiRunFlakes(nth: number): FlakeInjector {
  let ciRuns = 0;
  return ({ instance }) => {
    if (instance.kind !== 'ci') return null;
    ciRuns += 1;
    return ciRuns === nth ? { file: FLAKY, name: 'flakes once' } : null;
  };
}

/** A runner whose reset jobs take `SLOW_RESET_MS`. */
function slowResets(world: World): World {
  return { ...world, jobMillis: (spec) => (isReset(spec) ? SLOW_RESET_MS : world.jobMillis(spec)) };
}

/**
 * Three beans land within the first minute; the validation of the second (trunk #1) flakes red
 * and resets the sprout, while the validation of the third (trunk #2) is still running. Its green
 * would land in the middle of the (slow) reset.
 */
function flakeUnderReset(): RaceScenario {
  return {
    tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
    durations: { t001: 10_000, t002: 15_000, t003: 20_000 },
    flakes: nthCiRunFlakes(2),
    wrapWorld: slowResets,
    config: { agents: 3, flake_confirm: false },
  };
}

describe('red_reset: no green for a discarded tree', () => {
  it('cancels the validations the reset discards, so the stalk never goes back', () => {
    const run = runV2(flakeUnderReset());

    expect(wellFormedProblems(run.events)).toEqual([]);
    const [reset] = eventsOf(run.events, 'sprout.reset');
    expect(reset).toBeDefined();
    // The validation of trunk #2 was running when the reset started: it is cancelled, and no
    // verdict for a commit below the reset arrives afterwards.
    const late = eventsOf(run.events, 'ci.end', { purpose: 'validate' }).filter(
      (event) =>
        event.t >= Number(reset?.t) - SLOW_RESET_MS / 1000 &&
        event['cancelled'] !== true &&
        Number(event['trunk_idx']) < Number(reset?.['trunk_idx']),
    );
    expect(late).toEqual([]);
    expect(eventsOf(run.events, 'ticket.close')).toHaveLength(1);
    const promoted = eventsOf(run.events, 'green.promote').map((event) =>
      Number(event['trunk_idx']),
    );
    expect(promoted).toEqual(promoted.toSorted((a, b) => a - b));
    expect(eventsOf(run.events, 'bean.requeued').map((event) => event['task'])).toEqual([
      't002',
      't003',
    ]);
    expect(Object.values(run.state.tasks).map((task) => task.status)).toEqual([
      'green',
      'green',
      'green',
    ]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
    expect(eventsOf(run.events, 'error')).toEqual([]);
  });
});

/** CI suites take `SLOW_SUITE_MS` on the runner; the `nth` of them fails for good. */
function slowSuitesFailing(nth: number): (world: World) => World {
  return (world) => {
    let ciRuns = 0;
    return {
      ...world,
      jobMillis: (spec) =>
        spec.kind === 'check' && spec.instance.kind === 'ci'
          ? SLOW_SUITE_MS
          : world.jobMillis(spec),
      runJob: (spec) => {
        if (spec.kind !== 'check' || spec.instance.kind !== 'ci') return world.runJob(spec);
        ciRuns += 1;
        if (ciRuns === nth)
          return { ok: false, error: 'runner lost the sandbox', retryable: false };
        return world.runJob(spec);
      },
    };
  };
}
const SLOW_SUITE_MS = 50_000;

/**
 * The validation of trunk #2 is still running on the runner when the reset cancels it, and its
 * job then fails for good: that outcome concerns nobody and must not abort the race.
 */
function cancelledSuiteFails(): RaceScenario {
  return {
    ...flakeUnderReset(),
    wrapWorld: slowSuitesFailing(3),
    config: { agents: 3, flake_confirm: false, ci_seconds: 10 },
  };
}

describe('red_reset: a superseded validation keeps its CI slot until the runner returns it', () => {
  it('drops the cancelled run’s failure instead of aborting', () => {
    const run = runV2(cancelledSuiteFails());

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(run.state.aborted).toBeNull();
    const [cancelled] = eventsOf(run.events, 'ci.end', { purpose: 'validate', cancelled: true });
    expect(cancelled).toMatchObject({ trunk_idx: 2 });
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('starts no other suite on that slot before the cancelled one returned', () => {
    const run = runV2(cancelledSuiteFails());

    const [cancelled] = eventsOf(run.events, 'ci.end', { purpose: 'validate', cancelled: true });
    const started = eventsOf(run.events, 'ci.start', { ci: cancelled?.['ci'] })[0];
    const next = eventsOf(run.events, 'ci.start', { slot: cancelled?.['slot'] }).find(
      (event) => event.t > Number(started?.t),
    );
    expect(Number(next?.t) - Number(started?.t)).toBeGreaterThanOrEqual(SLOW_SUITE_MS / 1000);
  });
});

/**
 * t002 breaks t001's test; t002 and t003 both write what that test reads, so the red window's
 * reset holds both as suspects and requeues them one at a time, t002 first. t002 stays red
 * (stubborn) and its card only a person answers: it is parked, with its landing flow kept.
 */
function parkedSuspect(config: Partial<RunConfigInput> = {}): RaceScenario {
  return {
    tasks: [
      soloTask('t001'),
      soloTask('t002', {
        writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
        stubborn: true,
      }),
      soloTask('t003'),
    ],
    rules: [
      {
        markers: ['impl:t001', 'BUG:t002'],
        file: 'tests/t001.test.ts',
        name: 't001 keeps working',
        reads: ['src/t001/index.ts', 'src/t002/index.ts', 'src/t003/index.ts'],
      },
    ],
    durations: { t001: 10_000, t002: 10_500, t003: 12_000 },
    config: { ci_slots: 1, agents: 3, decision_mode: 'human', max_wall_minutes: 30, ...config },
  };
}

describe('red_reset: the requeue chain', () => {
  it('moves on to the next suspect when the current one is parked', () => {
    const run = runV2(parkedSuspect());

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'sprout.reset')[0]).toMatchObject({ requeued: ['t002', 't003'] });
    const parked = eventsOf(run.events, 'task.parked', { task: 't002' })[0];
    expect(parked?.['reason']).toBe('needs a person: decision card D001 (t002 vs t001)');
    const relanded = eventsOf(run.events, 'land', { task: 't003' }).at(-1);
    expect(relanded?.t).toBeGreaterThan(Number(parked?.t));
    expect(run.state.tasks['t003']?.status).toBe('green');
    expect(run.state.aborted).toBeNull();
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });
});

describe('red_reset without release_on_check: a requeued bean’s rework', () => {
  it('waits for a free agent when its old slot works for another bean', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      config: { agents: 2, release_on_check: false },
    });
    const base = v2StepAfter(run);
    const started: LandingFlow[] = [];
    const step = {
      ...base,
      flow: { ...base.flow, startWork: (flow: LandingFlow) => started.push(flow) },
    };
    const busy = step.ctx.state.slots.find((slot) => slot.id === 'a0');
    if (busy === undefined) throw new Error('no slot a0');
    busy.holding = 't002';
    busy.running = 'inv0099-rework';
    // t001 was requeued by a reset: its flow names its old slot, which t002 now works on.
    const flow = landingFlowOf(step, TaskId.parse('t001'), SlotId.parse('a0'));

    requestAgent(step, flow, { kind: 'rescue', failing: [] });

    expect(started).toEqual([]);
    expect(step.state.agentQueue).toEqual(['t001']);
    expect(busy.outbox).toBeNull();
    expect(flow.step.kind).toBe('awaiting-agent');
  });
});

describe('red_reset: a requeued card loser squashes its own change', () => {
  it('moves the loser’s branch back from the test author’s commit before its squash', () => {
    // t002 wins its card against the landed t001 (adopt-in-place): the author amends t001's test
    // on t001's branch. The validation under both then flakes red and the reset requeues t001.
    const run = runV2({
      tasks: [
        soloTask('t001', {
          amendTests: { 'tests/t001.test.ts': "test('t001'); // accepts BUG:t002\n" },
        }),
        soloTask('t002', {
          writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
          stubborn: true,
        }),
      ],
      rules: [
        {
          markers: ['impl:t001', 'BUG:t002'],
          file: 'tests/t001.test.ts',
          name: 't001 keeps working',
          reads: ['src/t001/index.ts', 'src/t002/index.ts'],
          unless: 'accepts BUG:t002',
        },
      ],
      durations: { t001: 20_000, t002: 40_000 },
      flakes: nthCiRunFlakes(1),
      config: {
        agents: 2,
        ci_seconds: 900,
        preland_seconds: 10,
        flake_confirm: false,
        decision_oracle: 'arriving',
        decision_seconds: 1,
      },
    });

    expect(eventsOf(run.events, 'decision.made')[0]).toMatchObject({ outcome: 'adopt-in-place' });
    expect(eventsOf(run.events, 'bean.requeued', { task: 't001' })).toHaveLength(1);
    const jobs = run.world.jobs;
    const repoint = jobs.findIndex(
      (job) => job.kind === 'update-ref' && job.ref === 'refs/heads/beans/t001',
    );
    const author = run.world.instructions.find((instruction) => instruction.kind === 'test-author');
    expect(jobs[repoint]).toMatchObject({ newSha: run.state.tasks['t001']?.headSha });
    expect(jobs[repoint]).not.toMatchObject({ oldSha: run.state.tasks['t001']?.headSha });
    expect(author?.task).toBe('t001');
    // The fake runner checks the squash's merge base: from the author's commit it would fail.
    const relanding = jobs
      .slice(repoint)
      .find((job) => job.kind === 'squash' && job.changeKey === 't001');
    expect(relanding).toBeDefined();
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });
});

/** A finished race's policy step with ticket R900, closed by a green, still searching. */
function closedTicketStep(): V2Step {
  const tasks = ['t001', 't002', 't003', 't004'].map((id) => soloTask(id));
  const step = v2StepAfter(runV2({ tasks, config: { agents: 1 } }));
  const ticket: Ticket = {
    id: 'R900',
    openedAt: 0,
    redSha: step.state.sprout,
    redIdx: 0,
    failingFiles: ['tests/t001.test.ts'],
    failingTests: [],
    output: '',
    suspects: [],
    concurrent: [],
    method: 'bisect',
    attempt: 2,
    status: 'closed',
    revertIdx: null,
    closedAt: 1,
    closedHow: 'green at trunk #0',
    early: false,
  };
  step.state.tickets['R900'] = ticket;
  return step;
}

describe('a ticket a green promotion closed spends no more CI', () => {
  it('stops its bisection at the next probe', () => {
    const step = closedTicketStep();
    step.state.reverts['R900'] = {
      phase: 'bisect',
      search: { lo: -1, hi: 3, files: [], points: [0], probes: { ci9001: 0 }, bad: {} },
    };
    const requested = step.ctx.state.ci.seq;

    // Trunk #0 is good: the search would probe between #0 and #3 next.
    onProbe(step, 'R900', 'ci9001', {
      ...redCheckOf('tests/t001.test.ts', []),
      green: true,
      failingFiles: [],
    });

    expect(step.state.reverts['R900']).toBeUndefined();
    expect(step.ctx.state.ci.seq).toBe(requested);
  });

  it('stops its leave-one-out search when a probe commit is built', () => {
    const step = closedTicketStep();
    step.state.reverts['R900'] = {
      phase: 'leave-one-out',
      idx: 0,
      head: step.state.sprout,
      candidates: [0],
      offset: 1,
      probes: [{ commit: 0, sha: null, isBuilt: false, ciId: null, result: null }],
    };
    const requested = step.ctx.state.ci.seq;

    onLeaveOneOutBuilt(
      step,
      { ticket: 'R900', commit: 0 },
      { kind: 'revert', outcome: 'clean', sha: step.state.sprout, files: [] },
    );

    expect(step.state.reverts['R900']).toBeUndefined();
    expect(step.ctx.state.ci.seq).toBe(requested);
  });
});
