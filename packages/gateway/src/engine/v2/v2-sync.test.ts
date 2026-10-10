import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

function runV2(scenario: RaceScenario, config: Partial<RunConfigInput>): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config, ...config } });
}

function stats(run: RaceRun): Record<string, unknown> {
  const block: unknown = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
  if (typeof block !== 'object' || block === null) throw new Error('no beanstalk block');
  return { ...block };
}

/** t001 lands while t002 (declared coupled with it, files apart) is still being written. */
const coupledWhileWriting: RaceScenario = {
  tasks: [soloTask('t001'), soloTask('t002', { coupledWith: ['t001'] })],
  durations: { t001: 10_000, t002: 200_000 },
};

/** Both append to one file from the same base: t002's squash conflicts once t001 landed. */
const conflictWhileWriting: RaceScenario = {
  tasks: [
    soloTask('t001', { appends: { 'src/app.ts': '// t001' } }),
    soloTask('t002', { appends: { 'src/app.ts': '// t002' } }),
  ],
  durations: { t001: 10_000, t002: 200_000 },
};

describe('live sprout sync', () => {
  it('hands a bean the sprout its declared partner landed while it was written', () => {
    const run = runV2(coupledWhileWriting, { live_sync: 'overlap' });
    const applied = eventsOf(run.events, 'sync.applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ task: 't002', landed: ['t001'] });
    const sync = run.world.instructions.find((instruction) => instruction.kind === 'sync');
    expect(sync?.prompt).toContain('t001 "Task t001"');
    expect(sync?.workspace.merge?.sha).toBe(applied[0]?.['sprout']);
    expect(run.state.tasks['t002']?.greenAt).not.toBeNull();
    expect(run.state.tasks['t002']?.reworks).toBe(0);
    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(stats(run)).toMatchObject({ live_sync: 'overlap', syncs_applied: 1, syncs_noted: 0 });
  });

  it('leaves a bean alone under overlap when nothing it touches landed, but not under all', () => {
    const apart: RaceScenario = {
      ...coupledWhileWriting,
      tasks: [soloTask('t001'), soloTask('t002')],
    };
    expect(eventsOf(runV2(apart, { live_sync: 'overlap' }).events, 'sync.applied')).toEqual([]);
    expect(eventsOf(runV2(apart, { live_sync: 'all' }).events, 'sync.applied')).toHaveLength(1);
  });

  it('merges nothing on a conflict and opens the conflict rework with a note', () => {
    const run = runV2(conflictWhileWriting, { live_sync: 'overlap' });
    expect(eventsOf(run.events, 'sync.noted')).toEqual([
      expect.objectContaining({ task: 't002', landed: ['t001'], conflicts: ['src/app.ts'] }),
    ]);
    expect(run.world.instructions.some((instruction) => instruction.kind === 'sync')).toBe(false);
    const rework = run.world.instructions.find(
      (instruction) => instruction.kind === 'rework' && instruction.task === 't002',
    );
    expect(rework?.prompt.startsWith('Note: while you worked')).toBe(true);
    expect(stats(run)).toMatchObject({ syncs_applied: 0, syncs_noted: 1 });
  });

  it('is off by default: no sync events, no summary keys, no variant addition', () => {
    const run = runV2(coupledWhileWriting, {});
    expect(eventsOf(run.events, 'sync.applied')).toEqual([]);
    expect(stats(run)).not.toHaveProperty('live_sync');
    expect(stats(run)['variant_additions']).toEqual([]);
  });

  it('lists the track next to the variant', () => {
    const run = runV2(coupledWhileWriting, { live_sync: 'all' });
    expect(stats(run)['variant_additions']).toEqual(['live_sync:all']);
  });
});
