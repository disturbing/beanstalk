import { describe, expect, it } from 'vitest';

import type { ScriptedTask } from '../testing/fake-world';
import type { LooseEvent } from '../testing/scenario';
import {
  eventsOf,
  runRace,
  soloTask,
  sortedStrings,
  typesOf,
  wellFormedProblems,
} from '../testing/scenario';

/** Two tasks rewriting the same file differently: they conflict textually. */
const clashing = (id: string): ScriptedTask => ({
  id,
  writes: { 'src/shared.ts': `export const owner = '${id}'; // impl:${id}\n` },
});

/** A task whose change breaks its own acceptance test until the author fixes it. */
const buggy = (id: string, extra: Partial<ScriptedTask> = {}): ScriptedTask => ({
  id,
  writes: { [`src/${id}/index.ts`]: `export const ${id} = 'BUG:${id}'; // impl:${id}\n` },
  ...extra,
});

const bugRule = (id: string) => ({
  markers: [`BUG:${id}`],
  file: `tests/${id}.test.ts`,
  name: `${id} works`,
});

const changelog = (id: string): ScriptedTask => ({
  id,
  writes: { 'CHANGELOG.md': `# Changes\n- ${id}\n`, [`src/${id}.ts`]: `// impl:${id}\n` },
});

const after = (events: readonly LooseEvent[], first: LooseEvent): LooseEvent[] =>
  events.filter((event) => event.seq > first.seq);

