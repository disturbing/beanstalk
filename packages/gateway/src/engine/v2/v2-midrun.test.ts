import { describe, expect, it } from 'vitest';

import type { InvocationResult, MidrunSyncOutcome } from '@gitstalk/shared-race/driver';
import { Sha } from '@gitstalk/shared-race/ids';
import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import type { EngineInput, EngineInstruction } from '../model';
import { SPROUT_REF } from '../refs';
import { buildSummary } from '../summary';
import { longBurst } from '../testing/burst';
import type { World } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

/** t002's initial run, still being written long after t001 landed. */
const T002_INITIAL = 'inv0002-initial';

function progressAt(at: number, files: readonly string[]): NonNullable<RaceScenario['injections']> {
  const input = (now: number): EngineInput => ({
    kind: 'progress',
    at: now,
    slot: 'a1',
    inv: T002_INITIAL,
    costUsd: 0.01,
    files,
  });
  return [{ at, input }];
}

/** t001 and t002 both append to src/app.ts; t001 lands while t002 is still running. */
function race(config: Partial<RunConfigInput>, extra: Partial<RaceScenario> = {}): RaceRun {
  return runRace({
    tasks: [
      soloTask('t001', { appends: { 'src/app.ts': '// t001' } }),
      soloTask('t002', { appends: { 'src/app.ts': '// t002' } }),
    ],
    durations: { t001: 10_000, t002: 300_000 },
    injections: [...progressAt(120_000, ['src/app.ts']), ...progressAt(150_000, ['src/app.ts'])],
    ...extra,
    config: { ...V2, ...config },
  });
}

function beanstalkStats(run: RaceRun): Record<string, unknown> {
  const block: unknown = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
  if (typeof block !== 'object' || block === null) throw new Error('no beanstalk block');
  return { ...block };
}

/** The run's event types in order, its config line aside. */
function shape(run: RaceRun): string[] {
  return run.events.filter((event) => event.type !== 'race.start').map((event) => event.type);
}

function offeredSprout(): Sha {
  const offered = eventsOf(race({ live_sync_midrun: true }).events, 'sync.midrun.offered');
  return Sha.parse(offered[0]?.['sprout']);
}

/**
 * What the driver posts after its hook merged the sprout into t002's worktree mid-run: the
 * agent's commit sits on a merge of the sprout, and the hook reports it applied.
 */
function mergedMidrun(
  world: World,
  instruction: EngineInstruction,
  result: InvocationResult,
): InvocationResult {
  const sprout = world.repoRef(SPROUT_REF);
  if (instruction.inv !== T002_INITIAL || result.head_sha === null || sprout === undefined) {
    return result;
  }
  const files = new Map([...world.git.get(sprout).files, ...world.git.get(result.head_sha).files]);
  const merged = world.git.commit([result.head_sha, sprout], files, 'merge sprout');
  world.git.setRef('repo', `refs/heads/${instruction.workspace.branch}`, merged.sha);
  const landed = ['t001'];
  return {
    ...result,
    head_sha: merged.sha,
    midrun_syncs: [{ sprout, landed, outcome: 'applied', reason: null, files: [] }],
  };
}

describe('mid-run live sprout sync', () => {
  it('offers a landed bean that meets the running bean once, with the sprout head', () => {
    const run = race({ live_sync_midrun: true });
    const offered = eventsOf(run.events, 'sync.midrun.offered');
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({
      task: 't002',
      inv: T002_INITIAL,
      landed: ['t001'],
      files: ['src/app.ts'],
    });
    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(beanstalkStats(run)).toMatchObject({
      live_sync_midrun: true,
      midrun_offered: 1,
      variant_additions: ['live_sync_midrun'],
    });
  });

  it('offers nothing under overlap when the running bean has not touched the landed files', () => {
    const run = race(
      { live_sync_midrun: true },
      { injections: progressAt(120_000, ['src/t002/index.ts']) },
    );
    expect(eventsOf(run.events, 'sync.midrun.offered')).toEqual([]);
  });

  it('offers every landed bean when live_sync is all', () => {
    const run = race(
      { live_sync_midrun: true, live_sync: 'all' },
      { injections: progressAt(120_000, ['src/t002/index.ts']) },
    );
    expect(eventsOf(run.events, 'sync.midrun.offered')).toHaveLength(1);
  });

  it('logs what the hook did and moves the merged line to an applied sprout', () => {
    const run = runRace({
      tasks: [soloTask('t001'), soloTask('t002', { coupledWith: ['t001'] })],
      durations: { t001: 10_000, t002: 300_000 },
      injections: progressAt(120_000, ['src/t002/index.ts']),
      afterAgent: mergedMidrun,
      config: { ...V2, live_sync_midrun: true },
    });
    const sprout = eventsOf(run.events, 'sync.midrun.offered')[0]?.['sprout'];
    expect(eventsOf(run.events, 'sync.midrun.applied')).toEqual([
      expect.objectContaining({ task: 't002', inv: T002_INITIAL, sprout, landed: ['t001'] }),
    ]);
    expect(run.state.tasks['t002']?.mergedMain).toBe(sprout);
    expect(run.state.tasks['t002']?.greenAt).not.toBeNull();
    expect(beanstalkStats(run)).toMatchObject({ midrun_applied: 1, midrun_noted: 0 });
    expect(wellFormedProblems(run.events)).toEqual([]);
  });

  it('logs a noted offer with its reason', () => {
    const sprout = offeredSprout();
    const reason = 'the merge would conflict in src/app.ts';
    const reports = (inv: string): MidrunSyncOutcome[] =>
      inv === T002_INITIAL
        ? [{ sprout, landed: ['t001'], outcome: 'noted', reason, files: ['src/app.ts'] }]
        : [];
    const run = race(
      { live_sync_midrun: true },
      {
        afterAgent: (_world, instruction, result) => ({
          ...result,
          midrun_syncs: reports(instruction.inv),
        }),
      },
    );
    expect(eventsOf(run.events, 'sync.midrun.noted')).toEqual([
      expect.objectContaining({ task: 't002', reason }),
    ]);
  });

  it('is off by default: progress replies offer nothing and the summary is unchanged', () => {
    const run = race({});
    expect(eventsOf(run.events, 'sync.midrun.offered')).toEqual([]);
    expect(beanstalkStats(run)).not.toHaveProperty('live_sync_midrun');
    expect(beanstalkStats(run)['variant_additions']).toEqual([]);
  });

  it('leaves a simulated burst as it was: replay agents report no progress', () => {
    const config = { policy: 'beanstalk-v2', preland_mode: 'optimistic' } as const;
    const off = runRace(longBurst(3, config));
    const on = runRace(longBurst(3, { ...config, live_sync_midrun: true }));
    expect(shape(on)).toEqual(shape(off));
    expect(wellFormedProblems(on.events)).toEqual([]);
  });

  it('is refused for the queue', () => {
    expect(() => race({ policy: 'queue', live_sync_midrun: true })).toThrow(/live_sync_midrun/);
  });
});