describe('queue race', () => {
  it('lands every clean task, promotes main and passes the final check', () => {
    const race = runRace({ tasks: ['t001', 't002', 't003', 't004'].map((id) => soloTask(id)) });

    expect(wellFormedProblems(race.events)).toEqual([]);
    expect(eventsOf(race.events, 'land')).toHaveLength(4);
    expect(race.state.phase).toBe('done');
    expect(race.state.aborted).toBeNull();
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({
      suite_green: true,
      correct: true,
      all_tasks_accepted: true,
      tasks_accepted: 4,
      green_tasks: 4,
      base_tests_changed: [],
    });
    expect(Object.values(race.state.tasks).every((task) => task.status === 'green')).toBe(true);
    expect(race.refusals).toEqual([]);
  });

  it('logs the harness event sequence for one task', () => {
    const race = runRace({ tasks: [soloTask('t001')], config: { agents: 1 } });

    expect(typesOf(race.events)).toEqual([
      'race.setup',
      'footprint.predicted',
      'race.start',
      'task.start',
      'invocation.start',
      'invocation.end',
      'task.commit',
      'queue.enqueue',
      'batch.start',
      'ci.start',
      'ci.end',
      'land',
      'green.promote',
      'race.end',
      'ci.start',
      'ci.end',
      'ci.start',
      'ci.end',
      'final.check',
    ]);
  });

  it('never asks the runner for its structural merge tier (the harness baseline)', () => {
    const race = runRace({
      tasks: [clashing('t001'), { ...clashing('t002'), mergesStructurally: true }],
    });

    const squashes = race.world.jobs.filter((job) => job.kind === 'squash');
    expect(squashes.length).toBeGreaterThan(0);
    expect(squashes.every((job) => !job.structural)).toBe(true);
    expect(eventsOf(race.events, 'land').some((event) => 'resolved' in event)).toBe(false);
  });

  it('reworks a textual conflict with main and requeues it', () => {
    const race = runRace({ tasks: [clashing('t001'), clashing('t002')] });

    expect(wellFormedProblems(race.events)).toEqual([]);
    const ejected = eventsOf(race.events, 'queue.eject', { reason: 'conflict' });
    expect(ejected).toHaveLength(1);
    const ejectedEvent = ejected[0];
    if (ejectedEvent === undefined) throw new Error('no ejection');
    const later = after(race.events, ejectedEvent).filter(
      (event) => event['task'] === ejectedEvent['task'],
    );
    const kinds = typesOf(later);
    expect(kinds.indexOf('rework.start')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('rework.start')).toBeLessThan(kinds.indexOf('queue.enqueue'));
    expect(kinds).toContain('land');
    expect(eventsOf(race.events, 'rework.start')[0]).toMatchObject({
      reason: 'conflict',
      conflicts: ['src/shared.ts'],
      attempt: 1,
      resumed: false,
    });
    expect(race.state.conflictsMet).toBeGreaterThanOrEqual(1);
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({
      correct: true,
      all_tasks_accepted: true,
    });
  });

  it('holds a PR that conflicts only with a speculative batch ahead of it', () => {
    const race = runRace({ tasks: [clashing('t001'), clashing('t002')] });

    const holds = eventsOf(race.events, 'queue.hold');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ files: ['src/shared.ts'] });
    expect(eventsOf(race.events, 'merge.conflict')[0]).toMatchObject({ onto_main: true });
  });

  it('bisects a red batch, lands the green prefix and ejects the culprit', () => {
    const race = runRace({
      tasks: [soloTask('t001'), buggy('t002'), soloTask('t003')],
      rules: [bugRule('t002')],
      config: { agents: 3, ci_slots: 1, batch: 3, batch_wait: 3600 },
    });

    expect(wellFormedProblems(race.events)).toEqual([]);
    const red = eventsOf(race.events, 'batch.red');
    expect(red).toHaveLength(1);
    expect(sortedStrings(red[0]?.['tasks'])).toEqual(['t001', 't002', 't003']);
    expect(eventsOf(race.events, 'bisect.start')).toHaveLength(1);
    const end = eventsOf(race.events, 'bisect.end')[0];
    expect(end).toMatchObject({ culprit: 't002' });
    expect(end?.['landed']).not.toContain('t002');
    expect(eventsOf(race.events, 'queue.eject', { task: 't002', reason: 'red' })).toHaveLength(1);
    expect(eventsOf(race.events, 'rework.start', { task: 't002', reason: 'red' })).toHaveLength(1);
    expect(eventsOf(race.events, 'ci.end', { purpose: 'bisect' }).length).toBeGreaterThanOrEqual(1);
    expect(race.state.redValidations).toBeGreaterThanOrEqual(1);
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({
      correct: true,
      all_tasks_accepted: true,
    });
  });

  it('ejects a lone red PR straight to its author with the failing tests', () => {
    const race = runRace({
      tasks: [buggy('t001')],
      rules: [bugRule('t001')],
      config: { agents: 1 },
    });

    expect(eventsOf(race.events, 'bisect.start')).toHaveLength(0);
    expect(eventsOf(race.events, 'queue.eject', { reason: 'red' })[0]).toMatchObject({
      failing: ['tests/t001.test.ts > t001 works'],
      files: ['tests/t001.test.ts'],
    });
    expect(race.state.tasks['t001']?.status).toBe('green');
  });

  it('retries an initial invocation that failed to run, after a backoff', () => {
    const race = runRace({
      tasks: [soloTask('t001', { flakyInitialRuns: 1 })],
      config: { agents: 1 },
    });

    const retry = eventsOf(race.events, 'invocation.retry')[0];
    expect(retry).toMatchObject({ task: 't001', reason: 'exit 1 without a result' });
    const starts = eventsOf(race.events, 'invocation.start', { task: 't001' });
    expect(starts.map((event) => event['attempt'])).toEqual([1, 2]);
    expect((starts[1]?.t ?? 0) - (retry?.t ?? 0)).toBeCloseTo(10, 1);
    expect(race.state.tasks['t001']?.status).toBe('green');
  });

  it('drops a task whose agent fails to run three times', () => {
    const race = runRace({
      tasks: [soloTask('t001', { flakyInitialRuns: 5 })],
      config: { agents: 1 },
    });

    expect(eventsOf(race.events, 'task.drop')[0]).toMatchObject({
      task: 't001',
      reason: 'agent failed to run: exit 1 without a result',
    });
    expect(eventsOf(race.events, 'invocation.retry')).toHaveLength(2);
    expect(race.state.phase).toBe('done');
  });

  it('drops a PR that is still red after max_rework reworks', () => {
    const race = runRace({
      tasks: [buggy('t001', { stubborn: true }), soloTask('t002')],
      rules: [bugRule('t001')],
      config: { batch: 1 },
    });

    expect(eventsOf(race.events, 'task.drop')[0]).toMatchObject({
      task: 't001',
      reason: 'ejected (red) after 3 reworks',
    });
    expect(eventsOf(race.events, 'rework.start', { task: 't001' })).toHaveLength(3);
    expect(race.state.tasks['t002']?.status).toBe('green');
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({
      correct: true,
      all_tasks_accepted: false,
    });
  });

  it('drops a rework that leaves conflict markers after the last round', () => {
    const race = runRace({
      tasks: [
        { ...clashing('t001'), stubborn: true },
        { ...clashing('t002'), stubborn: true },
      ],
      config: { agents: 2, max_rework: 2 },
    });

    expect(eventsOf(race.events, 'rework.markers_left').length).toBeGreaterThanOrEqual(1);
    const drop = eventsOf(race.events, 'task.drop')[0];
    expect(drop?.['reason']).toBe('conflict markers left after the last rework');
  });

  it('drops a replay agent that cannot resolve its rework', () => {
    const race = runRace({
      tasks: [
        { ...clashing('t001'), unresolvable: true },
        { ...clashing('t002'), unresolvable: true },
      ],
    });

    expect(eventsOf(race.events, 'task.drop')[0]?.['reason']).toBe(
      'replay could not resolve the conflict or red (limitation of replay agents)',
    );
  });

  it('aborts cleanly on the budget and still runs the final check', () => {
    const race = runRace({
      tasks: ['t001', 't002', 't003', 't004'].map((id) => soloTask(id)),
      costUsd: 1,
      config: { budget_usd: 2.5 },
    });

    expect(wellFormedProblems(race.events)).toEqual([]);
    expect(race.state.aborted).toBe('budget: $3.00 of $2.50');
    const kinds = typesOf(race.events);
    expect(kinds.indexOf('abort')).toBeLessThan(kinds.indexOf('race.end'));
    expect(kinds.at(-1)).toBe('final.check');
    expect(eventsOf(race.events, 'race.end')[0]).toMatchObject({
      aborted: 'budget: $3.00 of $2.50',
    });
  });

  it('frees the author at enqueue without queue_hold and hands reworks to free slots', () => {
    const race = runRace({
      tasks: [clashing('t001'), clashing('t002'), soloTask('t003'), soloTask('t004')],
      config: { queue_hold: false },
    });

    expect(wellFormedProblems(race.events)).toEqual([]);
    expect(race.state.phase).toBe('done');
    expect(Object.values(race.state.tasks).filter((task) => task.status === 'green')).toHaveLength(
      4,
    );
  });

  it('dissolves CHANGELOG conflicts with the union driver and not without it', () => {
    const tasks = [changelog('t001'), changelog('t002')];
    const baseFiles = { 'CHANGELOG.md': '# Changes\n', 'src/app.ts': 'export {};\n' };

    const union = runRace({ tasks, baseFiles, config: { merge_drivers: 'union' } });
    const plain = runRace({ tasks, baseFiles, config: { merge_drivers: 'none' } });

    expect(union.state.conflictsMet).toBe(0);
    expect(plain.state.conflictsMet).toBeGreaterThanOrEqual(1);
  });

  it('stops on request: kills running agents, logs race.end and the final check', () => {
    const race = runRace({
      tasks: ['t001', 't002'].map((id) => soloTask(id)),
      injections: [{ at: 5000, input: (at) => ({ kind: 'stop', at, reason: 'stopped by admin' }) }],
    });

    expect(wellFormedProblems(race.events)).toEqual([]);
    expect(race.state.aborted).toBe('stopped by admin');
    const killed = race.events.filter(
      (event) => event.type === 'invocation.end' && 'killed' in event,
    );
    expect(killed).toHaveLength(2);
    expect(eventsOf(race.events, 'race.end')[0]).toMatchObject({ killed_processes: 2 });
    expect(race.refusals).toContain('closed_invocation');
  });

  it('never gives work to a slot that does not poll', () => {
    const race = runRace({
      tasks: ['t001', 't002', 't003'].map((id) => soloTask(id)),
      config: { agents: 3 },
      silentSlots: ['a1'],
    });

    expect(eventsOf(race.events, 'task.start').map((event) => event['agent'])).not.toContain('a1');
    expect(race.state.phase).toBe('done');
  });

  it('starts nothing before the admin starts the run', () => {
    const race = runRace({ tasks: [soloTask('t001')], startAfterMs: 60_000 });

    expect(eventsOf(race.events, 'task.start')[0]?.t).toBeGreaterThanOrEqual(60);
  });
});
